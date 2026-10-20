import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessPageHtml, accessPageUrl, accessStatus, accessView } from './access-page.js';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const waiting = accessStatus('denied', '/db');

describe('access page', () => {
  const html = accessPageHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';

  it('allows its own inline script and style, data: images, and nothing remote', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const style = /<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${sha(script)}`);
    expect(csp).toContain(`style-src ${sha(style)}`);
    expect(csp).toContain('img-src data:');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it('never parses app names as HTML', () => {
    expect(script).toContain('textContent');
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('is served as a data: URL', () => {
    expect(decodeURIComponent(accessPageUrl().replace('data:text/html;charset=utf-8,', ''))).toBe(html);
  });
});

describe('accessView', () => {
  const collector = { name: 'Insider Collector', path: '/Applications/Insider Collector.app' };
  const vscode = { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' };

  it('asks to turn on the packaged collector, and offers a relaunch', () => {
    const v = accessView(collector, 'app', 'data:image/png;base64,AA==', waiting);
    expect(v.holderName).toBe('Insider Collector');
    expect(v.turnOn).toContain('“Insider Collector”');
    expect(v.warning).toBeNull();
    expect(v.canRelaunch).toBe(true);
    expect(v.icon).toBe('data:image/png;base64,AA==');
  });

  it('asks to turn on the dev copy, shows it in Finder, and restarts with Ctrl-C', () => {
    const dev = { name: 'Insider Collector', path: '/Users/me/Insider/.dev/Insider Collector.app' };
    const v = accessView(dev, 'dev-app', null, waiting);
    expect(v.turnOn).toContain('Turn on “Insider Collector”');
    expect(v.canReveal).toBe(true);
    expect(v.canRelaunch).toBe(false);
    expect(v.restart).toContain('remove it (−) and add it again');
    expect(v.restart).toContain('Ctrl-C');
    expect(v.warning).toBeNull();
  });

  it('names the app that started a plain `electron .`, and points at make collector-real', () => {
    const v = accessView(vscode, 'other', null, waiting);
    expect(v.holderName).toBe('Visual Studio Code');
    expect(v.holderNote).toContain('started from Visual Studio Code');
    expect(v.turnOn).toContain('“Visual Studio Code”');
    expect(v.restart).toContain('Quit Visual Studio Code (⌘Q)');
    expect(v.warning).toContain('Everything you run from Visual Studio Code');
    expect(v.warning).toContain('make collector-real');
    expect(v.canRelaunch).toBe(false);
    expect(v.canReveal).toBe(true);
  });

  it('stays generic when the app is unknown', () => {
    const v = accessView(null, 'other', 'data:image/png;base64,AA==', waiting);
    expect(v.holderName).toBe('The app you started the collector from');
    expect(v.holderNote).toContain('your terminal or editor');
    expect(v.icon).toBeNull();
    expect(v.canReveal).toBe(false);
    expect(v.canRelaunch).toBe(false);
  });
});

describe('accessStatus', () => {
  it('has one text per state', () => {
    expect(accessStatus('denied', '/db').tone).toBe('wait');
    expect(accessStatus('ok', '/db').tone).toBe('ok');
    expect(accessStatus('missing', '/x/ChatStorage.sqlite')).toEqual({
      text: 'WhatsApp’s database is not at /x/ChatStorage.sqlite. Open WhatsApp on this Mac and sign in.',
      tone: 'error',
    });
  });
});
