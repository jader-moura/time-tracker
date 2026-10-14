import { contextBridge } from 'electron'

// The typed tracker API lands here in step 5 of docs/PLAN.md.
contextBridge.exposeInMainWorld('workTracker', {})
