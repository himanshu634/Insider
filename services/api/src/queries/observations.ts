import type { priceObservation } from '../db/schema.js';

/** The editable fields of an observation, as extraction events store them in `before` and `after`. */
export const observationSnapshot = (o: typeof priceObservation.$inferSelect) => ({
  commodity_id: o.commodityId,
  market_id: o.marketId,
  unit_id: o.unitId,
  variety: o.variety,
  obs_date: o.obsDate,
  min_raw: o.minRaw,
  max_raw: o.maxRaw,
  modal_raw: o.modalRaw,
  arrivals_quintal: o.arrivalsQuintal,
});
