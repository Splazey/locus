import { useState, useEffect } from 'react'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

/**
 * Modal for setting API keys (ANTHROPIC_API_KEY and HF_TOKEN).
 * Keys are stored in Electron's userData (never in the repo).
 * The main process also reads locus-backend/.env as a fallback.
 */
export function SettingsModal({ onClose }) {
  const [anthropic, setAnthropic]  = useState('')
  const [hf, setHf]                = useState('')
  const [status, setStatus]        = useState(null)   // { hasAnthropicKey, hasHfToken, hasVenv }
  const [saving, setSaving]        = useState(false)
  const [saved, setSaved]          = useState(false)

  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.getSettings().then(setStatus)
  }, [])

  async function handleSave() {
    if (!isElectron || saving) return
    setSaving(true)
    try {
      const next = await window.electronAPI.saveSettings({
        ...(anthropic !== '' ? { ANTHROPIC_API_KEY: anthropic } : {}),
        ...(hf        !== '' ? { HF_TOKEN: hf }                 : {}),
      })
      setStatus(next)
      setAnthropic('')
      setHf('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } finally {
      setSaving(false)
    }
  }

  function StatusDot({ ok, label, hint }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: ok ? '#3fb950' : '#f85149' }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: ok ? '#3fb950' : '#f85149',
        }} />
        <span>{label}</span>
        {!ok && hint && (
          <span style={{ color: '#484f58', fontSize: 11 }}>{hint}</span>
        )}
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 className="modal__title" style={{ margin: 0 }}>Settings</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Environment status */}
        {status && (
          <div style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 18,
          }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Environment</p>
            <StatusDot ok={status.hasVenv}         label="Python venv"        hint="— run: pip install -r requirements.txt" />
            <StatusDot ok={status.hasAnthropicKey} label="Anthropic API key"  hint="— required for cluster labelling" />
            <StatusDot ok={status.hasHfToken}      label="HuggingFace token"  hint="— required for CodeBERT clustering" />
          </div>
        )}

        {/* Key entry */}
        <p style={{ fontSize: 11, color: '#8b949e', marginBottom: 12, lineHeight: 1.5 }}>
          Enter a new value to update a key. Leave blank to keep the existing value.
          Keys are stored locally in your user profile and never sent anywhere except
          the respective APIs when clustering is active.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, letterSpacing: '0.04em' }}>
              ANTHROPIC_API_KEY
            </span>
            <input
              type="password"
              className="home__input"
              placeholder={status?.hasAnthropicKey ? '••••••••  (already set)' : 'sk-ant-...'}
              value={anthropic}
              onChange={(e) => setAnthropic(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600, letterSpacing: '0.04em' }}>
              HF_TOKEN <span style={{ color: '#484f58', fontWeight: 400 }}>(HuggingFace)</span>
            </span>
            <input
              type="password"
              className="home__input"
              placeholder={status?.hasHfToken ? '••••••••  (already set)' : 'hf_...'}
              value={hf}
              onChange={(e) => setHf(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>
        </div>

        <p style={{ fontSize: 10, color: '#484f58', marginTop: 10, lineHeight: 1.45 }}>
          Tip: you can also create <code style={{ background: '#21262d', padding: '1px 4px', borderRadius: 3 }}>locus-backend/.env</code> with <code style={{ background: '#21262d', padding: '1px 4px', borderRadius: 3 }}>KEY=value</code> pairs — those are picked up automatically too (stored values take precedence).
        </p>

        <div className="modal__actions" style={{ marginTop: 18 }}>
          <button
            className="modal__btn modal__btn--primary"
            onClick={handleSave}
            disabled={saving || (!anthropic && !hf)}
          >
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save keys'}
          </button>
          <button className="modal__btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
