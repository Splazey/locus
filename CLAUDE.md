# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Locus** is a code-graph visualizer for Python, JavaScript, and Java codebases. It consists of two parts:
- `locus-backend/` — Python analysis engine that parses a project (language auto-detected per file by extension) and emits `output/graph.json`
- `locus-frontend/` — React + Electron desktop app that renders the graph

The two halves are loosely coupled via `graph.json`. In development you can run either independently.

## Commands

### Backend

```bash
cd locus-backend
pip install -r requirements.txt          # tree-sitter + python/javascript/java grammars

# Analyze a project (output goes to output/graph.json)
python analyze.py path/to/project
python analyze.py path/to/project --output custom/path.json

# Analyze the bundled sample projects
python analyze.py sample_projects
```

No test suite exists yet; manually inspect `output/graph.json` to verify backend output.

### Frontend

```bash
cd locus-frontend
npm install

# Web-only dev server (no Electron, no file-system APIs)
npm run dev                  # Vite at http://localhost:5173

# Full Electron dev (both Vite and Electron, with hot-reload)
npm run electron:dev

# Production preview (builds Vite then launches Electron)
npm run electron:preview
```

`window.electronAPI` is only available in Electron mode. The web-only dev server can load a `graph.json` via the "Load JSON" button (when `isElectron` is false, the button is hidden — load graphs by editing the store directly or adding a temporary file-input).

## Architecture

### Data flow

```
Project on disk (Python / JavaScript / Java, detected per file by extension)
  → locus-backend/analyze.py (3-pass graph builder)
      → uses parser/python_parser.py | javascript_parser.py | java_parser.py
        (tree-sitter AST; all subclass parser/base_parser.py and return the
        same language-neutral records dict)
  → output/graph.json  { nodes: [...], edges: [...], metadata: { languages } }
  → Electron main process (electron/main.js) reads file, sends via IPC
  → useGraphStore.setGraph()
      → transform.js  (graph.json → Cytoscape element array)
  → GraphRenderer (SVG canvas)
```

### Backend passes (`analyze.py`)

1. **First pass** — parse every supported source file (`.py`, `.js/.jsx/.mjs/.cjs`, `.java`) with its language's parser; create `file`, `class`, `function`, `method`, `import`, and `variable` nodes; build `contains` edges and the `local_entity` lookup table `(rel_path, name) → node_id`.
2. **Second pass** — resolve `imports` edges with a per-language resolver (Python: dotted module paths; JS: relative specifiers with extension/index inference; Java: package + class FQCN map): local imports link to actual file/entity nodes; unresolvable ones become standalone `import` nodes.
3. **Third pass** — resolve `calls` edges: callee names are matched against `local_entity` (same-file first, then cross-file unique match); unresolvable calls are dropped.

### Node & edge types

**Nodes:** `file`, `class`, `function`, `method`, `import`, `variable`

**Edges:** `contains` (converted to `parent` field, never rendered as an edge), `imports`, `inherits`, `calls`

### Frontend rendering pipeline

`graph.json` → **`transform.js`** → flat Cytoscape element array → **`computeLayout`** (`graphLayout.js`) → absolute `positions` + `sizes` maps → **`GraphRenderer`** (SVG) → **`EdgeLayer`** + per-type node components.

Key layout rules:
- Containers: `file` wraps `class`, `function`, `variable`; `class` wraps `method`, `variable`
- Leaf sizes are fixed constants in `LEAF_SIZE` (`graphLayout.js`)
- `import` nodes are top-level (no parent); they sit beside file containers in the canvas pack

### Adding a new node type (checklist)

1. **Backend**: emit nodes with the new `type` string in `analyze.py`; add `contains` edges to set the parent
2. `constants/nodeConfig.js` — add color/label entry
3. `utils/graphLayout.js` — add to `LEAF_SIZE` if it's a leaf, or add a new sizing block if it's a container
4. `utils/transform.js` — add a `shortLabel` case; pass any extra fields through to `data`
5. Create `components/graph/nodes/YourNode.jsx`
6. `components/graph/EdgeLayer.jsx` — add to the `LEAF` set if circular
7. `components/graph/GraphRenderer.jsx` — add to `leafNodes` filter and `renderLeaf` switch
8. `store/useGraphStore.js` — add to `visibleTypes`
9. `components/Sidebar.jsx` — add to `TYPE_LABELS`
10. `components/RightSidebar.jsx` — add to `TYPE_LABEL`; handle children display if needed

### Adding a new edge type (checklist)

1. **Backend**: emit edges with the new `type` string; ensure both endpoint IDs resolve to real nodes
2. `components/graph/EdgeLayer.jsx` — add to `STYLE` map (color, dashed, marker, opacity); add an SVG `<marker>` def if needed
3. `components/RightSidebar.jsx` — add to `EDGE_LABEL`

### State management

A single Zustand store (`useGraphStore`) holds `elements`, `visibleTypes`, `selectedNode`, `stats`, and `layoutKey`. Incrementing `layoutKey` triggers a full re-layout in `GraphRenderer`.

### Screens & save system

The app has three screens, driven by `screen` in `useGraphStore` (`'home' | 'loading' | 'graph'`):

- **Home** (`components/HomeScreen.jsx`) — path input + folder picker, semantic-clustering toggle pill, and a "recent visualizations" list backed by the save store.
- **Loading** (`components/LoadingScreen.jsx`) — candy-cane progress bar driven by `##LOCUS_PROGRESS## {json}` lines that `analyze.py` prints to stdout (forwarded by Electron main as `analysis-progress` IPC events).
- **Graph** — the original sidebar/canvas layout, with a Home button (top of sidebar) and a Save button. Leaving with unsaved changes (`dirty` in the store) opens a confirm modal.

Saves live in `userData/saves/`: one `<id>.json` per codebase (id = sha1 of the project path, so re-analyzing the same path overwrites) holding the raw graph, node positions per view mode, and view settings (colors, visibility, peerGap, viewMode); `index.json` holds lightweight metadata for the recents list. A codebase is auto-saved right after analysis completes. `GraphRenderer` restores positions from `savedPositions[viewMode]` after layout and writes drag results back via `setSavedPositions` (which sets `dirty`); an explicit re-layout discards saved positions for that mode.

### IPC bridge (Electron)

`electron/main.js` exposes: `analyze-project` (spawns `python analyze.py`, streams `analysis-progress` events), `open-folder-dialog`, `open-file` (opens VS Code at a line), `load-graph-file`, and the save store (`list-saves`, `save-codebase`, `load-save`, `delete-save`). All are surfaced to the renderer via `electron/preload.js` as `window.electronAPI`.
