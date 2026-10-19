import { describe, expect, it } from 'vitest';
import { DEFAULT_WA_DB, loadConfig, parseInterval, resolvePath } from './config.js';

const HOME = '/Users/tester';

describe('loadConfig', () => {
  it('uses defaults (path is only computed, never opened)', () => {
    const cfg = loadConfig({ INIT_CWD: '/repo' }, HOME);
    expect(cfg).toEqual({
      apiUrl: 'http://localhost:8000',
      deviceToken: undefined,
      waDbPath: `${HOME}/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`,
      senderHmacKey: undefined,
      syncIntervalSeconds: 90,
      webUrl: 'http://localhost:5173',
    });
    expect(DEFAULT_WA_DB.startsWith('~/')).toBe(true);
  });

  it('reads every variable and resolves a relative DB path against INIT_CWD', () => {
    const cfg = loadConfig(
      {
        INSIDER_API_URL: 'https://api.example.test/',
        INSIDER_DEVICE_TOKEN: ' tok ',
        INSIDER_WA_DB: '.dev/fixtures/ChatStorage.sqlite',
        SENDER_HMAC_KEY: 'k',
        INSIDER_SYNC_INTERVAL_SECONDS: '120',
        INSIDER_WEB_URL: 'http://web.test',
        INIT_CWD: '/repo',
      },
      HOME,
    );
    expect(cfg).toEqual({
      apiUrl: 'https://api.example.test',
      deviceToken: 'tok',
      waDbPath: '/repo/.dev/fixtures/ChatStorage.sqlite',
      senderHmacKey: 'k',
      syncIntervalSeconds: 120,
      webUrl: 'http://web.test',
    });
  });

  it('parses the interval defensively', () => {
    expect(parseInterval(undefined)).toBe(90);
    expect(parseInterval('abc')).toBe(90);
    expect(parseInterval('1')).toBe(15);
  });

  it('expands ~ and keeps absolute paths', () => {
    expect(resolvePath('~/x.sqlite', HOME, '/repo')).toBe(`${HOME}/x.sqlite`);
    expect(resolvePath('/abs/x.sqlite', HOME, '/repo')).toBe('/abs/x.sqlite');
  });
});
