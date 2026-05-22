const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('txw', {
  setup: () => ipcRenderer.invoke('setup:first-run'),
  getSummary: () => ipcRenderer.invoke('data:summary'),
  getAccounts: () => ipcRenderer.invoke('data:accounts'),
  importAccounts: () => ipcRenderer.invoke('accounts:import'), //
  markAccountVotedToday: (email) => ipcRenderer.invoke('accounts:mark-voted-today', email),//
  downloadAccountsTemplate: (language) => ipcRenderer.invoke('accounts:download-template', language),//
  start: (mode, options) => ipcRenderer.invoke('run:start', mode, options),
  stop: () => ipcRenderer.invoke('run:stop'),
  onSetupStatus: (callback) => ipcRenderer.on('setup-status', (_event, value) => callback(value)),
  onLog: (callback) => ipcRenderer.on('worker-log', (_event, value) => callback(value)),
  onRunState: (callback) => ipcRenderer.on('run-state', (_event, value) => callback(value)),
  onDataUpdated: (callback) => ipcRenderer.on('data-updated', () => callback())
});
