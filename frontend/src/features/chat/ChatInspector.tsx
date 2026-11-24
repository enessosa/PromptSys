import { useState } from 'react'
import { Button } from '@primer/react'
import { HoverCard } from '../../components/HoverCard.tsx'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { RulesPanel } from '../rules/RulesPanel.tsx'
import { useAblations } from '../ablation/hooks.ts'
import { badgeText } from '../ablation/model.ts'
import { CardPreview } from '../cards/CardPreview.tsx'
import { cardLabel, KIND_COLORS } from '../cards/model.ts'
import { useConversation, useTimelineMessages } from './hooks.ts'
import styles from './chat.module.css'

/** Inspector of a chat tab: the cards of the selected answer (default: the latest) with used / not used marks. */
export function ChatInspector({ conversationId }: { conversationId: number }) {
  const [tab, setTab] = useState<'cards' | 'rules'>('cards')
  const answerId = useSelectedAnswerId(conversationId)
  return (
    <>
      <div className={styles.inspTabs} role="tablist" aria-label="Inspector sections">
        <button type="button" role="tab" aria-selected={tab === 'cards'} data-active={tab === 'cards'} onClick={() => setTab('cards')}>
          Cards
        </button>
        <button type="button" role="tab" aria-selected={tab === 'rules'} data-active={tab === 'rules'} onClick={() => setTab('rules')}>
          Rules
        </button>
      </div>
      {tab === 'cards' ? <CardsSection conversationId={conversationId} /> : <RulesPanel conversationId={conversationId} messageId={answerId ?? undefined} />}
    </>
  )
}

function useSelectedAnswerId(conversationId: number): number | null {
  const conversation = useConversation(conversationId)
  const messages = useTimelineMessages(conversation.data?.activeTimelineId)
  const selectedId = useWorkspace((s) => s.selectedMessageId)
  const answers = (messages.data ?? []).filter((m) => m.role === 'assistant')
  return (answers.find((m) => m.id === selectedId) ?? answers[answers.length - 1])?.id ?? null
}

function CardsSection({ conversationId }: { conversationId: number }) {
  const conversation = useConversation(conversationId)
  const messages = useTimelineMessages(conversation.data?.activeTimelineId)
  const selectedId = useWorkspace((s) => s.selectedMessageId)
  const openTab = useWorkspace((s) => s.openTab)
  const openWhy = useWorkspace((s) => s.openWhy)
  const all = messages.data ?? []
  const answers = all.filter((m) => m.role === 'assistant')
  const answer = answers.find((m) => m.id === selectedId) ?? answers[answers.length - 1]
  if (!answer) return <p>No answer yet. The cards of the selected answer appear here.</p>
  const turn = all.find((m) => m.id === answer.parentId)
  const sent = turn?.context ?? []
  const used = new Set(answer.usedCardIds)
  const unused = new Set(answer.unusedCardIds)
  const whyCards = sent.filter((c) => c.state !== 'excluded').map((c) => ({ cardId: c.cardId, title: c.title }))
  return (
    <>
      <h3>Cards of this answer</h3>
      {sent.length === 0 && <p>No cards were sent with this question.</p>}
      {sent.map((c) => {
        const mark = c.state === 'excluded' ? 'excluded' : used.has(c.cardId) ? 'used' : unused.has(c.cardId) ? 'not used' : 'sent'
        return (
          <div key={c.cardId} className={styles.inspCard}>
            <HoverCard content={<CardPreview id={c.cardId} />}>
              <button type="button" className={styles.pickerRow} onClick={() => openTab(makeTab('card', c.cardId))}>
                <span className={styles.dot} style={{ background: KIND_COLORS[c.kind] }} />
                <span className={styles.ctxId}>{cardLabel(c.cardId)}</span>
                <span className={styles.ctxTitle}>{c.title}</span>
                <span className={styles.mark} data-kind={mark === 'used' ? 'used' : undefined}>
                  {mark}
                </span>
              </button>
            </HoverCard>
            {c.state !== 'excluded' && answer.status === 'complete' && (
              <>
                <InspectorScore messageId={answer.id} cardId={c.cardId} />
                <Button size="small" variant="invisible" aria-label={`Why ${cardLabel(c.cardId)}?`} onClick={() => openWhy({ messageId: answer.id, answerText: answer.content, cards: whyCards, cardId: c.cardId })}>
                  Why?
                </Button>
              </>
            )}
          </div>
        )
      })}
      {answer.invalidMarkers.length > 0 && <p>Not in the prompt: {answer.invalidMarkers.join(', ')}</p>}
    </>
  )
}

function InspectorScore({ messageId, cardId }: { messageId: number; cardId: number }) {
  const result = useAblations(messageId).data?.cards.find((r) => r.cardId === cardId)
  return result ? <span className={styles.mark} data-kind={result.label === 'strong' ? 'used' : undefined}>{badgeText(result)}</span> : null
}
