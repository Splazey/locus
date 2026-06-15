export const LEAF_SIZE = { function: 72, method: 60, import: 88, import_module: 92, import_entity: 72, variable: 76 }

export const FOLDER = { header: 46, padX: 34, padY: 30, minW: 170, minH: 140 }
export const FILE  = { header: 44, padX: 36, padY: 30, minW: 140, minH: 120 }
export const CLASS = { header: 34, padX: 22, padY: 18, minW: 110, minH: 86  }
export const H_GAP = 24

// Padding config per container type (used by both layout and drag clamping).
export const CONTAINER_PAD = { folder: FOLDER, file: FILE, class: CLASS }

// Collapsed-folder summary box: small fixed footprint so a collapsed folder
// shrinks the overview instead of occupying its full expanded area.
const FOLDER_COLLAPSED = { minW: 150, h: 96 }

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

// Shelf-pack ids into rows that wrap at ~targetW, for near-square containers.
// Used for folder contents (files + subfolders) which can be numerous.
function arrangeShelf(ids, sizes, gap, targetW) {
  const placed = {}
  let x = 0, y = 0, rowH = 0, maxRowW = 0
  for (const id of ids) {
    const s = sizes[id] ?? { w: 72, h: 72 }
    if (x > 0 && x + s.w > targetW) { x = 0; y += rowH + gap; rowH = 0 }
    placed[id] = { x, y }
    x += s.w + gap
    rowH = Math.max(rowH, s.h)
    maxRowW = Math.max(maxRowW, x - gap)
  }
  return { placed, contentW: maxRowW, contentH: ids.length ? y + rowH : 0 }
}

export function computeLayout(elements, collapsedFolders = new Set()) {
  const nodes = elements.filter((e) => !e.data.source)
  if (nodes.length === 0) return { positions: {}, sizes: {} }

  const byId = Object.fromEntries(nodes.map((n) => [n.data.id, n.data]))

  const childrenOf = {}
  for (const n of nodes) childrenOf[n.data.id] = []
  for (const n of nodes) {
    const p = n.data.parent
    if (p && childrenOf[p]) childrenOf[p].push(n.data.id)
  }

  // Hidden = every descendant of a collapsed folder. Those nodes are neither
  // sized nor positioned, so they never render and don't inflate the layout.
  const hidden = new Set()
  const markHidden = (id) => {
    for (const k of childrenOf[id] ?? []) { hidden.add(k); markHidden(k) }
  }
  for (const fid of collapsedFolders) if (byId[fid]) markHidden(fid)

  const sizes   = {}
  const relPos  = {}
  const content = {}  // id → { contentW, contentH } for centering

  // ── 1. Leaf sizes (fixed) ────────────────────────────────────────────────
  for (const n of nodes) {
    if (hidden.has(n.data.id)) continue
    const s = LEAF_SIZE[n.data.type]
    if (s != null) sizes[n.data.id] = { w: s, h: s }
  }

  // Generic single-row container sizing (class, file): a square box wrapping a
  // horizontal row of its visible children.
  const sizeRowContainer = (n, PAD) => {
    const id        = n.data.id
    const kids      = (childrenOf[id] ?? []).filter(k => !hidden.has(k))
    const labelMinW = Math.max(PAD.minW, (n.data.label?.length ?? 0) * 8 + 70)
    if (kids.length === 0) {
      const side  = Math.max(labelMinW, PAD.minH)
      sizes[id]   = { w: side, h: side }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
    } else {
      const { placed, contentW, contentH } = arrangeRow(kids, sizes)
      relPos[id]  = placed
      content[id] = { contentW, contentH }
      const w    = Math.max(labelMinW, contentW + PAD.padX * 2)
      const h    = Math.max(PAD.minH, contentH + PAD.header + PAD.padY * 2)
      const side = Math.max(w, h)
      sizes[id]  = { w: side, h: side }
    }
  }

  // ── 2. Class sizes from methods ─────────────────────────────────────────
  for (const n of nodes) {
    if (n.data.type === 'class' && !hidden.has(n.data.id)) sizeRowContainer(n, CLASS)
  }

  // ── 3. File sizes from functions + classes ───────────────────────────────
  for (const n of nodes) {
    if (n.data.type === 'file' && !hidden.has(n.data.id)) sizeRowContainer(n, FILE)
  }

  // ── 4. Folder sizes (shelf-packed, bottom-up by depth) ────────────────────
  // Folders can nest, so size the deepest first: a parent folder packs its
  // already-sized files and subfolders. Collapsed folders become small summary
  // boxes and never lay out their (hidden) children.
  const depthOf = (id) => {
    let d = 0, cur = byId[id]?.parent
    while (cur) { d++; cur = byId[cur]?.parent }
    return d
  }
  const folders = nodes
    .filter(n => n.data.type === 'folder' && !hidden.has(n.data.id))
    .sort((a, b) => depthOf(b.data.id) - depthOf(a.data.id))

  for (const n of folders) {
    const id        = n.data.id
    const count     = n.data.fileCount ?? 0
    const labelMinW = Math.max(FOLDER.minW, (n.data.label?.length ?? 0) * 8 + 90)

    if (collapsedFolders.has(id)) {
      const w     = Math.max(labelMinW, FOLDER_COLLAPSED.minW)
      sizes[id]   = { w, h: FOLDER_COLLAPSED.h }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
      continue
    }

    const kids = (childrenOf[id] ?? []).filter(k => !hidden.has(k))
    if (kids.length === 0) {
      const side  = Math.max(labelMinW, FOLDER.minH)
      sizes[id]   = { w: side, h: side }
      relPos[id]  = {}
      content[id] = { contentW: 0, contentH: 0 }
    } else {
      let kidArea = 0
      for (const k of kids) { const s = sizes[k] ?? { w: 120, h: 120 }; kidArea += s.w * s.h }
      const targetW = Math.max(FOLDER.minW, Math.sqrt(kidArea) * 1.4)
      const { placed, contentW, contentH } = arrangeShelf(kids, sizes, H_GAP, targetW)
      relPos[id]  = placed
      content[id] = { contentW, contentH }
      const w = Math.max(labelMinW, contentW + FOLDER.padX * 2)
      const h = Math.max(FOLDER.minH, contentH + FOLDER.header + FOLDER.padY * 2)
      sizes[id] = { w, h }
    }
    void count
  }

  // ── 5. Top-level pack layout ─────────────────────────────────────────────
  // Top level = visible nodes with no parent (root folders, root files, imports).
  const topLevel = nodes.filter((n) => !n.data.parent && !hidden.has(n.data.id))
  const containers = topLevel.filter((n) => n.data.type === 'folder' || n.data.type === 'file')
  const others     = topLevel.filter((n) => n.data.type !== 'folder' && n.data.type !== 'file')

  // Cluster-aware sort so same-cluster regions stay contiguous (folders inherit
  // the cluster of their first clustered descendant).
  const clusterOf = (id) => {
    const stack = [...(childrenOf[id] ?? [])]
    while (stack.length) {
      const c = stack.pop()
      if (byId[c]?.clusterId) return byId[c].clusterId
      for (const g of childrenOf[c] ?? []) stack.push(g)
    }
    return byId[id]?.clusterId
  }
  containers.sort((a, b) => {
    const ca = clusterOf(a.data.id) ?? '￿'
    const cb = clusterOf(b.data.id) ?? '￿'
    if (ca !== cb) return ca < cb ? -1 : 1
    const sa = sizes[a.data.id] ?? { w: 140, h: 140 }
    const sb = sizes[b.data.id] ?? { w: 140, h: 140 }
    return (sb.w * sb.h) - (sa.w * sa.h)
  })

  const ordered = [...containers, ...others]
  let totalArea = 0
  for (const n of ordered) {
    const s = sizes[n.data.id] ?? { w: 140, h: 140 }
    totalArea += s.w * s.h
  }
  const targetRowW = Math.max(900, Math.sqrt(totalArea) * 1.3)

  const positions = {}
  let x = 60, y = 60, rowH = 0
  for (const n of ordered) {
    const id = n.data.id
    const s  = sizes[id] ?? { w: 140, h: 140 }
    if (x > 60 && x + s.w > 60 + targetRowW) { x = 60; y += rowH + 60; rowH = 0 }
    positions[id] = { x, y }
    x += s.w + 80
    rowH = Math.max(rowH, s.h)
  }

  // ── 6. Absolute positions, recursing through every container level ────────
  const placeChildren = (id) => {
    const pos = positions[id]
    if (!pos) return
    const type = byId[id]?.type
    const PAD  = CONTAINER_PAD[type]
    if (!PAD) return                       // leaf
    if (collapsedFolders.has(id)) return   // collapsed: children stay hidden
    const sz  = sizes[id]
    const rel = relPos[id] ?? {}
    const { contentW, contentH } = content[id] ?? { contentW: 0, contentH: 0 }
    const hOff = Math.max(0, (sz.w - PAD.padX * 2 - contentW) / 2)
    const vOff = Math.max(0, (sz.h - PAD.header - PAD.padY * 2 - contentH) / 2)
    for (const k of childrenOf[id] ?? []) {
      if (hidden.has(k)) continue
      const r = rel[k] ?? { x: 0, y: 0 }
      positions[k] = {
        x: pos.x + PAD.padX + hOff + r.x,
        y: pos.y + PAD.header + PAD.padY + vOff + r.y,
      }
      placeChildren(k)
    }
  }
  for (const n of ordered) placeChildren(n.data.id)

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

  // Collect file + folder IDs — these structural containers are excluded from
  // rendering and layout in semantic mode (entities cluster by meaning, not path).
  const fileIds = new Set(
    allNodes.filter(n => n.data.type === 'file' || n.data.type === 'folder').map(n => n.data.id)
  )

  // Working node set: drop file and folder nodes
  const nodes = allNodes.filter(n => n.data.type !== 'file' && n.data.type !== 'folder')
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
