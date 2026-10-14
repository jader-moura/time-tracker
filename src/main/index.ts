import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { parseIntervalMs } from '../core/config'
import { channels } from '../preload/api'
import type { Status } from '../preload/api'
import { createInputCounter } from './input'
import { createScreenshotService } from './screenshots'
import { createFileStorage, dataFilePath, screenshotDirPath } from './storage'
import { createTrackerService } from './tracker'
import type { TrackerService } from './tracker'

let tracker: TrackerService | null = null
let mainWindow: BrowserWindow | null = null
let quitting = false

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 420,
    height: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'Work Tracker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

const publish = (status: Status): void => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channels.changed, status)
  }
}

const registerHandlers = (service: TrackerService): void => {
  ipcMain.handle(channels.start, () => service.start())
  ipcMain.handle(channels.stop, () => service.stop())
  ipcMain.handle(channels.status, () => service.status())
  ipcMain.handle(channels.thumbnail, () => service.thumbnail())
}

void app.whenReady().then(async () => {
  const service = createTrackerService({
    storage: createFileStorage(dataFilePath(app.getPath('userData'))),
    screenshots: createScreenshotService(screenshotDirPath(app.getPath('userData'))),
    input: await createInputCounter(),
    notify: publish,
    now: () => Date.now(),
    intervalMs: parseIntervalMs(process.env['SCREENSHOT_INTERVAL_MS'])
  })

  await service.load()
  tracker = service
  registerHandlers(service)
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

// Closing the window ends the app on Windows and Linux, which means an active
// session has to be stopped and flushed before the process goes away.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting || tracker === null) return

  // Quit is synchronous, so hold it open for one pass while the session is
  // stopped and written, then quit for real.
  event.preventDefault()
  quitting = true
  void tracker.dispose().finally(() => app.quit())
})
