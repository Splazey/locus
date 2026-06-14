import { NODE_CONFIG } from '../constants/nodeConfig'

const nc = NODE_CONFIG

const uri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`

const FILE_ICON = uri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16">` +
  `<path fill="${nc.file.color}" d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 ` +
  `.909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 ` +
  `13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 ` +
  `.138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Z` +
  `m6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>` +
  `</svg>`
)

const CLASS_ICON = uri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
  `<circle cx="8" cy="8" r="8" fill="white"/>` +
  `<text x="8.5" y="12" text-anchor="middle" ` +
  `font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="700" ` +
  `fill="${nc.class.bg}">C</text>` +
  `</svg>`
)

export const CYTOSCAPE_STYLESHEET = [
  // ── Base node defaults ────────────────────────────────────────────────────
  {
    selector: 'node',
    style: {
      shape: 'ellipse',
      label: 'data(label)',
      color: '#e6edf3',
      'font-family': '"Inter", "system-ui", sans-serif',
      'font-size': 11,
      'font-weight': 500,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-overflow-wrap': 'anywhere',
      'overlay-opacity': 0,
    },
  },

  // ── Override :parent default shape (Cytoscape forces 'rectangle' for parents) ─
  {
    selector: ':parent',
    style: {
      shape: 'round-rectangle',
      'corner-radius': 9999,
    },
  },

  // ── File (compound parent) ────────────────────────────────────────────────
  {
    selector: 'node[type="file"]',
    style: {
      shape: 'round-rectangle',
      'corner-radius': 9999,
      'background-color': nc.file.bg,
      'background-opacity': 0.88,
      'border-color': nc.file.color,
      'border-width': 2.5,
      'background-image': FILE_ICON,
      'background-width': 14,
      'background-height': 14,
      'background-position-x': 14,
      'background-position-y': 16,
      'background-image-containment': 'over',
      'font-size': 13,
      'font-weight': 700,
      color: nc.file.color,
      'text-valign': 'top',
      'text-halign': 'left',
      'text-wrap': 'none',
      'text-margin-x': 34,
      'text-margin-y': 15,
      padding: '40px',
      'min-width': function (ele) {
        return Math.max(130, (ele.data('label') || '').length * 8 + 70)
      },
      'min-height': 110,
    },
  },

  // ── Class (compound parent) ───────────────────────────────────────────────
  {
    selector: 'node[type="class"]',
    style: {
      shape: 'round-rectangle',
      'corner-radius': 9999,
      'background-color': nc.class.bg,
      'background-opacity': 0.92,
      'border-color': nc.class.color,
      'border-width': 2,
      'background-image': CLASS_ICON,
      'background-width': 16,
      'background-height': 16,
      'background-position-x': 50,
      'background-position-y': 5,
      'background-image-containment': 'over',
      'font-size': 12,
      'font-weight': 600,
      color: nc.class.color,
      'text-valign': 'top',
      'text-halign': 'center',
      'text-wrap': 'none',
      'text-margin-x': 0,
      'text-margin-y': 24,
      padding: '30px',
      'min-width': function (ele) {
        return Math.max(100, (ele.data('label') || '').length * 7 + 60)
      },
      'min-height': 80,
    },
  },

  // ── Function (leaf, inside file) ──────────────────────────────────────────
  {
    selector: 'node[type="function"]',
    style: {
      'background-color': nc.function.bg,
      'background-opacity': 1,
      'border-color': nc.function.color,
      'border-width': 2,
      width: 72,
      height: 72,
      'font-size': 10,
      color: '#e6edf3',
    },
  },

  // ── Method (leaf, inside class) ───────────────────────────────────────────
  {
    selector: 'node[type="method"]',
    style: {
      'background-color': nc.method.bg,
      'background-opacity': 1,
      'border-color': nc.method.color,
      'border-width': 2,
      width: 60,
      height: 60,
      'font-size': 10,
      color: '#e6edf3',
    },
  },

  // ── Import (standalone, deduplicated) ────────────────────────────────────
  {
    selector: 'node[type="import"]',
    style: {
      'background-color': nc.import.bg,
      'background-opacity': 1,
      'border-color': nc.import.color,
      'border-width': 2,
      width: 88,
      height: 88,
      'font-size': 9.5,
      color: nc.import.color,
      'text-wrap': 'wrap',
      'text-max-width': 72,
    },
  },

  // ── Hover overlay ─────────────────────────────────────────────────────────
  {
    selector: 'node:active',
    style: {
      'overlay-opacity': 0.12,
      'overlay-color': '#ffffff',
    },
  },

  // ── Selected ─────────────────────────────────────────────────────────────
  {
    selector: 'node:selected',
    style: {
      'border-width': 3,
      'border-color': '#ffffff',
      'overlay-opacity': 0.08,
      'overlay-color': '#ffffff',
    },
  },

  // ── Base edge ─────────────────────────────────────────────────────────────
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'curve-style': 'bezier',
      opacity: 0.75,
      'target-arrow-fill': 'filled',
    },
  },

  // ── calls (dashed gray) ───────────────────────────────────────────────────
  {
    selector: 'edge[type="calls"]',
    style: {
      'line-color': '#6e7681',
      'line-style': 'dashed',
      'line-dash-pattern': [7, 4],
      'target-arrow-shape': 'none',
      label: 'CALLS',
      'font-size': 8,
      'font-weight': 600,
      color: '#6e7681',
      'text-rotation': 'autorotate',
      'text-margin-y': -7,
      'text-background-color': '#0d1117',
      'text-background-opacity': 0.9,
      'text-background-padding': '2px',
      'letter-spacing': 1,
    },
  },

  // ── imports (orange arrow) ────────────────────────────────────────────────
  {
    selector: 'edge[type="imports"]',
    style: {
      'line-color': nc.import.color,
      'target-arrow-color': nc.import.color,
      'target-arrow-shape': 'none',
    },
  },

  // ── inherits (purple arrow) ───────────────────────────────────────────────
  {
    selector: 'edge[type="inherits"]',
    style: {
      'line-color': nc.class.color,
      'target-arrow-color': nc.class.color,
      'target-arrow-shape': 'triangle',
    },
  },
]
