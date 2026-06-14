export const LEAF_SIZE = { function: 72, method: 60, import: 88, import_module: 92, import_entity: 72, variable: 76 }

export const FILE  = { header: 44, padX: 36, padY: 30, minW: 140, minH: 120 }
export const CLASS = { header: 34, padX: 22, padY: 18, minW: 110, minH: 86  }
export const H_GAP = 24

// Arrange ids in a single horizontal row. Returns placed positions relative to (0,0).
function arrangeRow(ids, sizes) {
  const placed = {}
  let x = 0, maxH = 0
  for (const id of ids) {
    const s = sizes[id] ?? { w: 72, h: 72 }
    placed[id] = { x, y: 0 }
    x += s.w + H_GAP
    maxH = Math.max(maxH, s.h)
  }
  const contentW = ids.length > 0 ? x - H_GAP : 0
  return { placed, contentW, contentH: maxH }
}

export function computeLayout(elements) {
  const nodes = elements.filter((e) => !e.data.source)
  if (nodes.length === 0) return { positions: {}, sizes: {} }

  const byId = Object.fromEntries(nodes.map((n) => [n.data.id, n.data]))

  const childrenOf = {}
  for (const n of nodes) childrenOf[n.data.id] = []
  for (const n of nodes) {
    const p = n.data.parent
    if (p && childrenOf[p]) childrenOf[p].push(n.data.id)
  }

  const sizes   = {}
  const relPos  = {}
  const content = {}  // id → { contentW, contentH } for centering

  // ── 1. Leaf sizes (fixed) ────────────────────────────────────────────────
  for (const n of nodes) {
    const s = LEAF_SIZE[n.data.type]
    if (s != null) sizes[n.data.id] = { w: s, h: s }
  }

  // ── 2. Class sizes from methods ─────────────────────────────────────────
  for (const n of nodes) {
    if (n.data.type !== 'class') continue
    const id        = n.data.id
    const kids      = childrenOf[id]
    const labelMinW = Math.max(CLASS.minW, (n.data.label?.length ?? 0) * 8 + 70)

    if (kids.length === 0) {
      const side  = Math.max(labelMinW, CLASS.minH)
      sizes[id]   = { w: side, h: side }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
    } else {
      const { placed, contentW, contentH } = arrangeRow(kids, sizes)
      relPos[id]  = placed
      content[id] = { contentW, contentH }
      const w    = Math.max(labelMinW, contentW + CLASS.padX * 2)
      const h    = Math.max(CLASS.minH, contentH + CLASS.header + CLASS.padY * 2)
      const side = Math.max(w, h)
      sizes[id]  = { w: side, h: side }
    }
  }

  // ── 3. File sizes from functions + classes ───────────────────────────────
  for (const n of nodes) {
    if (n.data.type !== 'file') continue
    const id        = n.data.id
    const kids      = childrenOf[id]
    const labelMinW = Math.max(FILE.minW, (n.data.label?.length ?? 0) * 8 + 70)

    if (kids.length === 0) {
      const side  = Math.max(labelMinW, FILE.minH)
      sizes[id]   = { w: side, h: side }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
    } else {
      const { placed, contentW, contentH } = arrangeRow(kids, sizes)
      relPos[id]  = placed
      content[id] = { contentW, contentH }
      const w    = Math.max(labelMinW, contentW + FILE.padX * 2)
      const h    = Math.max(FILE.minH, contentH + FILE.header + FILE.padY * 2)
      const side = Math.max(w, h)
      sizes[id]  = { w: side, h: side }
    }
  }

  // ── 4. Top-level pack layout ─────────────────────────────────────────────
  const topLevel = nodes.filter((n) => !n.data.parent)
  const files    = topLevel.filter((n) => n.data.type === 'file')
  const others   = topLevel.filter((n) => n.data.type !== 'file')

  // Determine each file's dominant cluster from its direct children's clusterId.
  // Files from the same cluster sort together so the blob encircles a contiguous area.
  const fileCluster = {}
  for (const f of files) {
    const fid = f.data.id
    for (const kid of childrenOf[fid] ?? []) {
      const cid = byId[kid]?.clusterId
      if (cid) { fileCluster[fid] = cid; break }
    }
  }
  files.sort((a, b) => {
    const ca = fileCluster[a.data.id] ?? '￿'   // unclustered files sort last
    const cb = fileCluster[b.data.id] ?? '￿'
    if (ca !== cb) return ca < cb ? -1 : 1
    // Within the same cluster, keep larger files first
    return (sizes[b.data.id].w * sizes[b.data.id].h) - (sizes[a.data.id].w * sizes[a.data.id].h)
  })

  let totalArea = 0
  for (const n of [...files, ...others]) {
    const s = sizes[n.data.id] ?? { w: 140, h: 140 }
    totalArea += s.w * s.h
  }
  const targetRowW = Math.max(900, Math.sqrt(totalArea) * 1.3)

  const positions = {}
  let x = 60, y = 60, rowH = 0
  for (const n of [...files, ...others]) {
    const id = n.data.id
    const s  = sizes[id] ?? { w: 140, h: 140 }
    if (x > 60 && x + s.w > 60 + targetRowW) { x = 60; y += rowH + 60; rowH = 0 }
    positions[id] = { x, y }
    x += s.w + 80
    rowH = Math.max(rowH, s.h)
  }

  // ── 5a. Absolute positions for file children (centered within square) ────
  for (const n of nodes) {
    if (n.data.type !== 'file') continue
    const fp  = positions[n.data.id]
    if (!fp) continue
    const sz   = sizes[n.data.id]
    const rel  = relPos[n.data.id] ?? {}
    const { contentW, contentH } = content[n.data.id] ?? { contentW: 0, contentH: 0 }
    // Center children horizontally and vertically inside the square
    const hOff = Math.max(0, (sz.w - FILE.padX * 2 - contentW) / 2)
    const vOff = Math.max(0, (sz.h - FILE.header - FILE.padY * 2 - contentH) / 2)

    for (const k of childrenOf[n.data.id]) {
      const r = rel[k] ?? { x: 0, y: 0 }
      positions[k] = {
        x: fp.x + FILE.padX + hOff + r.x,
        y: fp.y + FILE.header + FILE.padY + vOff + r.y,
      }
    }
  }

  // ── 5b. Absolute positions for class children (centered within square) ───
  for (const n of nodes) {
    if (n.data.type !== 'class') continue
    const cp  = positions[n.data.id]
    if (!cp) continue
    const sz   = sizes[n.data.id]
    const rel  = relPos[n.data.id] ?? {}
    const { contentW, contentH } = content[n.data.id] ?? { contentW: 0, contentH: 0 }
    const hOff = Math.max(0, (sz.w - CLASS.padX * 2 - contentW) / 2)
    const vOff = Math.max(0, (sz.h - CLASS.header - CLASS.padY * 2 - contentH) / 2)

    for (const k of childrenOf[n.data.id]) {
      const r = rel[k] ?? { x: 0, y: 0 }
      positions[k] = {
        x: cp.x + CLASS.padX + hOff + r.x,
        y: cp.y + CLASS.header + CLASS.padY + vOff + r.y,
      }
    }
  }

  return { positions, sizes }
}

/**
 * computeSemanticLayout — layout for Semantic mode.
 *
 * File nodes are excluded entirely.  Classes and top-level functions whose
 * parent was a file become top-level nodes.  They are sorted by clusterId so
 * nodes in the same semantic cluster land adjacent to each other, letting the
 * cluster blob encircle a compact region.
 *
 * The class-children (methods, variables) are still sized and positioned
 * relative to their parent class box exactly as in computeLayout.
 */
export function computeSemanticLayout(elements) {
  const allNodes = elements.filter(e => !e.data.source)

  // Collect file IDs — these will be excluded from rendering and layout
  const fileIds = new Set(
    allNodes.filter(n => n.data.type === 'file').map(n => n.data.id)
  )

  // Working node set: drop file nodes
  const nodes = allNodes.filter(n => n.data.type !== 'file')
  if (nodes.length === 0) return { positions: {}, sizes: {} }

  // Build childrenOf, but strip file parentage so classes/functions are top-level
  const childrenOf = {}
  for (const n of nodes) childrenOf[n.data.id] = []
  for (const n of nodes) {
    const p = n.data.parent
    if (p && !fileIds.has(p) && childrenOf[p] !== undefined) {
      childrenOf[p].push(n.data.id)
    }
  }

  const sizes   = {}
  const relPos  = {}
  const content = {}

  // ── 1. Leaf sizes (fixed) ────────────────────────────────────────────────
  for (const n of nodes) {
    const s = LEAF_SIZE[n.data.type]
    if (s != null) sizes[n.data.id] = { w: s, h: s }
  }

  // ── 2. Class sizes from methods / variables ──────────────────────────────
  for (const n of nodes) {
    if (n.data.type !== 'class') continue
    const id        = n.data.id
    const kids      = childrenOf[id]
    const labelMinW = Math.max(CLASS.minW, (n.data.label?.length ?? 0) * 8 + 70)

    if (kids.length === 0) {
      const side = Math.max(labelMinW, CLASS.minH)
      sizes[id]   = { w: side, h: side }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
    } else {
      const { placed, contentW, contentH } = arrangeRow(kids, sizes)
      relPos[id]  = placed
      content[id] = { contentW, contentH }
      const w    = Math.max(labelMinW, contentW + CLASS.padX * 2)
      const h    = Math.max(CLASS.minH, contentH + CLASS.header + CLASS.padY * 2)
      const side = Math.max(w, h)
      sizes[id]  = { w: side, h: side }
    }
  }

  // ── 3. Top-level nodes: classes/functions whose file-parent was removed,
  //        plus import nodes (which never had a parent) ──────────────────────
  const topLevel = nodes.filter(n => !n.data.parent || fileIds.has(n.data.parent))

  // Sort by clusterId so members of the same cluster land adjacent
  topLevel.sort((a, b) => {
    const ca = a.data.clusterId ?? '￿'   // unclustered nodes sort last
    const cb = b.data.clusterId ?? '￿'
    if (ca !== cb) return ca < cb ? -1 : 1
    // Within the same cluster put larger nodes first
    const sa = sizes[a.data.id] ?? { w: 72, h: 72 }
    const sb = sizes[b.data.id] ?? { w: 72, h: 72 }
    return (sb.w * sb.h) - (sa.w * sa.h)
  })

  let totalArea = 0
  for (const n of topLevel) {
    const s = sizes[n.data.id] ?? { w: 72, h: 72 }
    totalArea += s.w * s.h
  }
  const targetRowW = Math.max(900, Math.sqrt(totalArea) * 1.4)

  const positions = {}
  let x = 60, y = 60, rowH = 0
  for (const n of topLevel) {
    const id = n.data.id
    const s  = sizes[id] ?? { w: 72, h: 72 }
    if (x > 60 && x + s.w > 60 + targetRowW) { x = 60; y += rowH + 80; rowH = 0 }
    positions[id] = { x, y }
    x += s.w + 80
    rowH = Math.max(rowH, s.h)
  }

  // ── 4. Absolute positions for class children ─────────────────────────────
  for (const n of nodes) {
    if (n.data.type !== 'class') continue
    const cp = positions[n.data.id]
    if (!cp) continue
    const sz  = sizes[n.data.id]
    const rel = relPos[n.data.id] ?? {}
    const { contentW, contentH } = content[n.data.id] ?? { contentW: 0, contentH: 0 }
    const hOff = Math.max(0, (sz.w - CLASS.padX * 2 - contentW) / 2)
    const vOff = Math.max(0, (sz.h - CLASS.header - CLASS.padY * 2 - contentH) / 2)

    for (const k of childrenOf[n.data.id]) {
      const r = rel[k] ?? { x: 0, y: 0 }
      positions[k] = {
        x: cp.x + CLASS.padX + hOff + r.x,
        y: cp.y + CLASS.header + CLASS.padY + vOff + r.y,
      }
    }
  }

  return { positions, sizes }
}
