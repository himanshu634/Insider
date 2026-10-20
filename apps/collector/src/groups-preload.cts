/**
 * Preload for the Groups window. CommonJS (.cts → .cjs) because sandboxed preloads cannot be ES
 * modules. Exposes the read-only list call and a button to the Full Disk Access window.
 */
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('insider', {
  list: (): Promise<unknown> => electron.ipcRenderer.invoke('insider:groups-list'),
  allowAccess: (): Promise<void> => electron.ipcRenderer.invoke('insider:groups-allow-access'),
});
