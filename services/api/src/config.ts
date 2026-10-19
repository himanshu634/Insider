const bool = (v: string | undefined, fallback = false) =>
  v === undefined ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());

export const DB_SCHEMA = 'market_intel';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    appVersion: '0.1.0',
    port: Number(env.PORT ?? 8000),
    /** Loopback by default: in production Nginx is the only way in. */
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? 'postgres://insider@localhost:54329/insider',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6380',
    /** Run pipeline jobs inline instead of through BullMQ (tests, or dev without Redis). */
    queueInline: bool(env.QUEUE_INLINE),
    senderHmacKey: env.SENDER_HMAC_KEY ?? 'change-me',
    /** Dev only: user endpoints accept any caller. Never enable in production. */
    authDevBypass: bool(env.AUTH_DEV_BYPASS),
    gcsMediaBucket: env.GCS_MEDIA_BUCKET ?? 'insider-media-dev',
    gcpProject: env.GCP_PROJECT || undefined,
    mediaUploadUrlTtlSeconds: Number(env.MEDIA_UPLOAD_URL_TTL_SECONDS ?? 900),
    defaultSyncIntervalSeconds: 90,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173').split(','),
  };
}

export type Config = ReturnType<typeof loadConfig>;
