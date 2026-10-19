import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connectPageHtml, connectPageUrl } from './connect-page.js';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('connect page', () => {
  const html = connectPageHtml();

  it('allows exactly its own inline script and style, and nothing remote', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    const style = /<style>([\s\S]*)<\/style>/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${sha(script)}`);
    expect(csp).toContain(`style-src ${sha(style)}`);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it('has the two fields, with the token masked', () => {
    expect(html).toContain('id="apiUrl" type="url"');
    expect(html).toContain('id="token" type="password"');
  });

  it('is served as a data: URL', () => {
    expect(decodeURIComponent(connectPageUrl().replace('data:text/html;charset=utf-8,', ''))).toBe(html);
  });
});
