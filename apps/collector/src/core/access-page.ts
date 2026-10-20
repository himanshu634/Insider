import { createHash } from 'node:crypto';
import type { AccessHolder, DbAccess } from './disk-access.js';

/**
 * The Full Disk Access window: what to turn on in System Settings, loaded as a data: URL like the
 * Connect window. The main process decides every text (accessView, accessStatus); the page only
 * shows them with textContent, because app names come from process paths. It polls
 * `window.insider.check()` from access-preload.cts until access works.
 */

export interface AccessStatus {
  text: string;
  tone: 'wait' | 'ok' | 'error';
}

export interface AccessView {
  /** The row to look for in the Full Disk Access list. */
  holderName: string;
  holderNote: string;
  /** data: URL of the holder's icon, or null. */
  icon: string | null;
  turnOn: string;
  restart: string;
  /** Set when the holder is another app: everything run from it gets the same access. */
  warning: string | null;
  /** "Show in Finder" for the holder (to add it with + or drag it into the list). */
  canReveal: boolean;
  /** "Quit & Reopen": only helps when the holder is this app. */
  canRelaunch: boolean;
  status: AccessStatus;
}

export function accessStatus(state: DbAccess, dbPath: string): AccessStatus {
  if (state === 'ok') return { text: 'Access allowed. Collecting from WhatsApp now.', tone: 'ok' };
  if (state === 'missing') {
    return {
      text: `WhatsApp’s database is not at ${dbPath}. Open WhatsApp on this Mac and sign in.`,
      tone: 'error',
    };
  }
  return { text: 'Waiting for access… This window checks every few seconds.', tone: 'wait' };
}

/**
 * Who macOS checks, relative to this process:
 * - `app`: the packaged collector.
 * - `dev-app`: this process is its own app but not packaged: the `.dev/Insider Collector.app` copy
 *   that bin/insider opens (or Electron.app opened with `open`).
 * - `other`: a terminal or editor started a plain `electron .`; macOS checks that app.
 */
export type HolderKind = 'app' | 'dev-app' | 'other';

/** Texts for the window. `holder` is null when it could not be found (kind is then `other`). */
export function accessView(
  holder: AccessHolder | null,
  kind: HolderKind,
  icon: string | null,
  status: AccessStatus,
): AccessView {
  if (holder && kind !== 'other') {
    const name = holder.name;
    return kind === 'app'
      ? {
          holderName: name,
          holderNote: 'Insider Collector reads only WhatsApp’s data on this Mac.',
          icon,
          turnOn: `Turn on “${name}”. If it is not in the list, click +, then choose it in Applications.`,
          restart: `Still locked after you turn it on? Quit and reopen ${name}.`,
          warning: null,
          canReveal: true,
          canRelaunch: true,
          status,
        }
      : {
          holderName: name,
          holderNote: 'Development copy of the collector. It reads only WhatsApp’s data on this Mac.',
          icon,
          turnOn: `Turn on “${name}”. If it is not in the list, click Show in Finder and drag it into the list.`,
          restart:
            `Still locked? If “${name}” is already on, remove it (−) and add it again: a rebuilt copy ` +
            'needs a new grant. Then stop the collector (Ctrl-C) and start it again.',
          warning: null,
          canReveal: true,
          canRelaunch: false,
          status,
        };
  }
  const app = holder ? holder.name : 'that app';
  return {
    holderName: holder ? holder.name : 'The app you started the collector from',
    holderNote: holder
      ? `The collector was started from ${holder.name}, so macOS checks ${holder.name}, not the collector.`
      : 'macOS checks that app (your terminal or editor), not the collector.',
    icon: holder ? icon : null,
    turnOn: `Turn on ${holder ? `“${holder.name}”` : 'that app'}. If it is not in the list, click +, then choose it.`,
    restart: `Still locked after you turn it on? Quit ${app} (⌘Q), open it again and start the collector again.`,
    warning:
      `Everything you run from ${app} gets the same access. To avoid that, run make collector-real ` +
      'instead: the collector then runs as its own app, “Insider Collector”.',
    canReveal: holder !== null,
    canRelaunch: false,
    status,
  };
}

const SCRIPT = `
const $ = (id) => document.getElementById(id);
let timer = null;

function show(status) {
  $('status').className = status.tone;
  $('status').textContent = status.text;
  if (status.tone === 'ok' && timer) {
    clearInterval(timer);
    timer = null;
  }
}

window.insider.info().then((v) => {
  $('holderName').textContent = v.holderName;
  $('holderNote').textContent = v.holderNote;
  $('turnOn').textContent = v.turnOn;
  $('restart').textContent = v.restart;
  if (v.icon) {
    $('icon').src = v.icon;
    $('icon').hidden = false;
  }
  if (v.warning) {
    $('warning').textContent = v.warning;
    $('warning').hidden = false;
  }
  $('reveal').hidden = !v.canReveal;
  $('relaunch').hidden = !v.canRelaunch;
  show(v.status);
});

$('open').addEventListener('click', () => window.insider.openSettings());
$('reveal').addEventListener('click', () => window.insider.reveal());
$('relaunch').addEventListener('click', () => window.insider.relaunch());
timer = setInterval(async () => show(await window.insider.check()), 2000);
`;

const STYLE = `
:root { color-scheme: light dark; --fg: #1c1b19; --muted: #6b675f; --line: #d9d4ca; --bg: #faf8f4;
  --card: #f1ede5; --accent: #2f6b3f; --warn: #8a5a14; --error: #a33a2a; }
@media (prefers-color-scheme: dark) { :root { --fg: #ece8e1; --muted: #a39e94; --line: #3a3833;
  --bg: #1d1c1a; --card: #262522; --accent: #7fbf8e; --warn: #e0b46a; --error: #ef8a78; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; padding: 20px 22px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--fg); background: var(--bg); }
h1 { margin: 0 0 4px; font-size: 15px; }
p { margin: 0 0 14px; color: var(--muted); }
.holder { display: flex; gap: 12px; align-items: center; padding: 10px 12px; margin-bottom: 14px;
  background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.holder img { width: 40px; height: 40px; flex: none; }
.name { font-weight: 600; }
.note { color: var(--muted); font-size: 12px; }
ol { margin: 0 0 12px; padding-left: 20px; }
li { margin-bottom: 12px; padding-left: 2px; }
li button { display: block; margin-top: 6px; }
button { padding: 5px 12px; font: inherit; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--fg); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.warning { color: var(--warn); font-size: 12px; }
#status { padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); }
#status.ok { color: var(--accent); font-weight: 600; }
#status.error { color: var(--error); }
`;

const BODY = `
<h1>Allow Full Disk Access</h1>
<p>Insider Collector reads a copy of WhatsApp’s database on this Mac. macOS keeps that database
locked until you allow Full Disk Access.</p>
<div class="holder">
  <img id="icon" alt="" hidden>
  <div><div id="holderName" class="name"></div><div id="holderNote" class="note"></div></div>
</div>
<ol>
  <li>Open Privacy &amp; Security → Full Disk Access.
    <button type="button" id="open" class="primary">Open System Settings</button></li>
  <li><span id="turnOn"></span>
    <button type="button" id="reveal" hidden>Show in Finder</button></li>
  <li><span id="restart"></span>
    <button type="button" id="relaunch" hidden>Quit &amp; Reopen</button></li>
</ol>
<p id="warning" class="warning" hidden></p>
<div id="status" role="status" aria-live="polite"></div>
`;

function cspHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

export function accessPageHtml(): string {
  const csp = [
    "default-src 'none'",
    `script-src ${cspHash(SCRIPT)}`,
    `style-src ${cspHash(STYLE)}`,
    'img-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Full Disk Access — Insider Collector</title>
<style>${STYLE}</style>
</head>
<body>${BODY}<script>${SCRIPT}</script></body>
</html>`;
}

export function accessPageUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(accessPageHtml())}`;
}
