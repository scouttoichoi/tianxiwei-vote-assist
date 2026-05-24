const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('txw', {
  setup: () => ipcRenderer.invoke('setup:first-run'),
  
  // Instance APIs
  getInstances: () => ipcRenderer.invoke('instances:list'),
  createInstance: (name, proxy) => ipcRenderer.invoke('instances:create', name, proxy),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', id),
  updateInstance: (id, name, proxy) => ipcRenderer.invoke('instances:update-config', id, name, proxy),
  
  // Running APIs
  startInstance: (id, mode, options) => ipcRenderer.invoke('instances:start', id, mode, options),
  stopInstance: (id) => ipcRenderer.invoke('instances:stop', id),
  
  // Data APIs per Instance
  getInstanceSummary: (id) => ipcRenderer.invoke('instances:get-summary', id),
  getInstanceAccounts: (id) => ipcRenderer.invoke('instances:get-accounts', id),
  importInstanceAccounts: (id) => ipcRenderer.invoke('instances:import-accounts', id),
  exportInstanceAccounts: (id) => ipcRenderer.invoke('instances:export-accounts', id),
  markInstanceAccountVoted: (id, email) => ipcRenderer.invoke('instances:mark-voted', id, email),
  toggleInstanceAccountStatus: (id, email, status) => ipcRenderer.invoke('instances:toggle-account-status', id, email, status),
  
  // Shared Utilities
  downloadTemplate: (language) => ipcRenderer.invoke('instances:download-template', language),
  
  // Event listeners
  onSetupStatus: (callback) => ipcRenderer.on('setup-status', (_event, value) => callback(value)),
  onLog: (callback) => ipcRenderer.on('worker-log', (_event, payload) => callback(payload)),
  onRunState: (callback) => ipcRenderer.on('run-state', (_event, payload) => callback(payload)),
  onDataUpdated: (callback) => ipcRenderer.on('data-updated', (_event, payload) => callback(payload)),
  onInstancesUpdated: (callback) => ipcRenderer.on('instances-updated', () => callback())
});
