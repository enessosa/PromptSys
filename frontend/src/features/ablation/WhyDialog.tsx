import { useState } from 'react'
import { Checkbox, Dialog, ProgressBar, TextInput } from '@primer/react'
import type { AblationCardResult, AblationDryRun } from '../../api/types.ts'
import { useWorkspace, type WhyTarget } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { useSettings } from '../settings/hooks.ts'
import { useAblationRun, useAblations } from './hooks.ts'
import { ablationErrorText, callsFormula, spreadText } from './model.ts'
import { ScoreBar } from './ScoreBar.tsx'
import styles from './ablation.module.css'

type Step = 'setup' | 'estimate' | 'running' | 'done'

/** Mounts the dialog when the workspace asks for it. */
export function WhyHost() {
  const why = useWorkspace((s) => s.why)
  const close = useWorkspace((s) => s.closeWhy)
  return why ? <WhyDialog key={`${why.messageId}:${why.cardId}`} target={why} onClose={close} /> : null
}

const clampInt = (text: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(text))
  return Number.isFinite(n) && text.trim() !== '' ? Math.min(max, Math.max(min, n)) : fallback
}

/** FR-09…FR-11, FR-21: pick cards and runs, see the number of API calls, confirm, watch progress, read the result. */
export function WhyDialog({ target, onClose }: { target: WhyTarget; onClose: () => void }) {
  const settings = useSettings()
  const stored = useAblations(target.messageId)
  const setExpected = useWorkspace((s) => s.setExpectedCalls)
  const { dryRun, run, cancel, progress, results, running } = useAblationRun(target.messageId)
  const [step, setStep] = useState<Step>('setup')
  const [selected, setSelected] = useState<Set<number>>(() => new Set([target.cardId]))
  const [runs, setRuns] = useState<string>('')
  const [baseline, setBaseline] = useState<string>('')
  const [estimate, setEstimate] = useState<AblationDryRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const runsValue = clampInt(runs, 1, 10, settings.data?.ablationRuns ?? 3)
  const baselineValue = clampInt(baseline, 0, 10, settings.data?.baselineRuns ?? 3)
  const cardIds = target.cards.map((c) => c.cardId).filter((id) => selected.has(id))
  const request = { cardIds, runs: runsValue, baselineRuns: baselineValue }

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const close = () => {
    if (running) cancel()
    onClose()
  }

  const estimateCalls = async () => {
    setError(null)
    setBusy(true)
    try {
      const d = await dryRun(request)
      setEstimate(d)
      setExpected(d.estimatedApiCalls)
      setStep('estimate')
    } catch (e) {
      setError(ablationErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setError(null)
    setStep('running')
    const failure = await run(request)
    if (failure) setError(ablationErrorText(failure))
    setExpected(null)
    setStep('done')
  }

  const title = (id: number) => target.cards.find((c) => c.cardId === id)?.title ?? ''
  const shown: AblationCardResult[] = step === 'running' || step === 'done' ? results : []
  const previous = (stored.data?.cards ?? []).filter((r) => !shown.some((s) => s.cardId === r.cardId))
  const noise = stored.data?.baseline.noise ?? null

  const footer =
    step === 'setup'
      ? [
          { content: 'Close', onClick: close },
          { content: 'Estimate API calls', buttonType: 'primary' as const, onClick: () => void estimateCalls(), disabled: cardIds.length === 0 || busy },
        ]
      : step === 'estimate'
        ? [
            { content: 'Back', onClick: () => { setStep('setup'); setExpected(null) } },
            { content: `Run ${estimate?.estimatedApiCalls ?? 0} API call${estimate?.estimatedApiCalls === 1 ? '' : 's'}`, buttonType: 'primary' as const, onClick: () => void start() },
          ]
        : step === 'running'
          ? [{ content: 'Stop', buttonType: 'danger' as const, onClick: cancel }]
          : [
              { content: 'Run again', onClick: () => setStep('setup') },
              { content: 'Close', buttonType: 'primary' as const, onClick: close },
            ]

  return (
    <Dialog title="Why? What did the cards change?" width="xlarge" onClose={close} footerButtons={footer}>
      <div className={styles.dialog}>
        {step === 'setup' && (
          <>
            <p className={styles.muted}>
              Each selected card is left out of the prompt and the answer is generated again. The change of the answer is measured with local embeddings (cosine similarity), compared with the noise of unchanged runs.
            </p>
            <ul className={styles.cardList}>
              {target.cards.map((c) => (
                <li key={c.cardId}>
                  <label>
                    <Checkbox checked={selected.has(c.cardId)} onChange={() => toggle(c.cardId)} aria-label={`Ask about ${cardLabel(c.cardId)}`} />
                    <span className={styles.id}>{cardLabel(c.cardId)}</span>
                    <span>{c.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className={styles.fields}>
              <label>
                Runs per card (n)
                <TextInput type="number" min={1} max={10} aria-label="Runs per card" value={runs} placeholder={String(runsValue)} onChange={(e) => setRuns(e.target.value)} />
              </label>
              <label>
                Baseline runs (k)
                <TextInput type="number" min={0} max={10} aria-label="Baseline runs" value={baseline} placeholder={String(baselineValue)} onChange={(e) => setBaseline(e.target.value)} />
              </label>
            </div>
            {runsValue === 1 && <p className={styles.hint}>Single run: the result may be noise.</p>}
          </>
        )}

        {step === 'estimate' && estimate && (
          <div className={styles.estimate} role="status">
            <strong>Expected: {callsFormula(estimate)}</strong>
            <p className={styles.muted}>
              k baseline runs + n runs × cards. Nothing is sent until you confirm. {cardIds.map(cardLabel).join(', ')}.
            </p>
          </div>
        )}

        {step === 'running' && (
          <div aria-label="Ablation progress">
            <ProgressBar
              aria-label="Progress"
              barSize="large"
              progress={progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}
            />
            <p className={styles.muted}>
              {progress && progress.total > 0 ? `${progress.done} of ${progress.total} API calls done` : 'Starting…'}
            </p>
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {(shown.length > 0 || previous.length > 0) && (
          <section aria-label="Results">
            <h4>Results</h4>
            <p className={styles.muted}>
              Method: embedding similarity (change = 1 − similarity to the original answer).{' '}
              {noise === null ? 'No baseline noise measured.' : `Baseline noise: ${noise.toFixed(2)}.`}
            </p>
            {[...shown, ...previous].map((r) => (
              <ResultRow key={r.cardId} result={r} title={title(r.cardId)} original={target.answerText} stale={!shown.includes(r)} />
            ))}
            <p className={styles.hint}>
              An ablation cannot tell "the card is not needed" from "the model already knew it" – both show as within noise.
            </p>
          </section>
        )}
      </div>
    </Dialog>
  )
}

function ResultRow({ result, title, original, stale }: { result: AblationCardResult; title: string; original: string; stale: boolean }) {
  const ablated = result.answers[0]?.answer
  return (
    <div className={styles.result} data-stale={stale || undefined}>
      <div className={styles.resultHead}>
        <span className={styles.id}>{cardLabel(result.cardId)}</span>
        <span>{title}</span>
        {stale && <span className={styles.muted}>earlier result</span>}
      </div>
      <ScoreBar result={result} spread={spreadText(result.answers)} />
      <p className={styles.explanation}>{result.explanation}</p>
      <p className={styles.muted}>
        Change {result.change.toFixed(2)} · noise {result.noiseMeasured ? result.noise.toFixed(2) : 'not measured'} · {result.runs} run{result.runs === 1 ? '' : 's'}
      </p>
      {result.runs === 1 && <p className={styles.hint}>Single run, may be noise.</p>}
      {ablated !== undefined && (
        <details>
          <summary>Original vs. answer without {cardLabel(result.cardId)}</summary>
          <div className={styles.compare}>
            <div>
              <h5>Original</h5>
              <pre>{original}</pre>
            </div>
            <div>
              <h5>Without {cardLabel(result.cardId)}</h5>
              <pre>{ablated}</pre>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}
