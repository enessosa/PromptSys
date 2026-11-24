import { useState } from 'react'
import { Button } from '@primer/react'
import { Toast } from '../../components/Toast.tsx'
import { useWorkspace } from '../../state/workspace.ts'
import { cardLabel } from '../cards/model.ts'
import { useUndoMerge } from './hooks.ts'
import { undoErrorMessage } from './undoError.ts'

/** Toast after a merge with Undo; undo reverts the whole merge operation (any merge id works). */
export function MergeToast() {
  const lastMerge = useWorkspace((s) => s.lastMerge)
  const setLastMerge = useWorkspace((s) => s.setLastMerge)
  const [message, setMessage] = useState<string | null>(null)
  const undo = useUndoMerge()

  if (message) return <Toast onClose={() => setMessage(null)} duration={5000}>{message}</Toast>
  if (!lastMerge) return null
  const sources = lastMerge.merges.map((m) => cardLabel(m.sourceId)).join(', ')
  return (
    <Toast onClose={() => setLastMerge(null)}>
      <span>
        Merged {sources} into {cardLabel(lastMerge.target.id)}.
      </span>
      <Button
        size="small"
        disabled={undo.isPending}
        onClick={() =>
          undo.mutate(lastMerge.merges[0].id, {
            onSuccess: () => {
              setLastMerge(null)
              setMessage('Merge undone')
            },
            onError: (e) => {
              setLastMerge(null)
              setMessage(undoErrorMessage(e))
            },
          })
        }
      >
        Undo
      </Button>
    </Toast>
  )
}
