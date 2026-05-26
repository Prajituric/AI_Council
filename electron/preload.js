/**
 * AI Council — Electron preload script
 * =======================================
 * Runs in a privileged context before the page loads.
 * Exposes a minimal, safe API to the renderer via contextBridge.
 * Never expose require() or full Node APIs to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Send a native notification (for agent task completion, etc.)
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),

  // Auto-start on login
  getLoginItem: ()         => ipcRenderer.invoke('get-login-item'),
  setLoginItem: (enable)   => ipcRenderer.invoke('set-login-item', enable),

  // Flag: running inside Electron
  isElectron: true,
  platform:   process.platform,
});
