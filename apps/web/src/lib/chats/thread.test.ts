import { describe, expect, it } from 'vitest';
import type { Message, PriceObservation } from '#lib/api/queries.js';
import {
	avatarTone,
	buildThread,
	dayLabel,
	formatPriceRange,
	initials,
	previewText,
	senderTone
} from './thread.js';

let nextId = 1;
function msg(over: Partial<Message> = {}): Message {
	return {
		id: nextId++,
		group: { jid: 'g1@g.us', name: 'Gondal Castor Rates' },
		sender_name: 'Ramesh Bhai',
		sent_at: '2026-10-20T04:10:00Z',
		type: 'text',
		text: 'Gondal arenda close 1260-1288',
		label: 'price',
		is_forwarded: false,
		cluster_group_count: 1,
		observations: [],
		media: [],
		...over
	};
}

describe('buildThread', () => {
	it('starts every IST day with a day marker', () => {
		const items = buildThread([
			msg({ sent_at: '2026-10-19T18:00:00Z' }), // 19 Oct, 23:30 IST
			msg({ sent_at: '2026-10-19T18:45:00Z' }) // 20 Oct, 00:15 IST
		]);
		expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'day', 'message']);
		expect(items[0]).toMatchObject({ kind: 'day', date: '2026-10-19' });
		expect(items[2]).toMatchObject({ kind: 'day', date: '2026-10-20' });
	});

	it('gives the first message of a sender run a tail, and repeats after a break', () => {
		const items = buildThread([
			msg({ sender_name: 'Ramesh Bhai' }),
			msg({ sender_name: 'Ramesh Bhai' }),
			msg({ sender_name: 'Mahesh Dalal' }),
			msg({ sender_name: 'Ramesh Bhai' })
		]).filter((i) => i.kind === 'message');
		expect(items.map((i) => i.tail)).toEqual([true, false, true, true]);
	});

	it('folds consecutive noise into one collapsible run', () => {
		const items = buildThread([
			msg({ label: 'noise', text: 'Good morning', sent_at: '2026-10-20T03:32:00Z' }),
			msg({ label: 'noise', text: 'Jai Shree Krishna', sent_at: '2026-10-20T04:01:00Z' }),
			msg({ label: 'price' }),
			msg({ label: 'noise', text: 'Thank you' })
		]);
		expect(items.map((i) => i.kind)).toEqual(['day', 'noise', 'message', 'noise']);
		const run = items[1];
		expect(run).toMatchObject({
			kind: 'noise',
			from: '2026-10-20T03:32:00Z',
			to: '2026-10-20T04:01:00Z'
		});
		expect(run.kind === 'noise' && run.messages).toHaveLength(2);
	});

	it('keeps a message after a noise run tailed', () => {
		const items = buildThread([
			msg({ sender_name: 'Ramesh Bhai' }),
			msg({ sender_name: 'Ramesh Bhai', label: 'noise' }),
			msg({ sender_name: 'Ramesh Bhai' })
		]).filter((i) => i.kind === 'message');
		expect(items.map((i) => i.tail)).toEqual([true, true]);
	});

	it('opens one noise run without opening the others', () => {
		const messages = [
			msg({ label: 'noise' }),
			msg({ label: 'noise' }),
			msg({ label: 'price' }),
			msg({ label: 'noise' })
		];
		const runKey = buildThread(messages)[1].key;
		const items = buildThread(messages, { expanded: new Set([runKey]) });
		expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message', 'message', 'noise']);
	});

	it('in All chats, a change of group starts a new run', () => {
		const items = buildThread(
			[
				msg({ sender_name: 'Ramesh Bhai', group: { jid: 'g1@g.us', name: 'A' } }),
				msg({ sender_name: 'Ramesh Bhai', group: { jid: 'g2@g.us', name: 'B' } })
			],
			{ byGroup: true }
		).filter((i) => i.kind === 'message');
		expect(items.map((i) => i.tail)).toEqual([true, true]);
	});

	it('shows noise inline when asked to', () => {
		const items = buildThread([msg({ label: 'noise' }), msg({ label: 'noise' })], {
			expandNoise: true
		});
		expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'message']);
	});
});

describe('names and colours', () => {
	it('takes two initials from Latin names and one letter from Gujarati', () => {
		expect(initials('Gondal Castor Rates')).toBe('GC');
		expect(initials('kishan')).toBe('K');
		expect(initials('સૌરાષ્ટ્ર એરંડા વેપારી મંડળ')).toBe('સૌ');
		expect(initials('  ')).toBe('?');
	});

	it('picks a stable tone per key', () => {
		expect(avatarTone('g1@g.us')).toBe(avatarTone('g1@g.us'));
		expect(senderTone('Ramesh Bhai')).toBe(senderTone('Ramesh Bhai'));
		expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(avatarTone)).size).toBeGreaterThan(
			1
		);
	});
});

describe('labels', () => {
	it('names today and yesterday, then the date', () => {
		expect(dayLabel('2026-10-20', '2026-10-20')).toBe('Today');
		expect(dayLabel('2026-10-19', '2026-10-20')).toBe('Yesterday');
		expect(dayLabel('2026-10-14', '2026-10-20')).toBe('14 Oct 2026');
	});

	it('previews text, or names the media type', () => {
		expect(previewText({ text: 'Sing G20 1050-1140', type: 'text', is_forwarded: false })).toBe(
			'Sing G20 1050-1140'
		);
		expect(previewText({ text: null, type: 'image', is_forwarded: false })).toBe('Photo');
		expect(previewText({ text: 'Castor avg 1270', type: 'text', is_forwarded: true })).toBe(
			'Forwarded: Castor avg 1270'
		);
	});

	it('formats a ₹/quintal range, a single price, or nothing', () => {
		const base = {
			min_per_quintal: 6300,
			max_per_quintal: 6440,
			modal_per_quintal: null
		} as PriceObservation;
		expect(formatPriceRange(base)).toBe('₹6,300–6,440');
		expect(formatPriceRange({ ...base, min_per_quintal: 6350, max_per_quintal: 6350 })).toBe(
			'₹6,350'
		);
		expect(
			formatPriceRange({
				...base,
				min_per_quintal: null,
				max_per_quintal: null,
				modal_per_quintal: 6350
			})
		).toBe('₹6,350');
		expect(formatPriceRange({ ...base, min_per_quintal: null, max_per_quintal: null })).toBe('—');
	});
});
