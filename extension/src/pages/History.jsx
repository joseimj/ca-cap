import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { Badge } from '../components/ui'

export default function History({ client, setError }) {
  const { t, fmtNum, fmtDate } = useT()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setEvents(await client.history(200))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="cc-toolbar">
        <span className="cc-spacer" />
        <button className="cc-btn" disabled={loading} onClick={load}>
          {t('action.refresh')}
        </button>
      </div>
      {loading ? <div className="cc-empty">{t('msg.loading')}</div> : null}
      {!loading && events.length === 0 ? <div className="cc-empty">{t('hist.none')}</div> : null}
      {events.length > 0 ? (
        <table className="cc-table">
          <thead>
            <tr>
              <th>{t('hist.when')}</th>
              <th>{t('hist.event')}</th>
              <th>{t('usage.agent')}</th>
              <th>{t('hist.details')}</th>
              <th>{t('susp.by')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.at)}</td>
                <td>
                  {e.event === 'suspend' ? (
                    <Badge kind="stop">{t('event.suspend')}</Badge>
                  ) : (
                    <Badge kind="ok">{t('event.restore')}</Badge>
                  )}
                </td>
                <td>
                  <div>{e.agent_name}</div>
                  <div className="cc-muted">ID {e.agent_id}</div>
                </td>
                <td className="cc-muted">
                  {e.event === 'suspend'
                    ? `${fmtNum(e.tokens)} / ${e.cap ? fmtNum(e.cap) : '—'} · ${(e.user_ids || []).length} ${t('susp.users').toLowerCase()} · ${e.source || ''}`
                    : `${e.restored_users ?? 0} ${t('susp.users').toLowerCase()} · ${e.group_name || ''}`}
                </td>
                <td>{e.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
