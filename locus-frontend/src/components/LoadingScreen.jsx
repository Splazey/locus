import { useGraphStore } from '../store/useGraphStore'
import logo from '../assets/logo.png'

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
        <img src={logo} alt="Locus" width="160" className="loading-screen__mark" style={{ height: 'auto' }} />

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
