import { create } from 'zustand'
import { transformGraphToCytoscape } from '../utils/transform'
import { NODE_CONFIG } from '../constants/nodeConfig'

const defaultNodeColors = Object.fromEntries(
  Object.entries(NODE_CONFIG).map(([type, cfg]) => [type, cfg.color])
)

const defaultVisibleTypes = {
  file:          true,
  class:         true,
  function:      true,
  method:        true,
  import:        true,
  import_module: true,
  import_entity: true,
  variable:      true,
}

const defaultVisibleEdgeTypes = {
  calls: true,
}

function computeStats(graphData) {
  const byType = graphData.nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1
    return acc
  }, {})
  return {
    totalNodes: graphData.nodes.length,
    totalEdges: graphData.edges.length,
    byType,
    languages: graphData.metadata?.languages || null,
  }
}

export const useGraphStore = create((set, get) => ({
  // Which top-level screen is shown: 'home' | 'loading' | 'graph'
  screen: 'home',

  // Live analysis progress shown by the loading screen
  progress: { percent: 0, message: 'Starting…' },

  // Cytoscape elements array (nodes + edges)
  elements: [],

  // The untransformed graph.json — kept so the visualization can be saved
  rawGraph: null,

  // Cluster map: { [clusterId]: { id, name, description, memberIds[] } }
  // Populated only when graph.json contains cluster nodes (i.e. --cluster flag was used)
  clusters: {},

  // UI state
  selectedNode: null,
  projectPath: null,
  isLoading: false,
  error: null,
  stats: null,
  layoutKey: 0,

  // ── Save / load state ─────────────────────────────────────────────────────
  // Metadata of the save backing the current visualization (null = never saved)
  currentSave: null,
  // True when the visualization has unsaved changes (positions, colors, …)
  dirty: false,
  // "Save before leaving?" modal visibility
  showExitModal: false,
  // Node positions to restore, keyed by view mode:
  // { structural?: { [id]: {x,y} }, semantic?: { [id]: {x,y} } }
  // GraphRenderer applies these after layout and writes back into them on drag.
  savedPositions: {},

  // Per-type visibility toggles (node types)
  visibleTypes: { ...defaultVisibleTypes },

  // Per-type visibility toggles (edge types)
  visibleEdgeTypes: { ...defaultVisibleEdgeTypes },

  // Minimum gap (px) between node edges — controlled by the Node Spacing slider
  peerGap: 80,

  // Visualization mode: 'structural' (file-grouped) | 'semantic' (cluster-grouped)
  viewMode: 'structural',

  // Whether to run semantic clustering during analysis (passes --cluster to backend)
  clusterEnabled: false,

  // Per-type color overrides (hex strings) — initialized from NODE_CONFIG defaults
  nodeColors: { ...defaultNodeColors },

  // ── Actions ──────────────────────────────────────────────────────────────

  setGraph(graphData) {
    const { elements, clusters } = transformGraphToCytoscape(graphData)
    set({
      elements,
      clusters,
      rawGraph: graphData,
      selectedNode: null,
      error: null,
      stats: computeStats(graphData),
      savedPositions: {},
      currentSave: null,
      dirty: false,
    })
  },

  /** Restore a full saved visualization (graph + positions + view settings). */
  loadFromSave(save) {
    const { elements, clusters } = transformGraphToCytoscape(save.graph)
    const settings = save.settings ?? {}
    set({
      elements,
      clusters,
      rawGraph: save.graph,
      selectedNode: null,
      error: null,
      stats: computeStats(save.graph),
      savedPositions: save.positions ?? {},
      currentSave: {
        id: save.id,
        name: save.name,
        projectPath: save.projectPath,
        createdAt: save.createdAt,
      },
      dirty: false,
      projectPath: save.projectPath,
      clusterEnabled: !!save.clusterEnabled,
      viewMode:         settings.viewMode ?? 'structural',
      peerGap:          settings.peerGap ?? 80,
      nodeColors:       { ...defaultNodeColors, ...(settings.nodeColors ?? {}) },
      visibleTypes:     { ...defaultVisibleTypes, ...(settings.visibleTypes ?? {}) },
      visibleEdgeTypes: { ...defaultVisibleEdgeTypes, ...(settings.visibleEdgeTypes ?? {}) },
      screen: 'graph',
    })
  },

  /** Assemble everything needed to persist the current visualization. */
  buildSavePayload() {
    const s = get()
    const name =
      s.currentSave?.name ??
      (s.projectPath?.split(/[/\\]/).filter(Boolean).pop() || 'Untitled')
    return {
      id: s.currentSave?.id ?? null,           // main process derives one from the path
      name,
      projectPath: s.projectPath,
      createdAt: s.currentSave?.createdAt ?? null,
      clusterEnabled: s.clusterEnabled,
      stats: {
        nodes:     s.stats?.totalNodes ?? 0,
        edges:     s.stats?.totalEdges ?? 0,
        clusters:  Object.keys(s.clusters).length,
        languages: s.stats?.languages ?? null,
      },
      graph: s.rawGraph,
      positions: s.savedPositions,
      settings: {
        viewMode:         s.viewMode,
        peerGap:          s.peerGap,
        nodeColors:       s.nodeColors,
        visibleTypes:     s.visibleTypes,
        visibleEdgeTypes: s.visibleEdgeTypes,
      },
    }
  },

  setCurrentSave: (meta) => set({ currentSave: meta }),
  clearDirty:     () => set({ dirty: false }),

  /**
   * Record the current node positions for *mode*. Called by GraphRenderer
   * after layout (markDirty=false) and after user drags (markDirty=true).
   */
  setSavedPositions(mode, positions, markDirty = false) {
    set((s) => ({
      savedPositions: { ...s.savedPositions, [mode]: positions },
      ...(markDirty ? { dirty: true } : {}),
    }))
  },

  setScreen:   (screen) => set({ screen }),
  setProgress: (progress) => set({ progress }),

  /** Home-button entry point: intercepts when there are unsaved changes. */
  requestGoHome() {
    if (get().dirty) set({ showExitModal: true })
    else get().goHome()
  },

  setShowExitModal: (v) => set({ showExitModal: v }),

  /** Discard the current visualization and return to the start screen. */
  goHome() {
    set({
      screen: 'home',
      showExitModal: false,
      elements: [],
      clusters: {},
      rawGraph: null,
      stats: null,
      selectedNode: null,
      savedPositions: {},
      currentSave: null,
      dirty: false,
      projectPath: null,
      error: null,
      viewMode: 'structural',
    })
  },

  setSelectedNode: (node) => set({ selectedNode: node }),
  setProjectPath:  (p) => set({ projectPath: p }),
  setLoading:      (v) => set({ isLoading: v }),
  setError:        (e) => set({ error: e }),

  triggerRelayout() {
    set((s) => ({ layoutKey: s.layoutKey + 1 }))
  },

  toggleNodeType(type) {
    set((s) => ({
      visibleTypes: { ...s.visibleTypes, [type]: !s.visibleTypes[type] },
      dirty: true,
    }))
  },

  toggleEdgeType(type) {
    set((s) => ({
      visibleEdgeTypes: { ...s.visibleEdgeTypes, [type]: !s.visibleEdgeTypes[type] },
      dirty: true,
    }))
  },

  setPeerGap(val) {
    set({ peerGap: val, dirty: true })
  },

  setViewMode(mode) {
    set({ viewMode: mode, selectedNode: null })
  },

  setClusterEnabled(val) {
    set({ clusterEnabled: val })
  },

  setNodeColor(type, color) {
    set((s) => ({ nodeColors: { ...s.nodeColors, [type]: color }, dirty: true }))
  },
}))
