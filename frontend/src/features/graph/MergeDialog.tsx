import { useState } from 'react'
import { Dialog, FormControl, Select, Spinner, Textarea, TextInput } from '@primer/react'
import { ApiError } from '../../api/client.ts'
import { makeTab, useWorkspace } from '../../state/workspace.ts'
import { useCards } from '../cards/hooks.ts'
import { cardLabel } from '../cards/model.ts'
import { useMerge, useMergePreview } from './hooks.ts'
import styles from './graph.module.css'

type Props = {
  /** Selected cards; the first one is the default surviving card. */
  cardIds: number[]
  onClose: () => void
}

export function MergeDialog({ cardIds, onClose }: Props) {
  const { data: cards } = useCards()
  const [targetId, setTargetId] = useState(cardIds[0])
  const sourceIds = cardIds.filter((id) => id !== targetId)
  const preview = useMergePreview(targetId, sourceIds)
  const merge = useMerge()
  const closeTab = useWorkspace((s) => s.closeTab)
  const openTab = useWorkspace((s) => s.openTab)
  const setLastMerge = useWorkspace((s) => s.setLastMerge)

  // Edits belong to one proposal; choosing another survivor loads a new proposal.
  const proposalKey = `${targetId}:${sourceIds.join(',')}`
  const [edit, setEdit] = useState<{ key: string; title: string; body: string } | null>(null)
  const current = edit?.key === proposalKey ? edit : null
  const title = current?.title ?? preview.data?.title ?? ''
  const body = current?.body ?? preview.data?.body ?? ''

  const titleOf = (id: number) => cards?.find((c) => c.id === id)?.title ?? ''
  const canConfirm = !!preview.data && title.trim() !== '' && !merge.isPending

  const confirm = () => {
    merge.mutate(
      { targetId, sourceIds, title: title.trim(), body },
      {
        onSuccess: (result) => {
          setLastMerge(result)
          sourceIds.forEach((id) => closeTab(makeTab('card', id).id))
          openTab(makeTab('card', targetId))
          onClose()
        },
      },
    )
  }

  const error = (preview.error ?? merge.error) as Error | null

  return (
    <Dialog
      title={`Merge ${cardIds.length} cards`}
      width="large"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: merge.isPending ? 'Merging…' : 'Merge', buttonType: 'primary', onClick: confirm, disabled: !canConfirm },
      ]}
    >
      <div className={styles.mergeForm}>
        <FormControl>
          <FormControl.Label>Surviving card</FormControl.Label>
          <Select block value={String(targetId)} onChange={(e) => setTargetId(Number(e.target.value))}>
            {cardIds.map((id) => (
              <Select.Option key={id} value={String(id)}>
                {cardLabel(id)} {titleOf(id)}
              </Select.Option>
            ))}
          </Select>
        </FormControl>

        {preview.isPending ? (
          <Spinner size="small" />
        ) : (
          <>
            <FormControl>
              <FormControl.Label>Merged title</FormControl.Label>
              <TextInput
                block
                value={title}
                disabled={!preview.data}
                onChange={(e) => setEdit({ key: proposalKey, title: e.target.value, body })}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>Merged text</FormControl.Label>
              <Textarea
                block
                rows={12}
                value={body}
                disabled={!preview.data}
                onChange={(e) => setEdit({ key: proposalKey, title, body: e.target.value })}
              />
            </FormControl>
            {preview.data && (
              <p className={styles.mutedText}>
                {preview.data.linkCount} {preview.data.linkCount === 1 ? 'link' : 'links'} will be moved to{' '}
                {cardLabel(targetId)}. {sourceIds.map(cardLabel).join(', ')} will be archived; you can undo the merge afterwards.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className={styles.errorText}>
            {error instanceof ApiError && error.status === 404 && !error.code.endsWith('_not_found')
              ? 'Merging is not available on this backend yet.'
              : error.message}
          </p>
        )}
      </div>
    </Dialog>
  )
}
