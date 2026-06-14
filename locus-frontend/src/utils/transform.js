/**
 * transform.js
 *
 * Converts graph.json (produced by analyze.py) into:
 *   elements  — flat Cytoscape element array (nodes + edges)
 *   clusters  — { [clusterId]: { id, name, description, memberIds[] } }
 *
 * Key behaviours
 * ──────────────
 * • Cluster nodes (type:"cluster") are extracted into the `clusters` map and
 *   are NOT added to `elements` — they are rendered by ClusterLayer instead.
 * • `belongs_to` edges are consumed here to build memberIds lists and to tag
 *   each member node with a `clusterId` field (used by graphLayout for spatial
 *   grouping).  They are NOT emitted as Cytoscape edges.
 * • `contains` edges → `parent` field (compound nodes, not rendered as edges).
 * • Import deduplication: multiple files importing the same module share one
 *   import node (keyed on display name).
 * • Edge filtering: edges to non-existent nodes or self-loops are dropped.
 */

function shortLabel(node) {
  switch (node.type) {
    case 'file':
      return node.name.split(/[/\\]/).pop() || node.name
    case 'method': {
      const parts = node.name.split('.')
      return (parts[parts.length - 1] || node.name) + '()'
    }
    case 'function':
      return node.name + '()'
    case 'class':
      return node.name
    case 'import':
    case 'import_module':
    case 'import_entity':
      return node.name
    case 'variable':
      return node.name
    default:
      return node.name
  }
}

export function transformGraphToCytoscape(graphData) {
  const elements = []

  // ── 0. Separate cluster nodes out first ──────────────────────────────────
  const clusters = {}     // clusterId → { id, name, description, memberIds }
  for (const node of graphData.nodes) {
    if (node.type !== 'cluster') continue
    clusters[node.id] = {
      id:          node.id,
      name:        node.name,
      description: node.description ?? '',
      memberIds:   [],
    }
  }

  // ── 0b. Build belongs_to membership from edges ───────────────────────────
  const nodeCluster = {}  // nodeId → clusterId
  for (const e of graphData.edges) {
    if (e.type !== 'belongs_to') continue
    const cluster = clusters[e.target]
    if (!cluster) continue
    cluster.memberIds.push(e.source)
    nodeCluster[e.source] = e.target
  }

  // ── 1. Build parent lookup from "contains" edges ──────────────────────────
  const parentOf = {}
  for (const e of graphData.edges) {
    if (e.type === 'contains') parentOf[e.target] = e.source
  }

  // ── 2. Legacy import deduplication (for old graph.json files with type:"import") ──
  const importIdMap = new Map()
  const seenImports = new Map()

  for (const node of graphData.nodes) {
    if (node.type !== 'import') continue
    const key = node.name.trim()
    if (!seenImports.has(key)) {
      const canonId = `imp:${seenImports.size}`
      seenImports.set(key, canonId)
      elements.push({
        data: { id: canonId, label: node.name, type: 'import' },
      })
    }
    importIdMap.set(node.id, seenImports.get(key))
  }

  // ── 3. All non-import, non-cluster nodes (including import_module/import_entity) ──
  for (const node of graphData.nodes) {
    if (node.type === 'import' || node.type === 'cluster') continue

    const parent    = parentOf[node.id]
    const clusterId = nodeCluster[node.id] ?? null

    elements.push({
      data: {
        id:        node.id,
        label:     shortLabel(node),
        fullLabel: node.name,
        type:      node.type,
        ...(parent    ? { parent }    : {}),
        ...(clusterId ? { clusterId } : {}),
        startLine: node.start_line ?? null,
        endLine:   node.end_line   ?? null,
        docstring: node.docstring  ?? null,
        ...(node.var_type !== undefined ? { varType: node.var_type } : {}),
      },
    })
  }

  // ── 4. Edges ──────────────────────────────────────────────────────────────
  const allCyIds    = new Set(elements.map(e => e.data.id))
  const emittedKeys = new Set()

  // Build a map of file → [class/function ids] for semantic import edges
  // (file children that are top-level entities, not variables/methods)
  const fileChildren = {}  // fileId → [entityId, ...]
  for (const node of graphData.nodes) {
    const p = parentOf[node.id]
    if (!p) continue
    if (p.startsWith('file:') && (node.type === 'class' || node.type === 'function')) {
      ;(fileChildren[p] ??= []).push(node.id)
    }
  }

  function emitEdge(src, tgt, type, raw = null) {
    if (!allCyIds.has(src) || !allCyIds.has(tgt)) return
    if (src === tgt) return
    const key = `${type}::${src}::${tgt}`
    if (emittedKeys.has(key)) return
    emittedKeys.add(key)
    elements.push({ data: { id: `edge-${key}`, source: src, target: tgt, type, raw } })
  }

  for (const edge of graphData.edges) {
    if (edge.type === 'contains' || edge.type === 'belongs_to') continue

    let src = importIdMap.get(edge.source) ?? edge.source
    let tgt = importIdMap.get(edge.target) ?? edge.target

    // Legacy: flip old import edges (file→import → import→file)
    if (edge.type === 'imports' && (tgt.startsWith('imp:') || graphData.nodes.find(n => n.id === edge.target && n.type === 'import'))) {
      const tmp = src; src = tgt; tgt = tmp
    }

    emitEdge(src, tgt, edge.type, edge.raw ?? null)

    // Semantic import edges: for file→import_module/import_entity edges,
    // also emit edges from each class/function in that file to the same import node.
    // This lets the semantic view show which entities depend on which external imports.
    if (edge.type === 'imports' && src.startsWith('file:')) {
      const children = fileChildren[src] ?? []
      for (const childId of children) {
        emitEdge(childId, tgt, 'semantic_import')
      }
    }
  }

  return { elements, clusters }
}
