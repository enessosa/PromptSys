import type { Citation } from '../../api/types.ts'

/** Same pattern as the backend (`\[c(\d{1,9})\]`). */
export const MARKER_PATTERN = /\[c(\d{1,9})\]/g

export type Segment = { type: 'text'; text: string } | { type: 'marker'; marker: string; cardId: number }

/** Splits text into plain parts and `[cN]` markers. */
export function splitMarkers(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(MARKER_PATTERN)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'marker', marker: m[0], cardId: Number(m[1]) })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

export type MarkerInfo = { cardId: number | null; valid: boolean }

/** marker text → how the backend resolved it (the same marker always resolves the same way). */
export function markerLookup(citations: Citation[]): Map<string, MarkerInfo> {
  const map = new Map<string, MarkerInfo>()
  for (const c of citations) map.set(c.marker, { cardId: c.cardId, valid: c.valid })
  return map
}

/* Minimal mdast types: only what the plugin touches, so no extra type package is needed. */
type MdNode = {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference'])

function transform(node: MdNode) {
  if (!node.children || SKIP.has(node.type)) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value && /\[c\d/.test(child.value)) {
      for (const seg of splitMarkers(child.value)) {
        next.push(
          seg.type === 'text'
            ? { type: 'text', value: seg.text }
            : {
                type: 'citationMarker',
                data: { hName: 'cite-marker', hProperties: { marker: seg.marker, cardId: seg.cardId } },
                children: [],
              },
        )
      }
    } else {
      transform(child)
      next.push(child)
    }
  }
  node.children = next
}

/** remark plugin: turns `[cN]` in text (not in code or links) into `cite-marker` elements. */
export function remarkCitations() {
  return (tree: MdNode) => transform(tree)
}
