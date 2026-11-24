import type { Settings } from '../../api/types.ts'
import { isHexColor } from './accent.ts'

export type SettingsForm = { defaultModel: string; ablationRuns: string; baselineRuns: string; ablationTemperature: string; accentColor: string | null }

/** The part of the settings the form saves; mode and code auth are changed directly. */
export type SettingsValue = Omit<Settings, 'mode' | 'codeAuth'>

export const toForm = (s: Settings): SettingsForm => ({
  defaultModel: s.defaultModel ?? '',
  ablationRuns: String(s.ablationRuns),
  baselineRuns: String(s.baselineRuns),
  ablationTemperature: String(s.ablationTemperature),
  accentColor: s.accentColor,
})

function inRange(text: string, min: number, max: number, integer: boolean): number | null {
  if (text.trim() === '') return null
  const n = Number(text)
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return null
  return n
}

/** Validates the form; returns the request body or the field errors. */
export function parseSettingsForm(f: SettingsForm): { value: SettingsValue } | { errors: Partial<Record<keyof SettingsForm, string>> } {
  const errors: Partial<Record<keyof SettingsForm, string>> = {}
  const ablationRuns = inRange(f.ablationRuns, 1, 10, true)
  const baselineRuns = inRange(f.baselineRuns, 0, 10, true)
  const ablationTemperature = inRange(f.ablationTemperature, 0, 1, false)
  if (ablationRuns === null) errors.ablationRuns = 'A whole number from 1 to 10.'
  if (baselineRuns === null) errors.baselineRuns = 'A whole number from 0 to 10.'
  if (ablationTemperature === null) errors.ablationTemperature = 'A number from 0 to 1.'
  if (f.accentColor !== null && !isHexColor(f.accentColor)) errors.accentColor = 'Use the form #rrggbb.'
  if (ablationRuns === null || baselineRuns === null || ablationTemperature === null || errors.accentColor) return { errors }
  return {
    value: { defaultModel: f.defaultModel.trim() || null, ablationRuns, baselineRuns, ablationTemperature, accentColor: f.accentColor },
  }
}

