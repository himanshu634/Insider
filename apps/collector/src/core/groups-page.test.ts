import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { groupRows, groupsPageHtml, groupsPageUrl } from './groups-page.js';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('groups page', () => {
  const html = groupsPageHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';

  it('allows exactly its own inline script and style, and nothing remote', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const style = /<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${sha(script)}`);
    expect(csp).toContain(`style-src ${sha(style)}`);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it('never parses group names as HTML', () => {
    expect(script).toContain('textContent');
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('is served as a data: URL', () => {
    expect(decodeURIComponent(groupsPageUrl().replace('data:text/html;charset=utf-8,', ''))).toBe(html);
  });
});

describe('groupRows', () => {
  const BOOKTALK = '120363000000000101@g.us';
  const UNNAMED = '120363000000000102@g.us';
  const groups = [
    { jid: BOOKTALK, name: 'BOOKTALK', member_count: 42 },
    { jid: UNNAMED, name: UNNAMED, member_count: null },
  ];

  it('keeps names and order, and marks groups WhatsApp has no name for', () => {
    expect(groupRows(groups, [BOOKTALK])).toEqual([
      { jid: BOOKTALK, name: 'BOOKTALK', unnamed: false, memberCount: 42, watched: true },
      { jid: UNNAMED, name: UNNAMED, unnamed: true, memberCount: null, watched: false },
    ]);
  });

  it('leaves the watched flag unknown without a device config', () => {
    expect(groupRows(groups, null).map((r) => r.watched)).toEqual([null, null]);
  });
});
