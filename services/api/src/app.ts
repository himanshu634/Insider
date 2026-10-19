import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

import { requireDevice, requireUser } from './auth.js';
import type { AppDeps, AppEnv } from './env.js';
import { admin } from './routes/admin.js';
import { collector } from './routes/collector.js';
import { read } from './routes/read.js';
import { review } from './routes/review.js';

const DEVICE_PATHS = ['/v1/ingest/', '/v1/groups/catalog', '/v1/devices/config', '/v1/devices/heartbeat'];

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(cors({ origin: deps.config.corsOrigins }));
  app.use(async (c, next) => {
    c.set('db', deps.db);
    c.set('queue', deps.queue);
    c.set('config', deps.config);
    await next();
  });

  // Collector endpoints take a device token; every other /v1 endpoint takes a team user.
  app.use('/v1/*', (c, next) =>
    DEVICE_PATHS.some((p) => c.req.path.startsWith(p)) ? requireDevice(c, next) : requireUser(c, next),
  );

  app.get('/healthz', (c) => c.json({ status: 'ok', version: deps.config.appVersion }));

  app.route('/', collector);
  app.route('/', read);
  app.route('/', review);
  app.route('/', admin);

  app.notFound((c) => c.json({ detail: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.res ?? c.json({ detail: err.message }, err.status);
    }
    console.error(err);
    return c.json({ detail: 'Internal error' }, 500);
  });
  return app;
}
