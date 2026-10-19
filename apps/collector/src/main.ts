/**
 * Insider Collector — Electron main process. Menu-bar only (no Dock icon, no windows).
 * All WhatsApp/outbox/API logic lives in ./core (plain Node, unit-tested); this file is UI glue.
 */
import { join } from 'node:path';
import { app, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { ApiClient } from './core/api-client.js';
import { loadConfig, MIN_SYNC_INTERVAL_SECONDS, type CollectorConfig } from './core/config.js';
import { checkDbAccess, FULL_DISK_ACCESS_URL } from './core/disk-access.js';
import { Outbox } from './core/outbox.js';
import { removeStaleSnapshots } from './core/snapshot.js';
import { SyncEngine, type SyncStatus } from './core/sync-engine.js';
import { trayIconPng } from './core/tray-icon.js';
import { loadDeviceToken } from './token-store.js';

const HEARTBEAT_MS = 5 * 60 * 1000;
const CATALOG_MS = 60 * 60 * 1000;

let tray: Tray | null = null;
let outbox: Outbox | null = null;
let engine: SyncEngine | null = null;
let config: CollectorConfig;
let setupError: string | null = null;
let paused = false;
let syncTimer: NodeJS.Timeout | null = null;
const intervals: NodeJS.Timeout[] = [];
let fdaDialogShown = false;

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

  items.push(
    { type: 'separator' },
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
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Insider Collector needs Full Disk Access',
    detail: [
      'It reads a copy of WhatsApp’s local database to collect messages from watched groups.',
      '',
      '1. Click “Open System Settings” (Privacy & Security → Full Disk Access).',
      '2. Turn on “Insider Collector” (use + to add it from Applications if it is not listed).',
      '3. Quit and reopen Insider Collector.',
    ].join('\n'),
    buttons: ['Open System Settings', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(FULL_DISK_ACCESS_URL);
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

async function start(): Promise<void> {
  app.dock?.hide();
  config = loadConfig();

  const icon = nativeImage.createFromBuffer(trayIconPng(32), { scaleFactor: 2 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  renderMenu();

  const userData = app.getPath('userData');
  const workDir = join(userData, 'snapshots');
  await removeStaleSnapshots(workDir);
  outbox = Outbox.open(join(userData, 'outbox.sqlite'));

  const access = await checkDbAccess(config.waDbPath);
  if (access === 'denied') void showFullDiskAccessDialog();
  if (access === 'missing') setupError = `WhatsApp database not found at ${config.waDbPath}`;

  const token = await loadDeviceToken(config.deviceToken);
  if (!token) {
    setupError = 'No device token. Set INSIDER_DEVICE_TOKEN (onboarding UI comes later).';
    renderMenu();
    return;
  }

  engine = new SyncEngine({
    waDbPath: config.waDbPath,
    senderHmacKey: config.senderHmacKey,
    api: new ApiClient({
      baseUrl: config.apiUrl,
      deviceToken: token,
      userAgent: `InsiderCollector/${app.getVersion()}`,
    }),
    outbox,
    workDir,
    appVersion: app.getVersion(),
    onStatus: () => renderMenu(),
  });
  log(`reading ${config.waDbPath} → ${config.apiUrl}`);
  renderMenu();

  await syncNow();
  if (access !== 'denied') void publishCatalog();
  void heartbeat();
  intervals.push(setInterval(() => void heartbeat(), HEARTBEAT_MS));
  intervals.push(setInterval(() => void publishCatalog(), CATALOG_MS));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Menu-bar app: closing windows (there are none) must not quit.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    clearSyncTimer();
    for (const t of intervals) clearInterval(t);
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
