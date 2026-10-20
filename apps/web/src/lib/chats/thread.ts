/**
 * Pure helpers for the WhatsApp-style chat view: day markers, sender runs (which bubble
 * gets a tail), collapsed greetings, avatar initials and colours, preview and price text.
 */
import type { Message, MessagePreview, PriceObservation } from '#lib/api/queries.js';
import { addDays, formatDate, toISTDateString } from '#lib/utils/dates.js';
import { EMPTY, formatNumber } from '#lib/utils/format.js';

export type ThreadItem =
	| { kind: 'day'; key: string; date: string }
	| { kind: 'message'; key: string; message: Message; tail: boolean }
	| { kind: 'noise'; key: string; messages: Message[]; from: string; to: string };

/**
 * Lay out messages (oldest first) as a chat thread. A day marker opens each IST day,
 * the first bubble of a sender's run gets a tail, and runs of greetings and chit-chat
 * fold into one line unless `expandNoise` is set.
 */
export function buildThread(
	messages: Message[],
	{
		expandNoise = false,
		expanded,
		byGroup = false
	}: {
		/** Show every greeting inline. */
		expandNoise?: boolean;
		/** Keys of noise runs the reader opened. */
		expanded?: ReadonlySet<string>;
		/** "All chats": a change of group also starts a new run. */
		byGroup?: boolean;
	} = {}
): ThreadItem[] {
	// Pass 1: day markers, single messages and runs of consecutive noise.
	const laid: ThreadItem[] = [];
	let day: string | null = null;
	for (const message of messages) {
		const date = toISTDateString(message.sent_at);
		if (date !== day) {
			day = date;
			laid.push({ kind: 'day', key: `day-${date}`, date });
		}
		const prev = laid.at(-1);
		if (message.label === 'noise') {
			if (prev?.kind === 'noise') {
				prev.messages.push(message);
				prev.to = message.sent_at;
			} else {
				laid.push({
					kind: 'noise',
					key: `noise-${message.id}`,
					messages: [message],
					from: message.sent_at,
					to: message.sent_at
				});
			}
		} else {
			laid.push({ kind: 'message', key: `m-${message.id}`, message, tail: false });
		}
	}

	// Pass 2: open the runs the reader expanded, and give each sender run's first bubble a tail.
	const items: ThreadItem[] = [];
	let lastSender: string | undefined;
	const pushMessage = (message: Message) => {
		const sender = `${byGroup ? message.group.jid : ''}|${message.sender_name ?? ''}`;
		items.push({ kind: 'message', key: `m-${message.id}`, message, tail: sender !== lastSender });
		lastSender = sender;
	};
	for (const item of laid) {
		if (item.kind === 'message') pushMessage(item.message);
		else if (item.kind === 'noise' && (expandNoise || expanded?.has(item.key)))
			item.messages.forEach(pushMessage);
		else {
			items.push(item);
			lastSender = undefined;
		}
	}
	return items;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const LATIN = /^[A-Za-z0-9]/;

/** "Gondal Castor Rates" → "GC"; a Gujarati name → its first syllable cluster. */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '?';
	const first = (word: string) =>
		segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '';
	const head = first(words[0]);
	// One Gujarati grapheme (consonant + matra, e.g. "સૌ") reads better than two broken letters.
	if (!LATIN.test(head)) return head;
	return (head + (words[1] && LATIN.test(words[1]) ? first(words[1]) : '')).toUpperCase();
}

function hash(key: string): number {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/** Avatar colour pairs (fill + text role), all ≥4.5:1 in both themes. */
export const AVATAR_TONES = ['primary', 'info', 'accent', 'neutral'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

export function avatarTone(key: string): AvatarTone {
	return AVATAR_TONES[hash(key) % AVATAR_TONES.length];
}

/** Sender-name colours inside a group: text roles that pass 4.5:1 on the bubble. */
export const SENDER_TONES = ['primary', 'info', 'accent', 'ink'] as const;
export type SenderTone = (typeof SENDER_TONES)[number];

export function senderTone(name: string): SenderTone {
	return SENDER_TONES[hash(name) % SENDER_TONES.length];
}

/** "Today", "Yesterday", or "14 Oct 2026" for an IST calendar day. */
export function dayLabel(date: string, today: string, locale = 'en-IN'): string {
	if (date === today) return 'Today';
	if (date === addDays(today, -1)) return 'Yesterday';
	return formatDate(date, locale);
}

const MEDIA_LABEL: Record<Message['type'], string> = {
	text: 'Message',
	image: 'Photo',
	document: 'Document',
	audio: 'Voice note',
	video: 'Video',
	sticker: 'Sticker',
	location: 'Location',
	contact: 'Contact',
	system: 'Group update',
	other: 'Message'
};

export function mediaLabel(type: Message['type']): string {
	return MEDIA_LABEL[type];
}

/** One line for the chat list: the text, or what kind of media it was. */
export function previewText(last: Pick<MessagePreview, 'text' | 'type' | 'is_forwarded'>): string {
	const body = last.text?.trim() || MEDIA_LABEL[last.type];
	return last.is_forwarded ? `Forwarded: ${body}` : body;
}

/** "₹6,300–6,440", "₹6,350", or an em dash when nothing was read. */
export function formatPriceRange(
	obs: Pick<PriceObservation, 'min_per_quintal' | 'max_per_quintal' | 'modal_per_quintal'>
): string {
	const { min_per_quintal: min, max_per_quintal: max, modal_per_quintal: modal } = obs;
	if (min != null && max != null)
		return min === max ? `₹${formatNumber(min)}` : `₹${formatNumber(min)}–${formatNumber(max)}`;
	const single = modal ?? min ?? max;
	return single != null ? `₹${formatNumber(single)}` : EMPTY;
}

/** "1260–1288" as reported, before conversion. */
export function formatRawRange(
	obs: Pick<PriceObservation, 'min_raw' | 'max_raw' | 'modal_raw'>
): string {
	const { min_raw: min, max_raw: max, modal_raw: modal } = obs;
	if (min != null && max != null)
		return min === max ? formatNumber(min, 2) : `${formatNumber(min, 2)}–${formatNumber(max, 2)}`;
	const single = modal ?? min ?? max;
	return single != null ? formatNumber(single, 2) : EMPTY;
}
