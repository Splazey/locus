import { useState, useRef, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import { useGraphStore } from '../store/useGraphStore'
import { NODE_CONFIG } from '../constants/nodeConfig'

const PEER_GAP_MIN = 10
const PEER_GAP_MAX = 300

const TYPE_LABELS = {
  folder:        'Folders',
  file:          'Files',
  class:         'Classes',
  function:      'Functions',
  method:        'Methods',
  import:        'Imports (legacy)',
  import_module: 'Source Modules',
  import_entity: 'Import Entities',
  variable:      'Variables',
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

function isValidHex(str) {
  return /^#[0-9a-fA-F]{6}$/.test(str)
}

function ColorPickerPopover({ color, onClose, onConfirm }) {
  const [pending, setPending] = useState(color)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  function handleHexInput(e) {
    setPending(e.target.value)
  }

  function handleConfirm() {
    if (isValidHex(pending)) {
      onConfirm(pending)
    }
    onClose()
  }

  const previewColor = isValidHex(pending) ? pending : color

  return (
    <div
      ref={ref}
      className="color-picker-popover"
      style={{
        position: 'absolute',
        left: 0,
        top: '100%',
        marginTop: 4,
        zIndex: 100,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 8,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        width: 200,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Embedded saturation/hue picker */}
      <HexColorPicker
        color={previewColor}
        onChange={setPending}
        style={{ width: '100%', height: 140 }}
      />

      {/* HEX field + live preview swatch */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <span style={{ fontSize: 10, color: '#8b949e', letterSpacing: '0.5px' }}>HEX</span>
          <input
            type="text"
            value={pending}
            onChange={handleHexInput}
            maxLength={7}
            style={{
              width: '100%',
              background: '#0d1117',
              border: `1px solid ${isValidHex(pending) ? '#30363d' : '#f85149'}`,
              borderRadius: 4,
              color: '#e6edf3',
              fontSize: 12,
              fontFamily: 'monospace',
              padding: '4px 6px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 4,
            background: previewColor,
            border: '1px solid #30363d',
            flexShrink: 0,
          }}
        />
      </div>

      {/* Confirm / Cancel */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleConfirm}
          disabled={!isValidHex(pending)}
          style={{
            flex: 1,
            padding: '5px 0',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
            borderRadius: 5,
            border: 'none',
            background: isValidHex(pending) ? '#238636' : '#21262d',
            color: isValidHex(pending) ? '#ffffff' : '#6e7681',
            cursor: isValidHex(pending) ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          Confirm
        </button>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '5px 0',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'inherit',
            borderRadius: 5,
            border: '1px solid #30363d',
            background: 'transparent',
            color: '#8b949e',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const {
    stats, visibleTypes, visibleEdgeTypes, peerGap,
    isLoading, error, clusters,
    nodeColors, setNodeColor,
    toggleNodeType, toggleEdgeType, triggerRelayout, setPeerGap,
    projectPath, currentSave, dirty, viewMode,
    collapseAllFolders, expandAllFolders,
    requestGoHome, buildSavePayload, setCurrentSave, clearDirty, setError,
  } = useGraphStore()

  const hasFolders = (stats?.byType?.folder ?? 0) > 0

  const [colorPickerOpen, setColorPickerOpen] = useState(null)
  const [saving, setSaving] = useState(false)

  // Local slider state — updates live for visual feedback but only commits
  // to the store (triggering the settle pass) when the user releases the thumb.
  const [sliderGap, setSliderGap] = useState(peerGap)

  const projectName =
    currentSave?.name ??
    (projectPath?.split(/[/\\]/).filter(Boolean).pop() || 'Untitled')

  async function handleSave() {
    if (!isElectron || saving) return
    setSaving(true)
    try {
      const meta = await window.electronAPI.saveCodebase(buildSavePayload())
      setCurrentSave(meta)
      clearDirty()
    } catch (e) {
      setError(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="sidebar">
      {/* ── Logo + Home button ───────────────────────────────────────────── */}
      <div className="sidebar__logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3.5" fill="#388bfd" />
          <circle cx="4"  cy="6"  r="2" fill="#388bfd" opacity=".6" />
          <circle cx="20" cy="6"  r="2" fill="#388bfd" opacity=".6" />
          <circle cx="4"  cy="18" r="2" fill="#388bfd" opacity=".6" />
          <circle cx="20" cy="18" r="2" fill="#388bfd" opacity=".6" />
          <line x1="6"  y1="6.5" x2="10.2" y2="10.8" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="18" y1="6.5" x2="13.8" y2="10.8" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="6"  y1="17.5" x2="10.2" y2="13.2" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
          <line x1="18" y1="17.5" x2="13.8" y2="13.2" stroke="#388bfd" strokeWidth="1.4" opacity=".5" />
        </svg>
        <span className="sidebar__logo-text">Locus</span>
        <button
          className="sidebar__home-btn"
          onClick={requestGoHome}
          title="Back to home"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8.156 1.835a.25.25 0 0 0-.312 0l-5.25 4.2a.25.25 0 0 0-.094.196v7.019c0 .138.112.25.25.25H5.5V9.255a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75V13.5h2.75a.25.25 0 0 0 .25-.25V6.23a.25.25 0 0 0-.094-.195l-5.25-4.2ZM6.906.664a1.75 1.75 0 0 1 2.187 0l5.25 4.2c.415.332.657.835.657 1.367v7.019A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1-.75-.75V10H7v4.25a.75.75 0 0 1-.75.75h-3.5A1.75 1.75 0 0 1 1 13.25V6.23c0-.531.242-1.034.657-1.366l5.25-4.2Z" />
          </svg>
        </button>
      </div>

      <div className="sidebar__scroll">

        {/* ── Project ────────────────────────────────────────────────────── */}
        <section className="sidebar__section">
          <h3 className="sidebar__section-title">Project</h3>
          <p className="sidebar__project-name" title={projectPath ?? ''}>
            {projectName}
          </p>
          {projectPath && (
            <p className="sidebar__project-path">{projectPath}</p>
          )}
          <button
            className={`sidebar__btn sidebar__btn--full${dirty ? ' sidebar__btn--primary' : ''}`}
            onClick={handleSave}
            disabled={!isElectron || saving || !dirty}
            style={{ marginTop: 8 }}
          >
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved ✓'}
          </button>
          {error && <p className="sidebar__error">{error}</p>}
        </section>

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        {stats && (
          <section className="sidebar__section">
            <h3 className="sidebar__section-title">Graph</h3>
            {stats.languages && Object.keys(stats.languages).length > 0 && (
              <p style={{
                fontSize: 11,
                color: '#8b949e',
                margin: '0 0 8px',
                lineHeight: 1.4,
                padding: '0 2px',
              }}>
                {Object.entries(stats.languages)
                  .map(([lang, n]) => `${lang.charAt(0).toUpperCase()}${lang.slice(1)} · ${n} file${n === 1 ? '' : 's'}`)
                  .join('  ·  ')}
              </p>
            )}
            <div className="stats-grid">
              <div className="stats-grid__item">
                <span className="stats-grid__value">{stats.totalNodes}</span>
                <span className="stats-grid__label">Nodes</span>
              </div>
              <div className="stats-grid__item">
                <span className="stats-grid__value">{stats.totalEdges}</span>
                <span className="stats-grid__label">Edges</span>
              </div>
            </div>
            <div className="stats-types">
              {Object.entries(TYPE_LABELS).map(([type, label]) => {
                const count = stats.byType[type] || 0
                if (!count) return null
                return (
                  <div key={type} className="stats-types__row">
                    <span
                      className="stats-types__dot"
                      style={{ background: NODE_CONFIG[type]?.color }}
                    />
                    <span className="stats-types__label">{label}</span>
                    <span className="stats-types__count">{count}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── DEBUG: Cluster readout ─────────────────────────────────────── */}
        {Object.keys(clusters).length > 0 && (
          <section className="sidebar__section">
            <h3 className="sidebar__section-title" style={{ color: '#f472b6' }}>
              Clusters (debug)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.values(clusters).map(c => (
                <div key={c.id} style={{
                  background: '#1a0510',
                  border: '1px solid #5c1a3a',
                  borderRadius: 5,
                  padding: '7px 9px',
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#f472b6', margin: 0 }}>
                    {c.name}
                  </p>
                  {c.description && (
                    <p style={{ fontSize: 11, color: '#8b949e', margin: '3px 0 0', lineHeight: 1.4 }}>
                      {c.description}
                    </p>
                  )}
                  <p style={{ fontSize: 10, color: '#484f58', margin: '4px 0 0' }}>
                    {c.memberIds.length} member{c.memberIds.length !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Visibility ─────────────────────────────────────────────────── */}
        <section className="sidebar__section">
          <h3 className="sidebar__section-title">Visibility</h3>
          <div className="filter-list">
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const color = nodeColors[type] ?? NODE_CONFIG[type]?.color
              return (
                <div
                  key={type}
                  className={`filter-item${visibleTypes[type] ? ' filter-item--on' : ''}`}
                  style={{ '--fc': color, position: 'relative' }}
                >
                  <span
                    className="filter-item__dot"
                    title="Edit color"
                    style={{
                      background: color,
                      cursor: 'pointer',
                      flexShrink: 0,
                      outline: colorPickerOpen === type ? '2px solid #e3e3e3' : 'none',
                      outlineOffset: 1,
                      width: '20px',
                      height: '20px',
                      borderRadius: 4,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setColorPickerOpen(colorPickerOpen === type ? null : type)
                    }}
                  />
                  {colorPickerOpen === type && (
                    <ColorPickerPopover
                      color={color}
                      onClose={() => setColorPickerOpen(null)}
                      onConfirm={(c) => setNodeColor(type, c)}
                    />
                  )}
                  <span
                    className="filter-item__label"
                    style={{ cursor: 'pointer', flex: 1 }}
                    onClick={() => toggleNodeType(type)}
                  >
                    {label}
                  </span>
                  <span
                    className="filter-item__badge"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleNodeType(type)}
                  >
                    {visibleTypes[type] ? 'ON' : 'OFF'}
                  </span>
                </div>
              )
            })}
            {/* Edge type toggles */}
            <button
              className={`filter-item${visibleEdgeTypes?.calls !== false ? ' filter-item--on' : ''}`}
              onClick={() => toggleEdgeType('calls')}
              style={{ '--fc': NODE_CONFIG.calls?.color }}
            >
              <span className="filter-item__dot" style={{ borderRadius: 2 }} />
              <span className="filter-item__label">Call Edges</span>
              <span className="filter-item__badge">
                {visibleEdgeTypes?.calls !== false ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </section>

        {/* ── Layout ─────────────────────────────────────────────────────── */}
        <section className="sidebar__section">

          {/* Node Spacing slider */}
          <div className="sidebar__slider-row">
            <div className="sidebar__slider-header">
              <span className="sidebar__slider-label">Node Spacing</span>
            </div>
            <input
              type="range"
              className="sidebar__slider"
              min={PEER_GAP_MIN}
              max={PEER_GAP_MAX}
              value={sliderGap}
              onChange={e => setSliderGap(Number(e.target.value))}
              onPointerUp={e => setPeerGap(Number(e.target.value))}
            />
          </div>

          <button
            className="sidebar__btn sidebar__btn--full"
            onClick={triggerRelayout}
            disabled={isLoading}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.8 }}>
              <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
            </svg>
            Re-layout graph
          </button>

          {hasFolders && viewMode === 'structural' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                className="sidebar__btn"
                style={{ flex: 1 }}
                onClick={collapseAllFolders}
                disabled={isLoading}
                title="Collapse every top-level folder to an overview"
              >
                Collapse folders
              </button>
              <button
                className="sidebar__btn"
                style={{ flex: 1 }}
                onClick={expandAllFolders}
                disabled={isLoading}
                title="Expand all folders"
              >
                Expand folders
              </button>
            </div>
          )}
        </section>

      </div>
    </aside>
  )
}
