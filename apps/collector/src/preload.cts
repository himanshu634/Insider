/**
 * Preload for the Connect window. CommonJS (.cts → .cjs) because sandboxed preloads cannot be ES
 * modules. Exposes three IPC calls and nothing else to the page.
 */
import electron = require('electron');

electron.contextBridge.exposeInMainWorld('insider', {
  defaults: (): Promise<{ apiUrl: string; connected: boolean }> =>
    electron.ipcRenderer.invoke('insider:connect-defaults'),
  connect: (apiUrl: string, deviceToken: string): Promise<{ ok: boolean; error?: string }> =>
    electron.ipcRenderer.invoke('insider:connect', { apiUrl, deviceToken }),
  cancel: (): Promise<void> => electron.ipcRenderer.invoke('insider:connect-cancel'),
});
