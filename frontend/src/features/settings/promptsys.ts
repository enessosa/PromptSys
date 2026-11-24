/** Bridge of the Electron preload script; absent in the browser. */
export type PromptSysBridge = {
  isDesktop?: boolean
  platform?: string
  openSettings?: () => Promise<void> | unknown
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
