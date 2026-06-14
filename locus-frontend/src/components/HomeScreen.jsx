import { useState, useEffect, useCallback } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import { SettingsModal } from './SettingsModal'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const min  = Math.floor(diff / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min} min ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

function LocusMark({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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
  )
}

export function HomeScreen() {
  const [path, setPath]           = useState('')
  const [recents, setRecents]     = useState([])
  const [busyId, setBusyId]       = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const error           = useGraphStore((s) => s.error)
  const clusterEnabled  = useGraphStore((s) => s.clusterEnabled)
  const setClusterEnabled = useGraphStore((s) => s.setClusterEnabled)

  const refreshRecents = useCallback(async () => {
    if (!isElectron) return
    try {
      setRecents(await window.electronAPI.listSaves())
    } catch {
      setRecents([])
    }
  }, [])

  useEffect(() => { refreshRecents() }, [refreshRecents])

  async function handleBrowse() {
    if (!isElectron) return
    const folder = await window.electronAPI.openFolderDialog()
    if (folder) setPath(folder)
  }

  async function handleVisualize(targetPath = path) {
    const trimmed = targetPath.trim()
    if (!trimmed || !isElectron) return
    const store = useGraphStore.getState()
    store.setError(null)
    store.setProgress({ percent: 0, message: 'Starting analysis…' })
    store.setViewMode('structural')
    store.setScreen('loading')
    try {
      const graph = await window.electronAPI.analyzeProject(trimmed, { cluster: clusterEnabled })
      store.setGraph(graph)
      store.setProjectPath(trimmed)
      // Persist immediately so the codebase shows up in recents without re-processing
      try {
        const meta = await window.electronAPI.saveCodebase(store.buildSavePayload())
        store.setCurrentSave(meta)
      } catch { /* saving is best-effort; visualization still works */ }
      store.setProgress({ percent: 100, message: 'Analysis complete' })
      // Brief pause at 100% so the bar visibly finishes, then fade to the graph
      setTimeout(() => useGraphStore.getState().setScreen('graph'), 500)
    } catch (e) {
      store.setError(e.message)
      store.setScreen('home')
    }
  }

  async function handleOpenRecent(meta) {
    if (busyId) return
    setBusyId(meta.id)
    const store = useGraphStore.getState()
    try {
      const save = await window.electronAPI.loadSave(meta.id)
      store.loadFromSave(save)
    } catch (e) {
      store.setError(`Could not open "${meta.name}": ${e.message}`)
      setBusyId(null)
      refreshRecents()
    }
  }

  async function handleDeleteRecent(e, meta) {
    e.stopPropagation()
    try { await window.electronAPI.deleteSave(meta.id) } catch { /* ignore */ }
    refreshRecents()
  }

  async function handleLoadJsonFile() {
    if (!isElectron) return
    const store = useGraphStore.getState()
    try {
      const graph = await window.electronAPI.loadGraphFile()
      if (graph) {
        store.setGraph(graph)
        store.setScreen('graph')
      }
    } catch (err) {
      store.setError(err.message)
    }
  }

  return (
    <div className="home">
      {/* Settings gear — top-right corner */}
      {isElectron && (
        <button
          className="home__settings-btn"
          onClick={() => setShowSettings(true)}
          title="Settings (API keys)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.645-.715 1.195-1.459 1.259a8.199 8.199 0 0 1-1.402 0C5.555 15.905 5.01 15.355 4.84 14.71l-.288-1.107c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.364-1.891l.814-.806c.049-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.814-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.288-1.107C5.01.645 5.555.095 6.299.031 6.531.01 6.764 0 7 0h1Zm-.5 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
          </svg>
        </button>
      )}

      <div className="home__center">
        <div className="home__brand">
          <LocusMark />
          <h1 className="home__title">Locus</h1>
          <p className="home__subtitle">Visualize the structure of any codebase</p>
        </div>

        {/* ── Path entry ──────────────────────────────────────────────────── */}
        <div className="home__input-row">
          <input
            className="home__input"
            type="text"
            placeholder="Path to a codebase, e.g. C:\projects\my-app"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVisualize()}
            autoFocus
          />
          {isElectron && (
            <button
              className="home__icon-btn"
              onClick={handleBrowse}
              title="Browse for a folder"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z" />
              </svg>
            </button>
          )}
          <button
            className="home__go-btn"
            onClick={() => handleVisualize()}
            disabled={!path.trim() || !isElectron}
          >
            Visualize
          </button>
        </div>

        {/* ── Semantic clustering pill ────────────────────────────────────── */}
        <div className="home__options">
          <button
            className={`cluster-pill${clusterEnabled ? ' cluster-pill--on' : ''}`}
            onClick={() => setClusterEnabled(!clusterEnabled)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5">
              <ellipse cx="8" cy="8" rx="6.5" ry="4.5" strokeDasharray="3 2" />
              <circle cx="5"  cy="7"   r="1.4" fill="currentColor" stroke="none" />
              <circle cx="8"  cy="9.5" r="1.4" fill="currentColor" stroke="none" />
              <circle cx="11" cy="7"   r="1.4" fill="currentColor" stroke="none" />
            </svg>
            Semantic Clustering
            <span className="cluster-pill__knob" />
            <span className="cluster-pill__popup">
              Groups related classes and functions into labelled domains using
              CodeBERT embeddings, HDBSCAN clustering, and Claude-generated
              names. Enables the Semantic view, but makes analysis noticeably
              slower.
            </span>
          </button>
        </div>

        {error && <p className="home__error">{error}</p>}

        {/* ── Recent visualizations ───────────────────────────────────────── */}
        {recents.length > 0 && (
          <div className="home__recents">
            <h2 className="home__recents-title">Recent visualizations</h2>
            <div className="home__recents-list">
              {recents.map((r) => (
                <div
                  key={r.id}
                  className="recent-card"
                  onClick={() => handleOpenRecent(r)}
                  title={r.projectPath}
                >
                  <div className="recent-card__main">
                    <span className="recent-card__name">
                      {r.name}
                      {r.clusterEnabled && (
                        <span className="recent-card__cluster-badge">clustered</span>
                      )}
                    </span>
                    <span className="recent-card__path">{r.projectPath}</span>
                  </div>
                  <div className="recent-card__stats">
                    <span>{r.nodeCount} nodes</span>
                    <span>{r.edgeCount} edges</span>
                    <span>{busyId === r.id ? 'opening…' : timeAgo(r.lastOpened)}</span>
                  </div>
                  <button
                    className="recent-card__delete"
                    onClick={(e) => handleDeleteRecent(e, r)}
                    title="Remove from recents"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isElectron && (
          <button className="home__load-json" onClick={handleLoadJsonFile}>
            …or load a graph.json directly
          </button>
        )}
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
