import { useState } from 'react'
import { useT } from '../i18n'
import { Badge, Banner, Bar, ConfirmButton } from '../components/ui'

function CapEditor({ row, onSave, onRemove }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.cap || '')

  if (!editing) {
    return (
      <span className="cc-inline">
        <button className="cc-btn small" onClick={() => setEditing(true)}>
          {t('action.edit')}
        </button>
        {row.cap ? (
          <button className="cc-btn small danger" onClick={() => onRemove(row.agent_id)}>
            {t('action.remove')}
          </button>
        ) : null}
      </span>
    )
  }
  return (
    <span className="cc-inline">
      <input
        className="cc-input"
        type="number"
        min="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('usage.capValue')}
      />
      <button
        className="cc-btn small primary"
        disabled={!Number(value)}
        onClick={async () => {
          await onSave(row.agent_id, Number(value), row.agent_name)
          setEditing(false)
        }}
      >
        {t('action.save')}
      </button>
      <button className="cc-btn small" onClick={() => setEditing(false)}>
        {t('action.cancel')}
      </button>
    </span>
  )
}

export default function Usage({ client, cfg, usage, caps, suspensions, reload, setError }) {
  const { t, fmtNum } = useT()
  const [newAgent, setNewAgent] = useState({ id: '', name: '', cap: '' })
  const [busy, setBusy] = useState(false)

  const capById = Object.fromEntries(caps.map((c) => [c.agent_id, c]))
  const suspById = Object.fromEntries(suspensions.map((s) => [s.agent_id, s]))

  // Une consumo (System Activity) con topes: los agentes con tope pero sin filas aparecen con 0 tokens.
  const rowsById = {}
  usage.forEach((u) => {
    rowsById[u.agent_id] = { ...u }
  })
  caps.forEach((c) => {
    if (!rowsById[c.agent_id]) rowsById[c.agent_id] = { agent_id: c.agent_id, agent_name: c.agent_name, tokens: 0 }
  })
  const rows = Object.values(rowsById)
    .map((r) => {
      const cap = (capById[r.agent_id] && capById[r.agent_id].cap) || cfg.token_cap || 0
      const pct = cap ? (r.tokens / cap) * 100 : 0
      return { ...r, cap, pct, suspended: !!suspById[r.agent_id] }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {!cfg.sa_explore ? <Banner kind="warn">{t('usage.noExplore')}</Banner> : null}

      <div className="cc-toolbar">
        <span className="cc-muted">
          {t('usage.period')}: {cfg.period}
          {cfg.token_cap ? ` · ${t('usage.globalCap')}: ${fmtNum(cfg.token_cap)}` : ''}
        </span>
        <span className="cc-spacer" />
        {cfg.sa_explore ? (
          <ConfirmButton label={t('action.check')} disabled={busy} onConfirm={() => run(() => client.check())} />
        ) : null}
        <button className="cc-btn" disabled={busy} onClick={() => run(async () => {})}>
          {t('action.refresh')}
        </button>
      </div>

      <div className="cc-form">
        <strong>{t('usage.addAgent')}</strong>
        <input
          className="cc-input"
          placeholder={t('usage.agentId')}
          value={newAgent.id}
          onChange={(e) => setNewAgent({ ...newAgent, id: e.target.value })}
        />
        <input
          className="cc-input wide"
          placeholder={t('usage.agentName')}
          value={newAgent.name}
          onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
        />
        <input
          className="cc-input"
          type="number"
          min="1"
          placeholder={t('usage.capValue')}
          value={newAgent.cap}
          onChange={(e) => setNewAgent({ ...newAgent, cap: e.target.value })}
        />
        <button
          className="cc-btn primary"
          disabled={busy || !newAgent.id.trim() || !Number(newAgent.cap)}
          onClick={() =>
            run(async () => {
              await client.setCap(newAgent.id.trim(), Number(newAgent.cap), newAgent.name.trim() || newAgent.id.trim())
              setNewAgent({ id: '', name: '', cap: '' })
            })
          }
        >
          {t('action.add')}
        </button>
      </div>

      <table className="cc-table">
        <thead>
          <tr>
            <th>{t('usage.agent')}</th>
            <th className="num">{t('usage.tokens')}</th>
            <th className="num">{t('usage.cap')}</th>
            <th>{t('usage.pct')}</th>
            <th>{t('usage.status')}</th>
            <th>{t('usage.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="cc-empty">
                —
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.agent_id} className={r.cap && r.pct >= 100 ? 'over' : r.cap && r.pct >= 80 ? 'warn' : ''}>
              <td>
                <div>{r.agent_name || r.agent_id}</div>
                <div className="cc-muted">ID {r.agent_id}</div>
              </td>
              <td className="num">{fmtNum(r.tokens)}</td>
              <td className="num">{r.cap ? fmtNum(r.cap) : <span className="cc-muted" title={t('usage.noCapHint')}>—</span>}</td>
              <td>{r.cap ? <Bar pct={r.pct} /> : null}</td>
              <td>
                {r.suspended ? (
                  <Badge kind="stop">{t('status.suspended')}</Badge>
                ) : !r.cap ? (
                  <Badge kind="none">{t('status.noCap')}</Badge>
                ) : r.pct >= 100 ? (
                  <Badge kind="stop">{t('status.over')}</Badge>
                ) : r.pct >= 80 ? (
                  <Badge kind="warn">{t('status.warn')}</Badge>
                ) : (
                  <Badge kind="ok">{t('status.active')}</Badge>
                )}
              </td>
              <td>
                <span className="cc-inline">
                  <CapEditor
                    row={{ ...r, cap: capById[r.agent_id] ? capById[r.agent_id].cap : '' }}
                    onSave={(id, cap, name) => run(() => client.setCap(id, cap, name))}
                    onRemove={(id) => run(() => client.deleteCap(id))}
                  />
                  {r.suspended ? (
                    <ConfirmButton
                      label={t('action.restore')}
                      className="cc-btn small"
                      disabled={busy}
                      onConfirm={() => run(() => client.restore(r.agent_id))}
                    />
                  ) : (
                    <ConfirmButton
                      label={t('action.suspend')}
                      className="cc-btn small danger"
                      disabled={busy}
                      onConfirm={() => run(() => client.suspend(r.agent_id, r.agent_name, r.tokens))}
                    />
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
