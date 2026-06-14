/** Shared colour/label config for every node type — used by Cytoscape stylesheet, Sidebar, and minimap. */
export const NODE_CONFIG = {
  file:     { color: '#79c0ff', dimColor: '#1c3461', bg: '#0a1a2e', label: 'FILE'     },
  class:    { color: '#d2a8ff', dimColor: '#3d1f6e', bg: '#160b26', label: 'CLASS'    },
  function: { color: '#56d364', dimColor: '#1a4d22', bg: '#0a1a0d', label: 'FUNC'     },
  method:   { color: '#58a6ff', dimColor: '#0d2645', bg: '#071423', label: 'METHOD'   },
  import:         { color: '#ffa657', dimColor: '#5c2c00', bg: '#1a0d00', label: 'IMPORT'        },
  import_module:  { color: '#f0883e', dimColor: '#5a2a00', bg: '#1a0c00', label: 'MODULE'        },
  import_entity:  { color: '#e3b341', dimColor: '#4a3600', bg: '#150f00', label: 'ENTITY'        },
  variable: { color: '#39d5c4', dimColor: '#0a3530', bg: '#041210', label: 'VAR'      },
  calls:    { color: '#6e7681', dimColor: '#1c2128', bg: '#0d1117', label: 'CALLS'    },
  cluster:  { color: '#f472b6', dimColor: '#5c1a3a', bg: '#1a0510', label: 'CLUSTER' },
}
