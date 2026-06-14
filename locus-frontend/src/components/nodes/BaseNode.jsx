import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useGraphStore } from '../../store/useGraphStore'

export const NODE_CONFIG = {
  file: {
    color: '#388bfd',
    dimColor: '#1c3461',
    bg: '#0d1f3c',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z" />
      </svg>
    ),
    label: 'FILE',
  },
  class: {
    color: '#d2a8ff',
    dimColor: '#3d1f6e',
    bg: '#1a0e2e',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.75 1.75 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
      </svg>
    ),
    label: 'CLASS',
  },
  function: {
    color: '#56d364',
    dimColor: '#1a4d22',
    bg: '#0c1f0f',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.543 7.25h2.733c.144 0 .286-.077.372-.199l1.335-1.961.927 5.546a.4.4 0 0 0 .755.072L8.814 7.25h5.643a.75.75 0 0 0 0-1.5H8.357a.4.4 0 0 0-.37.252L6.95 8.817 6.034 3.35a.4.4 0 0 0-.727-.112L3.564 5.75H1.543a.75.75 0 0 0 0 1.5Z" />
      </svg>
    ),
    label: 'FUNC',
  },
  method: {
    color: '#79c0ff',
    dimColor: '#143050',
    bg: '#0a1728',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M6.368 2.806a.75.75 0 0 1 .575-.575l4-1a.75.75 0 0 1 .894.894l-1 4a.75.75 0 0 1-.575.575l-4 1a.75.75 0 0 1-.894-.894Zm.88 1.24-.528 2.113 2.113-.528.528-2.113ZM1.75 7.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5Zm0 3a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5Zm9 0a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 0-1.5Z" />
      </svg>
    ),
    label: 'METHOD',
  },
  import: {
    color: '#ffa657',
    dimColor: '#5c2c00',
    bg: '#1f1000',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8.75 1.75a.75.75 0 0 0-1.5 0V5H4a.75.75 0 0 0 0 1.5h3.25V9a.75.75 0 0 0 1.5 0V6.5H12A.75.75 0 0 0 12 5H8.75V1.75ZM4 12.25a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Z" />
      </svg>
    ),
    label: 'IMPORT',
  },
}

export const BaseNode = memo(function BaseNode({ data, selected, type }) {
  const nodeColors = useGraphStore((s) => s.nodeColors)
  const baseCfg = NODE_CONFIG[type] || NODE_CONFIG.file
  const cfg = { ...baseCfg, color: nodeColors[type] ?? baseCfg.color }

  const shortName = (() => {
    const lbl = data.label || ''
    if (type === 'file') return lbl.split(/[/\\]/).pop() || lbl
    const parts = lbl.split(':')
    return parts[parts.length - 1] || lbl
  })()

  return (
    <div
      className={`graph-node graph-node--${type}${selected ? ' graph-node--selected' : ''}`}
      style={{ '--nc': cfg.color, '--nd': cfg.dimColor, '--nb': cfg.bg }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="graph-node__handle"
      />
      <div className="graph-node__accent" />
      <div className="graph-node__body">
        <div className="graph-node__header">
          <span className="graph-node__icon" style={{ color: cfg.color }}>
            {cfg.icon}
          </span>
          <span className="graph-node__type">{cfg.label}</span>
        </div>
        <div className="graph-node__name" title={data.label}>
          {shortName}
        </div>
        {data.startLine != null && (
          <div className="graph-node__meta">
            L{data.startLine}
            {data.endLine !== data.startLine ? `–${data.endLine}` : ''}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="graph-node__handle"
      />
    </div>
  )
})
