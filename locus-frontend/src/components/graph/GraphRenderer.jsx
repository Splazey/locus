import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { useGraphStore } from '../../store/useGraphStore'
import { NODE_CONFIG } from '../../constants/nodeConfig'
import { computeLayout, computeSemanticLayout, FOLDER as FOLDER_PAD, FILE as FILE_PAD, CLASS as CLASS_PAD } from '../../utils/graphLayout'
import { EdgeLayer }    from './EdgeLayer'
import { ClusterLayer } from './ClusterLayer'
import { ContextMenu }  from './ContextMenu'
import { Minimap }      from './Minimap'
import { FolderNode }   from './nodes/FolderNode'
import { FileNode }     from './nodes/FileNode'
import { ClassNode }    from './nodes/ClassNode'
import { FunctionNode } from './nodes/FunctionNode'
import { MethodNode }   from './nodes/MethodNode'
import { ImportNode }         from './nodes/ImportNode'
import { ImportModuleNode }   from './nodes/ImportModuleNode'
import { ImportEntityNode }   from './nodes/ImportEntityNode'
import { VariableNode } from './nodes/VariableNode'

const MIN_ZOOM       = 0.02   // low enough to frame very large graphs in one view
const MAX_ZOOM       = 5
const MOVE_THRESHOLD = 4

// Delay (ms) a pointer must rest on a node before its name tooltip appears.
const HOVER_DELAY = 450

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

/** Extract the source-file relative path encoded in a node id (imp/import nodes have none). */
function fileFromId(nodeId) {
  if (!nodeId || nodeId.startsWith('imp:')) return null
  if (nodeId.startsWith('import_module:') || nodeId.startsWith('import_entity:')) return null
  const parts = nodeId.split(':')
  return parts.length >= 2 ? parts[1] : null
}

// Leaf node types — used to classify edges into leaf vs deep layers.
const LEAF_TYPES = new Set(['function', 'method', 'import', 'import_module', 'import_entity', 'variable'])

/**
 * LOD_THRESHOLD — apparent on-screen pixel width below which a container node
 * (file or class) switches to the simplified "collapsed" view: interior child
 * nodes are unloaded from the DOM and the label moves to the centre of the box.
 *
 * apparent_width = sizes[id].w × viewport.zoom
 *
 * Example crossover points:
 *   140 px node → collapses at zoom < 0.57
 *   200 px node → collapses at zoom < 0.40
 *   300 px node → collapses at zoom < 0.27
 */
const LOD_THRESHOLD = 380

/**
 * EASE_FACTOR — fraction of the remaining gap closed each animation frame.
 * Pure exponential ease-out: pos += (target − pos) × EASE_FACTOR.
 * Range 0–1.  Higher = snappier, lower = more sluggish.
 */
const EASE_FACTOR = 0.03 // 0.13 initial

/**
 * PEER_GAP_DEFAULT — starting value for the Node Spacing slider.
 * The live value is stored in peerGapRef inside the component so every
 * callback always reads the latest figure without needing a re-render.
 */
const PEER_GAP_DEFAULT = 80

/**
 * REPULSION_DELAY — milliseconds a peer must be inside the push zone before
 * it starts moving.  Prevents jitter on brief/accidental overlaps.
 */
const REPULSION_DELAY = 60

/**
 * REPULSION_RAMP — milliseconds over which the push scales from 0 → full
 * after the delay has elapsed.  Uses a smoothstep curve for organic feel.
 */
const REPULSION_RAMP = 350

const BTN = {
  width: 28, height: 28,
  background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
  color: '#e6edf3', cursor: 'pointer', fontSize: 16,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Minimum centre-to-centre distance between two nodes before repulsion kicks in. */
function minCenterDist(szA, szB, gap) {
  // Use the longer half-dimension as the "radius" for each node so rectangles work too.
  return Math.max(szA.w, szA.h) / 2 + Math.max(szB.w, szB.h) / 2 + gap
}

/**
 * Post-drop / post-gap-change cascade relaxation.
 *
 * Iteratively pushes overlapping siblings apart across ALL peer groups until
 * no more overlaps exist or MAX_ITERS is reached.  Runs entirely on plain
 * objects (no React state) so it is synchronous and cheap.
 *
 * Parent-boundary clamping is applied after every push, so the effective gap
 * inside a container is naturally limited by the container's available space —
 * nodes can never be pushed outside their parent.
 *
 * `anyChange` is only set when a node's position *actually moved* after
 * clamping, so the loop terminates immediately when wall-blocked nodes can no
 * longer make progress.
 *
 * @param positions  - starting positions map  { [id]: {x,y} }  (not mutated)
 * @param sizes      - sizes map               { [id]: {w,h} }
 * @param nodeMap    - node data map           { [id]: {parent?, type, ...} }
 * @param getDesc    - fn(id) → descendant id[]
 * @param pinnedIds  - Set of IDs that must not move (e.g. the dragged subtree)
 * @param gap        - current PEER_GAP value
 * @returns new positions map with all overlaps resolved within parent bounds
 */
function settleAllPeers(positions, sizes, nodeMap, getDesc, pinnedIds, gap) {
  const MAX_ITERS = 30
  const MOVE_EPS  = 0.1               // px — ignore sub-pixel jitter
  const rest = { ...positions }       // working copy – mutated in place

  // Build peer groups once: same parent key → sibling IDs
  const groupMap = {}
  for (const id of Object.keys(nodeMap)) {
    const key = nodeMap[id]?.parent ?? '__top__'
    if (!groupMap[key]) groupMap[key] = []
    groupMap[key].push(id)
  }
  const groups = Object.values(groupMap).filter(g => g.length > 1)

  // Helper: push a node by (ddx, ddy), clamped to its parent boundary.
  // Returns the *actual* delta applied (may be smaller than requested if clamped).
  function applyPush(id, sz, ddx, ddy) {
    const old = rest[id]
    let nx = old.x + ddx,  ny = old.y + ddy
    const parentId = nodeMap[id]?.parent
    if (parentId) {
      const pp = rest[parentId],  ps = sizes[parentId],  pt = nodeMap[parentId]?.type
      if (pp && ps) ({ x: nx, y: ny } = clampInParent(nx, ny, sz, pp, ps, pt))
    }
    const ax = nx - old.x,  ay = ny - old.y
    if (Math.abs(ax) < MOVE_EPS && Math.abs(ay) < MOVE_EPS) return null  // clamped / no-op
    rest[id] = { x: nx, y: ny }
    for (const desc of getDesc(id)) {
      const dp = rest[desc]
      if (dp) rest[desc] = { x: dp.x + ax, y: dp.y + ay }
    }
    return { ax, ay }
  }

  let anyChange = true
  for (let iter = 0; iter < MAX_ITERS && anyChange; iter++) {
    anyChange = false

    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        const idA = group[i]
        const szA = sizes[idA];  const posA = rest[idA]
        if (!szA || !posA) continue

        for (let j = i + 1; j < group.length; j++) {
          const idB = group[j]
          const szB = sizes[idB];  const posB = rest[idB]
          if (!szB || !posB) continue

          const cxA = posA.x + szA.w / 2,  cyA = posA.y + szA.h / 2
          const cxB = posB.x + szB.w / 2,  cyB = posB.y + szB.h / 2
          const dx = cxB - cxA,  dy = cyB - cyA
          const dist = Math.hypot(dx, dy) || 1
          const md   = minCenterDist(szA, szB, gap)
          if (dist >= md) continue

          const overlap = md - dist + 0.5   // +0.5 avoids float oscillation
          const ux = dx / dist,  uy = dy / dist

          const pinA = pinnedIds?.has(idA)
          const pinB = pinnedIds?.has(idB)
          if (pinA && pinB) continue

          // Each free node takes its share; pinned node's share goes to the other
          const shareA = pinA ? 0 : (pinB ? overlap : overlap / 2)
          const shareB = pinB ? 0 : (pinA ? overlap : overlap / 2)

          // Apply push + clamp; anyChange only if position actually moved
          if (shareA > 0) {
            const r = applyPush(idA, szA, -ux * shareA, -uy * shareA)
            if (r) anyChange = true
          }
          if (shareB > 0) {
            const r = applyPush(idB, szB,  ux * shareB,  uy * shareB)
            if (r) anyChange = true
          }
        }
      }
    }
  }

  return rest
}

/** Clamp a node's top-left (x, y) so it stays inside its parent's content area. */
function clampInParent(x, y, sz, parentPos, parentSz, parentType) {
  if (!parentPos || !parentSz) return { x, y }
  const pad = parentType === 'folder' ? FOLDER_PAD : parentType === 'file' ? FILE_PAD : CLASS_PAD
  return {
    x: Math.max(parentPos.x + pad.padX,
        Math.min(parentPos.x + parentSz.w - pad.padX - sz.w, x)),
    y: Math.max(parentPos.y + pad.header + pad.padY,
        Math.min(parentPos.y + parentSz.h - pad.padY - sz.h, y)),
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export function GraphRenderer({ elements, clusters = {}, visibleTypes, visibleEdgeTypes, onNodeSelect, layoutKey, peerGap = PEER_GAP_DEFAULT, viewMode = 'structural' }) {
  const storeColors      = useGraphStore((s) => s.nodeColors)
  const collapsedFolders = useGraphStore((s) => s.collapsedFolders)
  const toggleFolder     = useGraphStore((s) => s.toggleFolder)
  const collapsedClusters     = useGraphStore((s) => s.collapsedClusters)
  const hiddenClusters        = useGraphStore((s) => s.hiddenClusters)
  const toggleClusterCollapsed = useGraphStore((s) => s.toggleClusterCollapsed)
  const toggleClusterHidden    = useGraphStore((s) => s.toggleClusterHidden)
  const moveNodeToCluster      = useGraphStore((s) => s.moveNodeToCluster)
  const createCluster          = useGraphStore((s) => s.createCluster)
  const deleteCluster          = useGraphStore((s) => s.deleteCluster)
  const updateClusterMetadata  = useGraphStore((s) => s.updateClusterMetadata)
  const contextMenu            = useGraphStore((s) => s.contextMenu)
  const openContextMenu        = useGraphStore((s) => s.openContextMenu)
  const closeContextMenu       = useGraphStore((s) => s.closeContextMenu)
  const storeSelectedNode      = useGraphStore((s) => s.selectedNode)
  const focusRequest           = useGraphStore((s) => s.focusRequest)
  // Merge store overrides with NODE_CONFIG defaults so every type always has a color
  const nodeColors = useMemo(() => {
    const merged = {}
    for (const type of Object.keys(NODE_CONFIG)) {
      merged[type] = storeColors?.[type] ?? NODE_CONFIG[type].color
    }
    return merged
  }, [storeColors])

  const svgRef          = useRef(null)
  const dragRef         = useRef(null)
  const panRef          = useRef(null)
  const movedRef        = useRef(false)
  const clusterClickRef = useRef(null)   // set to clusterId on blob mousedown

  const [positions,        setPositions]        = useState({})
  const [sizes,            setSizes]            = useState({})
  const [displayPositions, setDisplayPositions] = useState({})
  const [viewport,         setViewport]         = useState({ x: 0, y: 0, zoom: 1 })
  const [selectedId,       setSelectedId]       = useState(null)
  const [svgSize,          setSvgSize]          = useState({ w: 0, h: 0 })
  const [searchQuery,      setSearchQuery]      = useState('')
  const [hoverTip,         setHoverTip]         = useState(null)  // { label, x, y } | null
  const [searchOpen,       setSearchOpen]       = useState(false)
  const [searchActiveIdx,  setSearchActiveIdx]  = useState(0)
  const hoverTimerRef = useRef(null)
  const searchInputRef = useRef(null)

  // Refs used inside the rAF loop and stable callbacks (avoid stale closures)
  const posRef              = useRef({})         // mirror of `positions` state
  const sizesRef            = useRef({})         // mirror of `sizes` state
  const displayPosRef       = useRef({})         // current rendered (smoothed) positions
  const restPosRef          = useRef({})         // repulsion-settled positions
  const layoutPosRef        = useRef({})         // raw layout positions (pre-repulsion baseline)
  const draggingSubtree     = useRef(new Set())  // IDs that snap instantly (no spring)
  // { [peerId]: DOMHighResTimeStamp } — when each peer first entered the push zone.
  // null/absent means the peer is currently outside the zone (timer resets on exit).
  const repulsionTimersRef  = useRef({})
  // Tracks the live peerGap value so all callbacks always read the latest figure.
  const peerGapRef          = useRef(peerGap)

  // Mirror of `viewport` so stable callbacks (startPan) read the latest camera
  // without taking viewport.x/y as deps — otherwise they'd be rebuilt every pan
  // frame, thrashing the per-node handler cache and defeating React.memo.
  const viewportRef = useRef(viewport)

  useEffect(() => { posRef.current    = positions }, [positions])
  useEffect(() => { sizesRef.current  = sizes     }, [sizes])
  useEffect(() => { peerGapRef.current = peerGap  }, [peerGap])
  useEffect(() => { viewportRef.current = viewport }, [viewport])

  // ── Derived maps ──────────────────────────────────────────────────────────────
  const nodes = useMemo(() => elements.filter(e => !e.data.source), [elements])
  const edges = useMemo(() => elements.filter(e =>  e.data.source), [elements])

  const nodeMap = useMemo(() => {
    const m = {}
    for (const n of nodes) m[n.data.id] = n.data
    return m
  }, [nodes])

  // Partition edges once into "leaf" (both endpoints are leaf nodes, drawn above
  // containers) and "deep" (≥1 container endpoint, drawn below). Done here so
  // neither EdgeLayer has to scan the full edge list to classify on every render.
  const { deepEdges, leafEdges } = useMemo(() => {
    const deep = [], leaf = []
    for (const e of edges) {
      const sn = nodeMap[e.data.source]
      const tn = nodeMap[e.data.target]
      if (!sn || !tn) continue
      if (LEAF_TYPES.has(sn.type) && LEAF_TYPES.has(tn.type)) leaf.push(e)
      else deep.push(e)
    }
    return { deepEdges: deep, leafEdges: leaf }
  }, [edges, nodeMap])

  const childrenOf = useMemo(() => {
    const m = {}
    for (const n of nodes) m[n.data.id] = []
    for (const n of nodes) {
      const p = n.data.parent
      if (p && m[p]) m[p].push(n.data.id)
    }
    return m
  }, [nodes])

  const getDescendants = useCallback(id => {
    const out = [], stack = [...(childrenOf[id] ?? [])]
    while (stack.length) {
      const c = stack.pop(); out.push(c)
      for (const g of childrenOf[c] ?? []) stack.push(g)
    }
    return out
  }, [childrenOf])

  // Stable ref so onMouseMove can call it without re-declaring
  const descRef = useRef(getDescendants)
  useEffect(() => { descRef.current = getDescendants }, [getDescendants])

  // ── LOD: which container nodes are zoomed too small to show interiors ────────
  // Recomputes on every zoom change but NOT on pan (viewport.x / viewport.y).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const collapsedIds = useMemo(() => {
    const s = new Set()
    for (const n of nodes) {
      if (n.data.type !== 'file' && n.data.type !== 'class') continue
      const sz = sizes[n.data.id]
      if (sz && sz.w * viewport.zoom < LOD_THRESHOLD) s.add(n.data.id)
    }
    return s
  }, [nodes, sizes, viewport.zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hidden nodes ─────────────────────────────────────────────────────────
  // Structural mode: every descendant of a collapsed folder.
  // Semantic mode: every member (and descendants) of a collapsed OR hidden
  // cluster — these are removed from the DOM so large semantic graphs render
  // only the currently-expanded clusters.
  const hiddenIds = useMemo(() => {
    const s = new Set()
    const mark = id => { for (const k of childrenOf[id] ?? []) { s.add(k); mark(k) } }

    if (viewMode === 'semantic') {
      const hide = new Set([
        ...(collapsedClusters ?? []),
        ...(hiddenClusters ?? []),
      ])
      if (hide.size === 0) return s
      for (const cid of hide) {
        const cl = clusters[cid]
        if (!cl) continue
        for (const mid of cl.memberIds) { s.add(mid); mark(mid) }
      }
      return s
    }

    if (!collapsedFolders || collapsedFolders.size === 0) return s
    for (const fid of collapsedFolders) mark(fid)
    return s
  }, [collapsedFolders, collapsedClusters, hiddenClusters, clusters, childrenOf, viewMode])

  // ── Animation loop — exponential ease-out ─────────────────────────────────────
  // Each frame: display += (target − display) × EASE_FACTOR
  // This is pure exponential decay: no velocity, no overshoot.
  // Runs forever from refs; never needs to restart.
  useEffect(() => {
    let rafId
    const step = () => {
      const target   = posRef.current
      const cur      = displayPosRef.current
      const dragging = draggingSubtree.current
      const next     = {}

      // Track whether anything actually changed this frame. When nothing moves
      // (the common idle case) we skip the setState entirely, so an at-rest
      // graph triggers zero re-renders no matter how many nodes it has.
      let moved = false

      for (const id of Object.keys(target)) {
        const t = target[id]
        if (!t) continue

        if (dragging.has(id)) {
          // Dragged subtree: snap to exact mouse position, no easing.
          // While a drag is in progress we always re-render so the node tracks
          // the cursor.
          next[id] = { x: t.x, y: t.y }
          moved = true
          continue
        }

        const c  = cur[id] ?? { x: t.x, y: t.y }
        const dx = t.x - c.x
        const dy = t.y - c.y

        // Snap when close enough to avoid endless micro-movement
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
          if (dx !== 0 || dy !== 0) {
            // Just arrived at rest this frame — snap to a fresh object once.
            moved = true
            next[id] = { x: t.x, y: t.y }
          } else {
            // Already at rest: reuse the SAME object reference so memoized node
            // components see an unchanged `position`/`cx` prop and skip re-render.
            next[id] = c
          }
        } else {
          moved = true
          next[id] = { x: c.x + dx * EASE_FACTOR, y: c.y + dy * EASE_FACTOR }
        }
      }

      displayPosRef.current = next
      // Idle frames mutate the ref but skip React: no commit, no reconciliation.
      if (moved) setDisplayPositions(next)
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
  }, []) // empty: reads everything via refs

  // ── Fit viewport ───────────────────────────────────────────────────────────────
  const fitToContent = useCallback((pos, sz) => {
    const svg = svgRef.current
    if (!svg) return
    const ids = Object.keys(pos)
    if (!ids.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of ids) {
      const p = pos[id], s = sz[id]
      if (!p || !s) continue
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h)
    }
    if (!isFinite(minX)) return
    const rect = svg.getBoundingClientRect()
    const pad  = 80
    const zoom = Math.max(MIN_ZOOM, Math.min(2,
      (rect.width  - pad * 2) / (maxX - minX),
      (rect.height - pad * 2) / (maxY - minY),
    ))
    setViewport({
      zoom,
      x: (rect.width  - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    })
  }, [])

  // Re-layout when graph or view mode changes.
  // Saved positions (from a loaded save, or committed by earlier drags) take
  // precedence over the computed layout — except on an explicit re-layout
  // (layoutKey bump), which discards them for this mode.
  const prevLayoutKeyRef    = useRef(layoutKey)
  const prevCollapseRef     = useRef(collapsedFolders)
  const prevClusterCollapse = useRef(collapsedClusters)
  const prevClusterHidden   = useRef(hiddenClusters)
  useEffect(() => {
    // A collapse/expand/hide toggle re-runs layout but should NOT refit the
    // viewport or clear the selection — only a graph/mode/relayout change does.
    const collapseOnly =
      layoutKey === prevLayoutKeyRef.current &&
      (prevCollapseRef.current     !== collapsedFolders  ||
       prevClusterCollapse.current !== collapsedClusters ||
       prevClusterHidden.current   !== hiddenClusters)
    prevCollapseRef.current     = collapsedFolders
    prevClusterCollapse.current = collapsedClusters
    prevClusterHidden.current   = hiddenClusters

    const { positions: lp, sizes: s } = viewMode === 'semantic'
      ? computeSemanticLayout(elements, { collapsedClusters, hiddenClusters })
      : computeLayout(elements, collapsedFolders)

    let p = lp
    const store = useGraphStore.getState()
    if (layoutKey !== prevLayoutKeyRef.current) {
      // User asked for a fresh layout — overwrite any remembered positions
      store.setSavedPositions(viewMode, { ...lp }, true)
    } else {
      const saved = store.savedPositions?.[viewMode]
      if (saved && Object.keys(saved).length) {
        p = { ...lp }
        for (const id of Object.keys(saved)) {
          if (p[id]) p[id] = { ...saved[id] }
        }
      } else if (Object.keys(lp).length) {
        // First layout for this mode — record it (silently) so saving captures it
        store.setSavedPositions(viewMode, { ...lp }, false)
      }
    }
    prevLayoutKeyRef.current = layoutKey

    setPositions(p); setSizes(s)
    // Snap display to new layout instantly (reset easing state)
    displayPosRef.current      = { ...p }
    layoutPosRef.current       = { ...p }   // pristine baseline for gap-change settle
    restPosRef.current         = { ...p }
    repulsionTimersRef.current = {}
    draggingSubtree.current    = new Set()
    setDisplayPositions({ ...p })
    if (collapseOnly) return        // keep viewport + selection on collapse/expand
    setSelectedId(null)
    const t = setTimeout(() => fitToContent(p, s), 50)
    return () => clearTimeout(t)
  }, [elements, layoutKey, viewMode, collapsedFolders, collapsedClusters, hiddenClusters, fitToContent])

  // Re-settle all nodes when the peerGap changes (slider released).
  // Skipped on first mount (restPosRef is empty until a graph loads).
  const prevPeerGapRef = useRef(peerGap)
  useEffect(() => {
    if (prevPeerGapRef.current === peerGap) return   // no change
    prevPeerGapRef.current = peerGap
    const base = layoutPosRef.current
    if (!Object.keys(base).length) return            // no graph loaded yet
    // Always settle from the raw layout baseline so that BOTH increasing AND
    // decreasing the gap produces the correct result.  Starting from restPosRef
    // (already-repulsed positions) would prevent nodes from moving closer together
    // when the gap is reduced.
    const settled = settleAllPeers(
      base, sizesRef.current, nodeMap, descRef.current,
      new Set(),  // nothing pinned — let everything find its natural spacing
      peerGap,
    )
    restPosRef.current = settled
    setPositions(prev => ({ ...prev, ...settled }))
    useGraphStore.getState().setSavedPositions(viewMode, { ...settled }, true)
  }, [peerGap, nodeMap, viewMode])

  // Wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = e => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      setViewport(vp => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const zoom   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor))
        const ratio  = zoom / vp.zoom
        return { zoom, x: mx - (mx - vp.x) * ratio, y: my - (my - vp.y) * ratio }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Track the SVG's on-screen size so viewport culling knows the visible area.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const apply = () => {
      const r = svg.getBoundingClientRect()
      setSvgSize(prev =>
        (prev.w === r.width && prev.h === r.height) ? prev : { w: r.width, h: r.height }
      )
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // ── Helpers used by drag handlers ──────────────────────────────────────────────

  /**
   * Given the dragged node's current centre and a list of peer IDs, compute
   * new target positions for every peer that is too close.
   *
   * The push is gated by two timing constants:
   *   REPULSION_DELAY — ms the peer must stay in-zone before it reacts at all.
   *   REPULSION_RAMP  — ms over which the push eases from 0 → full (smoothstep).
   *
   * Peers that are far enough have their timer cleared and snap back to rest.
   * Returns { [peerId]: {x, y} } for every peer.
   */
  const repelPeers = useCallback((draggedCX, draggedCY, draggedSz, peers, parentId, parentType, prev) => {
    const result  = {}
    const rest    = restPosRef.current
    const timers  = repulsionTimersRef.current
    const now     = performance.now()

    for (const peerId of peers) {
      const peerSz  = sizesRef.current[peerId]
      const restPos = rest[peerId]
      if (!peerSz || !restPos) continue

      // Always measure from the peer's REST position so the force is stable
      const peerCX = restPos.x + peerSz.w / 2
      const peerCY = restPos.y + peerSz.h / 2
      const dx     = peerCX - draggedCX
      const dy     = peerCY - draggedCY
      const dist   = Math.hypot(dx, dy) || 1
      const md     = minCenterDist(draggedSz, peerSz, peerGapRef.current)

      let nx, ny

      if (dist < md) {
        // Start (or continue) the entry timer for this peer
        if (timers[peerId] == null) timers[peerId] = now

        // How far through the delay + ramp are we?
        const elapsed = now - timers[peerId]
        const t       = Math.max(0, Math.min(1, (elapsed - REPULSION_DELAY) / REPULSION_RAMP))
        // Smoothstep: s(t) = t² (3 − 2t)  → ease-in-out from 0 to 1
        const scale   = t * t * (3 - 2 * t)

        const push = (md - dist) * scale
        nx = restPos.x + (dx / dist) * push
        ny = restPos.y + (dy / dist) * push

        if (parentId) {
          const clamped = clampInParent(
            nx, ny, peerSz,
            prev[parentId], sizesRef.current[parentId], parentType,
          )
          nx = clamped.x; ny = clamped.y
        }
      } else {
        // Peer left the zone — clear its timer so the delay resets on re-entry
        timers[peerId] = null
        nx = restPos.x; ny = restPos.y
      }

      result[peerId] = { x: nx, y: ny }
    }
    return result
  }, [])

  /**
   * Apply peer position updates (from repelPeers) into the positions map,
   * also shifting every peer's descendants by the same delta so containers
   * carry their children with them.
   */
  const applyPeerUpdates = useCallback((next, prev, peerUpdates) => {
    for (const [peerId, newPos] of Object.entries(peerUpdates)) {
      const oldPos = prev[peerId] ?? restPosRef.current[peerId] ?? newPos
      const pdx = newPos.x - oldPos.x
      const pdy = newPos.y - oldPos.y
      next[peerId] = newPos
      for (const descId of descRef.current(peerId)) {
        const dp = prev[descId]
        if (dp) next[descId] = { x: dp.x + pdx, y: dp.y + pdy }
      }
    }
  }, [])

  // ── Interaction handlers ───────────────────────────────────────────────────────

  // Dismiss the hover tooltip (called on any drag/pan start).
  const hideTip = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHoverTip(null)
  }, [])

  // Begin a camera pan. Panning is bound to the MIDDLE mouse button only, and
  // works uniformly whether the pointer is over the background or a node.
  const startPan = useCallback(e => {
    hideTip()
    movedRef.current = false
    const rect = svgRef.current.getBoundingClientRect()
    const vp   = viewportRef.current
    panRef.current = {
      startMx: e.clientX - rect.left, startMy: e.clientY - rect.top,
      startVx: vp.x,                  startVy: vp.y,
      pan: true,
    }
  }, [hideTip])

  const onBgDown = useCallback(e => {
    if (e.button === 1) {          // middle-click → pan camera
      e.preventDefault()
      startPan(e)
      return
    }
    if (e.button !== 0) return     // ignore right — opens the context menu
    movedRef.current = false
    const rect = svgRef.current.getBoundingClientRect()
    // Left-press on empty background: track it so a plain click (no drag)
    // deselects on mouseup, but do NOT pan — panning is middle-click only.
    panRef.current = {
      startMx: e.clientX - rect.left, startMy: e.clientY - rect.top,
      startVx: viewport.x,            startVy: viewport.y,
      pan: false,
    }
  }, [viewport.x, viewport.y, startPan])

  const onNodeDown = useCallback(id => e => {
    if (e.button === 1) {          // middle-click over a node → pan camera
      e.preventDefault()
      e.stopPropagation()
      startPan(e)
      return
    }
    if (e.button !== 0) return    // ignore right-click — handled by onContextMenu
    e.stopPropagation()
    hideTip()
    movedRef.current = false
    const rect = svgRef.current.getBoundingClientRect()

    const desc    = getDescendants(id)
    const nodeIds = [id, ...desc]

    const parentId   = nodeMap[id]?.parent ?? null
    const parentType = parentId ? nodeMap[parentId]?.type : null

    // Peers = same-level nodes.
    //   • Has parent  → siblings (children of the same parent, minus itself)
    //   • Top-level   → every other node that also has no parent
    const peers = parentId
      ? (childrenOf[parentId] ?? []).filter(sid => sid !== id)
      : Object.keys(nodeMap).filter(nid => !nodeMap[nid]?.parent && nid !== id)

    // Baseline = displayed positions so there is no snap-on-pickup
    const snap = displayPosRef.current
    const startPositions = {}
    for (const nid of nodeIds) {
      if (snap[nid]) startPositions[nid] = { ...snap[nid] }
    }

    draggingSubtree.current    = new Set(nodeIds)
    repulsionTimersRef.current = {}   // fresh timers for this drag

    dragRef.current = {
      nodeIds, rootId: id,
      parentId, parentType, peers,
      startMx: e.clientX - rect.left,
      startMy: e.clientY - rect.top,
      startPositions,
    }
  }, [getDescendants, nodeMap, childrenOf, startPan, hideTip])

  // Per-id handler cache: `onNodeDown(id)` builds a fresh closure each call, which
  // would defeat React.memo on the node components (onMouseDown prop would change
  // every render). Cache one stable handler per id, invalidated only when
  // onNodeDown itself changes (i.e. on graph/layout change, not on animation).
  const nodeDownFor = useMemo(() => {
    const cache = new Map()
    return (id) => {
      let h = cache.get(id)
      if (!h) { h = onNodeDown(id); cache.set(id, h) }
      return h
    }
  }, [onNodeDown])

  const onMouseMove = useCallback(e => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (dragRef.current) {
      const d     = dragRef.current
      const rawDx = (mx - d.startMx) / viewport.zoom
      const rawDy = (my - d.startMy) / viewport.zoom

      if (Math.abs(mx - d.startMx) > MOVE_THRESHOLD ||
          Math.abs(my - d.startMy) > MOVE_THRESHOLD) {
        movedRef.current = true
      }
      if (!movedRef.current) return

      const { rootId, parentId, parentType, peers } = d
      const sp = d.startPositions[rootId]
      if (!sp) return

      // New dragged-node position, clamped to its parent
      let newX = sp.x + rawDx
      let newY = sp.y + rawDy
      if (parentId) {
        const clamped = clampInParent(
          newX, newY,
          sizesRef.current[rootId] ?? { w: 0, h: 0 },
          posRef.current[parentId],
          sizesRef.current[parentId],
          parentType,
        )
        newX = clamped.x; newY = clamped.y
      }
      const actualDx = newX - sp.x
      const actualDy = newY - sp.y

      const draggedSz = sizesRef.current[rootId] ?? { w: 72, h: 72 }
      const draggedCX = newX + draggedSz.w / 2
      const draggedCY = newY + draggedSz.h / 2

      setPositions(prev => {
        const next = { ...prev }

        // 1. Move the dragged subtree to the new position
        for (const nid of d.nodeIds) {
          const nsp = d.startPositions[nid]
          if (nsp) next[nid] = { x: nsp.x + actualDx, y: nsp.y + actualDy }
        }

        // 2. Repel peers that are within PEER_GAP + their combined radii
        if (peers.length) {
          const peerUpdates = repelPeers(
            draggedCX, draggedCY, draggedSz,
            peers, parentId, parentType, prev,
          )
          applyPeerUpdates(next, prev, peerUpdates)
        }

        return next
      })

    } else if (panRef.current) {
      const p  = panRef.current
      const dx = mx - p.startMx, dy = my - p.startMy
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) movedRef.current = true
      if (p.pan) setViewport(vp => ({ ...vp, x: p.startVx + dx, y: p.startVy + dy }))
    }
  }, [viewport.zoom, repelPeers, applyPeerUpdates])

  const onMouseUp = useCallback(() => {
    const d = dragRef.current

    if (!movedRef.current) {
      // It was a click, not a drag
      if (d) {
        const data = nodeMap[d.rootId]
        if (data) {
          setSelectedId(d.rootId)
          onNodeSelect?.({ id: d.rootId, type: data.type, data: { ...data } })
        }
      } else if (clusterClickRef.current) {
        // Cluster blob click
        const clusterId = clusterClickRef.current
        const cluster   = clusters[clusterId]
        if (cluster) {
          setSelectedId(clusterId)
          onNodeSelect?.({
            id:   clusterId,
            type: 'cluster',
            data: {
              id:          clusterId,
              type:        'cluster',
              label:       cluster.name,
              fullLabel:   cluster.name,
              description: cluster.description,
              memberIds:   cluster.memberIds,
            },
          })
        }
      } else if (panRef.current) {
        setSelectedId(null)
        onNodeSelect?.(null)
      }
    } else if (d) {
      // ── Drag ended ─────────────────────────────────────────────────────────
      // posRef.current already holds the live-repulsed positions from
      // onMouseMove — we simply promote those to "rest" so nothing springs back.
      const cur = posRef.current

      // 1. Commit the dropped subtree to rest AND to the layout baseline so
      //    subsequent gap-slider changes respect the user's intentional placement.
      for (const nid of d.nodeIds) {
        if (cur[nid]) {
          restPosRef.current[nid]   = { ...cur[nid] }
          layoutPosRef.current[nid] = { ...cur[nid] }
        }
      }

      // 2. Commit the live (already-repulsed) positions of direct peers.
      //    This is the fix for "nodes snap back": we read what was actually
      //    displayed during the drag, not re-run repelPeers with zeroed timers.
      for (const peerId of d.peers) {
        if (cur[peerId]) {
          restPosRef.current[peerId]   = { ...cur[peerId] }
          layoutPosRef.current[peerId] = { ...cur[peerId] }
          for (const descId of descRef.current(peerId)) {
            if (cur[descId]) {
              restPosRef.current[descId]   = { ...cur[descId] }
              layoutPosRef.current[descId] = { ...cur[descId] }
            }
          }
        }
      }

      // 3. Cascade settle: the moved peers may now overlap *their* own
      //    siblings.  Run an iterative relaxation pass across all peer groups
      //    until every sibling pair is at least PEER_GAP apart.
      //    The dragged subtree is pinned so the drop position is respected.
      const pinnedIds = new Set(d.nodeIds)
      const settled   = settleAllPeers(
        restPosRef.current,
        sizesRef.current,
        nodeMap,
        descRef.current,
        pinnedIds,
        peerGapRef.current,
      )

      // 4. Commit the fully-settled layout
      restPosRef.current = settled
      setPositions(prev => ({ ...prev, ...settled }))

      // 5. Remember the user's placement so it can be saved and restored
      useGraphStore.getState().setSavedPositions(viewMode, { ...settled }, true)
    }

    draggingSubtree.current    = new Set()
    repulsionTimersRef.current = {}
    dragRef.current        = null
    panRef.current         = null
    clusterClickRef.current = null
  }, [nodeMap, onNodeSelect, clusters, viewMode])

  // ── Linked nodes (selected + direct neighbours + their containers) ─────────────
  const linkedIds = useMemo(() => {
    if (!selectedId) return null

    // Cluster selection: highlight all member nodes and their containers
    if (selectedId.startsWith('cluster:') && clusters[selectedId]) {
      const s = new Set([selectedId])
      for (const memberId of clusters[selectedId].memberIds) {
        s.add(memberId)
        let cur = nodeMap[memberId]?.parent
        while (cur) { s.add(cur); cur = nodeMap[cur]?.parent }
      }
      return s
    }

    // Normal node selection
    const s = new Set([selectedId])
    for (const e of edges) {
      if (e.data.source === selectedId) s.add(e.data.target)
      if (e.data.target === selectedId) s.add(e.data.source)
    }
    const addAncestors = id => {
      let cur = nodeMap[id]?.parent
      while (cur) { s.add(cur); cur = nodeMap[cur]?.parent }
    }
    const snapshot = [...s]
    for (const id of snapshot) addAncestors(id)
    return s
  }, [selectedId, edges, nodeMap, clusters])

  // ── Visible node filter ───────────────────────────────────────────────────────
  const visibleIds = useMemo(() => {
    const s = new Set()
    for (const n of nodes) {
      if (visibleTypes[n.data.type] === false) continue
      const parent = n.data.parent
      if (parent) {
        const parentType = nodeMap[parent]?.type
        // In semantic mode, file parents are not rendered — skip file-parent check
        // so that classes/functions remain visible regardless of the file toggle.
        if (parentType === 'file' && viewMode === 'semantic') { /* allow */ }
        else if (visibleTypes[parentType] === false) continue
      }
      s.add(n.data.id)
    }
    return s
  }, [nodes, nodeMap, visibleTypes, viewMode])

  // ── Cluster blob mousedown (sets clusterClickRef for onMouseUp) ──────────────
  const onClusterMouseDown = useCallback((clusterId, e) => {
    if (e.button === 1) {         // middle-click over a cluster → pan camera
      e.preventDefault()
      e.stopPropagation()
      startPan(e)
      return
    }
    if (e.button !== 0) return    // ignore right-click — handled by onContextMenu
    e.stopPropagation()
    movedRef.current        = false
    clusterClickRef.current = clusterId
    dragRef.current         = null
    panRef.current          = null
  }, [startPan])

  // ── Context menus ───────────────────────────────────────────────────────────
  // Build the items for a node's right-click menu. Only meaningful in semantic
  // view (clusters aren't visible otherwise) — restricted at the call site.
  const buildNodeMenuItems = useCallback((nodeData) => {
    const nodeId        = nodeData.id
    const currentCid    = nodeData.clusterId ?? null
    const clusterValues = Object.values(clusters)
    const moveTargets   = clusterValues
      .filter(c => c.id !== currentCid)
      .map(c => ({
        type: 'action',
        label: c.name || c.id,
        onClick: () => moveNodeToCluster(nodeId, c.id),
      }))

    return [
      {
        type: 'submenu',
        label: 'Move to cluster',
        items: moveTargets,
      },
      {
        type: 'input',
        label: 'Move to new cluster…',
        placeholder: 'Cluster name',
        submitLabel: 'Create & move',
        onSubmit: (name) => {
          createCluster({ name, memberIds: [nodeId] })
        },
      },
      {
        type: 'action',
        label: 'Remove from cluster',
        disabled: !currentCid,
        onClick: () => moveNodeToCluster(nodeId, null),
      },
    ]
  }, [clusters, moveNodeToCluster, createCluster])

  const buildClusterMenuItems = useCallback((clusterId) => {
    const cluster = clusters[clusterId]
    if (!cluster) return []
    const isCollapsed = collapsedClusters?.has(clusterId)
    const isHidden    = hiddenClusters?.has(clusterId)
    return [
      {
        type: 'input',
        label: 'Rename…',
        placeholder: 'Cluster name',
        initial: cluster.name ?? '',
        submitLabel: 'Save',
        onSubmit: (name) => updateClusterMetadata(clusterId, { name }),
      },
      {
        type: 'input',
        label: 'Edit description…',
        placeholder: 'Short summary',
        initial: cluster.description ?? '',
        multiline: true,
        submitLabel: 'Save',
        allowEmpty: true,
        onSubmit: (description) => updateClusterMetadata(clusterId, { description }),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: isCollapsed ? 'Expand' : 'Collapse',
        onClick: () => toggleClusterCollapsed(clusterId),
      },
      {
        type: 'action',
        label: isHidden ? 'Unhide' : 'Hide',
        onClick: () => toggleClusterHidden(clusterId),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Delete cluster',
        onClick: () => deleteCluster(clusterId),
      },
    ]
  }, [clusters, collapsedClusters, hiddenClusters,
      updateClusterMetadata, toggleClusterCollapsed, toggleClusterHidden, deleteCluster])

  const buildCanvasMenuItems = useCallback(() => [
    {
      type: 'input',
      label: 'Create empty cluster…',
      placeholder: 'Cluster name',
      submitLabel: 'Create',
      onSubmit: (name) => createCluster({ name }),
    },
  ], [createCluster])

  const onNodeContextMenu = useCallback((nodeData, e) => {
    if (viewMode !== 'semantic') return      // clusters aren't visible — no-op
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY, buildNodeMenuItems(nodeData))
  }, [viewMode, openContextMenu, buildNodeMenuItems])

  const onClusterContextMenu = useCallback((clusterId, e) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY, buildClusterMenuItems(clusterId))
  }, [openContextMenu, buildClusterMenuItems])

  const onCanvasContextMenu = useCallback((e) => {
    if (viewMode !== 'semantic') return
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, buildCanvasMenuItems())
  }, [viewMode, openContextMenu, buildCanvasMenuItems])

  // ── Zoom helpers ──────────────────────────────────────────────────────────────
  const zoomBy = useCallback(factor => {
    const svg  = svgRef.current
    const rect = svg?.getBoundingClientRect()
    if (!rect) return
    const mx = rect.width / 2, my = rect.height / 2
    setViewport(vp => {
      const zoom  = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor))
      const ratio = zoom / vp.zoom
      return { zoom, x: mx - (mx - vp.x) * ratio, y: my - (my - vp.y) * ratio }
    })
  }, [])

  // Fit the whole graph using the latest rendered geometry (read from refs so
  // keyboard / button handlers never close over stale positions).
  const fitView = useCallback(() => {
    fitToContent(displayPosRef.current, sizesRef.current)
  }, [fitToContent])

  // Reset to 100% zoom, centred on the current viewport centre.
  const resetZoom = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = rect.width / 2, my = rect.height / 2
    setViewport(vp => {
      const ratio = 1 / vp.zoom
      return { zoom: 1, x: mx - (mx - vp.x) * ratio, y: my - (my - vp.y) * ratio }
    })
  }, [])

  // Keyboard navigation: +/= zoom in, -/_ zoom out, 0 fit, 1 reset to 100%.
  // Ctrl/Cmd+F opens the centred search overlay from anywhere (even the search
  // input itself, so re-pressing while open just keeps focus there).
  // Ignored while typing in an unrelated input/textarea.
  // Placed after zoomBy/fitView/resetZoom are declared to avoid temporal dead zone.
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        setSearchActiveIdx(0)
        return
      }
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.8) }
      else if (e.key === '0') { e.preventDefault(); fitView() }
      else if (e.key === '1') { e.preventDefault(); resetZoom() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomBy, fitView, resetZoom])

  // Focus the search input as soon as the overlay mounts.
  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    } else {
      setSearchQuery('')
      setSearchActiveIdx(0)
    }
  }, [searchOpen])

  // Center the viewport on a node at a comfortable zoom (reads latest geometry).
  const centerOnNode = useCallback((id) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const pos = posRef.current[id]
    const sz  = sizesRef.current[id]
    if (!pos || !sz) return
    const cx = pos.x + sz.w / 2
    const cy = pos.y + sz.h / 2
    const target = Math.max(0.4, Math.min(1.6,
      (Math.min(rect.width, rect.height) * 0.4) / Math.max(sz.w, sz.h)))
    setViewport({ zoom: target, x: rect.width / 2 - cx * target, y: rect.height / 2 - cy * target })
  }, [])

  // Select + center on a node by id, expanding any collapsed folder ancestors so
  // the target is actually visible (search-to-focus).
  const focusNode = useCallback((id) => {
    const data = nodeMap[id]
    if (!data) return
    const store = useGraphStore.getState()
    const collapsed = store.collapsedFolders
    const toExpand = []
    let cur = data.parent
    while (cur) { if (collapsed.has(cur)) toExpand.push(cur); cur = nodeMap[cur]?.parent }

    setSelectedId(id)
    onNodeSelect?.({ id, type: data.type, data: { ...data } })

    if (toExpand.length) {
      // Expand ancestors, then center once the re-layout has produced positions.
      store.revealFolders(toExpand)
      setTimeout(() => centerOnNode(id), 90)
    } else {
      centerOnNode(id)
    }
  }, [nodeMap, onNodeSelect, centerOnNode])

  // Choose a search result: select + center on it, then close the overlay.
  const chooseSearchResult = useCallback((id) => {
    focusNode(id)
    setSearchOpen(false)
  }, [focusNode])

  // Keep a live ref to focusNode so the focus-request effect can call the latest
  // version without re-subscribing every time the graph geometry changes.
  const focusNodeRef = useRef(focusNode)
  useEffect(() => { focusNodeRef.current = focusNode }, [focusNode])

  // Right-sidebar node clicks route through the store as focus requests: select
  // the node and glide the camera onto it.
  useEffect(() => {
    if (focusRequest?.id) focusNodeRef.current(focusRequest.id)
  }, [focusRequest])

  // When the selection is cleared elsewhere (e.g. the right sidebar's close
  // button), drop the canvas highlight too so the two stay in sync.
  useEffect(() => {
    if (!storeSelectedNode) setSelectedId(null)
  }, [storeSelectedNode])

  // Open a leaf entity (function / method / variable) at its line in the IDE.
  const openInIDE = useCallback((data) => {
    if (!isElectron || !data) return
    const relFile = data.type === 'file' ? data.fullLabel : fileFromId(data.id)
    if (!relFile) return
    const projectPath = useGraphStore.getState().projectPath
    const absPath = projectPath ? `${projectPath}/${relFile}`.replace(/\\/g, '/') : relFile
    window.electronAPI.openFile(absPath, data.startLine ?? null)
  }, [])

  // Double-click behaviour: sub-entities open in the IDE; classes zoom in.
  const onNodeDoubleClick = useCallback((data) => {
    if (!data) return
    if (data.type === 'class') { centerOnNode(data.id); return }
    if (data.type === 'function' || data.type === 'method' || data.type === 'variable') {
      openInIDE(data)
    }
  }, [centerOnNode, openInIDE])

  // ── Hover tooltip (node name after a short dwell) ─────────────────────────
  const onNodeEnter = useCallback((data, e) => {
    const cx = e.clientX, cy = e.clientY
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      setHoverTip({ label: data.fullLabel || data.label, x: cx - rect.left, y: cy - rect.top })
    }, HOVER_DELAY)
  }, [])

  const onNodeLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHoverTip(null)
  }, [])

  // Stable per-node wrapper props (hover + double-click) — memoized by id.
  const hoverProps = useCallback((data) => ({
    onMouseEnter:  (e) => onNodeEnter(data, e),
    onMouseLeave:  onNodeLeave,
    onDoubleClick: () => onNodeDoubleClick(data),
  }), [onNodeEnter, onNodeLeave, onNodeDoubleClick])

  // ── Search results (by label / full path) ─────────────────────────────────
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const out = []
    for (const n of nodes) {
      const d = n.data
      const label = (d.label ?? '').toLowerCase()
      const full  = (d.fullLabel ?? '').toLowerCase()
      if (label.includes(q) || full.includes(q)) {
        out.push({ id: d.id, label: d.label, type: d.type, full: d.fullLabel, starts: label.startsWith(q) ? 1 : 0 })
        if (out.length > 250) break
      }
    }
    out.sort((a, b) => (b.starts - a.starts) || ((a.label?.length ?? 0) - (b.label?.length ?? 0)))
    return out.slice(0, 25)
  }, [searchQuery, nodes])

  // ── Minimap data: top-level container boxes + overall bounds ───────────────
  const minimapData = useMemo(() => {
    const semantic = viewMode === 'semantic'
    const items = []
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      const d = n.data
      if (d.parent) continue                                   // top-level only
      if (semantic && (d.type === 'file' || d.type === 'folder')) continue
      if (!semantic && hiddenIds.has(d.id)) continue
      if (visibleTypes[d.type] === false) continue
      const p = positions[d.id], s = sizes[d.id]
      if (!p || !s) continue
      items.push({ id: d.id, x: p.x, y: p.y, w: s.w, h: s.h, color: nodeColors[d.type] })
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h)
    }
    if (!items.length) return null
    return { items, bounds: { minX, minY, maxX, maxY } }
  }, [nodes, positions, sizes, hiddenIds, viewMode, visibleTypes, nodeColors])

  // Currently-visible world rectangle (no cull margin) — drawn on the minimap.
  const viewportRect = useMemo(() => {
    if (!svgSize.w) return null
    const z = viewport.zoom || 1
    return {
      minX: (0 - viewport.x) / z, maxX: (svgSize.w - viewport.x) / z,
      minY: (0 - viewport.y) / z, maxY: (svgSize.h - viewport.y) / z,
    }
  }, [viewport, svgSize])

  const recenterOn = useCallback((wx, wy) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setViewport(vp => ({ ...vp, x: rect.width / 2 - wx * vp.zoom, y: rect.height / 2 - wy * vp.zoom }))
  }, [])

  // ── Semantic mode: nodeMap with file parentage stripped ───────────────────
  //
  // ClusterLayer's getRootId(id, nodeMap) walks `nodeMap[cur].parent` until it
  // finds a node with no parent, then returns that root ID as the anchor for the
  // blob bounding box.
  //
  // Problem (root cause of the "shows for a split second" bug):
  //   Even if we exclude file nodes from the map, class/function data objects
  //   still carry `parent: 'file:...'`.  So getRootId walks:
  //     class → nodeMap['class'].parent = 'file:foo'
  //             → nodeMap['file:foo'] = undefined  → loop stops
  //     returns 'file:foo'
  //   But `positions['file:foo']` is undefined in semantic layout → blob fails.
  //
  //   The one-frame flash on first switch occurs because displayPositions still
  //   holds the *old* structural positions (state batch hasn't applied yet), so
  //   positions['file:foo'] briefly exists, the blob renders once, then vanishes
  //   when the semantic positions land and the file entry disappears.
  //
  // Fix: strip the `parent` field from nodes whose parent is a file so
  //   getRootId stops immediately at the class/function level, which DOES have
  //   a position in the semantic layout.
  const clusterNodeMap = useMemo(() => {
    if (viewMode !== 'semantic') return nodeMap
    // Identify all file IDs
    const fileIds = new Set(
      Object.values(nodeMap).filter(d => d.type === 'file').map(d => d.id)
    )
    const m = {}
    for (const [id, data] of Object.entries(nodeMap)) {
      if (data.type === 'file') continue  // exclude file nodes entirely
      if (data.parent && fileIds.has(data.parent)) {
        // Strip the file parent so getRootId stops here (at class/function)
        m[id] = { ...data, parent: undefined }
      } else {
        m[id] = data
      }
    }
    return m
  }, [nodeMap, viewMode])

  // ── Render ────────────────────────────────────────────────────────────────────
  const dp = displayPositions

  const isSemantic = viewMode === 'semantic'

  // ── Viewport culling ──────────────────────────────────────────────────────────
  // Only nodes whose box intersects the visible world-rect (inflated by a full
  // screen of margin so panning doesn't pop nodes in at the edges) are rendered.
  // Combined with LOD this caps the rendered node count to a few hundred no
  // matter how large the graph is. Disabled until we know the SVG size.
  const cullRect = useMemo(() => {
    if (!svgSize.w || !svgSize.h) return null
    const z = viewport.zoom || 1
    const minX = (0          - viewport.x) / z
    const maxX = (svgSize.w  - viewport.x) / z
    const minY = (0          - viewport.y) / z
    const maxY = (svgSize.h  - viewport.y) / z
    const marginX = svgSize.w / z
    const marginY = svgSize.h / z
    return {
      minX: minX - marginX, maxX: maxX + marginX,
      minY: minY - marginY, maxY: maxY + marginY,
    }
  }, [viewport, svgSize])

  const inView = useCallback((id) => {
    if (!cullRect) return true
    const p = dp[id] ?? positions[id]
    const s = sizes[id]
    if (!p || !s) return true   // unknown geometry — don't hide
    return p.x <= cullRect.maxX && p.x + s.w >= cullRect.minX &&
           p.y <= cullRect.maxY && p.y + s.h >= cullRect.minY
  }, [cullRect, dp, positions, sizes])

  // ── Visible node sets, filtered by type visibility + LOD collapse ─────────
  //
  // In semantic mode, file nodes are excluded entirely.
  // When a container node (file or class) is LOD-collapsed its children are
  // unloaded from the DOM — they're still in the layout / positions maps, they
  // just aren't rendered.  The container itself still renders with collapsed=true
  // so the cross-fade to centred-label happens on the node itself.

  // Folder nodes (structural mode only). A folder is shown unless it's itself
  // inside a collapsed ancestor folder.
  const folderNodes = isSemantic ? [] : nodes.filter(n =>
    n.data.type === 'folder' && visibleIds.has(n.data.id) &&
    !hiddenIds.has(n.data.id) && inView(n.data.id)
  )

  // File nodes (structural mode only)
  const fileNodes = isSemantic ? [] : nodes.filter(n =>
    n.data.type === 'file' && visibleIds.has(n.data.id) &&
    !hiddenIds.has(n.data.id) && inView(n.data.id)
  )

  // Class nodes: skip if hidden by a collapsed folder or LOD-collapsed parent file
  const classNodes = nodes.filter(n => {
    if (n.data.type !== 'class' || !visibleIds.has(n.data.id)) return false
    if (hiddenIds.has(n.data.id)) return false
    const pid = n.data.parent
    // If the parent file is collapsed the class is unloaded
    if (pid && collapsedIds.has(pid)) return false
    return inView(n.data.id)
  })

  // Leaf nodes: skip if hidden by a collapsed folder, or direct/grandparent LOD-collapsed
  const leafNodes = nodes.filter(n => {
    const t = n.data.type
    if (t !== 'function' && t !== 'method' && t !== 'import' && t !== 'import_module' && t !== 'import_entity' && t !== 'variable') return false
    if (!visibleIds.has(n.data.id) || hiddenIds.has(n.data.id)) return false
    const pid = n.data.parent
    if (pid && collapsedIds.has(pid)) return false   // direct parent collapsed
    const gid = pid ? nodeMap[pid]?.parent : null
    if (gid && collapsedIds.has(gid)) return false   // grandparent collapsed
    return inView(n.data.id)                          // top-level imports also culled
  })

  // Set of node IDs that are actually rendered right now (respects type visibility + LOD).
  // Passed to EdgeLayer so edges whose endpoints aren't visible get suppressed.
  const renderedNodeIds = new Set()
  for (const n of folderNodes) renderedNodeIds.add(n.data.id)
  for (const n of fileNodes)  renderedNodeIds.add(n.data.id)
  for (const n of classNodes) renderedNodeIds.add(n.data.id)
  for (const n of leafNodes)  renderedNodeIds.add(n.data.id)

  const renderLeaf = n => {
    const id  = n.data.id
    const pos = dp[id]
    const sz  = sizes[id]
    if (!pos || !sz) return null
    const cx = pos.x + sz.w / 2
    const cy = pos.y + sz.h / 2
    const r  = sz.w / 2
    const common = {
      key: id, data: n.data, cx, cy, r,
      selected:    selectedId === id,
      dimmed:      linkedIds !== null && !linkedIds.has(id),
      onMouseDown: nodeDownFor(id),
      color:       nodeColors[n.data.type],
    }
    if (n.data.type === 'function')       return <FunctionNode     {...common} />
    if (n.data.type === 'method')         return <MethodNode       {...common} />
    if (n.data.type === 'import')         return <ImportNode       {...common} />
    if (n.data.type === 'import_module')  return <ImportModuleNode {...common} />
    if (n.data.type === 'import_entity')  return <ImportEntityNode {...common} />
    if (n.data.type === 'variable')       return <VariableNode     {...common} />
    return null
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={onBgDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onCanvasContextMenu}
      >
        <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>

          {isSemantic && (
            <ClusterLayer
              clusters={clusters}
              positions={dp}
              sizes={sizes}
              nodeMap={clusterNodeMap}
              selectedClusterId={selectedId}
              linkedIds={linkedIds}
              collapsedClusters={collapsedClusters}
              hiddenClusters={hiddenClusters}
              onClusterMouseDown={onClusterMouseDown}
              onClusterContextMenu={onClusterContextMenu}
              onClusterToggleCollapse={toggleClusterCollapsed}
            />
          )}

          {/* Folder containers — outermost boxes, drawn at the back.
              No context menu here: folders aren't cluster members. */}
          {folderNodes.map(n => (
            <g key={n.data.id} {...hoverProps(n.data)}>
              <FolderNode
                data={n.data}
                position={dp[n.data.id]}
                size={sizes[n.data.id]}
                selected={selectedId === n.data.id}
                dimmed={linkedIds !== null && !linkedIds.has(n.data.id)}
                onMouseDown={nodeDownFor(n.data.id)}
                collapsed={collapsedFolders.has(n.data.id)}
                zoom={viewport.zoom}
                color={nodeColors.folder}
                onToggle={toggleFolder}
              />
            </g>
          ))}

          {/* Deep edges: ≥1 container endpoint — render below file/class nodes */}
          <EdgeLayer
            edges={deepEdges}
            positions={dp}
            sizes={sizes}
            nodeMap={nodeMap}
            visibleTypes={visibleTypes}
            visibleEdgeTypes={visibleEdgeTypes}
            linkedIds={linkedIds}
            selectedId={selectedId}
            zoom={viewport.zoom}
            viewMode={viewMode}
            renderedNodeIds={renderedNodeIds}
            leafEdgesOnly={false}
          />

          {fileNodes.map(n => (
            <g key={n.data.id} onContextMenu={(e) => onNodeContextMenu(n.data, e)} {...hoverProps(n.data)}>
              <FileNode
                data={n.data}
                position={dp[n.data.id]}
                size={sizes[n.data.id]}
                selected={selectedId === n.data.id}
                dimmed={linkedIds !== null && !linkedIds.has(n.data.id)}
                onMouseDown={nodeDownFor(n.data.id)}
                collapsed={collapsedIds.has(n.data.id)}
                zoom={viewport.zoom}
                color={nodeColors.file}
              />
            </g>
          ))}

          {classNodes.map(n => (
            <g key={n.data.id} onContextMenu={(e) => onNodeContextMenu(n.data, e)} {...hoverProps(n.data)}>
              <ClassNode
                data={n.data}
                position={dp[n.data.id]}
                size={sizes[n.data.id]}
                selected={selectedId === n.data.id}
                dimmed={linkedIds !== null && !linkedIds.has(n.data.id)}
                onMouseDown={nodeDownFor(n.data.id)}
                collapsed={collapsedIds.has(n.data.id)}
                zoom={viewport.zoom}
                color={nodeColors.class}
              />
            </g>
          ))}

          {/* Leaf edges: both endpoints are leaf nodes — render above containers, below leaf nodes */}
          <EdgeLayer
            edges={leafEdges}
            positions={dp}
            sizes={sizes}
            nodeMap={nodeMap}
            visibleTypes={visibleTypes}
            visibleEdgeTypes={visibleEdgeTypes}
            linkedIds={linkedIds}
            selectedId={selectedId}
            zoom={viewport.zoom}
            viewMode={viewMode}
            renderedNodeIds={renderedNodeIds}
            leafEdgesOnly={true}
          />

          {leafNodes.map(n => (
            <g key={n.data.id} onContextMenu={(e) => onNodeContextMenu(n.data, e)} {...hoverProps(n.data)}>
              {renderLeaf(n)}
            </g>
          ))}
        </g>
      </svg>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}

      {/* ── Hover tooltip: node name after a short dwell ─────────────────── */}
      {hoverTip && (() => {
        // Flip to the left of the cursor when close to the right edge so long
        // names never spill outside the canvas.
        const nearRight = svgSize.w && hoverTip.x > svgSize.w - 220
        return (
          <div
            style={{
              position: 'absolute',
              left: nearRight ? undefined : hoverTip.x + 14,
              right: nearRight ? Math.max(8, svgSize.w - hoverTip.x + 14) : undefined,
              top: hoverTip.y + 16,
              zIndex: 50, pointerEvents: 'none', maxWidth: 340,
              background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
              padding: '4px 9px', fontSize: 12, color: '#e6edf3',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          >
            {hoverTip.label}
          </div>
        )
      })()}

      {/* ── Search-to-focus: Ctrl/Cmd+F opens a centred, screen-dimming overlay ── */}
      {searchOpen && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: '14vh',
          }}
          onMouseDown={e => { if (e.target === e.currentTarget) setSearchOpen(false) }}
        >
          <div style={{ width: 480, maxWidth: '90%' }}>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchActiveIdx(0) }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const pick = searchResults[searchActiveIdx] ?? searchResults[0]
                  if (pick) chooseSearchResult(pick.id)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearchOpen(false)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSearchActiveIdx(i => Math.min(i + 1, searchResults.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSearchActiveIdx(i => Math.max(i - 1, 0))
                }
              }}
              placeholder="Search nodes…"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px',
                background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
                color: '#e6edf3', fontSize: 15, fontFamily: 'inherit', outline: 'none',
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
              }}
            />
            {searchResults.length > 0 && (
              <ul style={{
                listStyle: 'none', margin: '8px 0 0', padding: 6, maxHeight: '50vh', overflowY: 'auto',
                background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
                boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
              }}>
                {searchResults.map((r, i) => (
                  <li
                    key={r.id}
                    onClick={() => chooseSearchResult(r.id)}
                    onMouseEnter={() => setSearchActiveIdx(i)}
                    title={r.full || r.label}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                      borderRadius: 5, cursor: 'pointer', fontSize: 13.5,
                      background: i === searchActiveIdx ? '#1f2630' : 'transparent',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: nodeColors[r.type] ?? '#8b949e' }} />
                    <span style={{ color: '#e6edf3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                    <span style={{ color: '#6e7681', marginLeft: 'auto', flexShrink: 0, textTransform: 'uppercase', fontSize: 10.5 }}>{r.type}</span>
                  </li>
                ))}
              </ul>
            )}
            {searchQuery.trim() && searchResults.length === 0 && (
              <div style={{
                marginTop: 8, padding: '10px 14px', background: '#161b22',
                border: '1px solid #30363d', borderRadius: 8, color: '#6e7681', fontSize: 13,
              }}>
                No matches
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Minimap ─────────────────────────────────────────────────────── */}
      {minimapData && (
        <div style={{ position: 'absolute', bottom: 16, left: 14, zIndex: 5 }}>
          <Minimap
            items={minimapData.items}
            bounds={minimapData.bounds}
            viewportRect={viewportRect}
            onRecenter={recenterOn}
          />
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={BTN} onClick={() => zoomBy(1.25)} title="Zoom in (+)">+</button>
        <button style={BTN} onClick={() => zoomBy(0.8)}  title="Zoom out (−)">−</button>
        <button style={{ ...BTN, fontSize: 10, fontWeight: 700 }} onClick={resetZoom} title="Reset zoom to 100% (1)">1:1</button>
        <button style={BTN} onClick={fitView} title="Fit to content (0)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1h4a.5.5 0 0 1 0 1H2v3.5a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 1.5 1zm9 0a.5.5 0 0 1 .5.5V5a.5.5 0 0 1-1 0V2h-3.5a.5.5 0 0 1 0-1H10.5zM1 10.5a.5.5 0 0 1 .5-.5H5a.5.5 0 0 1 0 1H2v3a.5.5 0 0 1-1 0v-3.5zm14 0v3.5a.5.5 0 0 1-1 0V11h-3a.5.5 0 0 1 0-1h3.5a.5.5 0 0 1 .5.5z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
