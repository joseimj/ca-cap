#!/usr/bin/env bash
# Despliega el servicio ca-cap en Cloud Run y crea los jobs de Cloud Scheduler.
#
# Uso:
#   export PROJECT_ID=mi-proyecto REGION=us-central1
#   export LOOKER_BASE_URL=https://mi-instancia.cloud.looker.com
#   export LOOKER_CLIENT_ID=... LOOKER_CLIENT_SECRET=...      # credenciales API de un usuario de servicio Admin
#   export CAP_KEY=$(openssl rand -hex 24)                     # secreto compartido (Looker webhook, Scheduler, extensión)
#   export JWT_SECRET=$(openssl rand -hex 32)                  # firma de los JWT de la extensión
#   export COL_AGENT_ID=agent.id COL_AGENT_NAME=agent.name COL_TOKENS=usage.total_tokens   # ajusta a tu Look
#   export SA_EXPLORE=... SA_DATE_FIELD=...                    # opcional: modo pull y pantalla de consumo
#   export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...   # opcional
#   export DRY_RUN=true                                        # primera vez: no toca grupos
#   ./deploy.sh
set -euo pipefail

: "${PROJECT_ID:?define PROJECT_ID}"
: "${LOOKER_BASE_URL:?define LOOKER_BASE_URL}"
: "${LOOKER_CLIENT_ID:?define LOOKER_CLIENT_ID}"
: "${LOOKER_CLIENT_SECRET:?define LOOKER_CLIENT_SECRET}"
: "${CAP_KEY:?define CAP_KEY}"
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-ca-cap}
SA_NAME=${SA_NAME:-ca-cap-sa}
SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
TZ_RESTORE=${TZ_RESTORE:-America/Mexico_City}

gcloud config set project "$PROJECT_ID" >/dev/null

echo ">> APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com

echo ">> Firestore (modo nativo, si no existe)"
gcloud firestore databases create --location="$REGION" --quiet 2>/dev/null || true

echo ">> Secretos"
upsert_secret() {
  local name=$1 value=$2
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf %s "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    printf %s "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
  fi
}
upsert_secret looker-client-id "$LOOKER_CLIENT_ID"
upsert_secret looker-client-secret "$LOOKER_CLIENT_SECRET"
upsert_secret ca-cap-key "$CAP_KEY"
upsert_secret ca-cap-jwt-secret "$JWT_SECRET"

echo ">> Cuenta de servicio"
gcloud iam service-accounts create "$SA_NAME" --display-name="ca-cap" 2>/dev/null || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA_EMAIL" \
  --role=roles/datastore.user --quiet >/dev/null
for s in looker-client-id looker-client-secret ca-cap-key ca-cap-jwt-secret; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA_EMAIL" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done

echo ">> Cloud Run"
# El delimitador ^@^ evita problemas con comas dentro de los valores.
ENV_VARS="^@^LOOKERSDK_BASE_URL=$LOOKER_BASE_URL"
ENV_VARS+="@CORS_ORIGINS=${CORS_ORIGINS:-$LOOKER_BASE_URL}"
ENV_VARS+="@GROUP_PREFIX=${GROUP_PREFIX:-ca-agente-}"
ENV_VARS+="@COL_AGENT_ID=${COL_AGENT_ID:-agent.id}"
ENV_VARS+="@COL_AGENT_NAME=${COL_AGENT_NAME:-agent.name}"
ENV_VARS+="@COL_TOKENS=${COL_TOKENS:-usage.total_tokens}"
ENV_VARS+="@TOKEN_CAP=${TOKEN_CAP:-0}"
ENV_VARS+="@DRY_RUN=${DRY_RUN:-false}"
ENV_VARS+="@SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL:-}"
ENV_VARS+="@SA_EXPLORE=${SA_EXPLORE:-}"
ENV_VARS+="@SA_DATE_FIELD=${SA_DATE_FIELD:-}"
ENV_VARS+="@SA_DATE_FILTER=${SA_DATE_FILTER:-this month}"
ENV_VARS+="@FS_PREFIX=${FS_PREFIX:-ca_cap}"

gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --timeout 300 \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "LOOKERSDK_CLIENT_ID=looker-client-id:latest,LOOKERSDK_CLIENT_SECRET=looker-client-secret:latest,CAP_KEY=ca-cap-key:latest,JWT_SECRET=ca-cap-jwt-secret:latest"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')

upsert_job() {
  local name=$1 schedule=$2 path=$3
  if gcloud scheduler jobs describe "$name" --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" --location "$REGION" --schedule "$schedule" \
      --time-zone "$TZ_RESTORE" --uri "$URL$path" --http-method POST --headers "X-Cap-Key=$CAP_KEY" >/dev/null
  else
    gcloud scheduler jobs create http "$name" --location "$REGION" --schedule "$schedule" \
      --time-zone "$TZ_RESTORE" --uri "$URL$path" --http-method POST --headers "X-Cap-Key=$CAP_KEY" >/dev/null
  fi
}

echo ">> Cloud Scheduler: restauración el día 1 a las 00:30 ($TZ_RESTORE)"
upsert_job ca-cap-restore "30 0 1 * *" "/restore"

if [[ -n "${SA_EXPLORE:-}" ]]; then
  echo ">> Cloud Scheduler: evaluación en modo pull cada 6 horas"
  upsert_job ca-cap-check "15 */6 * * *" "/check"
fi

cat <<EOF

Listo.
  Salud:                        $URL/healthz
  Webhook para el schedule:     $URL/hook?key=$CAP_KEY
  URL para la extensión:        $URL   (user attribute *_service_url y external_api_urls del manifest)
  Suspensiones activas:         curl -H "X-Cap-Key: \$CAP_KEY" $URL/suspensions
  Prueba con payload:           curl -X POST -H "Content-Type: application/json" -d @sample_webhook.json "$URL/hook?key=\$CAP_KEY"
EOF
