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

// ── Single blob component ─────────────────────────────────────────────────────

function ClusterBlob({ cluster, positions, sizes, nodeMap, selected, dimmed, onMouseDown }) {
  const { path, labelX, labelY, cx, cy } = useMemo(() => {
    // Collect root nodes for all members and gather bounding box corners
    const rootIds = new Set()
    for (const memberId of cluster.memberIds) {
      const rootId = getRootId(memberId, nodeMap)
      if (positions[rootId] && sizes[rootId]) rootIds.add(rootId)
    }

    const pts = []
    let minY = Infinity, topCx = 0

    for (const rid of rootIds) {
      const { x, y } = positions[rid]
      const { w, h } = sizes[rid]
      pts.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h })
      if (y < minY) { minY = y; topCx = x + w / 2 }
    }

    if (pts.length < 2) return { path: '', labelX: 0, labelY: 0, cx: 0, cy: 0 }

    const hull     = convexHull(pts)
    if (!hull)     return { path: '', labelX: 0, labelY: 0, cx: 0, cy: 0 }

    const expanded = expandHull(hull, BLOB_PADDING)
    const blobPath = smoothBlobPath(expanded)

    // Centroid of expanded hull for label positioning
    const ecx = expanded.reduce((s, p) => s + p.x, 0) / expanded.length
    const ecy = expanded.reduce((s, p) => s + p.y, 0) / expanded.length
    // Top-most y of expanded hull for label
    const topY = expanded.reduce((mn, p) => Math.min(mn, p.y), Infinity)

    return {
      path:   blobPath,
      labelX: ecx,
      labelY: topY - LABEL_OFFSET,
      cx:     ecx,
      cy:     ecy,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.memberIds, positions, sizes, nodeMap])

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
          the cluster. */}
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
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {cluster.name}
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
  onClusterMouseDown,
}) {
  if (!clusters || Object.keys(clusters).length === 0) return null

  return (
    <g>
      {Object.values(clusters).map(cluster => (
        <ClusterBlob
          key={cluster.id}
          cluster={cluster}
          positions={positions}
          sizes={sizes}
          nodeMap={nodeMap}
          selected={selectedClusterId === cluster.id}
          dimmed={linkedIds !== null && !linkedIds.has(cluster.id)}
          onMouseDown={(e) => onClusterMouseDown(cluster.id, e)}
        />
      ))}
    </g>
  )
}
