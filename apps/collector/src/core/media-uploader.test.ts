import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../test-support/fixture.js';
import { ApiError } from './api-client.js';
import { MAX_MEDIA_BYTES } from './media-queue.js';
import {
  isDevMediaUrl,
  MAX_MEDIA_ATTEMPTS,
  MediaUploader,
  mediaRootsFor,
  resolveMediaFile,
  type MediaUploaderOptions,
} from './media-uploader.js';
import { Outbox } from './outbox.js';
import type { IngestMessage, MediaUploadUrlRequest, MediaUploadUrlResponse, MessageType } from './types.js';

const G = '120363000000000002@g.us';
const SIGNED_URL = 'https://storage.googleapis.com/bucket/wa/x.jpeg?X-Goog-Signature=abc';

class FakeMediaApi {
  requests: MediaUploadUrlRequest[] = [];
  completed: number[] = [];
  uploadUrl = SIGNED_URL;
  alreadyUploaded = false;
  urlError: ApiError | null = null;
  completeError: ApiError | null = null;

  async createMediaUploadUrl(req: MediaUploadUrlRequest): Promise<MediaUploadUrlResponse> {
    if (this.urlError) throw this.urlError;
    this.requests.push(req);
    return {
      media_id: 100 + this.requests.length,
      upload_url: this.uploadUrl,
      gcs_path: 'wa/x.jpeg',
      expires_at: '2026-10-19T07:00:00.000Z',
      already_uploaded: this.alreadyUploaded,
    };
  }

  async completeMediaUpload(mediaId: number): Promise<void> {
    if (this.completeError) throw this.completeError;
    this.completed.push(mediaId);
  }
}

function msg(stanza: string, type: MessageType): IngestMessage {
  return {
    stanza_id: stanza,
    group_jid: G,
    sender_hash: 'a'.repeat(64),
    sender_name: null,
    sent_at: '2026-10-19T03:30:00.000Z',
    type,
    text: null,
    quoted_stanza_id: null,
    is_forwarded: false,
    media: { mime: 'image/jpeg', size_bytes: 1, file_name: null },
  };
}

let dir: string;
let root: string;
let outbox: Outbox;
let api: FakeMediaApi;
let clock: Date;
let puts: { url: string; body: Buffer; mime: string }[];
let putError: ApiError | null;

function uploader(overrides: Partial<MediaUploaderOptions> = {}): MediaUploader {
  return new MediaUploader({
    api,
    queue: outbox.media,
    mediaRoots: [root],
    now: () => clock,
    putFile: async (url, body, mime) => {
      if (putError) throw putError;
      puts.push({ url, body: Buffer.from(body), mime });
    },
    ...overrides,
  });
}

/** Queue a media message whose message has already been uploaded (left the outbox). */
function addMedia(stanza: string, localPath: string | null, type: MessageType = 'image', itemPk = 1): void {
  outbox.enqueue([{ groupJid: G, message: msg(stanza, type), media: { itemPk, localPath } }], new Map(), clock);
  const [item] = outbox.nextBatch();
  outbox.markSent([item!.id], clock);
}

function writeFile(relPath: string, bytes: Buffer | string): Buffer {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  const buf = Buffer.from(bytes);
  writeFileSync(file, buf);
  return buf;
}

beforeEach(() => {
  dir = makeTempDir();
  root = join(dir, 'Message');
  mkdirSync(root);
  outbox = Outbox.open(join(dir, 'outbox.sqlite'));
  api = new FakeMediaApi();
  clock = new Date('2026-10-19T06:00:00.000Z');
  puts = [];
  putError = null;
});
afterEach(() => outbox.close());
afterAll(removeTempDirs);

describe('MediaUploader', () => {
  it('hashes the file, asks for a signed URL, PUTs the same bytes and completes', async () => {
    const bytes = writeFile('Media/g/a/rates.jpg', 'jpeg bytes');
    addMedia('s1', 'Media/g/a/rates.jpg');
    const res = await uploader().run();
    expect(res).toMatchObject({ promoted: 1, uploaded: 1, skippedPut: 0, failed: 0, error: null });
    expect(api.requests).toEqual([
      {
        group_jid: G,
        stanza_id: 's1',
        mime: 'image/jpeg',
        size_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ]);
    expect(puts).toEqual([{ url: SIGNED_URL, body: bytes, mime: 'image/jpeg' }]);
    expect(api.completed).toEqual([101]);
    expect(outbox.media.waitingCount()).toBe(0);
  });

  it('uploads PDFs sent as documents', async () => {
    writeFile('Media/g/a/rates.pdf', '%PDF-1.4');
    addMedia('s1', 'Media/g/a/rates.pdf', 'document');
    await uploader().run();
    expect(api.requests[0]?.mime).toBe('application/pdf');
    expect(puts[0]?.mime).toBe('application/pdf');
  });

  it('drops documents that are not images or PDFs', async () => {
    writeFile('Media/g/a/rates.xlsx', 'xlsx');
    addMedia('s1', 'Media/g/a/rates.xlsx', 'document');
    const res = await uploader().run();
    expect(res.promoted).toBe(0);
    expect(api.requests).toHaveLength(0);
    expect(outbox.media.waitingCount()).toBe(0);
    expect(outbox.media.failed()).toEqual([]);
  });

  it('skips the PUT when the server already has the file', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.alreadyUploaded = true;
    const res = await uploader().run();
    expect(res).toMatchObject({ uploaded: 1, skippedPut: 1 });
    expect(puts).toHaveLength(0);
    expect(api.completed).toEqual([101]);
  });

  it('skips the PUT for the dev upload URL', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.uploadUrl = 'http://localhost:8000/dev-media/wa/x.jpeg';
    const res = await uploader().run();
    expect(res).toMatchObject({ uploaded: 1, skippedPut: 1 });
    expect(puts).toHaveLength(0);
    expect(api.completed).toEqual([101]);
  });

  it('waits until the message itself has been uploaded', async () => {
    writeFile('a.jpg', 'x');
    outbox.enqueue([{ groupJid: G, message: msg('s1', 'image'), media: { itemPk: 1, localPath: 'a.jpg' } }], new Map(), clock);
    const res = await uploader().run();
    expect(res).toMatchObject({ promoted: 1, uploaded: 0 });
    expect(api.requests).toHaveLength(0);

    outbox.markSent(outbox.nextBatch().map((i) => i.id), clock);
    expect((await uploader().run()).uploaded).toBe(1);
  });

  it('keeps everything queued while offline and retries on the next run', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.urlError = new ApiError('POST /v1/ingest/media/upload-url failed: offline', 0, true);
    const down = await uploader().run();
    expect(down.error).toMatch(/offline/);
    expect(outbox.media.uploads()).toEqual([expect.objectContaining({ attempts: 0, putDone: false })]);

    api.urlError = null;
    const up = await uploader().run();
    expect(up).toMatchObject({ uploaded: 1, error: null });
  });

  it('stops the run at the first network error', async () => {
    writeFile('a.jpg', 'a');
    writeFile('b.jpg', 'b');
    addMedia('s1', 'a.jpg', 'image', 1);
    addMedia('s2', 'b.jpg', 'image', 2);
    putError = new ApiError('PUT media failed: offline', 0, true);
    const res = await uploader().run();
    expect(res.error).toMatch(/offline/);
    expect(api.requests).toHaveLength(1);
  });

  it('after a successful PUT, retries only the complete call', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.completeError = new ApiError('POST /v1/ingest/media/complete → 503', 503, true);
    expect((await uploader().run()).error).toMatch(/503/);
    expect(outbox.media.uploads()[0]).toMatchObject({ putDone: true, mediaId: 101 });

    api.completeError = null;
    const res = await uploader().run();
    expect(res.uploaded).toBe(1);
    expect(api.requests).toHaveLength(1);
    expect(puts).toHaveLength(1);
    expect(api.completed).toEqual([101]);
  });

  it('asks for a fresh URL after the PUT is refused, after a backoff', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    putError = new ApiError('PUT media → 403: SignatureDoesNotMatch', 403, false);
    const first = await uploader().run();
    expect(first.error).toBeNull();
    expect(outbox.media.uploads()[0]).toMatchObject({ attempts: 1, putDone: false, mediaId: null });

    putError = null;
    expect((await uploader().run()).uploaded).toBe(0); // not due yet
    clock = new Date(clock.getTime() + 60_000);
    expect((await uploader().run()).uploaded).toBe(1);
    expect(api.requests).toHaveLength(2);
  });

  it('starts over when the server has lost the media id', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.completeError = new ApiError('POST /v1/ingest/media/complete → 404', 404, false);
    await uploader().run();
    expect(outbox.media.uploads()[0]).toMatchObject({ attempts: 1, putDone: false, mediaId: null });
  });

  it('gives up on a request the server calls invalid', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.urlError = new ApiError('POST /v1/ingest/media/upload-url → 422', 422, false);
    const res = await uploader().run();
    expect(res).toMatchObject({ failed: 1, error: null });
    expect(outbox.media.failed()[0]).toMatchObject({ stanzaId: 's1', reason: expect.stringMatching(/422/) });
  });

  it('stops without counting attempts when the device token is refused', async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.urlError = new ApiError('POST /v1/ingest/media/upload-url → 401', 401, false);
    const res = await uploader().run();
    expect(res.error).toMatch(/401/);
    expect(outbox.media.uploads()[0]).toMatchObject({ attempts: 0 });
  });

  it(`gives up after ${MAX_MEDIA_ATTEMPTS} attempts`, async () => {
    writeFile('a.jpg', 'x');
    addMedia('s1', 'a.jpg');
    api.urlError = new ApiError('POST /v1/ingest/media/upload-url → 404', 404, false);
    for (let i = 0; i < MAX_MEDIA_ATTEMPTS; i++) {
      await uploader().run();
      clock = new Date(clock.getTime() + 7 * 60 * 60 * 1000);
    }
    expect(outbox.media.waitingCount()).toBe(0);
    expect(outbox.media.failed()[0]?.reason).toMatch(/attempts/);
  });

  it('gives up on files over the API limit', async () => {
    writeFile('big.jpg', '');
    truncateSync(join(root, 'big.jpg'), MAX_MEDIA_BYTES + 1);
    addMedia('s1', 'big.jpg');
    const res = await uploader().run();
    expect(res.failed).toBe(1);
    expect(api.requests).toHaveLength(0);
    expect(outbox.media.failed()[0]?.reason).toMatch(/too large/);
  });

  it('gives up on a file deleted between promotion and upload', async () => {
    writeFile('a.jpg', 'x');
    outbox.enqueue([{ groupJid: G, message: msg('s1', 'image'), media: { itemPk: 1, localPath: 'a.jpg' } }], new Map(), clock);
    expect((await uploader().run()).promoted).toBe(1); // message still queued: no upload yet
    rmSync(join(root, 'a.jpg'));
    outbox.markSent(outbox.nextBatch().map((i) => i.id), clock);
    const res = await uploader().run();
    expect(res.failed).toBe(1);
    expect(outbox.media.failed()[0]?.reason).toMatch(/deleted/);
  });

  it('caps uploads per run', async () => {
    for (let i = 1; i <= 3; i++) {
      writeFile(`${i}.jpg`, String(i));
      addMedia(`s${i}`, `${i}.jpg`, 'image', i);
    }
    expect((await uploader({ maxPerRun: 2 }).run()).uploaded).toBe(2);
    expect((await uploader({ maxPerRun: 2 }).run()).uploaded).toBe(1);
  });

  it('waits for a file whose path is known but not on disk yet', async () => {
    addMedia('s1', 'Media/g/a/later.jpg');
    expect((await uploader().run()).promoted).toBe(0);
    writeFile('Media/g/a/later.jpg', 'x');
    expect((await uploader().run()).uploaded).toBe(1);
  });

  it('gives up on media still missing after 7 days', async () => {
    addMedia('s1', null);
    clock = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000);
    const res = await uploader().run();
    expect(res.expired).toBe(1);
    expect(outbox.media.failed()[0]).toMatchObject({
      stanzaId: 's1',
      path: null,
      reason: 'gave up after 7 days: not downloaded by WhatsApp',
    });
  });
});

describe('media paths', () => {
  it('resolves under the first root that has the file and never leaves a root', async () => {
    const other = join(dir, 'Other');
    mkdirSync(other);
    writeFileSync(join(other, 'x.jpg'), 'x');
    writeFileSync(join(dir, 'secret.txt'), 'no');
    expect(await resolveMediaFile([root, other], 'x.jpg')).toBe(join(other, 'x.jpg'));
    expect(await resolveMediaFile([root, other], '../secret.txt')).toBeNull();
    expect(await resolveMediaFile([root], join(dir, 'secret.txt'))).toBeNull();
    expect(await resolveMediaFile([root], 'missing/x.jpg')).toBeNull();
  });

  it('derives the media roots from the database location', () => {
    expect(mediaRootsFor('/c/group.shared/ChatStorage.sqlite')).toEqual(['/c/group.shared/Message', '/c/group.shared']);
  });

  it('recognises only the dev upload URL', () => {
    expect(isDevMediaUrl('http://localhost:8000/dev-media/wa/x.jpeg')).toBe(true);
    expect(isDevMediaUrl('http://127.0.0.1:8000/dev-media/wa/x.jpeg')).toBe(true);
    expect(isDevMediaUrl(SIGNED_URL)).toBe(false);
    expect(isDevMediaUrl('https://localhost:8000/dev-media/x')).toBe(false);
  });
});
