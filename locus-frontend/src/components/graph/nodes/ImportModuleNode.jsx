import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#f0883e'

function wrapLabel(label) {
  if (!label) return ['']
  if (label.length <= 13) return [label]
  const mid = Math.floor(label.length / 2)
  let split = -1
  for (let i = mid; i >= 0; i--) {
    if (label[i] === '.' || label[i] === '_' || label[i] === '/') { split = i; break }
  }
  if (split === -1) {
    for (let i = mid + 1; i < label.length; i++) {
      if (label[i] === '.' || label[i] === '_' || label[i] === '/') { split = i; break }
    }
  }
  if (split === -1) {
    const half = Math.ceil(label.length / 2)
    return [label.slice(0, half) + '…', label.slice(half)]
  }
  const first  = label.slice(0, split + 1)
  const second = label.slice(split + 1)
  return [first, second.length > 13 ? second.slice(0, 12) + '…' : second]
}

export function ImportModuleNode({ data, cx, cy, r, selected, dimmed, onMouseDown, color = DEFAULT_COLOR }) {
  const bg      = darkenColor(color)
  const text    = contrastText(bg)
  const lines  = wrapLabel(data.label)
  const lineH  = 11
  const startDy = lines.length === 2 ? -(lineH / 2) : 0

  // Hexagon points for a visually distinct module shape
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')

  return (
    <g onMouseDown={onMouseDown} style={{ cursor: 'pointer', opacity: dimmed ? 0.12 : 1, transition: 'opacity 0.15s' }}>
      {selected && <polygon points={
        Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 180) * (60 * i - 30)
          return `${cx + (r + 4) * Math.cos(a)},${cy + (r + 4) * Math.sin(a)}`
        }).join(' ')
      } fill="none" stroke="#ffffff" strokeWidth="1.5" />}
      <polygon points={pts} fill={bg} stroke={color} strokeWidth="2" />
      <text
        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fill={text} fontSize="9.5" style={{ userSelect: 'none' }}
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={cx} dy={i === 0 ? startDy : lineH}>
            {ln}
          </tspan>
        ))}
      </text>
    </g>
  )
}
