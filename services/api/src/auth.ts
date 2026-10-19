import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import { collectorDevice } from './db/schema.js';
import type { AppEnv } from './env.js';
import { hashToken } from './security.js';

const unauthorized = (message: string) =>
  new HTTPException(401, {
    message,
    res: new Response(JSON.stringify({ detail: message }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
    }),
  });

const bearer = (header: string | undefined) =>
  header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

/** Collector endpoints: per-device token, stored hashed. */
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearer(c.req.header('authorization'));
  if (!token) throw unauthorized('Missing device token');
  const [device] = await c.var.db
    .select()
    .from(collectorDevice)
    .where(eq(collectorDevice.tokenHash, hashToken(token)));
  if (!device || device.status === 'revoked') throw unauthorized('Invalid device token');
  c.set('device', device);
  await next();
});

/**
 * Web endpoints: team login. The provider is still an open decision (Bull Connect auth or
 * Supabase Auth); plug its token check in here. Until then only the dev bypass works.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.config.authDevBypass) {
    c.set('user', { id: 'dev', name: 'Dev user' });
    return next();
  }
  if (!bearer(c.req.header('authorization'))) throw unauthorized('Missing user token');
  throw unauthorized('User auth is not configured yet');
});
