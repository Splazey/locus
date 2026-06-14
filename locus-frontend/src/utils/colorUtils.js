/** Parse a 6-digit hex string into { r, g, b } (0-255 each). */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** Convert { r, g, b } back to a hex string. */
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

/**
 * Derive a dark background from an accent color by mixing it heavily with black.
 * `factor` controls how dark: 0 = black, 1 = original color. Default 0.15.
 */
export function darkenColor(hex, factor = 0.15) {
  try {
    const { r, g, b } = hexToRgb(hex)
    return rgbToHex({ r: r * factor, g: g * factor, b: b * factor })
  } catch {
    return '#0d1117'
  }
}

/**
 * Return '#ffffff' or '#111111' depending on which has better contrast
 * against the given background hex color (uses WCAG relative luminance).
 */
export function contrastText(hex) {
  try {
    const { r, g, b } = hexToRgb(hex)
    // sRGB linearisation
    const lin = v => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    // White contrast ratio vs dark background is better when L < 0.179
    return L < 0.35 ? '#ffffff' : '#111111'
  } catch {
    return '#ffffff'
  }
}
