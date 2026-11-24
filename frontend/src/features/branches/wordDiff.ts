export type DiffKind = 'same' | 'added' | 'removed'
export type DiffSegment = { text: string; kind: DiffKind }

/** Above this many token pairs the exact comparison is skipped (the middle part is shown as replaced). */
const MAX_CELLS = 400_000

const tokenize = (text: string): string[] => text.match(/\s+|\S+/g) ?? []

function push(out: DiffSegment[], text: string, kind: DiffKind) {
  if (text === '') return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ text, kind })
}

/**
 * Word diff (longest common subsequence over words and whitespace runs).
 * Removed text comes before added text where both replace each other.
 */
export function diffWords(a: string, b: string): DiffSegment[] {
  const x = tokenize(a)
  const y = tokenize(b)
  let start = 0
  while (start < x.length && start < y.length && x[start] === y[start]) start++
  let endX = x.length
  let endY = y.length
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--
    endY--
  }
  const out: DiffSegment[] = []
  push(out, x.slice(0, start).join(''), 'same')

  const mid1 = x.slice(start, endX)
  const mid2 = y.slice(start, endY)
  const n = mid1.length
  const m = mid2.length
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    push(out, mid1.join(''), 'removed')
    push(out, mid2.join(''), 'added')
  } else {
    // lcs[i][j] = length of the LCS of mid1[i..] and mid2[j..]
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = mid1[i] === mid2[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    // Collect removed/added runs between matches so that removals precede additions.
    let removed = ''
    let added = ''
    const flush = () => {
      push(out, removed, 'removed')
      push(out, added, 'added')
      removed = ''
      added = ''
    }
    while (i < n && j < m) {
      if (mid1[i] === mid2[j]) {
        flush()
        push(out, mid1[i], 'same')
        i++
        j++
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) removed += mid1[i++]
      else added += mid2[j++]
    }
    removed += mid1.slice(i).join('')
    added += mid2.slice(j).join('')
    flush()
  }
  push(out, x.slice(endX).join(''), 'same')
  return out
}

/** The segments of one side: the left text shows `same` + `removed`, the right text `same` + `added`. */
export const sideSegments = (segments: DiffSegment[], side: 'left' | 'right'): DiffSegment[] =>
  segments.filter((s) => s.kind === 'same' || s.kind === (side === 'left' ? 'removed' : 'added'))
