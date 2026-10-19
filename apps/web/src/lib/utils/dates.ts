/**
 * Date helpers pinned to India Standard Time. The team, the mandis and the
 * 19:00 brief all run on IST, whatever timezone the browser happens to be in.
 */

export const IST = 'Asia/Kolkata';

const isoDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: IST,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

function toDate(value: Date | string | number): Date {
	return value instanceof Date ? value : new Date(value);
}

/** The IST calendar day of `now` as YYYY-MM-DD (the API's `date` format). */
export function todayIST(now: Date = new Date()): string {
	return isoDay.format(now);
}

/** Any instant as its IST calendar day, YYYY-MM-DD. */
export function toISTDateString(value: Date | string | number): string {
	return isoDay.format(toDate(value));
}

/** YYYY-MM-DD shifted by `days` (calendar arithmetic, no timezone involved). */
export function addDays(isoDate: string, days: number): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + days));
	return dt.toISOString().slice(0, 10);
}

function fmt(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat(locale, { ...options, timeZone: IST });
}

/**
 * A calendar date from the API (YYYY-MM-DD, no time) → "19 Oct 2026".
 * Parsed at IST noon so the day never slips across a timezone boundary.
 */
export function formatDate(isoDate: string, locale = 'en-IN'): string {
	const d = new Date(`${isoDate}T12:00:00+05:30`);
	if (Number.isNaN(d.getTime())) return isoDate;
	return fmt(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** A timestamp → "19 Oct, 07:00 pm" in IST. */
export function formatDateTime(value: Date | string | number, locale = 'en-IN'): string {
	const d = toDate(value);
	if (Number.isNaN(d.getTime())) return String(value);
	return fmt(locale, {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true
	}).format(d);
}

/** A timestamp → "07:00 pm" in IST. */
export function formatTime(value: Date | string | number, locale = 'en-IN'): string {
	const d = toDate(value);
	if (Number.isNaN(d.getTime())) return String(value);
	return fmt(locale, { hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
}

/** "5 minutes ago" / "in 2 hours", relative to `now`. */
export function formatRelative(
	value: Date | string | number,
	now: Date = new Date(),
	locale = 'en'
): string {
	const d = toDate(value);
	if (Number.isNaN(d.getTime())) return String(value);
	const seconds = Math.round((d.getTime() - now.getTime()) / 1000);
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	const abs = Math.abs(seconds);
	if (abs < 60) return rtf.format(seconds, 'second');
	if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
	if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
	return rtf.format(Math.round(seconds / 86_400), 'day');
}
