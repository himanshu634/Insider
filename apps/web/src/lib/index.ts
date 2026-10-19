// Entry for the bare `#lib` import (package.json "imports"). Prefer deep imports
// such as `#lib/api/client.js`; this barrel re-exports the most shared helpers.
export { api, API_BASE_URL, ApiError } from './api/client.js';
export { keys } from './api/queries.js';
export { formatRupees, formatRupeesShort, formatNumber } from './utils/format.js';
export { todayIST, formatDate, formatDateTime } from './utils/dates.js';
export { toPerQuintal } from './utils/units.js';
