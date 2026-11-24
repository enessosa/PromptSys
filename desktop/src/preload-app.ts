// Preload of the main window (sandboxed: only `electron` can be required here). Exposes a tiny, fixed API to the frontend.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('promptsys', {
  /** True inside the desktop app; lets the frontend show desktop-only UI. */
  isDesktop: true,
  platform: process.platform,
  /** Opens the settings window (API key). */
  openSettings: (): Promise<void> => ipcRenderer.invoke('app:open-settings'),
})
