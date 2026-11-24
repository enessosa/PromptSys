type SettingsStatus = { available: boolean; hasKey: boolean; backendRunning: boolean }
type SaveResult = { ok: true } | { ok: false; error: string }

interface Window {
  promptsysUi: {
    getStatus(): Promise<SettingsStatus>
    saveKey(key: string): Promise<SaveResult>
    clearKey(): Promise<SaveResult>
    openLog(): Promise<void>
    retry(): Promise<void>
    quit(): Promise<void>
  }
}
