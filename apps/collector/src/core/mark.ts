/**
 * The Insider mark ("chatter to one line") as geometry, rasterized without dependencies.
 * Same 64-unit drawing as apps/web/src/lib/assets/favicon.svg and apps/web/src/lib/ui/Logo.svelte
 * — change all three together:
 *
 *   chatter  M8 16 q6 -9 12 0 t12 0 t12 0 t12 0   and   M8 32 q8 -5 16 0 t16 0 t16 0
 *   line     M8 48 H42
 *   point    circle (52, 48) r 5.5
 *
 * Strokes are 5 units wide with round caps and joins, so "inside" is "within 2.5 units of the
 * centre line".
 */

type Pt = readonly [number, number];
export type MarkPart = 'chatter' | 'line' | 'point';

const HALF_STROKE = 2.5;
const POINT = { x: 52, y: 48, r: 5.5 };

/** A row of smooth quadratic waves: `q dx/2 -amp dx 0` then `t dx 0` repeated. */
function waveRow(x0: number, y: number, dx: number, amp: number, waves: number): Pt[] {
  const pts: Pt[] = [];
  const steps = 16;
  for (let i = 0; i < waves; i++) {
    const sx = x0 + i * dx;
    const cy = y + (i % 2 === 0 ? -amp : amp);
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      pts.push([u * u * sx + 2 * u * t * (sx + dx / 2) + t * t * (sx + dx), u * u * y + 2 * u * t * cy + t * t * y]);
    }
  }
  return pts;
}

const STROKES: { part: MarkPart; pts: Pt[] }[] = [
  { part: 'chatter', pts: waveRow(8, 16, 12, 9, 4) },
  { part: 'chatter', pts: waveRow(8, 32, 16, 5, 3) },
  { part: 'line', pts: [[8, 48], [42, 48]] },
];

// Bounding boxes (grown by the half stroke) let most samples skip the segment loop.
const BOXES = STROKES.map(({ pts }) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - HALF_STROKE, Math.min(...ys) - HALF_STROKE, Math.max(...xs) + HALF_STROKE, Math.max(...ys) + HALF_STROKE] as const;
});

function nearSegment(x: number, y: number, [ax, ay]: Pt, [bx, by]: Pt): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= HALF_STROKE;
}

/** Which part of the mark covers this point (64-unit space), or null. The point sits on top. */
export function markPartAt(x: number, y: number): MarkPart | null {
  if (Math.hypot(x - POINT.x, y - POINT.y) <= POINT.r) return 'point';
  for (let i = 0; i < STROKES.length; i++) {
    const [x0, y0, x1, y1] = BOXES[i]!;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { part, pts } = STROKES[i]!;
    for (let k = 1; k < pts.length; k++) if (nearSegment(x, y, pts[k - 1]!, pts[k]!)) return part;
  }
  return null;
}

export type Rgba = readonly [number, number, number, number];

/**
 * Rasterize a square image: `paint(x, y)` gets a point in 0..1 image space and returns its
 * colour (straight alpha) or null for transparent. `ss`×`ss` supersampling anti-aliases edges.
 */
export function rasterize(size: number, ss: number, paint: (x: number, y: number) => Rgba | null): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Premultiplied sums so edge pixels blend colour and coverage correctly.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = paint((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return rgba;
}
