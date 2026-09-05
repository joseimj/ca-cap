"""ca-cap service: tope automatizado de tokens para agentes de Conversational Analytics en Looker.

Autenticación:
  - Automatizaciones (webhook de Looker, Cloud Scheduler): cabecera X-Cap-Key o ?key= con CAP_KEY.
  - Extensión de Looker: POST /auth (vía serverProxy, con CAP_KEY resuelto por Looker) devuelve un JWT
    de corta duración que se usa como "Authorization: Bearer" en el resto de llamadas (fetchProxy).

Endpoints:
  POST /auth                      Cambia CAP_KEY por un JWT.
  GET  /config                    Configuración efectiva (explore, campos, prefijo de grupo, tope global).
  GET  /caps | PUT /caps/<id> | DELETE /caps/<id>   Topes por agente.
  GET  /suspensions               Suspensiones activas.
  GET  /history?limit=100         Historial de cortes y restauraciones.
  POST /suspend/<id>              Corte manual de un agente.
  POST /restore[?agent_id=<id>]   Restaura el acceso (todo o un agente).
  POST /hook                      Webhook del schedule de Looker (filas del Look).
  POST /check                     Modo pull: consulta System Activity y aplica los topes.
  GET  /healthz

Cómo corta: cada agente se comparte en Looker ÚNICAMENTE con un grupo <GROUP_PREFIX><agent_id>.
Vaciar ese grupo = los usuarios pierden el acceso View al agente sin tocar ningún otro permiso.
La lista de miembros se guarda en Firestore para poder restaurarla.
"""

import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from functools import wraps

import jwt
import looker_sdk
import requests
from flask import Flask, abort, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from looker_sdk import error as looker_error
from looker_sdk import models40 as models
from werkzeug.exceptions import HTTPException

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("ca-cap")

# ----------------------------------------------------------------------------
# Configuración (variables de entorno)
# ----------------------------------------------------------------------------
CAP_KEY = os.environ["CAP_KEY"]                          # secreto compartido con Looker y Cloud Scheduler
JWT_SECRET = os.getenv("JWT_SECRET") or CAP_KEY          # firma de los JWT de la extensión
JWT_TTL_SECONDS = int(os.getenv("JWT_TTL_SECONDS", "900"))
LOOKER_BASE_URL = os.getenv("LOOKERSDK_BASE_URL", "").rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", LOOKER_BASE_URL).split(",") if o.strip()]

GROUP_PREFIX = os.getenv("GROUP_PREFIX", "ca-agente-")   # grupo por agente: ca-agente-<agent_id>
TOKEN_CAP = int(os.getenv("TOKEN_CAP", "0"))             # tope global; 0 = sin tope global
COL_AGENT_ID = os.getenv("COL_AGENT_ID", "agent.id")     # nombres de campo tal como salen del Look
COL_AGENT_NAME = os.getenv("COL_AGENT_NAME", "agent.name")
COL_TOKENS = os.getenv("COL_TOKENS", "usage.total_tokens")
SA_EXPLORE = os.getenv("SA_EXPLORE", "")                 # explore de System Activity con tokens por agente
SA_DATE_FIELD = os.getenv("SA_DATE_FIELD", "")
SA_DATE_FILTER = os.getenv("SA_DATE_FILTER", "this month")
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"
FS_PREFIX = os.getenv("FS_PREFIX", "ca_cap")

db = firestore.Client()
activos = db.collection(f"{FS_PREFIX}_active")      # una suspensión activa por agente (doc id = agent_id)
historial = db.collection(f"{FS_PREFIX}_history")   # eventos de corte y restauración
topes = db.collection(f"{FS_PREFIX}_caps")          # tope por agente (doc id = agent_id)


class ISOJSONProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


app = Flask(__name__)
app.json = ISOJSONProvider(app)
CORS(app, origins=CORS_ORIGINS, allow_headers=["Authorization", "Content-Type", "X-Cap-Key"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

@app.errorhandler(HTTPException)
def handle_http_error(exc):
    """Errores siempre en JSON para que la extensión pueda mostrarlos."""
    return jsonify({"message": exc.description, "status": exc.code}), exc.code


_sdk = None


def sdk():
    """Cliente Looker perezoso. Lee LOOKERSDK_BASE_URL / LOOKERSDK_CLIENT_ID / LOOKERSDK_CLIENT_SECRET."""
    global _sdk
    if _sdk is None:
        _sdk = looker_sdk.init40()
    return _sdk


# ----------------------------------------------------------------------------
# Autenticación
# ----------------------------------------------------------------------------
def actor_actual():
    key = request.headers.get("X-Cap-Key") or request.args.get("key") or ""
    if key and hmac.compare_digest(key, CAP_KEY):
        return "cap-key"
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            claims = jwt.decode(auth[7:], JWT_SECRET, algorithms=["HS256"])
            return str(claims.get("sub") or "extension")
        except jwt.PyJWTError:
            abort(401)
    abort(401)


def protegido(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        g.actor = actor_actual()
        return fn(*args, **kwargs)
    return wrapper


@app.post("/auth")
def auth():
    body = request.get_json(force=True, silent=True) or {}
    if not hmac.compare_digest(str(body.get("cap_key", "")), CAP_KEY):
        abort(401)
    sub = str(body.get("user") or "extension")[:200]
    now = int(time.time())
    token = jwt.encode({"sub": sub, "iat": now, "exp": now + JWT_TTL_SECONDS}, JWT_SECRET, algorithm="HS256")
    return jsonify({"token": token, "expires_in": JWT_TTL_SECONDS})


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def unwrap(value):
    """El formato 'JSON detallado' de Looker envuelve cada celda en {"value": ..., "rendered": ...}."""
    return value.get("value") if isinstance(value, dict) else value


def to_int(value):
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return 0


def rows_from_webhook(payload):
    """Extrae las filas del Look del payload del webhook (formatos JSON simple y detallado)."""
    data = (payload.get("attachment") or {}).get("data")
    if data is None:
        return []
    if isinstance(data, str):
        data = json.loads(data) if data.strip() else []
    if isinstance(data, dict):
        data = data.get("data", [])
    return [{k: unwrap(v) for k, v in row.items()} for row in data]


def periodo_actual():
    return datetime.now(timezone.utc).strftime("%Y-%m")


def notificar(texto):
    log.info(texto)
    if SLACK_WEBHOOK_URL:
        try:
            requests.post(SLACK_WEBHOOK_URL, json={"text": texto}, timeout=10)
        except requests.RequestException as exc:
            log.warning("No se pudo avisar a Slack: %s", exc)


def buscar_grupo(agent_id):
    nombre = f"{GROUP_PREFIX}{agent_id}"
    for grupo in sdk().search_groups(name=nombre):
        if grupo.name == nombre:
            return grupo
    return None


def miembros_del_grupo(group_id):
    usuarios, offset, lote = [], 0, 500
    while True:
        pagina = sdk().all_group_users(group_id=group_id, fields="id,email", limit=lote, offset=offset)
        usuarios.extend(pagina)
        if len(pagina) < lote:
            return usuarios
        offset += lote


def cargar_topes():
    return {snap.id: snap.to_dict() for snap in topes.stream()}


def tope_para(agent_id, config_topes):
    propio = config_topes.get(agent_id) or {}
    return int(propio.get("cap") or 0) or TOKEN_CAP


# ----------------------------------------------------------------------------
# Corte
# ----------------------------------------------------------------------------
def cortar(agent_id, agent_name, tokens, tope, origen, actor):
    ref = activos.document(agent_id)
    if ref.get().exists:
        return {"agent_id": agent_id, "action": "skip", "reason": "already_suspended"}

    grupo = buscar_grupo(agent_id)
    if grupo is None:
        notificar(f":warning: El agente {agent_name} ({agent_id}) superó el tope pero no existe "
                  f"el grupo {GROUP_PREFIX}{agent_id}; no se aplicó el corte.")
        return {"agent_id": agent_id, "action": "error", "reason": "group_not_found"}

    miembros = miembros_del_grupo(grupo.id)
    user_ids = [str(u.id) for u in miembros]

    if DRY_RUN:
        notificar(f":test_tube: [DRY RUN] Se retirarían {len(user_ids)} usuarios del grupo {grupo.name} "
                  f"(agente {agent_name}, {tokens:,} tokens).")
        return {"agent_id": agent_id, "action": "dry_run", "users": len(user_ids)}

    registro = {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "group_id": str(grupo.id),
        "group_name": grupo.name,
        "user_ids": user_ids,
        "tokens": tokens,
        "cap": tope,
        "period": periodo_actual(),
        "source": origen,
        "actor": actor,
        "status": "suspending",
        "suspended_at": firestore.SERVER_TIMESTAMP,
    }
    # 1) Guardar primero la lista de miembros: si algo falla a medias, la restauración sigue siendo posible.
    ref.set(registro)

    # 2) Vaciar el grupo.
    fallos = 0
    for uid in user_ids:
        try:
            sdk().delete_group_user(group_id=grupo.id, user_id=uid)
        except looker_error.SDKError as exc:
            fallos += 1
            log.warning("No se pudo retirar al usuario %s del grupo %s: %s", uid, grupo.id, exc)

    ref.update({"status": "suspended", "failed_removals": fallos})
    historial.add({**registro, "status": "suspended", "event": "suspend",
                   "failed_removals": fallos, "at": firestore.SERVER_TIMESTAMP})
    notificar(f":no_entry: Tope de tokens ({origen}): agente {agent_name} ({agent_id}) con {tokens:,} tokens. "
              f"{len(user_ids) - fallos} usuarios retirados del grupo {grupo.name}.")
    return {"agent_id": agent_id, "action": "suspended", "users": len(user_ids), "failed": fallos}


def evaluar(rows, origen, actor):
    config_topes = cargar_topes()
    resultados = []
    for row in rows:
        agent_id = str(row.get(COL_AGENT_ID) or "").strip()
        if not agent_id:
            continue
        tokens = to_int(row.get(COL_TOKENS))
        tope = tope_para(agent_id, config_topes)
        if tope and tokens < tope:
            continue
        if not tope and origen != "webhook":
            continue  # sin tope definido solo cortamos si el Look ya filtró por tope
        agent_name = str(row.get(COL_AGENT_NAME) or agent_id)
        resultados.append(cortar(agent_id, agent_name, tokens, tope, origen, actor))
    return resultados


# ----------------------------------------------------------------------------
# Restauración
# ----------------------------------------------------------------------------
def restaurar(solo_agent_id, actor):
    resultados = []
    for snap in activos.stream():
        datos = snap.to_dict()
        if solo_agent_id and datos.get("agent_id") != solo_agent_id:
            continue
        devueltos = 0
        for uid in datos.get("user_ids", []):
            try:
                if not DRY_RUN:
                    sdk().add_group_user(group_id=datos["group_id"],
                                         body=models.GroupIdForGroupUserInclusion(user_id=uid))
                devueltos += 1
            except looker_error.SDKError as exc:
                log.warning("No se pudo devolver al usuario %s al grupo %s: %s", uid, datos["group_id"], exc)
        if not DRY_RUN:
            historial.add({
                "event": "restore", "agent_id": datos.get("agent_id"), "agent_name": datos.get("agent_name"),
                "group_id": datos.get("group_id"), "group_name": datos.get("group_name"),
                "restored_users": devueltos, "period": datos.get("period"), "actor": actor,
                "at": firestore.SERVER_TIMESTAMP,
            })
            snap.reference.delete()
        notificar(f":white_check_mark: Acceso restaurado: agente {datos.get('agent_name')} ({datos.get('agent_id')}), "
                  f"{devueltos} usuarios de vuelta en {datos.get('group_name')}.")
        resultados.append({"agent_id": datos.get("agent_id"), "action": "restored", "users": devueltos})
    return resultados


# ----------------------------------------------------------------------------
# Modo pull
# ----------------------------------------------------------------------------
def consultar_system_activity():
    body = models.WriteQuery(
        model="system__activity",
        view=SA_EXPLORE,
        fields=[COL_AGENT_ID, COL_AGENT_NAME, COL_TOKENS],
        filters={SA_DATE_FIELD: SA_DATE_FILTER} if SA_DATE_FIELD else None,
        limit="500",
    )
    return json.loads(sdk().run_inline_query(result_format="json", body=body))


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------
@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/config")
@protegido
def config():
    return jsonify({
        "group_prefix": GROUP_PREFIX, "token_cap": TOKEN_CAP, "dry_run": DRY_RUN,
        "sa_explore": SA_EXPLORE, "sa_date_field": SA_DATE_FIELD, "sa_date_filter": SA_DATE_FILTER,
        "col_agent_id": COL_AGENT_ID, "col_agent_name": COL_AGENT_NAME, "col_tokens": COL_TOKENS,
        "period": periodo_actual(),
    })


@app.get("/caps")
@protegido
def list_caps():
    return jsonify([{"agent_id": snap.id, **snap.to_dict()} for snap in topes.stream()])


@app.put("/caps/<agent_id>")
@protegido
def put_cap(agent_id):
    body = request.get_json(force=True, silent=True) or {}
    cap = to_int(body.get("cap"))
    if cap <= 0:
        abort(400, "cap debe ser un entero positivo")
    datos = {"cap": cap, "agent_name": str(body.get("agent_name") or agent_id),
             "updated_by": g.actor, "updated_at": firestore.SERVER_TIMESTAMP}
    topes.document(agent_id).set(datos)
    return jsonify({"agent_id": agent_id, "cap": cap})


@app.delete("/caps/<agent_id>")
@protegido
def delete_cap(agent_id):
    topes.document(agent_id).delete()
    return jsonify({"agent_id": agent_id, "deleted": True})


@app.get("/suspensions")
@protegido
def list_suspensions():
    return jsonify([snap.to_dict() for snap in activos.stream()])


@app.get("/history")
@protegido
def list_history():
    limit = min(to_int(request.args.get("limit")) or 100, 500)
    consulta = historial.order_by("at", direction=firestore.Query.DESCENDING).limit(limit)
    return jsonify([{"id": snap.id, **snap.to_dict()} for snap in consulta.stream()])


@app.post("/suspend/<agent_id>")
@protegido
def suspend(agent_id):
    body = request.get_json(force=True, silent=True) or {}
    agent_name = str(body.get("agent_name") or agent_id)
    tokens = to_int(body.get("tokens"))
    tope = tope_para(agent_id, cargar_topes())
    return jsonify(cortar(agent_id, agent_name, tokens, tope, "manual", g.actor))


@app.post("/restore")
@protegido
def restore():
    return jsonify(restaurar(request.args.get("agent_id"), g.actor))


@app.post("/hook")
@protegido
def hook():
    payload = request.get_json(force=True, silent=True) or {}
    rows = rows_from_webhook(payload)
    log.info("Webhook recibido: %d filas del Look", len(rows))
    return jsonify(evaluar(rows, "webhook", g.actor))


@app.post("/check")
@protegido
def check():
    if not SA_EXPLORE:
        abort(400, "Configura SA_EXPLORE (y COL_*) para usar el modo pull")
    rows = consultar_system_activity()
    log.info("System Activity: %d filas", len(rows))
    return jsonify(evaluar(rows, "check", g.actor))


@app.get("/status")
@protegido
def status():
    """Compatibilidad con la v1."""
    return list_suspensions()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
