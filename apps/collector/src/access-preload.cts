/**
 * Preload for the Full Disk Access window. CommonJS (.cts → .cjs) because sandboxed preloads
 * cannot be ES modules. Exposes five IPC calls and nothing else to the page.
 */
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('insider', {
  info: (): Promise<unknown> => electron.ipcRenderer.invoke('insider:access-info'),
  check: (): Promise<unknown> => electron.ipcRenderer.invoke('insider:access-check'),
  openSettings: (): Promise<void> => electron.ipcRenderer.invoke('insider:access-open-settings'),
  reveal: (): Promise<void> => electron.ipcRenderer.invoke('insider:access-reveal'),
  relaunch: (): Promise<void> => electron.ipcRenderer.invoke('insider:access-relaunch'),
});
