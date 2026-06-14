/**
 * cytoscapeLayout.js
 *
 * cose-bilkent layout configuration.
 * This algorithm handles compound (parent/child) graphs natively and
 * produces the nested circular cluster look.
 */
export const LAYOUT_CONFIG = {
  name: 'cose-bilkent',

  quality: 'default',           // 'draft' | 'default' | 'proof'
  nodeDimensionsIncludeLabels: true,

  fit: true,
  padding: 50,

  // Animation
  animate: 'end',
  animationEasing: 'ease-in-out-cubic',
  animationDuration: 700,

  // Physics
  randomize: true,
  nodeRepulsion: 5500,
  idealEdgeLength: 120,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,

  // Tiling (spread unconnected nodes evenly)
  tile: true,
  tilingPaddingVertical: 12,
  tilingPaddingHorizontal: 12,

  // Compound-specific
  gravityRangeCompound: 1.5,
  gravityCompound: 1.0,
  gravityRange: 3.8,
  initialEnergyOnIncremental: 0.5,
}
