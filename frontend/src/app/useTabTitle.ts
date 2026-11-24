import { useCard, useConversations } from '../features/cards/hooks.ts'
import { cardLabel } from '../features/cards/model.ts'
import type { Tab } from '../state/workspace.ts'

export function useTabTitle(tab: Tab): string {
  const card = useCard(tab.type === 'card' ? tab.refId : undefined)
  const conversations = useConversations()
  if (tab.type === 'graph') return 'Graph'
  if (tab.type === 'settings') return 'Settings'
  if (tab.type === 'branches') return `Branches · ${conversations.data?.find((c) => c.id === tab.refId)?.title ?? `Chat ${tab.refId}`}`
  if (tab.type === 'card') return card.data ? `${cardLabel(tab.refId!)} ${card.data.title}` : cardLabel(tab.refId!)
  return conversations.data?.find((c) => c.id === tab.refId)?.title ?? `Chat ${tab.refId}`
}
