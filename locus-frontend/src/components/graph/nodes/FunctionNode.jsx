import { memo } from 'react'
import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#56d364'

function clip(label) {
  if (!label) return ''
  return label.length > 14 ? label.slice(0, 13) + '…' : label
}

export const FunctionNode = memo(function FunctionNode({ data, cx, cy, r, selected, dimmed, onMouseDown, color = DEFAULT_COLOR }) {
  const bg   = darkenColor(color)
  const text = contrastText(bg)
  return (
    <g onMouseDown={onMouseDown} style={{ cursor: 'pointer', opacity: dimmed ? 0.12 : 1, transition: 'opacity 0.15s' }}>
      {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#ffffff" strokeWidth="1.5" />}
      <circle cx={cx} cy={cy} r={r} fill={bg} stroke={color} strokeWidth="2" />
      <text
        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fill={text} fontSize="10" style={{ userSelect: 'none' }}
      >
        {clip(data.label)}
      </text>
    </g>
  )
})
