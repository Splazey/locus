import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { useGraphStore } from '../../store/useGraphStore'
import { NODE_CONFIG } from '../../constants/nodeConfig'
import { computeLayout, computeSemanticLayout, FILE as FILE_PAD, CLASS as CLASS_PAD } from '../../utils/graphLayout'
import { EdgeLayer }    from './EdgeLayer'
import { ClusterLayer } from './ClusterLayer'
import { FileNode }     from './nodes/FileNode'
import { ClassNode }    from './nodes/ClassNode'
import { FunctionNode } from './nodes/FunctionNode'
import { MethodNode }   from './nodes/MethodNode'
import { ImportNode }         from './nodes/ImportNode'
import { ImportModuleNode }   from './nodes/ImportModuleNode'
import { ImportEntityNode }   from './nodes/ImportEntityNode'
import { VariableNode } from './nodes/VariableNode'

const MIN_ZOOM       = 0.08
const MAX_ZOOM       = 5
const MOVE_THRESHOLD = 4

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
  const pad = parentType === 'file' ? FILE_PAD : CLASS_PAD
  return {
    x: Math.max(parentPos.x + pad.padX,
        Math.min(parentPos.x + parentSz.w - pad.padX - sz.w, x)),
    y: Math.max(parentPos.y + pad.header + pad.padY,
        Math.min(parentPos.y + parentSz.h - pad.padY - sz.h, y)),
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export function GraphRenderer({ elements, clusters = {}, visibleTypes, visibleEdgeTypes, onNodeSelect, layoutKey, peerGap = PEER_GAP_DEFAULT, viewMode = 'structural' }) {
  const storeColors = useGraphStore((s) => s.nodeColors)
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

  useEffect(() => { posRef.current    = positions }, [positions])
  useEffect(() => { sizesRef.current  = sizes     }, [sizes])
  useEffect(() => { peerGapRef.current = peerGap  }, [peerGap])

  // ── Derived maps ──────────────────────────────────────────────────────────────
  const nodes = useMemo(() => elements.filter(e => !e.data.source), [elements])
  const edges = useMemo(() => elements.filter(e =>  e.data.source), [elements])

  const nodeMap = useMemo(() => {
    const m = {}
    for (const n of nodes) m[n.data.id] = n.data
    return m
  }, [nodes])

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

      for (const id of Object.keys(target)) {
        const t = target[id]
        if (!t) continue

        if (dragging.has(id)) {
          // Dragged subtree: snap to exact mouse position, no easing
          next[id] = { x: t.x, y: t.y }
          continue
        }

        const c  = cur[id] ?? { x: t.x, y: t.y }
        const dx = t.x - c.x
        const dy = t.y - c.y

        // Snap when close enough to avoid endless micro-movement
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
          next[id] = { x: t.x, y: t.y }
        } else {
          next[id] = { x: c.x + dx * EASE_FACTOR, y: c.y + dy * EASE_FACTOR }
        }
      }

      displayPosRef.current = next
      setDisplayPositions({ ...next })
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
  const prevLayoutKeyRef = useRef(layoutKey)
  useEffect(() => {
    const { positions: lp, sizes: s } = viewMode === 'semantic'
      ? computeSemanticLayout(elements)
      : computeLayout(elements)

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
    setSelectedId(null)
    const t = setTimeout(() => fitToContent(p, s), 50)
    return () => clearTimeout(t)
  }, [elements, layoutKey, viewMode, fitToContent])

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

  const onBgDown = useCallback(e => {
    movedRef.current = false
    const rect = svgRef.current.getBoundingClientRect()
    panRef.current = {
      startMx: e.clientX - rect.left, startMy: e.clientY - rect.top,
      startVx: viewport.x,            startVy: viewport.y,
    }
  }, [viewport.x, viewport.y])

  const onNodeDown = useCallback(id => e => {
    e.stopPropagation()
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
  }, [getDescendants, nodeMap, childrenOf])

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
      setViewport(vp => ({ ...vp, x: p.startVx + dx, y: p.startVy + dy }))
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
    e.stopPropagation()
    movedRef.current        = false
    clusterClickRef.current = clusterId
    dragRef.current         = null
    panRef.current          = null
  }, [])

  // ── Zoom helpers ──────────────────────────────────────────────────────────────
  const zoomBy = factor => {
    const svg  = svgRef.current
    const rect = svg?.getBoundingClientRect()
    if (!rect) return
    const mx = rect.width / 2, my = rect.height / 2
    setViewport(vp => {
      const zoom  = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor))
      const ratio = zoom / vp.zoom
      return { zoom, x: mx - (mx - vp.x) * ratio, y: my - (my - vp.y) * ratio }
    })
  }

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

  // ── Visible node sets, filtered by type visibility + LOD collapse ─────────
  //
  // In semantic mode, file nodes are excluded entirely.
  // When a container node (file or class) is LOD-collapsed its children are
  // unloaded from the DOM — they're still in the layout / positions maps, they
  // just aren't rendered.  The container itself still renders with collapsed=true
  // so the cross-fade to centred-label happens on the node itself.

  // File nodes (structural mode only)
  const fileNodes = isSemantic ? [] : nodes.filter(n =>
    n.data.type === 'file' && visibleIds.has(n.data.id)
  )

  // Class nodes: skip if the parent file is LOD-collapsed
  const classNodes = nodes.filter(n => {
    if (n.data.type !== 'class' || !visibleIds.has(n.data.id)) return false
    const pid = n.data.parent
    // If the parent file is collapsed the class is unloaded
    return !pid || !collapsedIds.has(pid)
  })

  // Leaf nodes: skip if direct parent or grandparent container is LOD-collapsed
  const leafNodes = nodes.filter(n => {
    const t = n.data.type
    if (t !== 'function' && t !== 'method' && t !== 'import' && t !== 'import_module' && t !== 'import_entity' && t !== 'variable') return false
    if (!visibleIds.has(n.data.id)) return false
    const pid = n.data.parent
    if (!pid) return true            // top-level import — always render
    if (collapsedIds.has(pid)) return false          // direct parent collapsed
    const gid = nodeMap[pid]?.parent
    return !gid || !collapsedIds.has(gid)            // grandparent collapsed
  })

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
      onMouseDown: onNodeDown(id),
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
              onClusterMouseDown={onClusterMouseDown}
            />
          )}

          <EdgeLayer
            edges={edges}
            positions={dp}
            sizes={sizes}
            nodeMap={nodeMap}
            visibleTypes={visibleTypes}
            visibleEdgeTypes={visibleEdgeTypes}
            linkedIds={linkedIds}
            selectedId={selectedId}
            zoom={viewport.zoom}
            viewMode={viewMode}
          />

          {fileNodes.map(n => (
            <FileNode
              key={n.data.id}
              data={n.data}
              position={dp[n.data.id]}
              size={sizes[n.data.id]}
              selected={selectedId === n.data.id}
              dimmed={linkedIds !== null && !linkedIds.has(n.data.id)}
              onMouseDown={onNodeDown(n.data.id)}
              collapsed={collapsedIds.has(n.data.id)}
              zoom={viewport.zoom}
              color={nodeColors.file}
            />
          ))}

          {classNodes.map(n => (
            <ClassNode
              key={n.data.id}
              data={n.data}
              position={dp[n.data.id]}
              size={sizes[n.data.id]}
              selected={selectedId === n.data.id}
              dimmed={linkedIds !== null && !linkedIds.has(n.data.id)}
              onMouseDown={onNodeDown(n.data.id)}
              collapsed={collapsedIds.has(n.data.id)}
              zoom={viewport.zoom}
              color={nodeColors.class}
            />
          ))}

          {leafNodes.map(renderLeaf)}
        </g>
      </svg>

      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={BTN} onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
        <button style={BTN} onClick={() => zoomBy(0.8)}  title="Zoom out">−</button>
        <button style={BTN} onClick={() => fitToContent(dp, sizes)} title="Fit to content">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1h4a.5.5 0 0 1 0 1H2v3.5a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 1.5 1zm9 0a.5.5 0 0 1 .5.5V5a.5.5 0 0 1-1 0V2h-3.5a.5.5 0 0 1 0-1H10.5zM1 10.5a.5.5 0 0 1 .5-.5H5a.5.5 0 0 1 0 1H2v3a.5.5 0 0 1-1 0v-3.5zm14 0v3.5a.5.5 0 0 1-1 0V11h-3a.5.5 0 0 1 0-1h3.5a.5.5 0 0 1 .5.5z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
