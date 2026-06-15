import { memo } from 'react'
import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#39d5c4'

function clip(s, max) {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export const VariableNode = memo(function VariableNode({ data, cx, cy, r, selected, dimmed, onMouseDown, color = DEFAULT_COLOR }) {
  const bg      = darkenColor(color)
  const text    = contrastText(bg)
  const varType = clip(data.varType || 'var', 10)
  const name    = clip(data.label, 12)
  const lineH   = 11

  return (
    <g onMouseDown={onMouseDown} style={{ cursor: 'pointer', opacity: dimmed ? 0.12 : 1, transition: 'opacity 0.15s' }}>
      {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#ffffff" strokeWidth="1.5" />}
      <circle cx={cx} cy={cy} r={r} fill={bg} stroke={color} strokeWidth="2" />
      <text textAnchor="middle" style={{ userSelect: 'none' }}>
        <tspan x={cx} y={cy - lineH / 2} fontWeight="bold" fill={color} fontSize="9">{varType}</tspan>
        <tspan x={cx} dy={lineH} fill={text} fontSize="9">{name}</tspan>
      </text>
    </g>
  )
})
