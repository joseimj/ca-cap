import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ExtensionContext40 } from '@looker/extension-sdk-react'
import { createClient, fetchUsage } from './api'
import { LANGS, LangContext, detectLang, useT } from './i18n'
import { Banner } from './components/ui'
import Usage from './pages/Usage'
import Suspensions from './pages/Suspensions'
import History from './pages/History'

function Shell() {
  const { extensionSDK, coreSDK } = useContext(ExtensionContext40)
  const { t } = useT()
  const { lang, setLang } = useContext(LangContext)

  const [me, setMe] = useState(null)
  const [serviceUrl, setServiceUrl] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [usage, setUsage] = useState([])
  const [caps, setCaps] = useState([])
  const [suspensions, setSuspensions] = useState([])
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('usage')
  const [ready, setReady] = useState(false)

  // 1) Usuario actual y URL del servicio (user attribute con ámbito de extensión, o valor de compilación).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const user = await coreSDK.ok(coreSDK.me())
        let url = null
        try {
          url = await extensionSDK.userAttributeGetItem('service_url')
        } catch (e) {
          url = null
        }
        url = (url || process.env.CA_CAP_SERVICE_URL || '').replace(/\/$/, '')
        if (!cancelled) {
          setMe(user)
          setServiceUrl(url)
          if (!url) setError(t('msg.noServiceUrl'))
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const client = useMemo(
    () => (serviceUrl && me ? createClient({ extensionSDK, serviceUrl, userEmail: me.email || me.display_name || String(me.id) }) : null),
    [extensionSDK, serviceUrl, me]
  )

  // 2) Carga de configuración, topes, suspensiones y consumo.
  const reload = useCallback(async () => {
    if (!client) return
    const config = await client.config()
    const [capList, suspList, usageRows] = await Promise.all([
      client.caps(),
      client.suspensions(),
      fetchUsage(coreSDK, config).catch((e) => {
        setError(`System Activity: ${e.message || e}`)
        return []
      }),
    ])
    setCfg(config)
    setCaps(capList)
    setSuspensions(suspList)
    setUsage(usageRows)
  }, [client, coreSDK])

  useEffect(() => {
    if (!client) return
    ;(async () => {
      try {
        await reload()
      } catch (e) {
        setError(e.message || String(e))
      } finally {
        setReady(true)
      }
    })()
  }, [client, reload])

  return (
    <div className="cc-app">
      <div className="cc-header">
        <h1>{t('app.title')}</h1>
        <div className="cc-inline">
          <span className="cc-meta">
            {me ? `${t('footer.user')}: ${me.email || me.display_name}` : ''}
            {serviceUrl ? ` · ${t('footer.service')}: ${serviceUrl.replace(/^https?:\/\//, '')}` : ''}
          </span>
          <select className="cc-input" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('lang')}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Banner kind="error">{error}</Banner>
      {cfg && cfg.dry_run ? <Banner kind="warn">{t('msg.dryRun')}</Banner> : null}

      {!ready ? <div className="cc-loading">{t('msg.loading')}</div> : null}

      {ready && cfg && client ? (
        <>
          <div className="cc-tabs">
            {['usage', 'suspensions', 'history'].map((k) => (
              <button key={k} className={`cc-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                {t(`tabs.${k}`)}
                {k === 'suspensions' && suspensions.length ? ` (${suspensions.length})` : ''}
              </button>
            ))}
          </div>

          {tab === 'usage' ? (
            <Usage client={client} cfg={cfg} usage={usage} caps={caps} suspensions={suspensions} reload={reload} setError={setError} />
          ) : null}
          {tab === 'suspensions' ? (
            <Suspensions client={client} suspensions={suspensions} reload={reload} setError={setError} />
          ) : null}
          {tab === 'history' ? <History client={client} setError={setError} /> : null}
        </>
      ) : null}
    </div>
  )
}

export default function App() {
  const [lang, setLang] = useState(detectLang())
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <Shell />
    </LangContext.Provider>
  )
}
