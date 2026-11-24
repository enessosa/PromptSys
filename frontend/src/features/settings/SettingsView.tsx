import { useEffect, useState, type FormEvent } from 'react'
import { Button, FormControl, TextInput } from '@primer/react'
import type { Settings } from '../../api/types.ts'
import { EmptyState } from '../../components/EmptyState.tsx'
import { useHealth } from '../chat/hooks.ts'
import { applyAccent } from './accent.ts'
import { parseSettingsForm, toForm, type SettingsForm } from './settingsForm.ts'
import { useSaveSettings, useSettings } from './hooks.ts'
import { ApiKeyButton } from './ApiKeyButton.tsx'
import { desktopApiKeyAction } from './promptsys.ts'
import styles from './settings.module.css'

export function SettingsView() {
  const settings = useSettings()
  if (settings.isPending) return <EmptyState title="Loading settings…" />
  if (settings.isError) return <EmptyState title="Settings could not be loaded">{settings.error.message}</EmptyState>
  return <SettingsForm saved={settings.data} />
}

function SettingsForm({ saved }: { saved: Settings }) {
  const save = useSaveSettings()
  const health = useHealth()
  const [form, setForm] = useState<SettingsForm>(() => toForm(saved))
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsForm, string>>>({})
  const [done, setDone] = useState(false)
  const keyAction = desktopApiKeyAction()
  const set = (patch: Partial<SettingsForm>) => {
    setDone(false)
    setForm((f) => ({ ...f, ...patch }))
  }

  // Leaving the page without saving drops the colour preview.
  useEffect(() => () => applyAccent(saved.accentColor), [saved.accentColor])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseSettingsForm(form)
    if ('errors' in parsed) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    save.mutate(parsed.value, { onSuccess: () => setDone(true) })
  }

  return (
    <form className={styles.settings} noValidate onSubmit={submit} aria-label="Settings">
      <h2>Settings</h2>

      <section>
        <h3>API key</h3>
        <p className={styles.muted}>{health.data ? (health.data.apiKeyConfigured ? 'An API key is configured.' : 'No API key configured.') : 'Checking the API key…'}</p>
        {keyAction ? (
          <ApiKeyButton variant={health.data?.apiKeyConfigured === false ? 'primary' : 'default'} />
        ) : (
          <p className={styles.muted}>Set ANTHROPIC_API_KEY in backend/.env and restart the backend. The key is never stored in the app database.</p>
        )}
      </section>

      <section>
        <h3>Model</h3>
        <FormControl>
          <FormControl.Label>Default model</FormControl.Label>
          <TextInput block value={form.defaultModel} placeholder="Empty = backend default" onChange={(e) => set({ defaultModel: e.target.value })} />
          <FormControl.Caption>Used by new conversations that have no model of their own.</FormControl.Caption>
        </FormControl>
      </section>

      <section>
        <h3>Ablation</h3>
        <div className={styles.row}>
          <FormControl required>
            <FormControl.Label>Runs per card (n)</FormControl.Label>
            <TextInput type="number" min={1} max={10} value={form.ablationRuns} onChange={(e) => set({ ablationRuns: e.target.value })} validationStatus={errors.ablationRuns ? 'error' : undefined} />
            {errors.ablationRuns && <FormControl.Validation variant="error">{errors.ablationRuns}</FormControl.Validation>}
          </FormControl>
          <FormControl required>
            <FormControl.Label>Baseline runs (k)</FormControl.Label>
            <TextInput type="number" min={0} max={10} value={form.baselineRuns} onChange={(e) => set({ baselineRuns: e.target.value })} validationStatus={errors.baselineRuns ? 'error' : undefined} />
            {errors.baselineRuns && <FormControl.Validation variant="error">{errors.baselineRuns}</FormControl.Validation>}
          </FormControl>
          <FormControl required>
            <FormControl.Label>Temperature</FormControl.Label>
            <TextInput type="number" step={0.05} min={0} max={1} value={form.ablationTemperature} onChange={(e) => set({ ablationTemperature: e.target.value })} validationStatus={errors.ablationTemperature ? 'error' : undefined} />
            {errors.ablationTemperature && <FormControl.Validation variant="error">{errors.ablationTemperature}</FormControl.Validation>}
          </FormControl>
        </div>
        <p className={styles.muted}>An ablation costs k + n × cards API calls; you see the number before anything is sent.</p>
      </section>

      <section>
        <h3>Appearance</h3>
        <div className={styles.row}>
          <label className={styles.color}>
            <span>Accent colour</span>
            <input
              type="color"
              aria-label="Accent colour"
              value={form.accentColor ?? '#5eb5a6'}
              onChange={(e) => {
                set({ accentColor: e.target.value })
                applyAccent(e.target.value)
              }}
            />
          </label>
          <Button
            type="button"
            size="small"
            disabled={form.accentColor === null}
            onClick={() => {
              set({ accentColor: null })
              applyAccent(null)
            }}
          >
            Reset to default
          </Button>
        </div>
        {errors.accentColor && <p role="alert">{errors.accentColor}</p>}
      </section>

      {save.isError && <p role="alert">{save.error.message}</p>}
      <div className={styles.row}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Save
        </Button>
        {done && <span role="status">Saved.</span>}
      </div>
    </form>
  )
}
