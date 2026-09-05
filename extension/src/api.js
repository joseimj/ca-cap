/**
 * Cliente del servicio ca-cap para la extensión.
 *
 * El secreto CAP_KEY nunca llega al navegador: se guarda como user attribute de Looker
 * (<proyecto>_<extensión>_cap_key, valor oculto) y se inserta con createSecretKeyTag.
 * serverProxy ejecuta la llamada desde el servidor de Looker, que sustituye la etiqueta por
 * el valor real; el servicio devuelve un JWT de corta duración que usamos con fetchProxy.
 */
export function createClient({ extensionSDK, serviceUrl, userEmail }) {
  let token = null
  let expiresAt = 0

  async function ensureToken() {
    if (token && Date.now() < expiresAt - 30000) return token
    const resp = await extensionSDK.serverProxy(`${serviceUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cap_key: extensionSDK.createSecretKeyTag('cap_key'),
        user: userEmail,
      }),
    })
    if (!resp.ok || !resp.body || !resp.body.token) {
      throw new Error(`auth failed (${resp.status})`)
    }
    token = resp.body.token
    expiresAt = Date.now() + (resp.body.expires_in || 900) * 1000
    return token
  }

  async function call(method, path, body) {
    const bearer = await ensureToken()
    const resp = await extensionSDK.fetchProxy(`${serviceUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (resp.status === 401) {
      token = null
    }
    if (!resp.ok) {
      const detail = resp.body && (resp.body.message || resp.body.description)
      throw new Error(`${method} ${path} → ${resp.status}${detail ? `: ${detail}` : ''}`)
    }
    return resp.body
  }

  const enc = encodeURIComponent
  return {
    config: () => call('GET', '/config'),
    caps: () => call('GET', '/caps'),
    setCap: (agentId, cap, agentName) => call('PUT', `/caps/${enc(agentId)}`, { cap, agent_name: agentName }),
    deleteCap: (agentId) => call('DELETE', `/caps/${enc(agentId)}`),
    suspensions: () => call('GET', '/suspensions'),
    history: (limit = 100) => call('GET', `/history?limit=${limit}`),
    suspend: (agentId, agentName, tokens) =>
      call('POST', `/suspend/${enc(agentId)}`, { agent_name: agentName, tokens: tokens || 0 }),
    restore: (agentId) => call('POST', agentId ? `/restore?agent_id=${enc(agentId)}` : '/restore'),
    check: () => call('POST', '/check'),
  }
}

/** Consulta System Activity como el usuario de la extensión usando la configuración del servicio. */
export async function fetchUsage(coreSDK, cfg) {
  if (!cfg.sa_explore) return []
  const body = {
    model: 'system__activity',
    view: cfg.sa_explore,
    fields: [cfg.col_agent_id, cfg.col_agent_name, cfg.col_tokens],
    limit: '500',
  }
  if (cfg.sa_date_field) body.filters = { [cfg.sa_date_field]: cfg.sa_date_filter }
  const rows = await coreSDK.ok(coreSDK.run_inline_query({ result_format: 'json', body }))
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    agent_id: String(r[cfg.col_agent_id] ?? '').trim(),
    agent_name: String(r[cfg.col_agent_name] ?? r[cfg.col_agent_id] ?? ''),
    tokens: Number(String(r[cfg.col_tokens] ?? 0).replace(/,/g, '')) || 0,
  })).filter((r) => r.agent_id)
}
