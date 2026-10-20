import { createHash } from 'node:crypto';
import type { CatalogGroup } from './types.js';

/**
 * The Groups window: a read-only list of the WhatsApp groups this Mac can see, loaded as a data:
 * URL like the Connect window. It gets its rows only through `window.insider.list()` from
 * groups-preload.cts. Group names are text from WhatsApp, so the script builds rows with
 * textContent and never parses them as HTML.
 */

export interface GroupRow {
  jid: string;
  name: string;
  /** WhatsApp stores no name for this group, so `name` is the JID. */
  unnamed: boolean;
  memberCount: number | null;
  /** null while the device config (the watched list) has not been loaded. */
  watched: boolean | null;
}

export type GroupsResult =
  | { ok: true; groups: GroupRow[] }
  /** needsAccess: macOS blocked the read; the page offers the Full Disk Access window. */
  | { ok: false; error: string; needsAccess?: boolean };

/** Rows for the window, in reader order (most recent activity first). */
export function groupRows(groups: readonly CatalogGroup[], watchedJids: readonly string[] | null): GroupRow[] {
  const watched = watchedJids ? new Set(watchedJids) : null;
  return groups.map((g) => ({
    jid: g.jid,
    name: g.name,
    unnamed: g.name === g.jid,
    memberCount: g.member_count ?? null,
    watched: watched ? watched.has(g.jid) : null,
  }));
}

const SCRIPT = `
const list = document.getElementById('list');
const search = document.getElementById('search');
const summary = document.getElementById('summary');
const status = document.getElementById('status');
const refresh = document.getElementById('refresh');
const allow = document.getElementById('allow');
let rows = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const watched = rows.filter((r) => r.watched).length;
  const known = rows.some((r) => r.watched !== null);
  summary.textContent = rows.length + (rows.length === 1 ? ' group' : ' groups') +
    (known ? ' · ' + watched + ' watched' : '');
  list.replaceChildren(...shown.map((r) => {
    const li = el('li');
    const main = el('div', 'main');
    main.append(el('span', r.unnamed ? 'name unnamed' : 'name', r.unnamed ? 'No name in WhatsApp' : r.name));
    if (r.unnamed) main.append(el('span', 'jid', r.jid));
    li.append(main);
    const meta = el('div', 'meta');
    if (r.watched) meta.append(el('span', 'badge', 'Watched'));
    if (r.memberCount !== null) meta.append(el('span', 'count', r.memberCount + (r.memberCount === 1 ? ' member' : ' members')));
    li.append(meta);
    return li;
  }));
  status.className = '';
  status.textContent = rows.length === 0 ? 'No groups found in WhatsApp.' : shown.length === 0 ? 'No group matches “' + search.value.trim() + '”.' : '';
}

async function load() {
  refresh.disabled = true;
  allow.hidden = true;
  status.className = '';
  status.textContent = 'Reading WhatsApp…';
  const res = await window.insider.list();
  refresh.disabled = false;
  if (!res.ok) {
    rows = [];
    list.replaceChildren();
    summary.textContent = '';
    status.className = 'error';
    status.textContent = res.error;
    allow.hidden = !res.needsAccess;
    return;
  }
  rows = res.groups;
  render();
}

search.addEventListener('input', render);
refresh.addEventListener('click', load);
allow.addEventListener('click', () => window.insider.allowAccess());
load();
`;

const STYLE = `
:root { color-scheme: light dark; --fg: #1c1b19; --muted: #6b675f; --line: #d9d4ca; --bg: #faf8f4;
  --accent: #2f6b3f; --error: #a33a2a; }
@media (prefers-color-scheme: dark) { :root { --fg: #ece8e1; --muted: #a39e94; --line: #3a3833;
  --bg: #1d1c1a; --accent: #7fbf8e; --error: #ef8a78; } }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; display: flex; flex-direction: column; font: 13px/1.45 -apple-system,
  BlinkMacSystemFont, sans-serif; color: var(--fg); background: var(--bg); }
header { padding: 16px 18px 10px; border-bottom: 1px solid var(--line); }
h1 { margin: 0 0 2px; font-size: 15px; }
p { margin: 0 0 10px; color: var(--muted); }
.row { display: flex; gap: 8px; align-items: center; }
input { flex: 1; padding: 6px 9px; font: inherit; color: var(--fg); background: transparent;
  border: 1px solid var(--line); border-radius: 6px; }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
button { padding: 6px 12px; font: inherit; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--fg); }
button:disabled { opacity: 0.6; }
#summary { margin-top: 8px; color: var(--muted); font-size: 12px; }
ul { flex: 1; margin: 0; padding: 0; list-style: none; overflow-y: auto; }
li { display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 9px 18px; border-bottom: 1px solid var(--line); }
.main { min-width: 0; display: flex; flex-direction: column; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unnamed { font-weight: 400; font-style: italic; color: var(--muted); }
.jid { font: 11px ui-monospace, Menlo, monospace; color: var(--muted); }
.meta { flex: none; display: flex; gap: 8px; align-items: center; color: var(--muted); }
.badge { padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
  color: var(--accent); border: 1px solid var(--accent); }
#status { padding: 14px 18px; color: var(--muted); }
#status:empty { display: none; }
#status.error { color: var(--error); }
#allow { margin: 0 18px; align-self: flex-start; background: var(--accent); border-color: var(--accent);
  color: var(--bg); }
[hidden] { display: none !important; }
`;

const BODY = `
<header>
  <h1>WhatsApp groups</h1>
  <p>Groups this Mac can see. Choose which ones to watch in the web app.</p>
  <div class="row">
    <input id="search" type="search" placeholder="Search groups" aria-label="Search groups" spellcheck="false">
    <button type="button" id="refresh">Refresh</button>
  </div>
  <div id="summary" aria-live="polite"></div>
</header>
<div id="status" role="status"></div>
<button type="button" id="allow" hidden>Allow Full Disk Access…</button>
<ul id="list"></ul>
`;

function cspHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

export function groupsPageHtml(): string {
  const csp = [
    "default-src 'none'",
    `script-src ${cspHash(SCRIPT)}`,
    `style-src ${cspHash(STYLE)}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>WhatsApp Groups — Insider Collector</title>
<style>${STYLE}</style>
</head>
<body>${BODY}<script>${SCRIPT}</script></body>
</html>`;
}

export function groupsPageUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(groupsPageHtml())}`;
}
