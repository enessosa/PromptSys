const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

export function isHexColor(value: string): boolean {
  return HEX.test(value)
}

/** `#rrggbb` → `rgb(r g b / alpha)` for the muted accent surface; null for anything else. */
export function mutedAccent(hex: string, alpha = 0.16): string | null {
  const m = HEX.exec(hex)
  if (!m) return null
  return `rgb(${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)} / ${alpha})`
}

/** Sets (or, with null, resets to the theme default) the accent colour of the whole UI. */
export function applyAccent(color: string | null, root: HTMLElement = document.documentElement) {
  const muted = color ? mutedAccent(color) : null
  if (color && muted) {
    root.style.setProperty('--ps-accent', color)
    root.style.setProperty('--ps-accent-muted', muted)
  } else {
    root.style.removeProperty('--ps-accent')
    root.style.removeProperty('--ps-accent-muted')
  }
}
