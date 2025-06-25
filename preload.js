const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  
  // Model management
  listModels: () => ipcRenderer.invoke('list-models'),
  downloadModel: (modelName) => ipcRenderer.invoke('download-model', modelName),
  deleteModel: (modelName) => ipcRenderer.invoke('delete-model', modelName),
  
  // Subtitle generation
  generateSubtitles: (params) => ipcRenderer.invoke('generate-subtitles', params),
  generateSubtitlesChunk: (params) => ipcRenderer.invoke('generate-subtitles-chunk', params),
  
  // File operations
  saveSrt: (params) => ipcRenderer.invoke('save-srt', params),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Event listeners
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  
  // Remove event listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
}); 