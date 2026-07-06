import { create } from 'zustand'
import { transformGraphToCytoscape } from '../utils/transform'
import { NODE_CONFIG } from '../constants/nodeConfig'

const defaultNodeColors = Object.fromEntries(
  Object.entries(NODE_CONFIG).map(([type, cfg]) => [type, cfg.color])
)

const defaultVisibleTypes = {
  folder:        true,
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

// Above this node count, top-level folders start collapsed so a large codebase
// opens as a compact, navigable overview instead of thousands of nodes at once.
const AUTO_COLLAPSE_NODE_THRESHOLD = 1500

// Above this entity count (non-file/folder/cluster nodes), all semantic clusters
// start collapsed so the semantic view opens as a compact map of cluster boxes
// instead of rendering every class/function/method at once.
const SEMANTIC_AUTO_COLLAPSE_THRESHOLD = 800

/** Top-level folder ids (no parent folder) — collapsed first for big graphs. */
function topLevelFolderIds(graphData) {
  const ids = []
  for (const n of graphData.nodes) {
    if (n.type !== 'folder') continue
    const path = n.path ?? n.name ?? ''
    if (!path.includes('/')) ids.push(n.id)
  }
  return ids
}

/** Initial collapsed-folder set: collapse top-level folders for large graphs. */
function initialCollapsedFolders(graphData) {
  if ((graphData.nodes?.length ?? 0) < AUTO_COLLAPSE_NODE_THRESHOLD) return new Set()
  return new Set(topLevelFolderIds(graphData))
}

/** All cluster ids in a graph. */
function allClusterIds(graphData) {
  return (graphData?.nodes ?? []).filter(n => n.type === 'cluster').map(n => n.id)
}

/**
 * Initial collapsed-cluster set: for large graphs every cluster starts
 * collapsed so the semantic view opens fast.  Returns empty for small graphs
 * (or graphs without clusters).
 */
function initialCollapsedClusters(graphData) {
  const clusterIds = allClusterIds(graphData)
  if (clusterIds.length === 0) return new Set()
  const entityCount = (graphData.nodes ?? []).filter(
    n => n.type !== 'file' && n.type !== 'folder' && n.type !== 'cluster'
  ).length
  if (entityCount < SEMANTIC_AUTO_COLLAPSE_THRESHOLD) return new Set()
  return new Set(clusterIds)
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
  // Request from the right sidebar for the canvas to focus (select + center on)
  // a node. { id, nonce } — the nonce changes on every request so repeated
  // clicks on the same node re-trigger the effect. null until first request.
  focusRequest: null,
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

  // Folder ids that are collapsed to a summary box (structural mode). A collapsed
  // folder hides all its descendants and shrinks the layout — the basis of the
  // large-codebase overview. Stored as a Set; replaced on every change.
  collapsedFolders: new Set(),

  // Cluster ids collapsed to a summary box (semantic mode) — the semantic analog
  // of collapsedFolders. A collapsed cluster hides its members and shrinks the
  // layout. Stored as a Set; replaced on every change.
  collapsedClusters: new Set(),

  // Cluster ids hidden entirely (semantic mode): neither members nor a summary
  // box are laid out or rendered. Drives selective cluster viewing / isolate.
  hiddenClusters: new Set(),

  // Whether to run semantic clustering during analysis (passes --cluster to backend)
  clusterEnabled: false,

  // Lite mode: drop variable nodes + skip test/vendor dirs (passes --lite to backend)
  liteEnabled: false,

  // Per-type color overrides (hex strings) — initialized from NODE_CONFIG defaults
  nodeColors: { ...defaultNodeColors },

  // Right-click context menu: { x, y, items } | null
  contextMenu: null,

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
      collapsedFolders: initialCollapsedFolders(graphData),
      collapsedClusters: initialCollapsedClusters(graphData),
      hiddenClusters: new Set(),
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
      collapsedFolders: settings.collapsedFolders
        ? new Set(settings.collapsedFolders)
        : initialCollapsedFolders(save.graph),
      collapsedClusters: settings.collapsedClusters
        ? new Set(settings.collapsedClusters)
        : initialCollapsedClusters(save.graph),
      hiddenClusters: settings.hiddenClusters
        ? new Set(settings.hiddenClusters)
        : new Set(),
      currentSave: {
        id: save.id,
        name: save.name,
        projectPath: save.projectPath,
        createdAt: save.createdAt,
      },
      dirty: false,
      projectPath: save.projectPath,
      clusterEnabled: !!save.clusterEnabled,
      liteEnabled: !!save.liteEnabled,
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
      liteEnabled: s.liteEnabled,
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
        collapsedFolders: [...s.collapsedFolders],
        collapsedClusters: [...s.collapsedClusters],
        hiddenClusters: [...s.hiddenClusters],
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
      collapsedFolders: new Set(),
      collapsedClusters: new Set(),
      hiddenClusters: new Set(),
    })
  },

  setSelectedNode: (node) => set({ selectedNode: node }),

  /** Ask the canvas to select and center on a node (from the right sidebar). */
  requestFocusNode(id) {
    if (!id) return
    set((s) => ({ focusRequest: { id, nonce: (s.focusRequest?.nonce ?? 0) + 1 } }))
  },

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

  /** Collapse/expand a single folder (structural-mode overview). */
  toggleFolder(id) {
    set((s) => {
      const next = new Set(s.collapsedFolders)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { collapsedFolders: next, dirty: true }
    })
  },

  /** Collapse every top-level folder (or all folders if none are top-level). */
  collapseAllFolders() {
    set((s) => {
      const tops = topLevelFolderIds(s.rawGraph ?? { nodes: [] })
      const ids = tops.length
        ? tops
        : (s.rawGraph?.nodes ?? []).filter(n => n.type === 'folder').map(n => n.id)
      return { collapsedFolders: new Set(ids), dirty: true }
    })
  },

  expandAllFolders() {
    set({ collapsedFolders: new Set(), dirty: true })
  },

  /** Expand the given folder ids (used to reveal a search target). */
  revealFolders(ids) {
    if (!ids || ids.length === 0) return
    set((s) => {
      const next = new Set(s.collapsedFolders)
      let changed = false
      for (const id of ids) if (next.delete(id)) changed = true
      return changed ? { collapsedFolders: next } : {}
    })
  },

  // ── Semantic-mode cluster controls ─────────────────────────────────────────

  /** Collapse/expand a single cluster to a summary box (semantic overview). */
  toggleClusterCollapsed(id) {
    set((s) => {
      const next = new Set(s.collapsedClusters)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { collapsedClusters: next, dirty: true }
    })
  },

  /** Show/hide a single cluster entirely (members + blob). */
  toggleClusterHidden(id) {
    set((s) => {
      const next = new Set(s.hiddenClusters)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { hiddenClusters: next, dirty: true }
    })
  },

  /**
   * Isolate a cluster: hide every OTHER cluster. Calling it again on the same
   * (already-isolated) cluster clears the isolation and shows everything.
   */
  isolateCluster(id) {
    set((s) => {
      const all = allClusterIds(s.rawGraph ?? { nodes: [] })
      const others = all.filter(cid => cid !== id)
      const alreadyIsolated =
        s.hiddenClusters.size === others.length &&
        others.every(cid => s.hiddenClusters.has(cid))
      return {
        hiddenClusters: alreadyIsolated ? new Set() : new Set(others),
        dirty: true,
      }
    })
  },

  collapseAllClusters() {
    set((s) => ({
      collapsedClusters: new Set(allClusterIds(s.rawGraph ?? { nodes: [] })),
      dirty: true,
    }))
  },

  expandAllClusters() {
    set({ collapsedClusters: new Set(), hiddenClusters: new Set(), dirty: true })
  },

  setClusterEnabled(val) {
    set({ clusterEnabled: val })
  },

  setLiteEnabled(val) {
    set({ liteEnabled: val })
  },

  setNodeColor(type, color) {
    set((s) => ({ nodeColors: { ...s.nodeColors, [type]: color }, dirty: true }))
  },

  // ── Context-menu controls ─────────────────────────────────────────────────
  openContextMenu(x, y, items) { set({ contextMenu: { x, y, items } }) },
  closeContextMenu()           { set({ contextMenu: null }) },

  // ── Cluster mutations ─────────────────────────────────────────────────────
  // All mutations flow through this helper: it edits `rawGraph` (the canonical
  // form that gets saved), re-runs the same transform used at load time, drops
  // dangling `belongs_to` edges, and bumps `layoutKey` so positions reflow.
  // One code path means the on-screen graph and the persisted file can never
  // drift. Set `pruneEmpty: true` to also delete clusters with no members
  // (used by moveNodeToCluster / deleteCluster — not by createCluster).
  applyGraphMutation(mutator, { pruneEmpty = false } = {}) {
    set((s) => {
      if (!s.rawGraph) return {}
      const draft = {
        ...s.rawGraph,
        nodes: s.rawGraph.nodes.map(n => ({ ...n })),
        edges: s.rawGraph.edges.map(e => ({ ...e })),
      }
      mutator(draft)

      if (pruneEmpty) {
        const memberCount = {}
        for (const e of draft.edges) {
          if (e.type === 'belongs_to') memberCount[e.target] = (memberCount[e.target] || 0) + 1
        }
        draft.nodes = draft.nodes.filter(n =>
          n.type !== 'cluster' || (memberCount[n.id] || 0) > 0
        )
      }

      const surviving = new Set(
        draft.nodes.filter(n => n.type === 'cluster').map(n => n.id)
      )
      // Drop belongs_to edges pointing at clusters that no longer exist
      draft.edges = draft.edges.filter(e =>
        e.type !== 'belongs_to' || surviving.has(e.target)
      )

      const { elements, clusters } = transformGraphToCytoscape(draft)
      const collapsedClusters = new Set([...s.collapsedClusters].filter(id => surviving.has(id)))
      const hiddenClusters    = new Set([...s.hiddenClusters].filter(id => surviving.has(id)))

      // Drop savedPositions for the semantic view — cluster membership changed,
      // so re-flow is required. Structural positions are unaffected.
      const savedPositions = { ...s.savedPositions }
      delete savedPositions.semantic

      return {
        rawGraph: draft,
        elements,
        clusters,
        collapsedClusters,
        hiddenClusters,
        savedPositions,
        stats: computeStats(draft),
        dirty: true,
        layoutKey: s.layoutKey + 1,
      }
    })
  },

  /** Move *nodeId* into *targetClusterId*, or out of any cluster when null.
   *  Prunes the source cluster if this empties it (auto-delete-on-empty). */
  moveNodeToCluster(nodeId, targetClusterId) {
    get().applyGraphMutation((draft) => {
      draft.edges = draft.edges.filter(e =>
        !(e.type === 'belongs_to' && e.source === nodeId)
      )
      if (targetClusterId) {
        draft.edges.push({ type: 'belongs_to', source: nodeId, target: targetClusterId })
      }
    }, { pruneEmpty: true })
  },

  /** Create a new cluster; returns the generated id. */
  createCluster({ name, description = '', memberIds = [] }) {
    const id = `cluster:user:${Date.now()}-${Math.floor(Math.random() * 10000)}`
    get().applyGraphMutation((draft) => {
      draft.nodes.push({ id, type: 'cluster', name, description })
      const memberSet = new Set(memberIds)
      if (memberSet.size) {
        draft.edges = draft.edges.filter(e =>
          !(e.type === 'belongs_to' && memberSet.has(e.source))
        )
        for (const mid of memberIds) {
          draft.edges.push({ type: 'belongs_to', source: mid, target: id })
        }
      }
    })
    // An empty cluster can't draw a hull, so render it as a collapsed
    // placeholder box until the user moves members into it.
    if (memberIds.length === 0) {
      set((s) => {
        const next = new Set(s.collapsedClusters)
        next.add(id)
        return { collapsedClusters: next }
      })
    }
    return id
  },

  /** Remove a cluster; its members become unclustered. */
  deleteCluster(clusterId) {
    get().applyGraphMutation((draft) => {
      draft.nodes = draft.nodes.filter(n => n.id !== clusterId)
      draft.edges = draft.edges.filter(e =>
        !(e.type === 'belongs_to' && e.target === clusterId)
      )
    })
  },

  /**
   * Rename / re-describe a cluster. Doesn't change membership, so no re-layout
   * is needed — this avoids reflowing the whole semantic view on every keystroke.
   */
  updateClusterMetadata(clusterId, updates) {
    set((s) => {
      if (!s.rawGraph) return {}
      const rawGraph = {
        ...s.rawGraph,
        nodes: s.rawGraph.nodes.map(n => {
          if (n.id !== clusterId) return n
          return {
            ...n,
            ...(updates.name        !== undefined ? { name:        updates.name        } : {}),
            ...(updates.description !== undefined ? { description: updates.description } : {}),
          }
        }),
      }
      const clusters = { ...s.clusters }
      if (clusters[clusterId]) {
        clusters[clusterId] = {
          ...clusters[clusterId],
          ...(updates.name        !== undefined ? { name:        updates.name        } : {}),
          ...(updates.description !== undefined ? { description: updates.description } : {}),
        }
      }
      return { rawGraph, clusters, dirty: true }
    })
  },
}))
