/** Bridge of the Electron preload script; absent in the browser. */
export type PromptSysBridge = {
  isDesktop?: boolean
  platform?: string
  openSettings?: () => Promise<void> | unknown
  chooseFolder?: () => Promise<string | null>
}

declare global {
  interface Window {
    promptsys?: PromptSysBridge
  }
}

/** The "Claude API key…" action of the desktop app, or null when running in a browser. */
export function desktopApiKeyAction(): (() => unknown) | null {
  const bridge = typeof window === 'undefined' ? undefined : window.promptsys
  if (!bridge?.isDesktop || typeof bridge.openSettings !== 'function') return null
  return () => window.promptsys?.openSettings?.()
}

/** Native folder picker of the desktop app, or null in a browser (there the path is typed in). */
export function desktopFolderPicker(): (() => Promise<string | null>) | null {
  const bridge = typeof window === 'undefined' ? undefined : window.promptsys
  if (!bridge?.isDesktop || typeof bridge.chooseFolder !== 'function') return null
  return () => window.promptsys?.chooseFolder?.() ?? Promise.resolve(null)
}
