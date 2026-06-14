import { useGraphStore } from '../store/useGraphStore'
import { GraphRenderer } from './graph/GraphRenderer'

// ── Mode switcher pill ─────────────────────────────────────────────────────────

const SWITCHER_MODES = [
  {
    id: 'structural',
    label: 'Structural',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="1" width="6" height="6" rx="1" opacity="0.9" />
        <rect x="9" y="1" width="6" height="6" rx="1" opacity="0.9" />
        <rect x="1" y="9" width="6" height="6" rx="1" opacity="0.9" />
        <rect x="9" y="9" width="6" height="6" rx="1" opacity="0.9" />
      </svg>
    ),
  },
  {
    id: 'semantic',
    label: 'Semantic',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="8" cy="8" rx="6.5" ry="4.5" strokeDasharray="3 2" />
        <circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="8" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="11" cy="7" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
]

function ModeSwitcher({ viewMode, setViewMode, hasClusters }) {
  return (
    <div style={{
      position: 'absolute',
      top: 12,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 20,
      display: 'flex',
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 8,
      padding: 3,
      gap: 2,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      userSelect: 'none',
    }}>
      {SWITCHER_MODES.map(({ id, label, icon }) => {
        const active = viewMode === id
        const isSemanticDisabled = id === 'semantic' && !hasClusters
        return (
          <button
            key={id}
            title={isSemanticDisabled ? 'Analyze with --cluster flag to enable Semantic mode' : label}
            disabled={isSemanticDisabled}
            onClick={() => !isSemanticDisabled && setViewMode(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 5,
              border: 'none',
              cursor: isSemanticDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              fontFamily: 'inherit',
              color: active ? '#e6edf3' : (isSemanticDisabled ? '#484f58' : '#8b949e'),
              background: active ? '#21262d' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
              transition: 'all 0.15s ease',
              opacity: isSemanticDisabled ? 0.45 : 1,
            }}
          >
            {icon}
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── GraphCanvas ────────────────────────────────────────────────────────────────

export function GraphCanvas() {
  const elements         = useGraphStore((s) => s.elements)
  const clusters         = useGraphStore((s) => s.clusters)
  const visibleTypes     = useGraphStore((s) => s.visibleTypes)
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes)
  const layoutKey        = useGraphStore((s) => s.layoutKey)
  const peerGap          = useGraphStore((s) => s.peerGap)
  const isLoading        = useGraphStore((s) => s.isLoading)
  const viewMode         = useGraphStore((s) => s.viewMode)
  const setSelectedNode  = useGraphStore((s) => s.setSelectedNode)
  const setViewMode      = useGraphStore((s) => s.setViewMode)

  const isEmpty     = elements.length === 0 && !isLoading
  const hasClusters = Object.keys(clusters).length > 0

  return (
    <div className="graph-canvas">
      {isLoading && (
        <div className="graph-overlay">
          <div className="graph-spinner" />
          <span className="graph-overlay__label">Analyzing project…</span>
        </div>
      )}

      {isEmpty && (
        <div className="graph-overlay graph-overlay--empty">
          <div className="empty-state">
            <svg className="empty-state__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="32" cy="32" r="8" />
              <circle cx="12" cy="14" r="5" />
              <circle cx="52" cy="14" r="5" />
              <circle cx="12" cy="50" r="5" />
              <circle cx="52" cy="50" r="5" />
              <line x1="17" y1="16" x2="26" y2="26" />
              <line x1="47" y1="16" x2="38" y2="26" />
              <line x1="17" y1="48" x2="26" y2="38" />
              <line x1="47" y1="48" x2="38" y2="38" />
            </svg>
            <p className="empty-state__title">No graph loaded</p>
            <p className="empty-state__hint">
              Enter a project path in the sidebar and click <strong>Analyze</strong>
            </p>
          </div>
        </div>
      )}

      {!isEmpty && !isLoading && (
        <>
          <ModeSwitcher
            viewMode={viewMode}
            setViewMode={setViewMode}
            hasClusters={hasClusters}
          />
          <GraphRenderer
            elements={elements}
            clusters={clusters}
            visibleTypes={visibleTypes}
            visibleEdgeTypes={visibleEdgeTypes}
            onNodeSelect={setSelectedNode}
            layoutKey={layoutKey}
            peerGap={peerGap}
            viewMode={viewMode}
          />
        </>
      )}
    </div>
  )
}
