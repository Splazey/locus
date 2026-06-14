import { useGraphStore } from '../store/useGraphStore'

/**
 * Full-screen loading view shown while the backend processes a codebase.
 * The bar fill uses an animated diagonal "candy cane" stripe pattern and its
 * width tracks the percent reported by analyze.py via IPC progress events.
 */
export function LoadingScreen() {
  const progress = useGraphStore((s) => s.progress)
  const percent  = Math.max(0, Math.min(100, progress.percent ?? 0))

  return (
    <div className="loading-screen">
      <div className="loading-screen__inner">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="loading-screen__mark">
          <circle cx="12" cy="12" r="3.5" fill="#388bfd" />
          <circle cx="4"  cy="6"  r="2" fill="#388bfd" opacity=".6" />
          <circle cx="20" cy="6"  r="2" fill="#388bfd" opacity=".6" />
          <circle cx="4"  cy="18" r="2" fill="#388bfd" opacity=".6" />
          <circle cx="20" cy="18" r="2" fill="#388bfd" opacity=".6" />
          <line x1="6"  y1="6.5"  x2="10.2" y2="10.8" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="18" y1="6.5"  x2="13.8" y2="10.8" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="6"  y1="17.5" x2="10.2" y2="13.2" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="18" y1="17.5" x2="13.8" y2="13.2" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
        </svg>

        <h2 className="loading-screen__title">Processing codebase</h2>

        <div className="loading-bar">
          <div className="loading-bar__fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="loading-screen__meta">
          <span className="loading-screen__message">{progress.message || 'Working…'}</span>
          <span className="loading-screen__percent">{percent}%</span>
        </div>
      </div>
    </div>
  )
}
