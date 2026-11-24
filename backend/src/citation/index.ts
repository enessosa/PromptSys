// Parsing of citation markers like [c3], including partial markers during streaming.
//
// A marker is `[c<digits>]` with 1 to 9 digits (at most 12 characters). Everything else (`[c3, c5]`, `[C3]`, `[3]`)
// stays plain text. The streaming parser and the final re-parse of the saved text use the same pattern;
// the re-parse is the source of truth for the `citations` rows.

/** Longest possible marker: `[c` + 9 digits + `]`. */
export const MAX_MARKER_LENGTH = 12

const MARKER = /^\[c(\d{1,9})\]/
const MARKER_PREFIX = /^\[(?:c\d*)?$/
const MARKER_GLOBAL = /\[c(\d{1,9})\]/g

/** A marker found in a text; offsets are UTF-16 code units (as `String.length` and `slice` count them). */
export type FoundMarker = { rawId: number; marker: string; start: number; end: number }

export type ParserEvent =
  | { type: 'text'; text: string }
  /** Emitted right after the `text` event that contains the marker text. Offsets refer to the final text. */
  | ({ type: 'marker' } & FoundMarker)

/**
 * State machine over the text chunks of a stream. From a `[` on, text is held back while the buffer is a prefix of a
 * marker (`[`, `[c`, `[c3`); it is released as plain text as soon as a character breaks the pattern or the buffer
 * is too long for a marker, and by `flush()` at the end of the stream. Nothing is ever lost, only delayed.
 */
export class StreamingCitationParser {
  #held = ''
  #offset = 0 // offset of the first character of `#held` (= number of characters released so far)

  push(chunk: string): ParserEvent[] {
    const events: ParserEvent[] = []
    let text = this.#held + chunk
    this.#held = ''
    while (text.length > 0) {
      const open = text.indexOf('[')
      if (open === -1) {
        this.#emitText(events, text)
        break
      }
      if (open > 0) {
        this.#emitText(events, text.slice(0, open))
        text = text.slice(open)
      }
      const match = MARKER.exec(text)
      if (match) {
        const marker = match[0]
        this.#emitText(events, marker, Number(match[1]))
        text = text.slice(marker.length)
      } else if (text.length < MAX_MARKER_LENGTH && MARKER_PREFIX.test(text)) {
        this.#held = text // could still become a marker
        break
      } else {
        this.#emitText(events, '[')
        text = text.slice(1)
      }
    }
    return events
  }

  /** Releases a held-back, unfinished buffer as plain text. Call once at the end of the stream. */
  flush(): ParserEvent[] {
    const events: ParserEvent[] = []
    if (this.#held) this.#emitText(events, this.#held)
    this.#held = ''
    return events
  }

  #emitText(events: ParserEvent[], text: string, markerId?: number) {
    const last = events.at(-1)
    if (markerId === undefined && last?.type === 'text') last.text += text
    else events.push({ type: 'text', text })
    if (markerId !== undefined) {
      events.push({ type: 'marker', rawId: markerId, marker: text, start: this.#offset, end: this.#offset + text.length })
    }
    this.#offset += text.length
  }
}

/** Re-parse of the complete text: all markers with their UTF-16 offsets. */
export function findMarkers(text: string): FoundMarker[] {
  return [...text.matchAll(MARKER_GLOBAL)].map((m) => ({
    rawId: Number(m[1]),
    marker: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }))
}

/** What the citation code needs to know about cards; the chat module backs it with SQL. */
export type CardLookup = {
  /** IDs of the cards that were part of this prompt (`included` or `pinned`). */
  inPrompt: ReadonlySet<number>
  /** The card a merged-away card was merged into (`cards.merged_into_id`), `null` if not merged; `undefined` if the card does not exist. */
  mergedInto(cardId: number): number | null | undefined
}

export type ResolvedCitation = FoundMarker & {
  /** The card the marker counts for; `null` if no such card exists. */
  cardId: number | null
  /** `false` if the card is unknown or was not part of this prompt (including `excluded` cards). */
  valid: boolean
}

const MAX_MERGE_HOPS = 20

/**
 * Resolves a marker: a card that is in the prompt counts as itself; otherwise merged-away cards are followed
 * through `merged_into_id` to their target (which counts if it is in the prompt).
 */
export function resolveMarker(marker: FoundMarker, lookup: CardLookup): ResolvedCitation {
  if (lookup.inPrompt.has(marker.rawId)) return { ...marker, cardId: marker.rawId, valid: true }
  let id = marker.rawId
  const seen = new Set<number>()
  for (let hop = 0; hop < MAX_MERGE_HOPS && !seen.has(id); hop++) {
    seen.add(id)
    const next = lookup.mergedInto(id)
    if (next === undefined) return { ...marker, cardId: null, valid: false } // unknown card
    if (next === null) return { ...marker, cardId: id, valid: lookup.inPrompt.has(id) }
    id = next
    if (lookup.inPrompt.has(id)) return { ...marker, cardId: id, valid: true }
  }
  return { ...marker, cardId: id, valid: false }
}

export type CitationSummary = {
  citations: ResolvedCitation[]
  /** Distinct cards with at least one valid citation. */
  usedCardIds: number[]
  /** Cards of the prompt without a valid citation. */
  unusedCardIds: number[]
  /** Distinct raw markers that are not valid. */
  invalidMarkers: string[]
}

/** Final re-parse of the saved answer: the citation rows plus the used / unused summary. */
export function analyzeCitations(text: string, lookup: CardLookup, promptCardIds: readonly number[]): CitationSummary {
  return summarize(findMarkers(text).map((m) => resolveMarker(m, lookup)), promptCardIds)
}

export function summarize(citations: ResolvedCitation[], promptCardIds: readonly number[]): CitationSummary {
  const used = new Set(citations.filter((c) => c.valid).map((c) => c.cardId as number))
  return {
    citations,
    usedCardIds: [...used],
    unusedCardIds: promptCardIds.filter((id) => !used.has(id)),
    invalidMarkers: [...new Set(citations.filter((c) => !c.valid).map((c) => c.marker))],
  }
}
