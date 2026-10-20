<script lang="ts">
	import { previewText } from '#lib/chats/thread.js';
	import type { Chat } from '#lib/api/queries.js';
	import { formatDate, formatTime, todayIST, toISTDateString } from '#lib/utils/dates.js';
	import ChatAvatar from './ChatAvatar.svelte';

	interface Props {
		href: string;
		selected: boolean;
		/** A real chat, or the summary for the "All chats" row. */
		chat:
			| Chat
			| { all: true; name: string; summary: string; priceCount: number; lastAt: string | null };
	}

	let { href, selected, chat }: Props = $props();

	const isAll = $derived('all' in chat);
	const lastAt = $derived('all' in chat ? chat.lastAt : (chat.last_message?.sent_at ?? null));
	const priceCount = $derived('all' in chat ? chat.priceCount : chat.today_price_count);
	const isGujarati = $derived(!/^[A-Za-z0-9]/.test(chat.name.trim()));

	const when = $derived.by(() => {
		if (!lastAt) return '';
		return toISTDateString(lastAt) === todayIST()
			? formatTime(lastAt)
			: formatDate(toISTDateString(lastAt));
	});

	const preview = $derived.by(() => {
		if ('all' in chat) return chat.summary;
		const last = chat.last_message;
		if (!last) return 'No messages yet';
		const body = previewText(last);
		const who = last.sender_name?.split(' ')[0];
		return who && !last.is_forwarded ? `${who}: ${body}` : body;
	});
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- href is built from resolve() by the page -->
<a
	{href}
	aria-current={selected ? 'true' : undefined}
	class={[
		'chat-row flex min-h-[4.5rem] items-center gap-3 pr-3 pl-4 text-ink no-underline',
		selected ? 'bg-surface-2' : 'hover:bg-surface-2/60'
	]}
>
	<ChatAvatar name={chat.name} key={'all' in chat ? 'all' : chat.jid} all={isAll} />
	<span
		class={[
			'flex min-w-0 flex-1 flex-col justify-center self-stretch py-2.5',
			!selected && 'border-b border-border/70'
		]}
	>
		<span class="flex items-baseline gap-2">
			<span
				lang={isGujarati ? 'gu' : undefined}
				class={[
					'min-w-0 flex-1 text-base leading-snug font-semibold',
					// Gujarati names wrap between words; Latin names stay on one line.
					isGujarati ? 'break-words' : 'truncate'
				]}>{chat.name}</span
			>
			{#if when}<span class="num flex-none text-xs text-ink-muted">{when}</span>{/if}
		</span>
		<span class="mt-0.5 flex items-center gap-2">
			<span class="min-w-0 flex-1 truncate text-sm text-ink-muted">{preview}</span>
			{#if priceCount > 0}
				<span
					class="num inline-flex h-5 flex-none items-center rounded-full bg-positive-soft px-2 text-xs font-semibold text-positive"
				>
					{priceCount}
					{priceCount === 1 ? 'price' : 'prices'}
				</span>
			{/if}
		</span>
	</span>
</a>
