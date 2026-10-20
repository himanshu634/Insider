/**
 * Preload for the Groups window. CommonJS (.cts → .cjs) because sandboxed preloads cannot be ES
 * modules. Exposes one read-only IPC call and nothing else to the page.
 */
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('insider', {
  list: (): Promise<unknown> => electron.ipcRenderer.invoke('insider:groups-list'),
});
