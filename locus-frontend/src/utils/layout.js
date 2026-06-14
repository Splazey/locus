import Dagre from '@dagrejs/dagre'

const NODE_SIZE = {
  file:     { width: 220, height: 72 },
  class:    { width: 200, height: 72 },
  function: { width: 190, height: 65 },
  method:   { width: 190, height: 65 },
  import:   { width: 200, height: 60 },
}

export function applyLayout(nodes, edges, direction = 'LR') {
  const g = new Dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 100, edgesep: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.forEach((node) => {
    const { width, height } = NODE_SIZE[node.type] || { width: 200, height: 70 }
    g.setNode(node.id, { width, height })
  })

  // Use only structural edges for layout — call/import edges create cycles
  edges
    .filter((e) => e.data?.edgeType === 'contains')
    .forEach((e) => {
      try {
        g.setEdge(e.source, e.target)
      } catch (_) {}
    })

  Dagre.layout(g)

  return nodes.map((node) => {
    const n = g.node(node.id)
    if (!n) return { ...node, position: { x: 0, y: 0 } }
    const { width, height } = NODE_SIZE[node.type] || { width: 200, height: 70 }
    return {
      ...node,
      position: { x: n.x - width / 2, y: n.y - height / 2 },
    }
  })
}
