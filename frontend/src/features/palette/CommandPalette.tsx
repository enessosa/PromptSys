import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { useQuery } from '@tanstack/react-query'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { searchEverything, useCards } from '../cards/hooks.ts'
import { cardLabel } from '../cards/model.ts'
import { filterCommands, formatShortcut, type PaletteCommand } from './commands.ts'
import styles from './palette.module.css'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const open = useWorkspace((s) => s.paletteOpen)
  const setOpen = useWorkspace((s) => s.setPaletteOpen)
  if (!open) return null
  return <PaletteBody commands={commands} onClose={() => setOpen(false)} />
}

export function PaletteBody({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 150)
  const openTab = useWorkspace((s) => s.openTab)
  const modifier = useRef(false)

  const recent = useCards()
  const search = useQuery({
    queryKey: ['palette-search', debounced],
    queryFn: ({ signal }) => searchEverything(debounced, signal),
    enabled: debounced !== '',
  })

  const shownCommands = useMemo(() => filterCommands(commands, query), [commands, query])
  const cards = debounced ? (search.data?.cards ?? []) : (recent.data ?? []).slice(0, 8)
  const conversations = debounced ? (search.data?.conversations ?? []) : []

  const pane = () => (modifier.current ? 1 : undefined)
  const done = (fn: () => void) => {
    onClose()
    fn()
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <Command
          shouldFilter={false}
          label="Command palette"
          loop
          onKeyDownCapture={(e) => {
            modifier.current = e.key === 'Enter' && (e.metaKey || e.ctrlKey)
            if (e.key === 'Escape') onClose()
          }}
        >
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search cards, conversations and commands…"
            className={styles.input}
          />
          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>
              {search.isFetching ? 'Searching…' : 'Nothing found.'}
            </Command.Empty>
            {shownCommands.length > 0 && (
              <Command.Group heading="Commands">
                {shownCommands.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`cmd:${c.id}`}
                    className={styles.item}
                    onSelect={() => done(() => c.run({ secondPane: modifier.current }))}
                  >
                    {c.title}
                    {c.shortcut && <kbd>{formatShortcut(c.shortcut)}</kbd>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {cards.length > 0 && (
              <Command.Group heading={debounced ? 'Cards' : 'Recent cards'}>
                {cards.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`card:${c.id}`}
                    className={styles.item}
                    onSelect={() => done(() => openTab(makeTab('card', c.id), { pane: pane() }))}
                  >
                    <span className={styles.id}>{cardLabel(c.id)}</span>
                    {c.title}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {conversations.length > 0 && (
              <Command.Group heading="Conversations">
                {conversations.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`chat:${c.id}`}
                    className={styles.item}
                    onSelect={() => done(() => openTab(makeTab('chat', c.id), { pane: pane() }))}
                  >
                    {c.title}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className={styles.hint}>Enter opens · {formatShortcut('Mod+')}Enter opens in second pane · Esc closes</div>
        </Command>
      </div>
    </div>
  )
}
