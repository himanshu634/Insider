// Renders the Insider mark's PNG icons from the compiled geometry (dist/core/tray-icon.js).
// Run `pnpm --filter @insider/collector icons` after changing the mark, and commit the output:
//   apps/collector/resources/icon.png     1024 px macOS app icon (electron-builder mac.icon)
//   apps/web/static/apple-touch-icon.png  180 px full-bleed home-screen icon (iOS masks it)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appIconPng } from '../dist/core/tray-icon.js';

const out = (path) => fileURLToPath(new URL(path, import.meta.url));

writeFileSync(out('../resources/icon.png'), appIconPng(1024));
writeFileSync(out('../../web/static/apple-touch-icon.png'), appIconPng(180, 0, 0));
console.log('wrote resources/icon.png and web/static/apple-touch-icon.png');
