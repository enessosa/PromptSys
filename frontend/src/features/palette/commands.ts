export type PaletteCommand = {
  id: string
  title: string
  shortcut?: string
  /** Hidden from the list when false (e.g. "Merge selected" without a selection). */
  enabled?: boolean
  run: (options: { secondPane: boolean }) => void
}

/** Subsequence match ("opgr" finds "Open graph"); lower score = better, null = no match. */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const direct = t.indexOf(q)
  if (direct !== -1) return direct
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const i = t.indexOf(ch, pos)
    if (i === -1) return null
    gaps += i - pos
    pos = i + 1
  }
  return 100 + gaps
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  return commands
    .filter((c) => c.enabled !== false)
    .map((c) => ({ c, score: fuzzyScore(c.title, query) }))
    .filter((x): x is { c: PaletteCommand; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c)
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modLabel = isMac ? '⌘' : 'Ctrl+'

export function formatShortcut(keys: string): string {
  return keys.replace('Mod+', modLabel).replace('Shift+', isMac ? '⇧' : 'Shift+')
}
