import { memo } from 'react'
import { darkenColor, contrastText } from '../../../utils/colorUtils'

const DEFAULT_COLOR = '#e3b341'

// Folder glyph (GitHub Octicon "file-directory").
const ICON_PATH =
  'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0' +
  ' 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26' +
  ' 5.55 1 5 1H1.75Z'

const CHAR_W = 7.5
const ICON_W = 16
const GAP    = 7

export const FolderNode = memo(function FolderNode({
  data, position, size, selected, dimmed, onMouseDown,
  collapsed = false, zoom = 1, color = DEFAULT_COLOR, onToggle,
}) {
  if (!position || !size) return null
  const bg   = darkenColor(color)
  const text = contrastText(bg)
  const { x, y } = position
  const { w, h } = size
  const count    = data.fileCount ?? 0
  const countTxt = `${count} file${count === 1 ? '' : 's'}`

  // ── Normal-state header geometry ─────────────────────────────────────────
  // Scale the header with the box so an expanded folder's title stays legible.
  const hScale     = Math.max(1, Math.min(w / 260, 4))
  const headerFont = 13.5 * hScale
  const iconW    = ICON_W * hScale
  const gap      = GAP * hScale
  const estTextW = (data.label?.length ?? 0) * CHAR_W * hScale
  const groupW   = iconW + gap + estTextW
  const iconX    = x + 18 * hScale
  const textX    = iconX + iconW + gap
  const headerTop = y + 12 * hScale
  const countY    = headerTop + headerFont + 6 * hScale

  // ── Collapsed-state geometry ─────────────────────────────────────────────
  const cx       = x + w / 2
  const cy       = y + h / 2
  const fontSize = Math.max(9, Math.min(w * 0.09, 15 / zoom))

  // Chevron toggle (top-right). Its own mousedown stops propagation so it never
  // starts a folder drag.
  const chX = x + w - 22
  const chY = y + 22
  const chevron = collapsed
    ? `M ${chX - 4} ${chY - 5} L ${chX + 4} ${chY} L ${chX - 4} ${chY + 5}`   // ▸
    : `M ${chX - 5} ${chY - 4} L ${chX} ${chY + 4} L ${chX + 5} ${chY - 4}`   // ▾
  const handleToggle = (e) => { e.stopPropagation(); onToggle?.(data.id) }

  void groupW
  return (
    <g onMouseDown={onMouseDown} style={{ cursor: 'pointer', opacity: dimmed ? 0.12 : 1, transition: 'opacity 0.15s' }}>
      {selected && (
        <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx="18" fill="none" stroke="#ffffff" strokeWidth="1.5" />
      )}
      <rect x={x} y={y} width={w} height={h} rx="16" fill={bg} stroke={color} strokeWidth="2.5"
            strokeDasharray={collapsed ? '7 5' : undefined} />

      {/* Chevron collapse/expand toggle */}
      <g onMouseDown={handleToggle} style={{ cursor: 'pointer' }}>
        <circle cx={chX} cy={chY} r="11" fill={bg} stroke={color} strokeWidth="1.5" />
        <path d={chevron} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* ── Expanded state: icon + header label + count ──────────────────── */}
      <g style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.25s ease', pointerEvents: 'none' }}>
        <g transform={`translate(${iconX}, ${headerTop}) scale(${iconW / 16})`}>
          <path d={ICON_PATH} fill={color} />
        </g>
        <text x={textX} y={headerTop} dominantBaseline="hanging" fill={text} fontSize={headerFont} fontWeight="700" style={{ userSelect: 'none' }}>
          {data.label}
        </text>
        <text x={iconX} y={countY} dominantBaseline="hanging" fill={color} fontSize={10.5 * hScale} fontWeight="600" opacity="0.85" style={{ userSelect: 'none' }}>
          {countTxt}
        </text>
      </g>

      {/* ── Collapsed state: large centred name + count ──────────────────── */}
      <g style={{ opacity: collapsed ? 1 : 0, transition: 'opacity 0.25s ease', pointerEvents: 'none' }}>
        <g transform={`translate(${cx - 8}, ${y + 16}) scale(1)`}>
          <path d={ICON_PATH} fill={color} />
        </g>
        <text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle"
              fill={text} fontSize={fontSize} fontWeight="700" style={{ userSelect: 'none' }}>
          {data.label}
        </text>
        <text x={cx} y={cy + 4 + fontSize} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={Math.max(8, fontSize * 0.6)} fontWeight="600" opacity="0.85"
              style={{ userSelect: 'none' }}>
          {countTxt}
        </text>
      </g>
    </g>
  )
})
