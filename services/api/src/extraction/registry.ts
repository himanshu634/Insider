/**
 * Per-commodity extraction schemas (the CropSchemaRegistry pattern from the Telegram pipeline).
 * Each commodity registers the JSON Schema the LLM fills with structured output. One message can
 * yield many rows (a full rate list). Extraction itself lands in Phase 3.
 */
export interface PriceRow {
  market: string;
  variety?: string | null;
  obs_date?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  modal_price?: number | null;
  /** As written: 20 kg, મણ, quintal, kg … */
  unit: string;
  arrivals?: number | null;
  arrivals_unit?: string | null;
}

export interface Extraction {
  rows: PriceRow[];
}

const priceRowSchema = {
  type: 'object',
  required: ['market', 'unit'],
  properties: {
    market: { type: 'string', description: 'Mandi name as written in the message' },
    variety: { type: ['string', 'null'] },
    obs_date: { type: ['string', 'null'], format: 'date', description: 'Defaults to the message date' },
    min_price: { type: ['number', 'null'] },
    max_price: { type: ['number', 'null'] },
    modal_price: { type: ['number', 'null'] },
    unit: { type: 'string', description: 'As written: 20 kg, મણ, quintal, kg …' },
    arrivals: { type: ['number', 'null'] },
    arrivals_unit: { type: ['string', 'null'] },
  },
} as const;

const extractionSchema = {
  type: 'object',
  required: ['rows'],
  properties: { rows: { type: 'array', items: priceRowSchema } },
} as const;

const registry = new Map<string, object>([
  ['castor', extractionSchema],
  ['groundnut', extractionSchema],
]);

export const CropSchemaRegistry = {
  register: (slug: string, schema: object) => void registry.set(slug, schema),
  get: (slug: string) => registry.get(slug),
  slugs: () => [...registry.keys()].sort(),
};
