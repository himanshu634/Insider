import { describe, expect, it } from 'vitest';
import { appBundlePath, fullDiskAccessHelp } from './disk-access.js';

const DEV_APP = '/Users/me/Insider/.dev/Insider Collector.app';
const ELECTRON_APP = '/Users/me/Insider/node_modules/electron/dist/Electron.app';

describe('appBundlePath', () => {
  it('finds the .app that holds the executable', () => {
    expect(appBundlePath(`${DEV_APP}/Contents/MacOS/Electron`)).toBe(DEV_APP);
  });

  it('is null outside a bundle', () => {
    expect(appBundlePath('/usr/local/bin/node')).toBeNull();
  });
});

describe('fullDiskAccessHelp', () => {
  it('names the packaged app', () => {
    const help = fullDiskAccessHelp('/Applications/Insider Collector.app/Contents/MacOS/Insider Collector', true);
    expect(help.steps.join('\n')).toContain('Turn on “Insider Collector”');
    expect(help.reveal).toBeNull();
  });

  it('shows the dev copy in Finder so it can be added to the list', () => {
    const help = fullDiskAccessHelp(`${DEV_APP}/Contents/MacOS/Electron`, false);
    expect(help.steps.join('\n')).toContain('Turn on “Insider Collector”');
    expect(help.reveal).toBe(DEV_APP);
  });

  it('points at the terminal for a bare `electron .`, which macOS charges to the terminal', () => {
    const help = fullDiskAccessHelp(`${ELECTRON_APP}/Contents/MacOS/Electron`, false);
    expect(help.steps.join('\n')).toContain('make collector-real');
    expect(help.steps.join('\n')).not.toContain('Turn on “Insider Collector”');
    expect(help.reveal).toBeNull();
  });
});
