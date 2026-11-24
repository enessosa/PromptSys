import type { AgentEntry } from './model.ts'
import { AgentsPanel } from './AgentsPanel.tsx'
import { CardsPanel } from './CardsPanel.tsx'
import styles from './code.module.css'

export type SideTab = 'cards' | 'agents'

/** Right-hand side panel with the tabs "Cards" and "Agents" (badge: running agents). */
export function SidePanel({ sessionId, tab, onTab, agents, expanded, onToggle }: { sessionId: number; tab: SideTab; onTab: (tab: SideTab) => void; agents: AgentEntry[]; expanded: string | null; onToggle: (id: string) => void }) {
  const running = agents.filter((a) => a.status === 'running').length
  return (
    <div className={styles.sideWrap}>
      <div role="tablist" aria-label="Side panel" className={styles.sideTabs}>
        <button type="button" role="tab" aria-selected={tab === 'cards'} onClick={() => onTab('cards')}>
          Cards
        </button>
        <button type="button" role="tab" aria-selected={tab === 'agents'} onClick={() => onTab('agents')}>
          Agents
          {running > 0 && <span className={styles.tabBadge} aria-label={`${running} running`}>{running}</span>}
        </button>
      </div>
      {tab === 'cards' ? <CardsPanel sessionId={sessionId} /> : <AgentsPanel agents={agents} expanded={expanded} onToggle={onToggle} />}
    </div>
  )
}
