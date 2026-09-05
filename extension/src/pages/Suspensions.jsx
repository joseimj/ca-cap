import { useState } from 'react'
import { useT } from '../i18n'
import { ConfirmButton } from '../components/ui'

export default function Suspensions({ client, suspensions, reload, setError }) {
  const { t, fmtNum, fmtDate } = useT()
  const [busy, setBusy] = useState(false)

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
      <div className="cc-toolbar">
        <span className="cc-spacer" />
        <ConfirmButton
          label={t('action.restoreAll')}
          className="cc-btn"
          disabled={busy || suspensions.length === 0}
          onConfirm={() => run(() => client.restore())}
        />
        <button className="cc-btn" disabled={busy} onClick={() => run(async () => {})}>
          {t('action.refresh')}
        </button>
      </div>

      {suspensions.length === 0 ? <div className="cc-empty">{t('susp.none')}</div> : null}

      {suspensions.length > 0 ? (
        <table className="cc-table">
          <thead>
            <tr>
              <th>{t('usage.agent')}</th>
              <th>{t('susp.group')}</th>
              <th className="num">{t('usage.tokens')}</th>
              <th className="num">{t('usage.cap')}</th>
              <th className="num">{t('susp.users')}</th>
              <th>{t('susp.since')}</th>
              <th>{t('susp.source')}</th>
              <th>{t('susp.by')}</th>
              <th>{t('usage.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {suspensions.map((s) => (
              <tr key={s.agent_id}>
                <td>
                  <div>{s.agent_name}</div>
                  <div className="cc-muted">ID {s.agent_id}</div>
                </td>
                <td>{s.group_name}</td>
                <td className="num">{fmtNum(s.tokens)}</td>
                <td className="num">{s.cap ? fmtNum(s.cap) : '—'}</td>
                <td className="num">
                  {(s.user_ids || []).length}
                  {s.failed_removals ? <span className="cc-muted"> (−{s.failed_removals})</span> : null}
                </td>
                <td>{fmtDate(s.suspended_at)}</td>
                <td>{s.source}</td>
                <td>{s.actor}</td>
                <td>
                  <ConfirmButton
                    label={t('action.restore')}
                    className="cc-btn small"
                    disabled={busy}
                    onConfirm={() => run(() => client.restore(s.agent_id))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
