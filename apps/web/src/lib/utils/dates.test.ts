import { describe, expect, it } from 'vitest';
import {
	addDays,
	formatDate,
	formatDateTime,
	formatRelative,
	formatTime,
	toISTDateString,
	todayIST
} from './dates.js';

describe('todayIST', () => {
	it('returns the IST calendar day as YYYY-MM-DD', () => {
		expect(todayIST(new Date('2026-10-19T06:00:00Z'))).toBe('2026-10-19');
	});

	it('rolls over at IST midnight, not UTC midnight', () => {
		// 19:00 UTC on the 18th is 00:30 IST on the 19th.
		expect(todayIST(new Date('2026-10-18T19:00:00Z'))).toBe('2026-10-19');
		// 18:29 UTC is still 23:59 IST on the 18th.
		expect(todayIST(new Date('2026-10-18T18:29:00Z'))).toBe('2026-10-18');
	});

	it('converts any instant to its IST day', () => {
		expect(toISTDateString('2026-12-31T20:00:00Z')).toBe('2027-01-01');
	});
});

describe('addDays', () => {
	it('does calendar arithmetic across month and year ends', () => {
		expect(addDays('2026-10-19', -1)).toBe('2026-10-18');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
	});
});

describe('formatting in IST', () => {
	it('formats calendar dates without shifting the day', () => {
		expect(formatDate('2026-10-19')).toBe('19 Oct 2026');
		expect(formatDate('not-a-date')).toBe('not-a-date');
	});

	it('formats timestamps in IST', () => {
		// 13:30 UTC = 19:00 IST.
		expect(formatTime('2026-10-18T13:30:00Z')).toBe('07:00 pm');
		expect(formatDateTime('2026-10-18T13:30:00Z')).toBe('18 Oct, 07:00 pm');
	});

	it('formats relative times', () => {
		const now = new Date('2026-10-19T12:00:00Z');
		expect(formatRelative('2026-10-19T11:55:00Z', now)).toBe('5 minutes ago');
		expect(formatRelative('2026-10-19T10:00:00Z', now)).toBe('2 hours ago');
		expect(formatRelative('2026-10-18T12:00:00Z', now)).toBe('yesterday');
	});
});
