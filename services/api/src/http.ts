import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';

import { type Schemas, validatorFor } from './contract.js';
import type { AppEnv } from './env.js';

export const notFound = (detail = 'Not found') => new HTTPException(404, { message: detail });
export const badRequest = (detail: string) => new HTTPException(422, { message: detail });

/** Validate the JSON body against a schema in the OpenAPI spec. */
export function body<K extends keyof Schemas & string>(schema: K) {
  const validate = validatorFor(schema);
  return validator('json', (value, c) => {
    if (!validate(value)) {
      return c.json({ detail: validate.errors ?? [] }, 422);
    }
    return value as Schemas[K];
  });
}

export const intParam = (value: string | undefined, name = 'id') => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw badRequest(`Bad ${name}`);
  return n;
};

/** Cursors are the last seen id; pages run newest first. */
export const decodeCursor = (cursor: string | undefined) =>
  cursor === undefined ? undefined : intParam(cursor, 'cursor');

export const nextCursor = (ids: number[], limit: number) =>
  ids.length === limit ? String(ids.at(-1)) : null;

export const limitParam = (value: string | undefined) => {
  const n = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw badRequest('limit must be 1–200');
  return n;
};

export const dateParam = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`Bad ${name}`);
  return value;
};

