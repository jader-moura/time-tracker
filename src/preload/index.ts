import { contextBridge, ipcRenderer } from 'electron'
import { channels } from './api'
import type { Status, WorkTrackerApi } from './api'

const api: WorkTrackerApi = {
  start: () => ipcRenderer.invoke(channels.start) as Promise<Status>,
  stop: () => ipcRenderer.invoke(channels.stop) as Promise<Status>,
  status: () => ipcRenderer.invoke(channels.status) as Promise<Status>,
  onChange: (listener) => {
    // The event object stays on this side of the bridge; only the payload crosses.
    const handler = (_event: unknown, status: Status): void => listener(status)
    ipcRenderer.on(channels.changed, handler)
    return () => ipcRenderer.removeListener(channels.changed, handler)
  }
}

contextBridge.exposeInMainWorld('workTracker', api)
