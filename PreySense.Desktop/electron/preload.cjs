const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('preySense', {
  send: (method, params) =>
    ipcRenderer.invoke('hw:send', method, params),

  getTelemetry: () =>
    ipcRenderer.invoke('hw:telemetry'),

  getDeviceInfo: () =>
    ipcRenderer.invoke('hw:device-info'),

  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('host:event', handler)
    return () => ipcRenderer.removeListener('host:event', handler)
  },

  getAutoStart: () =>
    ipcRenderer.invoke('app:get-auto-start'),

  setAutoStart: (enabled) =>
    ipcRenderer.invoke('app:set-auto-start', enabled),
})
