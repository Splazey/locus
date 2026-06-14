const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeProject: (projectPath, options) => ipcRenderer.invoke('analyze-project', projectPath, options),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  loadGraphFile: () => ipcRenderer.invoke('load-graph-file'),
  openFile: (filepath, line) => ipcRenderer.invoke('open-file', filepath, line),

  // Live analysis progress ({ percent, message }) — returns an unsubscribe fn
  onAnalysisProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('analysis-progress', listener)
    return () => ipcRenderer.removeListener('analysis-progress', listener)
  },

  // App settings (API keys etc.)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),

  // Saved-codebase store
  listSaves:    () => ipcRenderer.invoke('list-saves'),
  saveCodebase: (payload) => ipcRenderer.invoke('save-codebase', payload),
  loadSave:     (id) => ipcRenderer.invoke('load-save', id),
  deleteSave:   (id) => ipcRenderer.invoke('delete-save', id),
})
