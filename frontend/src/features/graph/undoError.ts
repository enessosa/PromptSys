import { ApiError } from '../../api/client.ts'

export function undoErrorMessage(e: Error): string {
  if (e instanceof ApiError && e.code === 'merge_outdated') return 'Card changed after the merge – undo not possible'
  if (e instanceof ApiError && e.code === 'merge_already_undone') return 'This merge was already undone'
  return e.message
}
