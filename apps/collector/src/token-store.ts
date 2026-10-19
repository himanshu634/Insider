import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';

const TOKEN_FILE = 'device-token.bin';

function tokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE);
}

/** Encrypt the device token with safeStorage (Keychain-backed on macOS) into userData. */
export async function saveDeviceToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage encryption unavailable');
  await writeFile(tokenPath(), safeStorage.encryptString(token), { mode: 0o600 });
}

/**
 * The device token: the safeStorage file under userData first, then INSIDER_DEVICE_TOKEN
 * (dev). A packaged app that only has the env token stores it encrypted for the next launch.
 * Call after `app.whenReady()`.
 */
export async function loadDeviceToken(envToken: string | undefined): Promise<string | undefined> {
  try {
    const encrypted = await readFile(tokenPath());
    if (safeStorage.isEncryptionAvailable()) {
      const token = safeStorage.decryptString(encrypted).trim();
      if (token) return token;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[collector] could not read stored device token:', err);
    }
  }
  if (envToken && app.isPackaged && safeStorage.isEncryptionAvailable()) {
    await saveDeviceToken(envToken).catch((err: unknown) =>
      console.error('[collector] could not store device token:', err),
    );
  }
  return envToken;
}
