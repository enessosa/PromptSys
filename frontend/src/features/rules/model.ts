import type { DerivedRule } from '../../api/types.ts'
import { cardLabel } from '../cards/model.ts'

/** FR-15: the source is the model's own report, so it is always labelled "claimed". */
export function sourceLabel(rule: Pick<DerivedRule, 'source'>): string {
  return rule.source.kind === 'card' && rule.source.cardId !== null
    ? `card ${cardLabel(rule.source.cardId)} (claimed)`
    : 'prior knowledge (claimed)'
}

export const STATUS_TEXT: Record<DerivedRule['status'], string> = {
  proposed: 'proposed',
  confirmed: 'confirmed',
  corrected: 'corrected',
  rejected: 'rejected',
}
