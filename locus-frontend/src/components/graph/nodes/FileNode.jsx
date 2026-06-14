const ICON_PATH =
  'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914' +
  'c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1' +
  ' 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0' +
  ' .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z'

import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#79c0ff'

// Approximate pixel width of a character at 13px Inter
const CHAR_W = 7.5
const ICON_W = 14  // rendered width (14/16 scale of 16px viewBox)
const GAP    = 6

export function FileNode({ data, position, size, selected, dimmed, onMouseDown, collapsed = false, zoom = 1, color = DEFAULT_COLOR }) {
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
  const iconY    = y + 15
  const textY    = y + 27

  // ── Collapsed-state geometry ─────────────────────────────────────────────
  // Target: label appears at ~14 px on screen regardless of zoom level.
  // SVG font = 14 / zoom, clamped so it never overflows the box or goes
  // below a legible minimum.
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
      <rect x={x} y={y} width={w} height={w} rx="9999" fill={bg} stroke={color} strokeWidth="2.5" />

      {/* ── Normal state: icon + header label ───────────────────────────── */}
      <g style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.3s ease', pointerEvents: 'none' }}>
        <g transform={`translate(${iconX}, ${iconY}) scale(${ICON_W / 16})`}>
          <path d={ICON_PATH} fill={color} />
        </g>
        <text
          x={textX} y={textY}
          fill={text} fontSize="13" fontWeight="700"
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
}
