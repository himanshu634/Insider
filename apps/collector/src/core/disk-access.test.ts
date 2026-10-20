import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appBundleOf, checkDbAccess, findAccessHolder, parseProcessList } from './disk-access.js';

const VSCODE = '/Applications/Visual Studio Code.app';
const ELECTRON =
  '/Users/me/Insider/node_modules/.pnpm/electron@38.8.6/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';

// `make dev-real` in the VS Code terminal (captured from a real Mac, ids shortened).
const VSCODE_CHAIN = `
    1     0 /sbin/launchd
  100     1 ${VSCODE}/Contents/MacOS/Code
  110   100 ${VSCODE}/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper
  120   110 /bin/zsh
  130   120 /Applications/Xcode.app/Contents/Developer/usr/bin/make
  140   130 bash
  150   140 node
  160   150 node
  170   160 ${ELECTRON}
`;

// A shell in the Claude desktop app: the CLI is started through a `disclaimer` helper.
const CLAUDE_CHAIN = `
    1     0 /sbin/launchd
  200     1 /Applications/Claude.app/Contents/MacOS/Claude
  210   200 /Applications/Claude.app/Contents/Helpers/disclaimer
  220   210 /Users/me/Library/Application Support/Claude/claude-code/2.1.299/abc/claude
  230   220 /bin/zsh
  240   230 ${ELECTRON}
`;

describe('parseProcessList', () => {
  it('keeps spaces in executable paths', () => {
    expect(parseProcessList(VSCODE_CHAIN)[2]).toEqual({
      pid: 110,
      ppid: 100,
      path: `${VSCODE}/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper`,
    });
  });
});

describe('appBundleOf', () => {
  it('finds the .app that holds the executable', () => {
    const dev = '/Users/me/Insider/.dev/Insider Collector.app';
    expect(appBundleOf(`${dev}/Contents/MacOS/Electron`)).toBe(dev);
  });

  it('returns the outermost bundle of a helper app', () => {
    expect(appBundleOf(`${VSCODE}/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper`)).toBe(VSCODE);
  });

  it('ignores tools that only live inside a bundle, and plain binaries', () => {
    expect(appBundleOf('/Applications/Xcode.app/Contents/Developer/usr/bin/make')).toBeNull();
    expect(appBundleOf('/bin/zsh')).toBeNull();
  });
});

describe('findAccessHolder', () => {
  it('names the editor a dev collector was started from', () => {
    expect(findAccessHolder(parseProcessList(VSCODE_CHAIN), 170)).toEqual({
      name: 'Visual Studio Code',
      path: VSCODE,
    });
  });

  it('stops at a process started through a disclaimer helper', () => {
    const cli = '/Users/me/Library/Application Support/Claude/claude-code/2.1.299/abc/claude';
    expect(findAccessHolder(parseProcessList(CLAUDE_CHAIN), 240)).toEqual({ name: 'claude', path: cli });
  });

  it('names the dev copy that bin/insider opens with `open`', () => {
    const dev = `
    1     0 /sbin/launchd
  500     1 /Users/me/Insider/.dev/Insider Collector.app/Contents/MacOS/Electron`;
    expect(findAccessHolder(parseProcessList(dev), 500)).toEqual({
      name: 'Insider Collector',
      path: '/Users/me/Insider/.dev/Insider Collector.app',
    });
  });

  it('names the app itself when launchd opened it', () => {
    const packaged = `
    1     0 /sbin/launchd
  300     1 /Applications/Insider Collector.app/Contents/MacOS/Insider Collector`;
    expect(findAccessHolder(parseProcessList(packaged), 300)).toEqual({
      name: 'Insider Collector',
      path: '/Applications/Insider Collector.app',
    });
  });

  it('returns null when no ancestor is an app', () => {
    const detached = `
    1     0 /sbin/launchd
  400     1 /opt/homebrew/bin/tmux
  410   400 /bin/zsh
  420   410 ${ELECTRON}`;
    expect(findAccessHolder(parseProcessList(detached), 420)).toBeNull();
    expect(findAccessHolder([], 1)).toBeNull();
  });
});

describe('checkDbAccess', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('tells ok, denied and missing apart', async () => {
    dir = await mkdtemp(join(tmpdir(), 'insider-access-'));
    const db = join(dir, 'ChatStorage.sqlite');
    await writeFile(db, 'SQLite format 3\0');
    expect(await checkDbAccess(db)).toBe('ok');
    expect(await checkDbAccess(join(dir, 'nope.sqlite'))).toBe('missing');
    await chmod(db, 0o000);
    expect(await checkDbAccess(db)).toBe('denied');
  });
});
