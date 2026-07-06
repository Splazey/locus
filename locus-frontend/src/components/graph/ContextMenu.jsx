/**
 * ContextMenu.jsx
 *
 * Lightweight right-click popover used for cluster-manipulation actions.
 * One instance is rendered by GraphRenderer; callers open it via the store
 * (`openContextMenu(x, y, items)`) and it self-closes on outside click,
 * Escape, or scroll.
 *
 * Item shape:
 *   { type: 'action',    label, onClick, disabled? }
 *   { type: 'separator' }
 *   { type: 'submenu',   label, items: [...] }                  // inline list
 *   { type: 'input',     label, placeholder?, initial?,
 *                        multiline?, submitLabel?, onSubmit }   // inline input
 */

import { useEffect, useRef, useState } from 'react'

const MENU_BG     = '#161b22'
const MENU_BORDER = '#30363d'
const HOVER_BG    = '#1f2630'
const TEXT        = '#e6edf3'
const MUTED       = '#6e7681'
const ACCENT      = '#f472b6'

const menuStyle = {
  position: 'absolute', zIndex: 1000,
  minWidth: 200, maxWidth: 320,
  background: MENU_BG, border: `1px solid ${MENU_BORDER}`, borderRadius: 6,
  boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
  padding: 4,
  fontFamily: 'inherit', fontSize: 12.5, color: TEXT,
  userSelect: 'none',
}

const itemStyle = (disabled, hover) => ({
  padding: '6px 10px', borderRadius: 4,
  cursor: disabled ? 'default' : 'pointer',
  color: disabled ? MUTED : TEXT,
  background: hover && !disabled ? HOVER_BG : 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
})

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginTop: 4,
  background: '#0d1117', border: `1px solid ${MENU_BORDER}`, borderRadius: 4,
  color: TEXT, fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
}

const submitBtnStyle = {
  marginTop: 6, padding: '5px 10px', borderRadius: 4,
  background: ACCENT, border: 'none', color: '#0d1117',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

function clampToViewport(x, y, w = 220, h = 200) {
  const vw = window.innerWidth, vh = window.innerHeight
  return {
    x: Math.min(x, vw - w - 8),
    y: Math.min(y, vh - h - 8),
  }
}

/** A single menu item — supports action / separator / submenu / input. */
function MenuItem({ item, onClose }) {
  const [hover,    setHover]    = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [value,    setValue]    = useState(item.initial ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus()
  }, [expanded])

  if (item.type === 'separator') {
    return <div style={{ height: 1, background: MENU_BORDER, margin: '4px 2px' }} />
  }

  if (item.type === 'action') {
    return (
      <div
        style={itemStyle(item.disabled, hover)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (item.disabled) return
          item.onClick?.()
          onClose()
        }}
      >
        <span>{item.label}</span>
      </div>
    )
  }

  if (item.type === 'submenu') {
    const items = item.items ?? []
    return (
      <div>
        <div
          style={itemStyle(items.length === 0, hover)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => { if (items.length) setExpanded(v => !v) }}
        >
          <span>{item.label}</span>
          <span style={{ color: MUTED, fontSize: 10 }}>
            {items.length === 0 ? '(none)' : (expanded ? '▾' : '▸')}
          </span>
        </div>
        {expanded && items.length > 0 && (
          <div style={{
            maxHeight: 240, overflowY: 'auto',
            margin: '2px 0 2px 10px',
            borderLeft: `1px solid ${MENU_BORDER}`,
            paddingLeft: 4,
          }}>
            {items.map((sub, i) => (
              <MenuItem key={i} item={sub} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'input') {
    const submit = () => {
      const v = value.trim()
      if (!v && !item.allowEmpty) return
      item.onSubmit?.(v)
      onClose()
    }
    return (
      <div>
        <div
          style={itemStyle(false, hover)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => setExpanded(v => !v)}
        >
          <span>{item.label}</span>
          <span style={{ color: MUTED, fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        </div>
        {expanded && (
          <div style={{ padding: '0 6px 6px' }}>
            {item.multiline ? (
              <textarea
                ref={inputRef}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={item.placeholder}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
                  if (e.key === 'Escape') onClose()
                }}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={item.placeholder}
                style={inputStyle}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); submit() }
                  if (e.key === 'Escape') onClose()
                }}
              />
            )}
            <button type="button" style={submitBtnStyle} onClick={submit}>
              {item.submitLabel ?? 'OK'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return null
}

export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })

  // Re-clamp once the menu has measured itself
  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos(clampToViewport(x, y, r.width, r.height))
  }, [x, y])

  // Close on outside click / Escape / scroll
  useEffect(() => {
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onScroll = () => onClose()
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onScroll)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ ...menuStyle, left: pos.x, top: pos.y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((it, i) => <MenuItem key={i} item={it} onClose={onClose} />)}
    </div>
  )
}
