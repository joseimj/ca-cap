import { useState } from 'react'
import { useT } from '../i18n'

/** Botón con confirmación en dos clics (window.confirm no está disponible en el iframe sandboxed). */
export function ConfirmButton({ label, onConfirm, className = 'cc-btn', disabled }) {
  const { t } = useT()
  const [arm, setArm] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!arm) {
    return (
      <button className={className} disabled={disabled || busy} onClick={() => setArm(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="cc-inline">
      <button
        className={`${className} primary`}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArm(false)
          }
        }}
      >
        {busy ? '…' : t('action.confirm')}
      </button>
      <button className="cc-btn small" disabled={busy} onClick={() => setArm(false)}>
        {t('action.cancel')}
      </button>
    </span>
  )
}

export function Badge({ kind, children }) {
  return <span className={`cc-badge ${kind}`}>{children}</span>
}

export function Banner({ kind = 'info', children }) {
  if (!children) return null
  return <div className={`cc-banner ${kind}`}>{children}</div>
}

export function Bar({ pct }) {
  const kind = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''
  return (
    <div className={`cc-bar ${kind}`} title={`${Math.round(pct)}%`}>
      <div style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}
