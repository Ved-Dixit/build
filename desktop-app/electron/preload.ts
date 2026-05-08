import { contextBridge, ipcRenderer } from 'electron';

// We can expose safe APIs here if we set contextIsolation to true
// but for simplicity we allowed nodeIntegration. 
// Just exposing a simple API for React.
window.addEventListener('DOMContentLoaded', () => {
  console.log('Preload script loaded');
});
