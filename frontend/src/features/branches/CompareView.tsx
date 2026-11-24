import { Button } from '@primer/react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import type { ChatMessage } from '../../api/types.ts'
import { EmptyState } from '../../components/EmptyState.tsx'
import { useComparison } from './hooks.ts'
import { diffWords, sideSegments, type DiffSegment } from './wordDiff.ts'
import styles from './branches.module.css'

/** FR-22: two timelines from their common branch point on, paired messages side by side with a word diff. */
export function CompareView({ a, b, onBack }: { a: number; b: number; onBack: () => void }) {
  const cmp = useComparison(a, b)
  return (
    <div className={styles.compare}>
      <div className={styles.compareHead}>
        <Button size="small" leadingVisual={ArrowLeftIcon} onClick={onBack}>
          Back to branches
        </Button>
        {cmp.data && (
          <span className={styles.muted}>
            {cmp.data.a.timeline.name} vs. {cmp.data.b.timeline.name}
            {cmp.data.commonBranchPointId === null ? ' · from the start' : ` · common branch point at message ${cmp.data.commonBranchPointId}`}
          </span>
        )}
      </div>
      {cmp.isPending && <EmptyState title="Loading comparison…" />}
      {cmp.isError && <EmptyState title="The timelines cannot be compared">{cmp.error.message}</EmptyState>}
      {cmp.data && cmp.data.pairs.length === 0 && <EmptyState title="Nothing to compare">Both timelines end at the common branch point.</EmptyState>}
      {cmp.data && (
        <div className={styles.pairs}>
          {cmp.data.pairs.map((p, i) => (
            <Pair key={i} left={p.a} right={p.b} leftName={cmp.data.a.timeline.name} rightName={cmp.data.b.timeline.name} />
          ))}
        </div>
      )}
    </div>
  )
}

function Segments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'same' ? <span key={i}>{s.text}</span> : s.kind === 'added' ? <ins key={i}>{s.text}</ins> : <del key={i}>{s.text}</del>,
      )}
    </>
  )
}

export function Pair({ left, right, leftName, rightName }: { left: ChatMessage | null; right: ChatMessage | null; leftName: string; rightName: string }) {
  const segments = left && right ? diffWords(left.content, right.content) : null
  const identical = segments !== null && segments.every((s) => s.kind === 'same')
  return (
    <div className={styles.pair} data-identical={identical || undefined} aria-label="Message pair">
      <div className={styles.side}>
        <h5>{leftName}{left ? ` · ${left.role === 'user' ? 'prompt' : 'answer'}` : ''}</h5>
        {left ? <p>{segments ? <Segments segments={sideSegments(segments, 'left')} /> : left.content}</p> : <p className={styles.muted}>No counterpart.</p>}
      </div>
      <div className={styles.side}>
        <h5>{rightName}{right ? ` · ${right.role === 'user' ? 'prompt' : 'answer'}` : ''}</h5>
        {right ? <p>{segments ? <Segments segments={sideSegments(segments, 'right')} /> : right.content}</p> : <p className={styles.muted}>No counterpart.</p>}
      </div>
    </div>
  )
}
