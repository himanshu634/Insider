import { describe, expect, it } from 'vitest';
import { isUnitCode, toPerQuintal, unitLabel } from './units.js';

describe('toPerQuintal', () => {
	it('keeps per-quintal prices as they are', () => {
		expect(toPerQuintal(6250, 'per_quintal')).toBe(6250);
	});

	it('multiplies per-20kg prices by 5', () => {
		expect(toPerQuintal(1250, 'per_20kg')).toBe(6250);
	});

	it('multiplies per-kg prices by 100', () => {
		expect(toPerQuintal(62.5, 'per_kg')).toBe(6250);
	});

	it('returns null for an unknown unit instead of guessing', () => {
		expect(toPerQuintal(100, 'per_maund')).toBeNull();
		expect(toPerQuintal(100, 'toString')).toBeNull();
	});

	it('returns null for missing or non-finite values', () => {
		expect(toPerQuintal(null, 'per_kg')).toBeNull();
		expect(toPerQuintal(undefined, 'per_kg')).toBeNull();
		expect(toPerQuintal(Number.NaN, 'per_kg')).toBeNull();
	});

	it('accepts a factor table from the units dictionary', () => {
		expect(toPerQuintal(10, 'per_40kg', { per_40kg: 2.5 })).toBe(25);
	});
});

describe('unit labels', () => {
	it('labels known codes and falls back to the raw code', () => {
		expect(unitLabel('per_20kg')).toBe('₹/20 kg');
		expect(unitLabel('per_maund')).toBe('per_maund');
		expect(isUnitCode('per_kg')).toBe(true);
		expect(isUnitCode('per_maund')).toBe(false);
	});
});
