import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@primer/react'
import type { DerivedRule } from '../../api/types.ts'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { rulesAskedKey, rulesWarningKey, useDecideRule, useRules, useSaveRuleAsCard } from './hooks.ts'
import { sourceLabel } from './model.ts'
import styles from './rules.module.css'

type Props = {
  conversationId: number
  /** Only the rules of this answer; undefined = all rules of the conversation. */
  messageId?: number
}

/** FR-15/FR-16: rules the model reported for an answer, with confirm / correct / reject / save as card. */
export function RulesPanel({ conversationId, messageId }: Props) {
  const rules = useRules(conversationId)
  const decide = useDecideRule(conversationId)
  const saveCard = useSaveRuleAsCard(conversationId)
  // Both values are written by the extraction (cache only, never fetched).
  const warning = useQuery<string | null>({ queryKey: rulesWarningKey(messageId ?? 0), queryFn: () => null, enabled: false })
  const askedQuery = useQuery<boolean>({ queryKey: rulesAskedKey(messageId ?? 0), queryFn: () => false, enabled: false })
  const asked = askedQuery.data === true
  const shown = (rules.data ?? []).filter((r) => messageId === undefined || r.messageId === messageId)
  const error = decide.error ?? saveCard.error

  return (
    <section className={styles.panel} aria-label="Derived rules">
      <h4>Derived rules <span className={styles.claimed}>reported by the model, not measured</span></h4>
      {rules.isPending && <p className={styles.muted}>Loading rules…</p>}
      {rules.isError && <p role="alert">{rules.error.message}</p>}
      {warning.data && (
        <p className={styles.warning} role="alert">
          {warning.data}
        </p>
      )}
      {rules.data && shown.length === 0 && (
        <p className={styles.muted}>{messageId !== undefined && !asked ? 'No rules requested for this answer yet.' : 'The model stated no rules for this answer.'}</p>
      )}
      {error && <p role="alert">{error.message}</p>}
      <ul>
        {shown.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            busy={decide.isPending || saveCard.isPending}
            onConfirm={() => decide.mutate({ id: r.id, patch: { status: 'confirmed' } })}
            onReject={() => decide.mutate({ id: r.id, patch: { status: 'rejected' } })}
            onCorrect={(text) => decide.mutate({ id: r.id, patch: { status: 'corrected', text } })}
            onSaveCard={() => saveCard.mutate(r.id)}
          />
        ))}
      </ul>
    </section>
  )
}

type RowProps = {
  rule: DerivedRule
  busy: boolean
  onConfirm: () => void
  onReject: () => void
  onCorrect: (text: string) => void
  onSaveCard: () => void
}

export function RuleRow({ rule, busy, onConfirm, onReject, onCorrect, onSaveCard }: RowProps) {
  const openTab = useWorkspace((s) => s.openTab)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(rule.text)
  const decided = rule.status === 'corrected' || rule.status === 'rejected'
  return (
    <li className={styles.rule} data-status={rule.status}>
      {editing ? (
        <>
          <textarea aria-label="Corrected rule" value={text} rows={3} onChange={(e) => setText(e.target.value)} />
          <div className={styles.actions}>
            <Button
              size="small"
              variant="primary"
              disabled={busy || text.trim() === ''}
              onClick={() => {
                onCorrect(text.trim())
                setEditing(false)
              }}
            >
              Save as rule card
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.text}>{rule.text}</p>
          <p className={styles.meta}>
            <span>{sourceLabel(rule)}</span>
            <span className={styles.status}>{rule.status}</span>
            {rule.cardId !== null && (
              <button type="button" className={styles.link} onClick={() => openTab(makeTab('card', rule.cardId!))}>
                {rule.status === 'corrected' ? 'Rule card' : 'Card'} {cardLabel(rule.cardId)}
              </button>
            )}
          </p>
          {!decided && (
            <div className={styles.actions}>
              {rule.status !== 'confirmed' && (
                <Button size="small" disabled={busy} onClick={onConfirm}>
                  Confirm
                </Button>
              )}
              <Button size="small" disabled={busy} onClick={() => { setText(rule.text); setEditing(true) }}>
                Correct
              </Button>
              <Button size="small" variant="danger" disabled={busy} onClick={onReject}>
                Reject
              </Button>
              {rule.status === 'confirmed' && rule.cardId === null && (
                <Button size="small" disabled={busy} onClick={onSaveCard}>
                  Save as card
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  )
}
