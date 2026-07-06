/**
 * ClusterLayer.jsx
 *
 * Renders an adaptive "blob" for each semantic cluster behind all other graph
 * elements.  The blob is a smooth convex-hull outline that automatically
 * recomputes every frame from the current (display) positions of its member
 * nodes, so it tracks node movement live during drags.
 *
 * Visual design:
 *   • Pink (#f472b6) dashed stroke, very light translucent fill
 *   • Selected state: brighter stroke, wider dash, glowing drop-shadow filter
 *   • Cluster label centred at the top edge of the blob
 *
 * Interaction:
 *   • onClusterMouseDown(clusterId, e) is called on mousedown so GraphRenderer
 *     can handle selection using the same click-vs-drag logic it uses for nodes.
 */

import { useMemo } from 'react'

const STROKE_COLOR    = '#f472b6'
const FILL_COLOR      = '#f472b610'
const SEL_FILL        = '#f472b620'
const BLOB_PADDING    = 52   // px expansion outward from the hull
const LABEL_OFFSET    = 18   // px above top of blob

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Cross product of vectors OA and OB. */
function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/**
 * Graham-scan convex hull.
 * Returns points in counter-clockwise order.
 * Returns null when fewer than 2 distinct points are available.
 */
function convexHull(pts) {
  // Deduplicate
  const seen = new Set()
  const uniq = pts.filter(p => {
    const k = `${Math.round(p.x)},${Math.round(p.y)}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })
  if (uniq.length < 2) return uniq.length ? uniq : null

  // Find bottom-left pivot
  let pivot = uniq[0]
  for (const p of uniq) {
    if (p.y > pivot.y || (p.y === pivot.y && p.x < pivot.x)) pivot = p
  }

  // Sort by polar angle from pivot
  const sorted = uniq
    .filter(p => p !== pivot)
    .sort((a, b) => {
      const angA = Math.atan2(pivot.y - a.y, a.x - pivot.x)
      const angB = Math.atan2(pivot.y - b.y, b.x - pivot.x)
      if (angA !== angB) return angA - angB
      return Math.hypot(a.x - pivot.x, a.y - pivot.y) -
             Math.hypot(b.x - pivot.x, b.y - pivot.y)
    })

  const hull = [pivot]
  for (const p of sorted) {
    while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) >= 0) {
      hull.pop()
    }
    hull.push(p)
  }
  return hull
}

/**
 * Expand each hull vertex outward from the centroid by `padding` px.
 */
function expandHull(hull, padding) {
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
  return hull.map(p => {
    const dx = p.x - cx, dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * padding, y: p.y + (dy / len) * padding }
  })
}

/**
 * Build a smooth closed SVG path through `pts` using quadratic Bézier curves.
 * The control point is each original vertex; the on-curve points are midpoints
 * between consecutive vertices, producing a naturally rounded outline.
 */
function smoothBlobPath(pts) {
  if (!pts || pts.length < 2) return ''
  const n = pts.length
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  // Midpoints between consecutive hull vertices (and wrap around)
  const m = pts.map((p, i) => mid(p, pts[(i + 1) % n]))
  let d = `M ${m[n - 1].x.toFixed(2)} ${m[n - 1].y.toFixed(2)}`
  for (let i = 0; i < n; i++) {
    const ctrl = pts[i]
    const end  = m[i]
    d += ` Q ${ctrl.x.toFixed(2)} ${ctrl.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  }
  d += ' Z'
  return d
}

// ── Root-ancestor resolution ──────────────────────────────────────────────────

/**
 * Walk the parent chain of `id` until we reach a node with no parent.
 * For methods → class → file; for classes → file; for functions → file.
 */
function getRootId(id, nodeMap) {
  let cur = id
  let safety = 20
  while (nodeMap[cur]?.parent && safety-- > 0) cur = nodeMap[cur].parent
  return cur
}

/**
 * Build the smooth-hull blob geometry for a set of member root boxes.
 * Pure (no hooks) so it can be memoized on a cheap position signature.
 * Returns '' path when fewer than 2 boxes are available.
 */
function buildBlobGeometry(rootIds, positions, sizes) {
  const pts = []
  for (const rid of rootIds) {
    const p = positions[rid], s = sizes[rid]
    if (!p || !s) continue
    pts.push({ x: p.x, y: p.y }, { x: p.x + s.w, y: p.y },
             { x: p.x + s.w, y: p.y + s.h }, { x: p.x, y: p.y + s.h })
  }
  if (pts.length < 2) return { path: '', labelX: 0, labelY: 0 }

  const hull = convexHull(pts)
  if (!hull) return { path: '', labelX: 0, labelY: 0 }

  const expanded = expandHull(hull, BLOB_PADDING)
  const ecx  = expanded.reduce((s, p) => s + p.x, 0) / expanded.length
  const topY = expanded.reduce((mn, p) => Math.min(mn, p.y), Infinity)
  return { path: smoothBlobPath(expanded), labelX: ecx, labelY: topY - LABEL_OFFSET }
}

// ── Expanded blob (smooth hull around member root boxes) ───────────────────────

function ExpandedClusterBlob({ cluster, positions, sizes, nodeMap, selected, dimmed, onMouseDown, onContextMenu, onToggleCollapse }) {
  // Build a cheap signature of member-root positions. The expensive convex-hull
  // path only recomputes when this changes, so idle frames, pans and zooms (which
  // don't move nodes) reuse the cached geometry instead of re-hulling every blob.
  const rootIds = []
  let signature = ''
  for (const memberId of cluster.memberIds) {
    const rootId = getRootId(memberId, nodeMap)
    const p = positions[rootId], s = sizes[rootId]
    if (!p || !s) continue
    rootIds.push(rootId)
    signature += `${rootId}:${Math.round(p.x)},${Math.round(p.y)};`
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { path, labelX, labelY } = useMemo(
    () => buildBlobGeometry(rootIds, positions, sizes),
    [signature],  // recompute only when a member root actually moves
  )

  if (!path) return null

  const opacity     = dimmed ? 0.25 : 1
  const strokeWidth = selected ? 2.5 : 1.8
  const dashArray   = selected ? '10 6' : '8 6'
  const fill        = selected ? SEL_FILL : FILL_COLOR
  const filterId    = `cluster-glow-${cluster.id.replace(/[^a-zA-Z0-9]/g, '_')}`

  return (
    <g opacity={opacity} style={{ cursor: 'pointer' }}>
      {selected && (
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feFlood floodColor={STROKE_COLOR} floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}

      {/* Blob fill + border.
          pointer-events:'all' makes the semi-transparent interior a hit target.
          Nodes are rendered AFTER the ClusterLayer in the SVG DOM, so they sit
          on top in z-order and capture their own clicks via stopPropagation —
          clicking a node still selects the node, not the cluster.
          Clicking empty space inside the blob (or the border itself) selects
          the cluster; double-clicking collapses it to a summary box. */}
      <path
        d={path}
        fill={fill}
        stroke={STROKE_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={selected ? `url(#${filterId})` : undefined}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onDoubleClick={() => onToggleCollapse?.(cluster.id)}
        style={{ pointerEvents: 'all' }}
      />

      {/* Cluster title — also a click target so users can always select
          the cluster by clicking its label above the blob. */}
      <text
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="auto"
        fill={STROKE_COLOR}
        fontSize={13}
        fontWeight={selected ? 700 : 500}
        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace"
        opacity={dimmed ? 0.4 : 0.9}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onDoubleClick={() => onToggleCollapse?.(cluster.id)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {cluster.name}
      </text>
    </g>
  )
}

// ── Collapsed cluster (compact summary box) ───────────────────────────────────

function CollapsedClusterBox({ cluster, pos, sz, selected, dimmed, onMouseDown, onContextMenu, onToggleCollapse }) {
  if (!pos || !sz) return null
  const opacity = dimmed ? 0.3 : 1
  const memberN = cluster.memberIds.length
  return (
    <g
      opacity={opacity}
      style={{ cursor: 'pointer' }}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onDoubleClick={() => onToggleCollapse?.(cluster.id)}
    >
      <rect
        x={pos.x} y={pos.y} width={sz.w} height={sz.h}
        rx={14} ry={14}
        fill={selected ? SEL_FILL : FILL_COLOR}
        stroke={STROKE_COLOR}
        strokeWidth={selected ? 2.5 : 1.8}
        strokeDasharray={selected ? '10 6' : '8 6'}
        style={{ pointerEvents: 'all' }}
      />
      <text
        x={pos.x + sz.w / 2} y={pos.y + sz.h / 2 - 6}
        textAnchor="middle" dominantBaseline="middle"
        fill={STROKE_COLOR} fontSize={14} fontWeight={selected ? 700 : 600}
        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace"
        style={{ userSelect: 'none' }}
      >
        {cluster.name}
      </text>
      <text
        x={pos.x + sz.w / 2} y={pos.y + sz.h / 2 + 16}
        textAnchor="middle" dominantBaseline="middle"
        fill={STROKE_COLOR} fontSize={11} opacity={0.7}
        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace"
        style={{ userSelect: 'none' }}
      >
        {memberN} member{memberN === 1 ? '' : 's'} · double-click to expand
      </text>
    </g>
  )
}

// ── Public layer component ────────────────────────────────────────────────────

export function ClusterLayer({
  clusters,
  positions,
  sizes,
  nodeMap,
  selectedClusterId,
  linkedIds,
  collapsedClusters,
  hiddenClusters,
  onClusterMouseDown,
  onClusterContextMenu,
  onClusterToggleCollapse,
}) {
  if (!clusters || Object.keys(clusters).length === 0) return null

  return (
    <g>
      {Object.values(clusters).map(cluster => {
        if (hiddenClusters?.has(cluster.id)) return null   // hidden: render nothing
        const selected = selectedClusterId === cluster.id
        const dimmed   = linkedIds !== null && !linkedIds.has(cluster.id)
        const onMouseDown   = (e) => onClusterMouseDown(cluster.id, e)
        const onContextMenu = (e) => onClusterContextMenu?.(cluster.id, e)

        if (collapsedClusters?.has(cluster.id)) {
          return (
            <CollapsedClusterBox
              key={cluster.id}
              cluster={cluster}
              pos={positions[cluster.id]}
              sz={sizes[cluster.id]}
              selected={selected}
              dimmed={dimmed}
              onMouseDown={onMouseDown}
              onContextMenu={onContextMenu}
              onToggleCollapse={onClusterToggleCollapse}
            />
          )
        }

        return (
          <ExpandedClusterBlob
            key={cluster.id}
            cluster={cluster}
            positions={positions}
            sizes={sizes}
            nodeMap={nodeMap}
            selected={selected}
            dimmed={dimmed}
            onMouseDown={onMouseDown}
            onContextMenu={onContextMenu}
            onToggleCollapse={onClusterToggleCollapse}
          />
        )
      })}
    </g>
  )
}
