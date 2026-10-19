/**
 * Request validation straight from packages/contracts/openapi.yaml — the spec is the only
 * source of truth, so there are no hand-written schemas to drift.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { components } from '@insider/contracts';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';

export type Schemas = components['schemas'];

const require = createRequire(import.meta.url);
export const SPEC_PATH = require.resolve('@insider/contracts/openapi.yaml');
export const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false });
addFormats(ajv);
ajv.addFormat('int64', { type: 'number', validate: Number.isSafeInteger });
ajv.addSchema({ $id: 'spec', components: spec.components });

const cache = new Map<string, ValidateFunction>();

export function validatorFor(schemaName: keyof Schemas & string): ValidateFunction {
  let fn = cache.get(schemaName);
  if (!fn) {
    fn = ajv.compile({ $ref: `spec#/components/schemas/${schemaName}` });
    cache.set(schemaName, fn);
  }
  return fn;
}
