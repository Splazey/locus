import { useRef } from 'react'

const MM_W = 200
const MM_H = 150
const PAD  = 6

/**
 * Minimap — a cheap overview of the whole graph.
 *
 * Renders one small rect per top-level container (folders / root files / imports)
 * — never every leaf — scaled to fit, plus a draggable rectangle showing the
 * current viewport. Clicking or dragging inside recenters the main view.
 *
 * Props:
 *   items        [{ id, x, y, w, h, color }]  top-level node boxes (world coords)
 *   bounds       { minX, minY, maxX, maxY }   overall content bounds (world)
 *   viewportRect { minX, minY, maxX, maxY }   currently visible region (world)
 *   onRecenter   (worldX, worldY) => void     center main view on this world point
 */
export function Minimap({ items, bounds, viewportRect, onRecenter }) {
  const svgRef    = useRef(null)
  const draggingRef = useRef(false)

  if (!bounds || !items?.length) return null
  const worldW = Math.max(1, bounds.maxX - bounds.minX)
  const worldH = Math.max(1, bounds.maxY - bounds.minY)
  const scale  = Math.min((MM_W - PAD * 2) / worldW, (MM_H - PAD * 2) / worldH)
  const offX   = PAD + ((MM_W - PAD * 2) - worldW * scale) / 2
  const offY   = PAD + ((MM_H - PAD * 2) - worldH * scale) / 2

  const toMM = (wx, wy) => ({ x: offX + (wx - bounds.minX) * scale, y: offY + (wy - bounds.minY) * scale })

  const handleAt = (clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = clientX - rect.left, my = clientY - rect.top
    const wx = bounds.minX + (mx - offX) / scale
    const wy = bounds.minY + (my - offY) / scale
    onRecenter?.(wx, wy)
  }

  const vr = viewportRect ? {
    ...toMM(viewportRect.minX, viewportRect.minY),
    w: (viewportRect.maxX - viewportRect.minX) * scale,
    h: (viewportRect.maxY - viewportRect.minY) * scale,
  } : null

  return (
    <svg
      ref={svgRef}
      width={MM_W}
      height={MM_H}
      style={{
        background: 'rgba(13,17,23,0.85)', border: '1px solid #30363d',
        borderRadius: 8, cursor: 'crosshair', display: 'block',
      }}
      onMouseDown={e => { draggingRef.current = true; handleAt(e.clientX, e.clientY) }}
      onMouseMove={e => { if (draggingRef.current) handleAt(e.clientX, e.clientY) }}
      onMouseUp={() => { draggingRef.current = false }}
      onMouseLeave={() => { draggingRef.current = false }}
    >
      {items.map(it => {
        const p = toMM(it.x, it.y)
        return (
          <rect
            key={it.id}
            x={p.x} y={p.y}
            width={Math.max(1.5, it.w * scale)} height={Math.max(1.5, it.h * scale)}
            rx={1.5}
            fill={it.color ?? '#30363d'} opacity={0.55}
          />
        )
      })}
      {vr && (
        <rect
          x={vr.x} y={vr.y} width={Math.max(4, vr.w)} height={Math.max(4, vr.h)}
          fill="rgba(88,166,255,0.12)" stroke="#58a6ff" strokeWidth="1.5" rx={2}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}
