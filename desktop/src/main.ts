import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createBackendProcess } from './backend'
import { waitForHealth } from './health'
import { createKeyStore, isPlausibleApiKey, KeyStoreUnavailableError, normalizeApiKey } from './keystore'
import { createLogger } from './logger'
import { backupBeforeMigrate } from './migrations'
import { isAllowedRequest, isAppUrl, isExternalHttpUrl, originOf } from './navigation'
import { backendEnv, dataPaths, resourcePaths } from './paths'
import { pickPort } from './ports'

const isDev = !app.isPackaged
const repoRoot = join(__dirname, '..', '..')
const resources = resourcePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot })
const data = dataPaths(app.getPath('userData'))
const log = createLogger(data.mainLog, 'main')
const backendLog = createLogger(data.backendLog)
const keyStore = createKeyStore(safeStorage, data.apiKeyFile)

let port = 0
let mainWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let errorWindow: BrowserWindow | undefined
let quitting = false
let restarting = false

const backend = createBackendProcess({
  entry: resources.backendEntry,
  log: backendLog,
  onUnexpectedExit: (code) => {
    if (quitting || restarting) return
    showError(`The backend stopped unexpectedly (exit code ${code ?? 'unknown'}).`)
  },
})

const healthUrl = () => `${originOf(port)}/api/health`
const outDir = (...parts: string[]) => join(__dirname, ...parts)

/** Backs up the database if migrations are pending, then starts the backend and waits until it answers. Throws with a readable message. */
async function startBackend(): Promise<void> {
  const backup = backupBeforeMigrate(data.dbFile, resources.migrationsDir)
  if (backup) log.line(`database backed up to ${backup} before applying new migrations`)
  if (port === 0) port = await pickPort()
  backend.start(backendEnv({ port, paths: data, frontendDist: resources.frontendDist, apiKey: keyStore.get(), parentEnv: process.env }))
  const healthy = await waitForHealth({ url: healthUrl(), isAlive: backend.isAlive })
  if (!healthy) {
    await backend.stop()
    throw new Error('The backend did not become ready.')
  }
  log.line(`backend ready on ${originOf(port)}`)
}

async function restartBackend(): Promise<void> {
  restarting = true
  try {
    await backend.stop()
    await startBackend()
    mainWindow?.loadURL(originOf(port))
  } finally {
    restarting = false
  }
}

/** Opens the main window on the backend origin and locks it to that origin. */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1c1d21',
    webPreferences: {
      preload: outDir('preload-app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const win = mainWindow
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, port)) return
    event.preventDefault()
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url) && !isAppUrl(url, port)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (_e, code, description, url) => log.line(`load failed (${code} ${description}) ${url}`))
  void win.loadURL(originOf(port))
}

/** A small window for our own local pages (settings, error); no navigation, no new windows. */
function createUiWindow(page: string, options: { query?: Record<string, string>; parent?: BrowserWindow; width: number; height: number; title: string }): BrowserWindow {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: options.title,
    parent: options.parent,
    backgroundColor: '#1c1d21',
    webPreferences: {
      preload: outDir('preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadFile(outDir('renderer', page), { query: options.query })
  return win
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = createUiWindow('settings.html', { width: 520, height: 400, title: 'PromptSys Settings', parent: mainWindow })
  settingsWindow.on('closed', () => (settingsWindow = undefined))
}

function showError(message: string): void {
  log.line(`error: ${message}`)
  mainWindow?.close()
  settingsWindow?.close()
  if (errorWindow && !errorWindow.isDestroyed()) errorWindow.close()
  errorWindow = createUiWindow('error.html', { width: 560, height: 340, title: 'PromptSys', query: { message, log: data.backendLog } })
  errorWindow.on('closed', () => (errorWindow = undefined))
}

/** IPC from our own pages only: checks which window the call came from. */
const fromWindow = (event: IpcMainInvokeEvent, win: BrowserWindow | undefined): boolean =>
  win !== undefined && !win.isDestroyed() && event.sender === win.webContents

function registerIpc(): void {
  ipcMain.handle('app:open-settings', (event) => {
    if (!fromWindow(event, mainWindow) || !isAppUrl(event.senderFrame?.url ?? '', port)) return
    openSettings()
  })
  ipcMain.handle('app:choose-folder', async (event) => {
    if (!fromWindow(event, mainWindow) || !isAppUrl(event.senderFrame?.url ?? '', port) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose project folder', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('settings:status', (event) => {
    if (!fromWindow(event, settingsWindow)) throw new Error('forbidden')
    return { available: keyStore.isAvailable(), hasKey: keyStore.has(), backendRunning: backend.isAlive() }
  })
  ipcMain.handle('settings:save-key', async (event, raw: unknown) => {
    if (!fromWindow(event, settingsWindow)) throw new Error('forbidden')
    const key = normalizeApiKey(typeof raw === 'string' ? raw : '')
    if (!isPlausibleApiKey(key)) return { ok: false, error: 'This does not look like an API key.' }
    try {
      keyStore.set(key)
    } catch (err) {
      return { ok: false, error: err instanceof KeyStoreUnavailableError ? err.message : 'Could not store the key.' }
    }
    return restartAfterKeyChange()
  })
  ipcMain.handle('settings:clear-key', async (event) => {
    if (!fromWindow(event, settingsWindow)) throw new Error('forbidden')
    keyStore.clear()
    return restartAfterKeyChange()
  })
  ipcMain.handle('error:open-log', (event) => {
    if (fromWindow(event, errorWindow)) shell.showItemInFolder(data.backendLog)
  })
  ipcMain.handle('error:retry', async (event) => {
    if (!fromWindow(event, errorWindow)) return
    try {
      await backend.stop()
      await startBackend()
      createMainWindow()
      errorWindow?.close() // only after the main window exists, or "all windows closed" would quit the app
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle('error:quit', (event) => {
    if (fromWindow(event, errorWindow)) app.quit()
  })
}

async function restartAfterKeyChange(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await restartBackend()
    return { ok: true }
  } catch (err) {
    log.line(`restart failed: ${err instanceof Error ? err.message : String(err)}`)
    showError('The backend could not be restarted after the key change.')
    return { ok: false, error: 'The backend could not be restarted.' }
  }
}

function buildMenu(): void {
  const settingsItem: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings }
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, settingsItem, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions]
      : [{ label: 'File', submenu: [settingsItem, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions]),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, ...(isDev ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions] : []), { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Permissions the UI may use without a prompt: writing to the clipboard (copy buttons of code blocks). */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/** No remote content: the app session only talks to the local backend. Also no permission prompts (camera, location, …). */
function lockDownSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequest(details.url, port)
    if (!allowed) log.line(`blocked request ${details.url}`)
    callback({ cancel: !allowed })
  })
}

async function boot(): Promise<void> {
  log.line(`PromptSys ${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node}, ${isDev ? 'dev' : 'packaged'})`)
  try {
    await startBackend()
    createMainWindow()
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow ?? errorWindow
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', (event) => {
    if (!backend.isAlive()) return
    event.preventDefault()
    void backend.stop().finally(() => app.quit())
  })
  app.on('window-all-closed', () => app.quit())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backend.isAlive()) createMainWindow()
  })
  process.on('uncaughtException', (err) => {
    log.line(`uncaught exception: ${err.stack ?? err.message}`)
    dialog.showErrorBox('PromptSys', `Unexpected error. See ${data.mainLog}`)
  })
  void app.whenReady().then(() => {
    registerIpc()
    buildMenu()
    lockDownSession()
    return boot()
  })
}
