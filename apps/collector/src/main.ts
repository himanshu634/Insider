/**
 * Insider Collector — Electron main process. Menu-bar only (no Dock icon); the windows are the
 * Connect dialog, the read-only Groups list and Full Disk Access. All WhatsApp/outbox/API logic
 * lives in ./core (plain Node, unit-tested); this file is UI glue.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { accessPageUrl, accessStatus, accessView, type AccessView, type HolderKind } from './core/access-page.js';
import { ApiClient } from './core/api-client.js';
import { loadConfig, MIN_SYNC_INTERVAL_SECONDS, type CollectorConfig } from './core/config.js';
import { connectPageUrl } from './core/connect-page.js';
import { normalizeConnection, readSettings, testConnection, writeSettings } from './core/connection.js';
import {
  appBundleOf,
  checkDbAccess,
  findAccessHolder,
  FULL_DISK_ACCESS_URL,
  isPermissionError,
  parseProcessList,
  type AccessHolder,
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
/** Re-check database access in the background, so a grant or revoke shows without a restart. */
const ACCESS_CHECK_MS = 15 * 1000;

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
let accessWindow: BrowserWindow | null = null;
let paused = false;
let syncTimer: NodeJS.Timeout | null = null;
const intervals: NodeJS.Timeout[] = [];

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
  if (dbAccess === 'denied') {
    items.push({ label: '⚠ Allow Full Disk Access…', click: () => openAccessWindow() });
  } else if (dbAccess === 'missing') {
    items.push(info(`⚠ ${clip(missingDbText())}`));
  }
  const error = setupError ?? withoutAccessErrors(status?.error ?? null);
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
  const problem =
    dbAccess === 'denied' ? 'needs Full Disk Access' : dbAccess === 'missing' ? missingDbText() : error;
  tray.setToolTip(problem ? `Insider Collector — ${clip(problem, 60)}` : 'Insider Collector');
}

function missingDbText(): string {
  return `WhatsApp database not found at ${config.waDbPath}`;
}

/** The menu shows access problems on their own line, so drop the sync errors they cause. */
function withoutAccessErrors(error: string | null): string | null {
  if (!error || dbAccess === 'ok') return error;
  const rest = error
    .split('; ')
    .filter((part) => !part.includes('Full Disk Access') && !part.includes('WhatsApp database not found'));
  return rest.length > 0 ? rest.join('; ') : null;
}

const execFileAsync = promisify(execFile);
let holderCache: Promise<{ holder: AccessHolder | null; kind: HolderKind; icon: string | null }> | null = null;

/** The app macOS checks for Full Disk Access (see findAccessHolder), its kind and its icon. */
function accessHolder(): Promise<{ holder: AccessHolder | null; kind: HolderKind; icon: string | null }> {
  holderCache ??= (async () => {
    const selfPath = appBundleOf(process.execPath) ?? process.execPath;
    let holder: AccessHolder | null = null;
    try {
      const { stdout } = await execFileAsync('/bin/ps', ['-A', '-o', 'pid=,ppid=,comm=']);
      holder = findAccessHolder(parseProcessList(stdout), process.pid);
    } catch (err) {
      log('could not list processes:', err);
    }
    if (!holder && app.isPackaged) holder = { name: app.getName(), path: selfPath };
    const kind: HolderKind = holder?.path !== selfPath ? 'other' : app.isPackaged ? 'app' : 'dev-app';
    let icon: string | null = null;
    if (holder) {
      try {
        icon = (await app.getFileIcon(holder.path, { size: 'normal' })).toDataURL();
      } catch (err) {
        log('no icon for', holder.path, err);
      }
    }
    log(`Full Disk Access is checked for ${holder ? holder.path : 'an unknown app'} (${kind})`);
    return { holder, kind, icon };
  })();
  return holderCache;
}

async function accessInfo(): Promise<AccessView> {
  const { holder, kind, icon } = await accessHolder();
  return accessView(holder, kind, icon, accessStatus(dbAccess, config.waDbPath));
}

/**
 * Re-read access to the WhatsApp database. On a change, update the menu and the windows; when it
 * is lost, open the Full Disk Access window (once per change, never on every tick). Returns true
 * when access just came back, so the caller can sync. A failed check keeps the last state.
 */
async function refreshAccess(): Promise<boolean> {
  const before = dbAccess;
  try {
    dbAccess = await checkDbAccess(config.waDbPath);
  } catch (err) {
    log('access check failed:', err);
    return false;
  }
  if (dbAccess === before) return false;
  log(`WhatsApp database access: ${before} → ${dbAccess}`);
  renderMenu();
  if (dbAccess === 'denied') {
    openAccessWindow();
    return false;
  }
  if (dbAccess !== 'ok') return false;
  if (groupsWindow) void groupsWindow.loadURL(groupsPageUrl());
  if (accessWindow) setTimeout(() => accessWindow?.close(), 1500);
  void publishCatalog();
  return true;
}

function openAccessWindow(): void {
  if (accessWindow) {
    accessWindow.show();
    accessWindow.focus();
    app.focus({ steal: true });
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 520,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Full Disk Access',
    webPreferences: {
      preload: fileURLToPath(new URL('./access-preload.cjs', import.meta.url)),
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
    accessWindow = null;
  });
  accessWindow = win;
  void win.loadURL(accessPageUrl());
}

function fromAccessWindow(event: IpcMainInvokeEvent): boolean {
  return accessWindow !== null && event.sender === accessWindow.webContents;
}

function registerAccessIpc(): void {
  ipcMain.handle('insider:access-info', (event) => (fromAccessWindow(event) ? accessInfo() : null));

  // The page polls this every 2 s while it is open.
  ipcMain.handle('insider:access-check', async (event) => {
    if (!fromAccessWindow(event)) return null;
    if (await refreshAccess()) void syncNow();
    return accessStatus(dbAccess, config.waDbPath);
  });

  ipcMain.handle('insider:access-open-settings', async (event) => {
    if (fromAccessWindow(event)) await shell.openExternal(FULL_DISK_ACCESS_URL);
  });

  ipcMain.handle('insider:access-reveal', async (event) => {
    if (!fromAccessWindow(event)) return;
    const { holder } = await accessHolder();
    if (holder) shell.showItemInFolder(holder.path);
  });

  ipcMain.handle('insider:access-relaunch', async (event) => {
    if (!fromAccessWindow(event) || (await accessHolder()).kind !== 'app') return;
    app.relaunch();
    app.quit();
  });
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
    await refreshAccess();
    // Runs without access too: uploads, heartbeats and media already found need no database.
    const status = await engine.tick();
    if (status.error) log('sync finished with error:', status.error);
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
  setupError = null;
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
      void refreshAccess();
      return {
        ok: false,
        error: 'macOS is blocking access to WhatsApp’s database. Allow Full Disk Access to see your groups.',
        needsAccess: true,
      };
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

  ipcMain.handle('insider:groups-allow-access', (event) => {
    if (groupsWindow !== null && event.sender === groupsWindow.webContents) openAccessWindow();
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
  registerAccessIpc();

  const icon = nativeImage.createFromBuffer(trayIconPng(32), { scaleFactor: 2 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  renderMenu();

  const userData = app.getPath('userData');
  await removeStaleSnapshots(join(userData, 'snapshots'));
  outbox = Outbox.open(join(userData, 'outbox.sqlite'));

  dbAccess = await checkDbAccess(config.waDbPath);
  if (dbAccess === 'denied') openAccessWindow();
  // Also runs before Connect (no engine, no ticks); syncNow is a no-op until then.
  setInterval(async () => {
    if (await refreshAccess()) await syncNow();
  }, ACCESS_CHECK_MS);

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
