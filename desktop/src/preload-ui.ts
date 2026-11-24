// Preload of our own pages (settings, error). Sandboxed: only `electron` can be required here.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('promptsysUi', {
  getStatus: (): Promise<unknown> => ipcRenderer.invoke('settings:status'),
  saveKey: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:save-key', key),
  clearKey: (): Promise<unknown> => ipcRenderer.invoke('settings:clear-key'),
  openLog: (): Promise<void> => ipcRenderer.invoke('error:open-log'),
  retry: (): Promise<void> => ipcRenderer.invoke('error:retry'),
  quit: (): Promise<void> => ipcRenderer.invoke('error:quit'),
})
