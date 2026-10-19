import type { Config } from './config.js';

export function mediaPath(groupJid: string, stanzaId: string, sha256: string, mime: string) {
  const ext = mime.split('/').pop()?.split(';')[0] || 'bin';
  return `wa/${groupJid.split('@')[0]}/${stanzaId}-${sha256.slice(0, 12)}.${ext}`;
}

/** Signed GCS PUT URL for one collector upload. */
export async function signedUploadUrl(config: Config, gcsPath: string, mime: string) {
  const expiresAt = new Date(Date.now() + config.mediaUploadUrlTtlSeconds * 1000);
  if (!config.gcpProject) {
    // Local dev without GCP credentials: a URL the collector recognises and skips.
    return { url: `http://localhost:${config.port}/dev-media/${gcsPath}`, expiresAt };
  }
  const { Storage } = await import('@google-cloud/storage'); // lazy: heavy, only needed with GCP
  const [url] = await new Storage({ projectId: config.gcpProject })
    .bucket(config.gcsMediaBucket)
    .file(gcsPath)
    .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: mime });
  return { url, expiresAt };
}
