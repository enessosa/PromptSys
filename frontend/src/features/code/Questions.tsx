import { useState } from 'react'
import { Button, Textarea, TextInput } from '@primer/react'
import Markdown from 'react-markdown'
import { codeComponents, rehypeCode, remarkMarkdown } from '../../components/codeMarkdown.ts'
import prose from '../../components/prose.module.css'
import { answerOf, parseQuestions, planText, type ApprovalReply } from './model.ts'
import styles from './code.module.css'

type FormProps = { input: unknown; busy: boolean; onAnswer: (reply: ApprovalReply) => void }

type Choice = { picked: string[]; other: string; otherOn: boolean }

const OTHER = 'Other'

/** The agent's AskUserQuestion as a form: one group per question, options as radio buttons or checkboxes, plus "Other" with free text. */
export function QuestionForm({ input, busy, onAnswer }: FormProps) {
  const questions = parseQuestions(input)
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => ({ picked: [], other: '', otherOn: false })))
  const set = (i: number, change: Partial<Choice>) => setChoices((all) => all.map((c, n) => (n === i ? { ...c, ...change } : c)))
  const answers = questions.map((q, i) => answerOf(choices[i], q.multiSelect))
  const complete = answers.every((a) => a !== '')

  const submit = () => {
    if (!complete) return
    onAnswer({ allow: true, answers: Object.fromEntries(questions.map((q, i) => [q.question, answers[i]])) })
  }

  return (
    <form className={styles.questionForm} aria-label="Questions from the agent" onSubmit={(e) => { e.preventDefault(); submit() }}>
      {questions.map((q, i) => {
        const c = choices[i]
        const type = q.multiSelect ? 'checkbox' : 'radio'
        const pick = (label: string, on: boolean) =>
          set(i, q.multiSelect ? { picked: on ? [...c.picked, label] : c.picked.filter((p) => p !== label) } : { picked: [label], otherOn: false })
        return (
          <fieldset key={q.question} className={styles.question}>
            <legend>
              {q.header && <span className={styles.questionHeader}>{q.header}</span>} {q.question}
            </legend>
            {q.options.map((o) => (
              <label key={o.label} className={styles.option}>
                <input type={type} name={`q${i}`} checked={c.picked.includes(o.label)} onChange={(e) => pick(o.label, e.target.checked)} />
                <span>
                  <strong>{o.label}</strong>
                  {o.description && <span className={styles.note}> – {o.description}</span>}
                </span>
              </label>
            ))}
            <label className={styles.option}>
              <input
                type={type}
                name={`q${i}`}
                checked={c.otherOn}
                onChange={(e) => set(i, q.multiSelect ? { otherOn: e.target.checked } : { otherOn: e.target.checked, picked: [] })}
              />
              <span>{OTHER}</span>
            </label>
            {c.otherOn && (
              <TextInput block size="small" aria-label={`Your answer to: ${q.question}`} placeholder="Your answer" value={c.other} onChange={(e) => set(i, { other: e.target.value })} />
            )}
          </fieldset>
        )
      })}
      <div className={styles.actions}>
        <span className={styles.note}>The agent waits for your answer</span>
        <span className={styles.spacer} />
        <Button size="small" type="submit" variant="primary" disabled={busy || !complete}>
          Submit answers
        </Button>
        <Button size="small" disabled={busy} onClick={() => onAnswer({ allow: false })}>
          Skip
        </Button>
      </div>
    </form>
  )
}

/** The plan the agent wants to carry out (ExitPlanMode): approve it with a permission mode, or send it back with a note. */
export function PlanApproval({ input, busy, onAnswer }: FormProps) {
  const [note, setNote] = useState('')
  const plan = planText(input)
  return (
    <div className={styles.questionForm} role="group" aria-label="Plan approval">
      {plan && (
        <div className={`${styles.plan} ${prose.prose}`}>
          <Markdown remarkPlugins={remarkMarkdown} rehypePlugins={rehypeCode} components={codeComponents}>{plan}</Markdown>
        </div>
      )}
      <Textarea block rows={2} aria-label="Note for the agent" placeholder="What should change? (only for “Keep planning”)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className={styles.actions}>
        <span className={styles.note}>Start with this plan?</span>
        <span className={styles.spacer} />
        <Button size="small" variant="primary" disabled={busy} onClick={() => onAnswer({ allow: true, mode: 'acceptEdits' })}>
          Yes, accept edits
        </Button>
        <Button size="small" disabled={busy} onClick={() => onAnswer({ allow: true, mode: 'default' })}>
          Yes, ask before edits
        </Button>
        <Button size="small" variant="danger" disabled={busy} onClick={() => onAnswer({ allow: false, ...(note.trim() ? { message: note.trim() } : {}) })}>
          Keep planning
        </Button>
      </div>
    </div>
  )
}
