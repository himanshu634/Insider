/**
 * Insider Collector — Electron main process. Menu-bar only (no Dock icon); the windows are the
 * Connect dialog and the read-only Groups list. All WhatsApp/outbox/API logic lives in ./core (plain Node, unit-tested); this
 * file is UI glue.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { ApiClient } from './core/api-client.js';
import { loadConfig, MIN_SYNC_INTERVAL_SECONDS, type CollectorConfig } from './core/config.js';
import { connectPageUrl } from './core/connect-page.js';
import { normalizeConnection, readSettings, testConnection, writeSettings } from './core/connection.js';
import {
  checkDbAccess,
  FULL_DISK_ACCESS_URL,
  fullDiskAccessHelp,
  isPermissionError,
  type DbAccess,
} from './core/disk-access.js';
import { groupRows, groupsPageUrl, type GroupsResult } from './core/groups-page.js';
import { Outbox } from './core/outbox.js';
import { removeStaleSnapshots } from './core/snapshot.js';
import { readGroupCatalog, SyncEngine, type SyncStatus } from './core/sync-engine.js';
import { trayIconPng } from './core/tray-icon.js';
import { loadDeviceToken, saveDeviceToken } from './token-store.js';

const HEARTBEAT_MS = 5 * 60 * 1000;
const CATALOG_MS = 60 * 60 * 1000;

let tray: Tray | null = null;
let outbox: Outbox | null = null;
let engine: SyncEngine | null = null;
let config: CollectorConfig;
/** API URL in use: the one saved by the Connect window, else INSIDER_API_URL, else the default. */
let apiUrl = '';
let deviceToken: string | undefined;
let dbAccess: DbAccess = 'ok';
let setupError: string | null = null;
let connectWindow: BrowserWindow | null = null;
let groupsWindow: BrowserWindow | null = null;
let paused = false;
let syncTimer: NodeJS.Timeout | null = null;
const intervals: NodeJS.Timeout[] = [];
let fdaDialogShown = false;

const settingsPath = () => join(app.getPath('userData'), 'settings.json');
const userAgent = () => `InsiderCollector/${app.getVersion()}`;

function log(...args: unknown[]): void {
  console.log('[collector]', ...args);
}

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function schemaLine(status: SyncStatus | null): string {
  if (!status || status.schemaOk === null) return 'Schema: not checked yet';
  if (status.schemaOk) return 'Schema: OK';
  return `Schema: MISMATCH (${status.missingColumns.length} missing)`;
}

function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderMenu(): void {
  if (!tray) return;
  const status = engine?.status ?? null;
  const info = (label: string): MenuItemConstructorOptions => ({ label, enabled: false });

  const items: MenuItemConstructorOptions[] = [
    info(paused ? 'Insider Collector — paused' : 'Insider Collector'),
    info(status?.syncing ? 'Syncing…' : `Last sync: ${formatTime(status?.lastSyncAt ?? null)}`),
    info(`Sent today: ${status?.sentToday ?? 0}`),
    info(`Outbox: ${status?.outboxSize ?? 0} waiting`),
    info(schemaLine(status)),
  ];
  if (status?.serverPaused) items.push(info('Paused from the web app'));
  const error = setupError ?? status?.error;
  if (error) items.push(info(`⚠ ${clip(error)}`));

  if (status && status.mediaWaiting > 0) items.splice(4, 0, info(`Media: ${status.mediaWaiting} waiting`));

  items.push(
    { type: 'separator' },
    { label: deviceToken ? 'Change connection…' : 'Connect…', click: () => openConnectWindow() },
    { label: 'Groups…', click: () => openGroupsWindow() },
    { label: 'Sync now', enabled: engine !== null && !status?.syncing, click: () => void syncNow() },
    {
      label: paused ? 'Resume syncing' : 'Pause syncing',
      enabled: engine !== null,
      click: () => {
        paused = !paused;
        if (paused) clearSyncTimer();
        else void syncNow();
        renderMenu();
      },
    },
    { type: 'separator' },
    { label: 'Open web app', click: () => void shell.openExternal(config.webUrl) },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        renderMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit Insider Collector', role: 'quit' },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(error ? `Insider Collector — ${clip(error, 60)}` : 'Insider Collector');
}

async function showFullDiskAccessDialog(): Promise<void> {
  if (fdaDialogShown) return;
  fdaDialogShown = true;
  const help = fullDiskAccessHelp(process.execPath, app.isPackaged);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Insider Collector needs Full Disk Access',
    detail: [
      'It reads a copy of WhatsApp’s local database to collect messages from watched groups.',
      '',
      ...help.steps,
    ].join('\n'),
    buttons: ['Open System Settings', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  if (help.reveal) shell.showItemInFolder(help.reveal);
  await shell.openExternal(FULL_DISK_ACCESS_URL);
}

function clearSyncTimer(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
}

function scheduleNextSync(): void {
  clearSyncTimer();
  if (paused || !engine) return;
  const seconds = Math.max(
    MIN_SYNC_INTERVAL_SECONDS,
    engine.config?.sync_interval_seconds ?? config.syncIntervalSeconds,
  );
  syncTimer = setTimeout(() => void syncNow(), seconds * 1000);
}

async function syncNow(): Promise<void> {
  if (!engine || paused) return;
  clearSyncTimer();
  try {
    const status = await engine.tick();
    if (status.error) log('sync finished with error:', status.error);
    if (status.error?.includes('Full Disk Access')) void showFullDiskAccessDialog();
  } catch (err) {
    log('sync failed:', err);
  } finally {
    renderMenu();
    scheduleNextSync();
  }
}

async function heartbeat(): Promise<void> {
  try {
    await engine?.sendHeartbeat();
  } catch (err) {
    log('heartbeat failed:', err);
  }
}

async function publishCatalog(): Promise<void> {
  try {
    const res = await engine?.publishCatalog();
    if (res) log(`group catalog sent: ${res.received} groups (${res.created} new)`);
  } catch (err) {
    log('group catalog failed:', err);
  }
}

function clearIntervals(): void {
  for (const t of intervals.splice(0)) clearInterval(t);
}

/** Stop the running engine (waiting for its tick) so a new one can take over the outbox. */
async function stopEngine(): Promise<void> {
  const old = engine;
  engine = null;
  clearSyncTimer();
  clearIntervals();
  await old?.whenIdle();
}

function dbAccessError(): string | null {
  return dbAccess === 'missing' ? `WhatsApp database not found at ${config.waDbPath}` : null;
}

let engineChain: Promise<void> = Promise.resolve();

/** (Re)build the engine from the saved connection (or env in dev). Calls run one at a time. */
function startEngine(): Promise<void> {
  engineChain = engineChain.then(buildEngine, buildEngine);
  return engineChain;
}

async function buildEngine(): Promise<void> {
  await stopEngine();
  apiUrl = (await readSettings(settingsPath())).apiUrl ?? config.apiUrl;
  deviceToken = await loadDeviceToken(config.deviceToken);
  setupError = dbAccessError();
  if (!deviceToken || !outbox) {
    // No token yet (first run of the packaged app): ask for one.
    setupError = 'Not connected. Choose “Connect…” to enter the API URL and device token.';
    renderMenu();
    openConnectWindow();
    return;
  }

  engine = new SyncEngine({
    waDbPath: config.waDbPath,
    // Dev fallback only: the server hands its key to the device in GET /v1/devices/config.
    senderHmacKey: config.senderHmacKey,
    api: new ApiClient({ baseUrl: apiUrl, deviceToken, userAgent: userAgent() }),
    outbox,
    workDir: join(app.getPath('userData'), 'snapshots'),
    appVersion: app.getVersion(),
    onStatus: () => renderMenu(),
  });
  log(`reading ${config.waDbPath} → ${apiUrl}`);
  renderMenu();

  await syncNow();
  if (dbAccess !== 'denied') void publishCatalog();
  void heartbeat();
  intervals.push(setInterval(() => void heartbeat(), HEARTBEAT_MS));
  intervals.push(setInterval(() => void publishCatalog(), CATALOG_MS));
}

function openConnectWindow(): void {
  if (connectWindow) {
    connectWindow.show();
    connectWindow.focus();
    app.focus({ steal: true });
    return;
  }
  const win = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Connect Insider Collector',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    win.show();
    app.focus({ steal: true }); // no Dock icon: without this the window can open behind others
  });
  win.on('closed', () => {
    connectWindow = null;
  });
  connectWindow = win;
  void win.loadURL(connectPageUrl());
}

function openGroupsWindow(): void {
  if (groupsWindow) {
    groupsWindow.show();
    groupsWindow.focus();
    app.focus({ steal: true });
    return;
  }
  const win = new BrowserWindow({
    width: 520,
    height: 600,
    minWidth: 380,
    minHeight: 320,
    fullscreenable: false,
    show: false,
    title: 'WhatsApp Groups',
    webPreferences: {
      preload: fileURLToPath(new URL('./groups-preload.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    win.show();
    app.focus({ steal: true });
  });
  win.on('closed', () => {
    groupsWindow = null;
  });
  groupsWindow = win;
  void win.loadURL(groupsPageUrl());
}

/** Read the group list from a fresh snapshot. Works before Connect; needs only Full Disk Access. */
async function listGroups(): Promise<GroupsResult> {
  try {
    const groups = await readGroupCatalog(config.waDbPath, join(app.getPath('userData'), 'snapshots'));
    return { ok: true, groups: groupRows(groups, engine?.config?.watched_group_jids ?? null) };
  } catch (err) {
    log('group list failed:', err);
    if (isPermissionError(err)) {
      void showFullDiskAccessDialog();
      return { ok: false, error: 'Insider Collector needs Full Disk Access to read WhatsApp groups.' };
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: `WhatsApp database not found at ${config.waDbPath}` };
    }
    return { ok: false, error: 'Could not read WhatsApp groups. See the log for details.' };
  }
}

function registerGroupsIpc(): void {
  ipcMain.handle('insider:groups-list', (event): Promise<GroupsResult> | GroupsResult => {
    if (groupsWindow === null || event.sender !== groupsWindow.webContents) {
      return { ok: false, error: 'Not allowed' };
    }
    return listGroups();
  });
}

function fromConnectWindow(event: IpcMainInvokeEvent): boolean {
  return connectWindow !== null && event.sender === connectWindow.webContents;
}

function registerConnectIpc(): void {
  ipcMain.handle('insider:connect-defaults', (event) => {
    if (!fromConnectWindow(event)) return { apiUrl: '', connected: false };
    return { apiUrl: apiUrl || config.apiUrl, connected: Boolean(deviceToken) };
  });

  ipcMain.handle('insider:connect-cancel', (event) => {
    if (fromConnectWindow(event)) connectWindow?.close();
  });

  ipcMain.handle('insider:connect', async (event, input: unknown) => {
    if (!fromConnectWindow(event)) return { ok: false, error: 'Not allowed' };
    const raw = (input ?? {}) as { apiUrl?: unknown; deviceToken?: unknown };
    // An empty token field keeps the stored token (when changing only the URL).
    const typed = typeof raw.deviceToken === 'string' ? raw.deviceToken.trim() : '';
    const checked = normalizeConnection({ apiUrl: raw.apiUrl, deviceToken: typed || deviceToken });
    if (!checked.ok) return checked;

    const test = await testConnection(checked.value, { userAgent: userAgent() });
    if (!test.ok) return test;

    try {
      await saveDeviceToken(checked.value.deviceToken);
      await writeSettings(settingsPath(), { apiUrl: checked.value.apiUrl });
    } catch (err) {
      log('could not save the connection:', err);
      return { ok: false, error: 'Could not store the token in the Keychain' };
    }
    log(`connected to ${checked.value.apiUrl}`);
    setTimeout(() => connectWindow?.close(), 600);
    void startEngine().catch((err: unknown) => log('restart failed:', err));
    return { ok: true };
  });
}

async function start(): Promise<void> {
  app.dock?.hide();
  config = loadConfig();
  registerConnectIpc();
  registerGroupsIpc();

  const icon = nativeImage.createFromBuffer(trayIconPng(32), { scaleFactor: 2 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  renderMenu();

  const userData = app.getPath('userData');
  await removeStaleSnapshots(join(userData, 'snapshots'));
  outbox = Outbox.open(join(userData, 'outbox.sqlite'));

  dbAccess = await checkDbAccess(config.waDbPath);
  if (dbAccess === 'denied') void showFullDiskAccessDialog();

  await startEngine();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Menu-bar app: closing windows (there are none) must not quit.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    clearSyncTimer();
    clearIntervals();
    outbox?.close();
  });
  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      console.error('[collector] failed to start:', err);
      dialog.showErrorBox('Insider Collector failed to start', String(err));
      app.quit();
    });
}
