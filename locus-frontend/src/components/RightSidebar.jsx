import { useState, useEffect } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import { NODE_CONFIG } from '../constants/nodeConfig'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

const TYPE_LABEL = {
  file: 'File', class: 'Class', function: 'Function',
  method: 'Method', import: 'Import', import_module: 'Source Module', import_entity: 'Import Entity',
  variable: 'Variable', cluster: 'Cluster',
}

const EDGE_LABEL = {
  imports: 'Imports', inherits: 'Inherits', calls: 'Calls',
  has_entity: 'From Module', semantic_import: 'Imported by File',
}

/**
 * Build the heading for a "Related" edge group.
 *
 * Import edges are stored flipped (import→entity) so the arrowhead points at
 * the consuming entity.  This means for a file/class node the imports edges
 * arrive as dir='in', which would normally read "↙ Imports (incoming)".
 * We override those labels so they read naturally:
 *   entity node  + dir='in'  → "↗ Imports"   (this entity imports these)
 *   import node  + dir='out' → "↙ Used by"    (this import is used by these)
 */
function edgeHeading(type, dir) {
  if (type === 'imports') {
    return dir === 'out' ? '↗ Imports' : '↙ Imported by'
  }
  if (type === 'has_entity') {
    return dir === 'out' ? '↗ Entities' : '↙ From module'
  }
  if (type === 'semantic_import') {
    return dir === 'out' ? '↗ Imports (via file)' : '↙ Used by (via file)'
  }
  return `${dir === 'out' ? '↗ ' : '↙ '}${EDGE_LABEL[type] ?? type}${dir === 'in' ? ' (incoming)' : ''}`
}

function fileFromId(nodeId) {
  if (!nodeId || nodeId.startsWith('imp:')) return null
  if (nodeId.startsWith('import_module:') || nodeId.startsWith('import_entity:')) return null
  const parts = nodeId.split(':')
  return parts.length >= 2 ? parts[1] : null
}

export function RightSidebar() {
  const selectedNode    = useGraphStore((s) => s.selectedNode)
  const elements        = useGraphStore((s) => s.elements)
  const projectPath     = useGraphStore((s) => s.projectPath)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)

  const [collapsed, setCollapsed] = useState(false)

  // When a new node is selected, auto-expand
  useEffect(() => {
    if (selectedNode) setCollapsed(false)
  }, [selectedNode?.id])

  // ── Derived data ──────────────────────────────────────────────────────────
  const nodeMap = {}
  const allEdges = []
  for (const el of elements) {
    if (el.data.source) allEdges.push(el.data)
    else nodeMap[el.data.id] = el.data
  }

  // Cluster nodes are not in elements — use selectedNode.data directly for them
  const isCluster = selectedNode?.type === 'cluster'
  const clusterData = isCluster ? selectedNode.data : null
  const node = isCluster ? null : (selectedNode ? (nodeMap[selectedNode.id] ?? null) : null)
  const isOpen = !!selectedNode && !collapsed

  const connectedEdges = node
    ? allEdges.filter((e) => e.source === node.id || e.target === node.id)
    : []

  const children = node
    ? elements
        .filter((el) => !el.data.source && el.data.parent === node.id)
        .map((el) => el.data)
    : []

  const color   = isCluster
    ? (NODE_CONFIG.cluster?.color ?? '#f472b6')
    : (NODE_CONFIG[node?.type]?.color ?? '#8b949e')
  const relFile = node ? (node.type === 'file' ? node.fullLabel : fileFromId(node.id)) : null
  const dirLabel = node?.type === 'file'
    ? (node.fullLabel && (node.fullLabel.includes('/') || node.fullLabel.includes('\\'))
        ? node.fullLabel.replace(/[/\\][^/\\]+$/, '')
        : '.')
    : null

  // Outgoing calls ("Uses")
  const usesEdges = node
    ? allEdges.filter((e) => e.type === 'calls' && e.source === node.id)
    : []

  // Group non-calls related edges by type + direction
  const grouped = {}
  for (const e of connectedEdges) {
    if (e.type === 'calls') continue  // shown separately in Uses
    const dir = e.source === node?.id ? 'out' : 'in'
    const key = `${e.type}:${dir}`
    if (!grouped[key]) grouped[key] = { type: e.type, dir, edges: [] }
    grouped[key].edges.push(e)
  }

  function handleOpenFile() {
    if (!isElectron || !relFile) return
    const absPath = projectPath
      ? `${projectPath}/${relFile}`.replace(/\\/g, '/')
      : relFile
    window.electronAPI.openFile(absPath, node?.startLine ?? null)
  }

  function handleClose() {
    setSelectedNode(null)
  }

  return (
    <aside className={`right-sidebar${isOpen ? ' right-sidebar--open' : ''}`}>
      <div className="right-sidebar__inner">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="rsb-header">
          <div className="rsb-header__left">
            <span
              className="rsb-badge"
              style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
            >
              {isCluster ? 'Cluster' : (TYPE_LABEL[node?.type] ?? (node?.type ?? '…'))}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="rsb-close"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                {collapsed
                  ? <path d="M2 4 L6 8 L10 4" />
                  : <path d="M2 8 L6 4 L10 8" />}
              </svg>
            </button>
            <button className="rsb-close" onClick={handleClose} title="Close panel">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M1 1 L11 11 M11 1 L1 11" />
              </svg>
            </button>
          </div>
        </div>

        {!collapsed && isCluster && clusterData && (
          <div className="rsb-scroll">

            {/* ── Cluster name & description ────────────────────────────────── */}
            <section className="rsb-section">
              <p className="rsb-name" style={{ color }}>
                {clusterData.fullLabel || clusterData.label}
              </p>
              {clusterData.description && (
                <p className="rsb-meta" style={{ marginTop: 8, display: 'block' }}>
                  <span className="rsb-meta__value" style={{ color: '#c9d1d9', lineHeight: 1.5, whiteSpace: 'normal' }}>
                    {clusterData.description}
                  </span>
                </p>
              )}
            </section>

            {/* ── Cluster members ───────────────────────────────────────────── */}
            {clusterData.memberIds && clusterData.memberIds.length > 0 && (() => {
              const byType = {}
              for (const mid of clusterData.memberIds) {
                const m = nodeMap[mid]
                if (!m) continue
                if (!byType[m.type]) byType[m.type] = []
                byType[m.type].push(m)
              }
              const typeOrder = ['class', 'function', 'method']
              const totalShown = typeOrder.reduce((s, t) => s + (byType[t]?.length ?? 0), 0)
              return (
                <section className="rsb-section">
                  <h4 className="rsb-section-title">
                    Contents ({totalShown})
                  </h4>
                  <ul className="rsb-list">
                    {typeOrder.flatMap(t => {
                      const items = byType[t]
                      if (!items || items.length === 0) return []
                      return items.map(m => (
                        <li key={m.id} className="rsb-list__item">
                          <span className="rsb-list__dot" style={{ background: NODE_CONFIG[m.type]?.color }} />
                          <span className="rsb-list__type">{TYPE_LABEL[m.type] ?? m.type}</span>
                          <span className="rsb-list__name rsb-mono">{m.label}</span>
                        </li>
                      ))
                    })}
                  </ul>
                </section>
              )
            })()}

          </div>
        )}

        {!collapsed && !isCluster && (
          <div className="rsb-scroll">

            {/* ── Name & location ──────────────────────────────────────────── */}
            <section className="rsb-section">
              <p className="rsb-name" style={{ color }}>
                {node?.fullLabel || node?.label || '—'}
              </p>
              {dirLabel !== null && (
                <p className="rsb-meta">
                  <span className="rsb-meta__label">Directory</span>
                  <span className="rsb-meta__value rsb-mono">{dirLabel}</span>
                </p>
              )}
              {relFile && node?.type !== 'file' && (
                <p className="rsb-meta">
                  <span className="rsb-meta__label">File</span>
                  <span className="rsb-meta__value rsb-mono">{relFile}</span>
                </p>
              )}
              {node?.type === 'variable' && (
                <p className="rsb-meta">
                  <span className="rsb-meta__label">Type</span>
                  <span className="rsb-meta__value rsb-mono" style={{ fontWeight: 'bold', color: NODE_CONFIG.variable?.color }}>
                    {node.varType || 'var'}
                  </span>
                </p>
              )}
              {node?.startLine && (
                <p className="rsb-meta">
                  <span className="rsb-meta__label">Lines</span>
                  <span className="rsb-meta__value rsb-mono">
                    {node.startLine}–{node.endLine}
                  </span>
                </p>
              )}
              {node?.docstring && (
                <p className="rsb-docstring">"{node.docstring}"</p>
              )}
            </section>

            {/* ── Open in editor ────────────────────────────────────────────── */}
            {isElectron && relFile && (
              <section className="rsb-section">
                <button className="rsb-btn rsb-btn--primary" onClick={handleOpenFile}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.75 1.5a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5zm5.5.369V4.25c0 .138.112.25.25.25h2.381zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l3.914 3.914c.329.328.513.773.513 1.237v8.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25z"/>
                  </svg>
                  Open in editor{node?.startLine ? ` :${node.startLine}` : ''}
                </button>
              </section>
            )}

            {/* ── Class members (methods + variables) ──────────────────────── */}
            {node?.type === 'class' && children.length > 0 && (() => {
              const methods   = children.filter((c) => c.type === 'method')
              const variables = children.filter((c) => c.type === 'variable')
              return (
                <>
                  {methods.length > 0 && (
                    <section className="rsb-section">
                      <h4 className="rsb-section-title">Methods</h4>
                      <ul className="rsb-list">
                        {methods.map((c) => (
                          <li key={c.id} className="rsb-list__item">
                            <span className="rsb-list__dot" style={{ background: NODE_CONFIG[c.type]?.color }} />
                            <span className="rsb-list__name rsb-mono">{c.label}</span>
                            {c.startLine && <span className="rsb-list__line">:{c.startLine}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {variables.length > 0 && (
                    <section className="rsb-section">
                      <h4 className="rsb-section-title">Attributes</h4>
                      <ul className="rsb-list">
                        {variables.map((c) => (
                          <li key={c.id} className="rsb-list__item">
                            <span className="rsb-list__dot" style={{ background: NODE_CONFIG[c.type]?.color }} />
                            {c.varType && <span className="rsb-list__type" style={{ fontWeight: 'bold', color: NODE_CONFIG.variable?.color }}>{c.varType}</span>}
                            <span className="rsb-list__name rsb-mono">{c.label}</span>
                            {c.startLine && <span className="rsb-list__line">:{c.startLine}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )
            })()}

            {/* ── File contents ─────────────────────────────────────────────── */}
            {node?.type === 'file' && children.length > 0 && (
              <section className="rsb-section">
                <h4 className="rsb-section-title">Contents</h4>
                <ul className="rsb-list">
                  {children.map((c) => (
                    <li key={c.id} className="rsb-list__item">
                      <span className="rsb-list__dot" style={{ background: NODE_CONFIG[c.type]?.color }} />
                      <span className="rsb-list__type">{TYPE_LABEL[c.type]}</span>
                      <span className="rsb-list__name rsb-mono">{c.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── Uses (outgoing calls) ─────────────────────────────────────── */}
            {usesEdges.length > 0 && (
              <section className="rsb-section">
                <h4 className="rsb-section-title">Uses</h4>
                <ul className="rsb-list">
                  {usesEdges.map((e) => {
                    const callee = nodeMap[e.target]
                    if (!callee) return null
                    return (
                      <li key={e.id} className="rsb-list__item rsb-list__item--rel">
                        <span className="rsb-list__dot" style={{ background: NODE_CONFIG[callee.type]?.color }} />
                        <span className="rsb-list__type">{TYPE_LABEL[callee.type] ?? callee.type}</span>
                        <span className="rsb-list__name rsb-mono">{callee.fullLabel || callee.label}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* ── Related nodes ─────────────────────────────────────────────── */}
            {Object.keys(grouped).length > 0 && (
              <section className="rsb-section">
                <h4 className="rsb-section-title">Related</h4>
                {Object.values(grouped).map(({ type, dir, edges: grpEdges }) => (
                  <div key={`${type}:${dir}`} className="rsb-rel-group">
                    <p className="rsb-rel-group__heading">
                      {edgeHeading(type, dir)}
                    </p>
                    <ul className="rsb-list">
                      {grpEdges.map((e) => {
                        const otherId = e.source === node.id ? e.target : e.source
                        const other   = nodeMap[otherId]
                        if (!other) return null
                        return (
                          <li key={e.id} className="rsb-list__item rsb-list__item--rel">
                            <span className="rsb-list__dot" style={{ background: NODE_CONFIG[other.type]?.color }} />
                            <span className="rsb-list__name">{other.fullLabel || other.label}</span>
                            {e.raw && (
                              <span className="rsb-import-line rsb-mono" title={e.raw}>{e.raw}</span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            )}

          </div>
        )}
      </div>
    </aside>
  )
}
