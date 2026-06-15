const LEAF = new Set(['function', 'method', 'import', 'import_module', 'import_entity', 'variable'])

const STYLE = {
  imports:         { color: '#ffa657', dashed: false, marker: 'locus-arrow-orange',  opacity: 0.75 },
  has_entity:      { color: '#e3b341', dashed: true,  marker: 'locus-arrow-gold',    opacity: 0.65 },
  semantic_import: { color: '#f0883e', dashed: true,  marker: 'locus-arrow-ember',   opacity: 0.30 },
  inherits:        { color: '#d2a8ff', dashed: false, marker: 'locus-arrow-purple',  opacity: 0.75 },
  calls:           { color: '#6e7681', dashed: true,  marker: 'locus-arrow-gray',    opacity: 0.35 },
}

// Total dash-cycle length must match strokeDasharray "7 4" → 11
const DASH_ANIMATION = `
  @keyframes locus-dash-flow {
    from { stroke-dashoffset: 0; }
    to   { stroke-dashoffset: 20; }
  }
`

function center(id, positions, sizes) {
  const p = positions[id]
  const s = sizes[id]
  if (!p || !s) return null
  return { x: p.x + s.w / 2, y: p.y + s.h / 2 }
}

function clipToCircle(c, toward, r) {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const len = Math.hypot(dx, dy) || 1
  return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r }
}

function clipToRect(c, toward, w, h) {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return { ...c }
  const hw = w / 2, hh = h / 2
  let t = Infinity
  if (dx) t = Math.min(t, hw / Math.abs(dx))
  if (dy) t = Math.min(t, hh / Math.abs(dy))
  return { x: c.x + dx * t, y: c.y + dy * t }
}

function edgeEndpoint(id, toward, positions, sizes, nodeMap) {
  const c = center(id, positions, sizes)
  if (!c) return null
  const n = nodeMap[id]
  const s = sizes[id]
  if (!n || !s) return null

  const padding = -30; // used to push lines inwards

  if (LEAF.has(n.type)) {
    return clipToCircle(c, toward, (s.w / 2) + padding)
  }
  // For rectangles, you can inflate the bounding box dimensions slightly before clipping
  return clipToRect(c, toward, s.w + padding * 2, s.h + padding * 2)
}

export function EdgeLayer({ edges, positions, sizes, nodeMap, visibleTypes, visibleEdgeTypes, linkedIds, selectedId, zoom = 1, viewMode = 'structural', renderedNodeIds = null, leafEdgesOnly = false }) {
  // Target: edges appear ~1.5 px thick on screen regardless of zoom.
  // SVG strokeWidth = 1.5 / zoom, clamped so it never falls below the default
  // (lines stay 1.5 px minimum at zoom ≥ 1) and never exceeds 8 px SVG at
  // extreme zoom-out levels.
  const strokeWidth = Math.max(1.25, Math.min(8, 1.25 / zoom))
  return (
    <g>
      <defs>
        <style>{DASH_ANIMATION}</style>
        <marker id="locus-arrow-orange" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#ffa657" />
        </marker>
        <marker id="locus-arrow-purple" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#d2a8ff" />
        </marker>
        <marker id="locus-arrow-gray" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#6e7681" />
        </marker>
        <marker id="locus-arrow-gold" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#e3b341" />
        </marker>
        <marker id="locus-arrow-ember" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="#f0883e" />
        </marker>
      </defs>

      {edges.map((edge) => {
        const { id, source, target, type } = edge.data
        const sn = nodeMap[source]
        const tn = nodeMap[target]
        if (!sn || !tn) return null
        if (visibleTypes[sn.type] === false || visibleTypes[tn.type] === false) return null
        if (type === 'calls' && visibleEdgeTypes?.calls === false) return null
        if (type === 'semantic_import' && viewMode !== 'semantic') return null

        // LOD: skip edges whose endpoints are not currently rendered
        if (renderedNodeIds && (!renderedNodeIds.has(source) || !renderedNodeIds.has(target))) return null

        // Layer split: leaf edges (both endpoints are leaves) vs deep edges (≥1 container endpoint)
        const srcIsLeaf = LEAF.has(sn.type)
        const tgtIsLeaf = LEAF.has(tn.type)
        const isLeafEdge = srcIsLeaf && tgtIsLeaf
        if (leafEdgesOnly && !isLeafEdge) return null
        if (!leafEdgesOnly && isLeafEdge) return null

        const sc = center(source, positions, sizes)
        const tc = center(target, positions, sizes)
        if (!sc || !tc) return null

        const sp = edgeEndpoint(source, tc, positions, sizes, nodeMap)
        const tp = edgeEndpoint(target, sc, positions, sizes, nodeMap)
        if (!sp || !tp) return null

        const style  = STYLE[type] ?? STYLE.calls
        const d      = `M ${sp.x} ${sp.y} L ${tp.x} ${tp.y}`

        // An edge is "active" when it is directly attached to the selected node
        const isActive = selectedId && (source === selectedId || target === selectedId)
        const dimmed   = linkedIds && !isActive && (!linkedIds.has(source) || !linkedIds.has(target))
        const opacity  = dimmed ? 0.05 : (isActive ? Math.min(1, style.opacity + 0.25) : style.opacity)

        // Animate dashes on active call edges AND active import edges
        const animateFlow = isActive && (type === 'calls' || type === 'imports')

        // Import edges become dashed only when animated (marching-ants flow indicator)
        const dashArray = style.dashed ? '7 4'
          : (animateFlow && type === 'imports') ? '10 5'
          : undefined

        return (
          <path
            key={id}
            d={d}
            fill="none"
            stroke={style.color}
            strokeWidth={strokeWidth}
            opacity={opacity}
            strokeDasharray={dashArray}
            markerEnd={style.marker ? `url(#${style.marker})` : undefined}
            style={{
              transition: 'opacity 0.15s',
              animation: animateFlow ? 'locus-dash-flow 2s linear infinite' : undefined,
            }}
          />
        )
      })}
    </g>
  )
}
