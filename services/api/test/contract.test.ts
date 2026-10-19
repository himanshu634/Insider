/**
 * packages/contracts/openapi.yaml is the source of truth: every path + method in it must be
 * implemented, nothing else may be, and responses must validate against the spec's schemas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { spec, validatorFor } from '../src/contract.js';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => (t = await setup()));
afterAll(() => t.close());

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const toHono = (path: string) => path.replace(/\{(\w+)\}/g, ':$1');

describe('contract', () => {
  it('implements exactly the routes in the spec', () => {
    const want = new Set(
      Object.entries(spec.paths).flatMap(([path, ops]) =>
        METHODS.filter((m) => m in ops).map((m) => `${m.toUpperCase()} ${toHono(path)}`),
      ),
    );
    const have = new Set(
      t.app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path}`),
    );
    expect([...want].filter((r) => !have.has(r)).sort()).toEqual([]);
    expect([...have].filter((r) => !want.has(r)).sort()).toEqual([]);
  });

  it.each([
    ['/healthz', 'Health'],
    ['/v1/insights', 'InsightPage'],
    ['/v1/messages', 'MessagePage'],
    ['/v1/review/observations', 'ObservationPage'],
    ['/v1/devices/config', 'DeviceConfig'],
  ] as const)('GET %s matches %s', async (path, schema) => {
    const res = await t.request(path);
    expect(res.status).toBe(200);
    const validate = validatorFor(schema);
    expect(validate(await res.json()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('dictionary rows match the spec and come seeded', async () => {
    const res = await t.request('/v1/dictionaries/units', { device: false });
    const units = await res.json();
    expect(units.map((u: { code: string }) => u.code).sort()).toEqual(['per_20kg', 'per_kg', 'per_quintal']);
    const validate = validatorFor('Unit');
    for (const u of units) expect(validate(u), JSON.stringify(validate.errors)).toBe(true);
  });

  it('a missing brief is a 404', async () => {
    expect((await t.request('/v1/brief/2026-10-19', { device: false })).status).toBe(404);
  });
});
