import { describe, expect, it } from 'vitest';
import {
	changeDirection,
	formatNumber,
	formatPercent,
	formatRupeeChange,
	formatRupees,
	formatRupeesShort,
	humanizeSlug
} from './format.js';

describe('formatRupees', () => {
	it('uses Indian digit grouping', () => {
		expect(formatRupees(123456)).toBe('₹1,23,456');
		expect(formatRupees(12345678)).toBe('₹1,23,45,678');
		expect(formatRupees(999)).toBe('₹999');
		expect(formatRupees(0)).toBe('₹0');
	});

	it('rounds to whole rupees by default and allows decimals', () => {
		expect(formatRupees(6250.4)).toBe('₹6,250');
		expect(formatRupees(62.5, 2)).toBe('₹62.5');
	});

	it('puts the sign before the rupee symbol', () => {
		expect(formatRupees(-1234)).toBe('-₹1,234');
	});

	it('renders missing values as an em dash', () => {
		expect(formatRupees(null)).toBe('—');
		expect(formatRupees(undefined)).toBe('—');
		expect(formatRupees(Number.NaN)).toBe('—');
	});
});

describe('formatRupeesShort', () => {
	it('uses lakh and crore short forms', () => {
		expect(formatRupeesShort(150000)).toBe('₹1.5 L');
		expect(formatRupeesShort(123456)).toBe('₹1.23 L');
		expect(formatRupeesShort(23000000)).toBe('₹2.3 Cr');
		expect(formatRupeesShort(-250000)).toBe('-₹2.5 L');
	});

	it('shows amounts under a lakh in full', () => {
		expect(formatRupeesShort(99999)).toBe('₹99,999');
		expect(formatRupeesShort(null)).toBe('—');
	});
});

describe('changes and other numbers', () => {
	it('signs price changes', () => {
		expect(formatRupeeChange(120)).toBe('+₹120');
		expect(formatRupeeChange(-45)).toBe('-₹45');
		expect(formatRupeeChange(0)).toBe('₹0');
		expect(formatRupeeChange(null)).toBe('—');
	});

	it('classifies change direction', () => {
		expect(changeDirection(5)).toBe('up');
		expect(changeDirection(-5)).toBe('down');
		expect(changeDirection(0)).toBe('flat');
		expect(changeDirection(null)).toBe('flat');
	});

	it('formats plain numbers and percents', () => {
		expect(formatNumber(1234567)).toBe('12,34,567');
		expect(formatNumber(null)).toBe('—');
		expect(formatPercent(0.873)).toBe('87%');
		expect(formatPercent(undefined)).toBe('—');
	});

	it('humanizes slugs', () => {
		expect(humanizeSlug('groundnut-bold')).toBe('Groundnut bold');
		expect(humanizeSlug('castor')).toBe('Castor');
	});
});
