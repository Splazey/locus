import { memo } from 'react'
import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#d2a8ff'

// Approximate pixel width of a character at 12px Inter
const CHAR_W = 6.5
const ICON_W = 16  // diameter of the C circle
const GAP    = 6

export const ClassNode = memo(function ClassNode({ data, position, size, selected, dimmed, onMouseDown, collapsed = false, zoom = 1, color = DEFAULT_COLOR }) {
  if (!position || !size) return null
  const bg   = darkenColor(color)
  const text = contrastText(bg)
  const { x, y } = position
  const { w }    = size  // square node: w === h

  // ── Normal-state header geometry ─────────────────────────────────────────
  const estTextW = (data.label?.length ?? 0) * CHAR_W
  const groupW   = ICON_W + GAP + estTextW
  const iconX    = x + w / 2 - groupW / 2
  const textX    = iconX + ICON_W + GAP
  const iconY    = y + 9
  const textY    = y + 23

  // ── Collapsed-state geometry ─────────────────────────────────────────────
  // Same zoom-compensating formula as FileNode.
  const cx       = x + w / 2
  const cy       = y + w / 2
  const fontSize = Math.max(8, Math.min(w * 0.08, 14 / zoom))

  return (
    <g onMouseDown={onMouseDown} style={{ cursor: 'pointer', opacity: dimmed ? 0.12 : 1, transition: 'opacity 0.15s' }}>
      {selected && (
        <rect
          x={x - 3} y={y - 3} width={w + 6} height={w + 6}
          rx="9999" fill="none" stroke="#ffffff" strokeWidth="1.5"
        />
      )}
      <rect x={x} y={y} width={w} height={w} rx="9999" fill={bg} stroke={color} strokeWidth="2" />

      {/* ── Normal state: icon + header label ───────────────────────────── */}
      <g style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.3s ease', pointerEvents: 'none' }}>
        <g transform={`translate(${iconX}, ${iconY})`}>
          <circle cx="8" cy="8" r="8" fill={color} />
          <text
            x="8" y="11.5" textAnchor="middle"
            fontSize="10" fontWeight="700" fill={bg}
            style={{ userSelect: 'none' }}
          >
            C
          </text>
        </g>
        <text
          x={textX} y={textY}
          fill={text} fontSize="12" fontWeight="600"
          style={{ userSelect: 'none' }}
        >
          {data.label}
        </text>
      </g>

      {/* ── Collapsed state: large centred label ─────────────────────────── */}
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={text}
        fontSize={fontSize}
        fontWeight="700"
        style={{
          opacity: collapsed ? 1 : 0,
          transition: 'opacity 0.3s ease',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {data.label}
      </text>
    </g>
  )
})
