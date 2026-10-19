import { createHash } from 'node:crypto';

/**
 * The Connect window: one local page, loaded as a data: URL (tsc copies no .html files). It talks
 * to the main process only through `window.insider` from preload.cts; the main process checks the
 * connection, so the page itself never touches the network (its CSP allows nothing remote).
 */

const SCRIPT = `
const form = document.getElementById('form');
const apiUrl = document.getElementById('apiUrl');
const token = document.getElementById('token');
const status = document.getElementById('status');
const submit = document.getElementById('submit');

window.insider.defaults().then((d) => {
  if (d.apiUrl) apiUrl.value = d.apiUrl;
  if (d.connected) token.placeholder = 'Leave empty to keep the current token';
  (d.apiUrl ? token : apiUrl).focus();
});

document.getElementById('cancel').addEventListener('click', () => window.insider.cancel());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.className = '';
  status.textContent = 'Checking…';
  const res = await window.insider.connect(apiUrl.value, token.value);
  submit.disabled = false;
  status.className = res.ok ? 'ok' : 'error';
  status.textContent = res.ok ? 'Connected.' : res.error;
});
`;

const STYLE = `
:root { color-scheme: light dark; --fg: #1c1b19; --muted: #6b675f; --line: #d9d4ca; --bg: #faf8f4;
  --accent: #2f6b3f; --error: #a33a2a; }
@media (prefers-color-scheme: dark) { :root { --fg: #ece8e1; --muted: #a39e94; --line: #3a3833;
  --bg: #1d1c1a; --accent: #7fbf8e; --error: #ef8a78; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 22px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--fg); background: var(--bg); }
h1 { margin: 0 0 4px; font-size: 15px; }
p { margin: 0 0 14px; color: var(--muted); }
label { display: block; margin: 10px 0 4px; font-weight: 600; }
input { width: 100%; padding: 7px 9px; font: inherit; color: var(--fg); background: transparent;
  border: 1px solid var(--line); border-radius: 6px; }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
button { padding: 6px 14px; font: inherit; border-radius: 6px; border: 1px solid var(--line);
  background: transparent; color: var(--fg); }
button[type=submit] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
button:disabled { opacity: 0.6; }
#status { min-height: 1.45em; margin-top: 12px; color: var(--muted); }
#status.error { color: var(--error); }
#status.ok { color: var(--accent); }
`;

const BODY = `
<h1>Connect Insider Collector</h1>
<p>Enter the Insider API address and this Mac’s device token. An admin creates the token on the
server with <code>create-device</code>. The token is kept in the macOS Keychain.</p>
<form id="form" autocomplete="off">
  <label for="apiUrl">API URL</label>
  <input id="apiUrl" type="url" required placeholder="https://insider.example.com" spellcheck="false">
  <label for="token">Device token</label>
  <input id="token" type="password" spellcheck="false">
  <div id="status" role="status"></div>
  <div class="row">
    <button type="button" id="cancel">Cancel</button>
    <button type="submit" id="submit">Connect</button>
  </div>
</form>
`;

function cspHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

export function connectPageHtml(): string {
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
<title>Connect Insider Collector</title>
<style>${STYLE}</style>
</head>
<body>${BODY}<script>${SCRIPT}</script></body>
</html>`;
}

export function connectPageUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(connectPageHtml())}`;
}
