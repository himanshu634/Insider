<script lang="ts">
	import type { Message } from '#lib/api/queries.js';
	import { mediaLabel, senderTone } from '#lib/chats/thread.js';
	import { formatTime } from '#lib/utils/dates.js';
	import { Icon } from '#lib/ui/index.js';
	import PriceQuote from './PriceQuote.svelte';

	interface Props {
		message: Message;
		/** First bubble of a sender's run: gets the tail and the sender name. */
		tail: boolean;
		/** "All chats": name the group above the sender. */
		showGroup?: boolean;
		selected?: boolean;
		onopen: (message: Message) => void;
	}

	let { message, tail, showGroup = false, selected = false, onopen }: Props = $props();

	const tone = $derived(senderTone(message.sender_name ?? message.group.jid));
	const media = $derived(message.media[0]);
	const isMedia = $derived(message.type !== 'text' && message.type !== 'system');
	const alsoIn = $derived(message.cluster_group_count - 1);
	const OCR: Record<string, { text: string; cls: string } | undefined> = {
		pending: { text: 'Reading image…', cls: 'bg-warning-soft text-warning' },
		failed: { text: 'Could not read', cls: 'bg-negative-soft text-negative' }
	};
	const ocr = $derived(media ? OCR[media.ocr_status] : undefined);
</script>

<article
	class={[
		'bubble shadow-bubble relative max-w-[min(32rem,85%)] self-start rounded-lg bg-surface px-2.5 pt-1.5 pb-1.5',
		tail ? 'tail mt-2 ml-2 rounded-tl-none' : 'ml-2',
		selected && 'outline-2 outline-offset-2 outline-accent'
	]}
	aria-label="{message.sender_name ?? 'Unknown sender'}, {formatTime(message.sent_at)}"
>
	{#if tail}
		{#if showGroup}
			<div class="text-xs font-medium text-ink-muted">{message.group.name}</div>
		{/if}
		{#if message.sender_name}
			<div
				class={[
					'text-[0.8125rem] leading-5 font-semibold',
					{
						primary: 'text-primary',
						info: 'text-info',
						accent: 'text-accent-text',
						ink: 'text-ink'
					}[tone]
				]}
			>
				{message.sender_name}
			</div>
		{/if}
	{/if}

	{#if message.is_forwarded || alsoIn > 0}
		<div
			class="flex flex-wrap items-center gap-1.5 text-[0.8125rem] leading-5 text-ink-muted italic"
		>
			{#if message.is_forwarded}<Icon name="forward" size={16} />Forwarded{/if}
			{#if alsoIn > 0}
				<span
					class="inline-flex h-5 items-center rounded-full bg-info-soft px-2 text-xs font-medium text-info not-italic"
					>Also in {alsoIn} {alsoIn === 1 ? 'chat' : 'chats'}</span
				>
			{/if}
		</div>
	{/if}

	{#if isMedia}
		<div
			class="photo mt-1 flex h-36 w-60 max-w-full items-center justify-center gap-2 rounded-md text-sm text-ink-muted"
		>
			<Icon name="image" size={20} />{mediaLabel(message.type)}
		</div>
		{#if ocr}
			<span
				class={[
					'mt-1.5 inline-flex h-5 items-center rounded-full px-2 text-xs font-medium',
					ocr.cls
				]}>{ocr.text}</span
			>
		{/if}
	{/if}

	{#if message.text}
		<p class="m-0 text-base leading-[1.375rem] break-words whitespace-pre-line">{message.text}</p>
	{/if}

	{#if message.observations.length}
		<PriceQuote observations={message.observations} onopen={() => onopen(message)} />
	{/if}

	<time class="num float-right mt-1 -mb-1 ml-3.5 text-xs text-ink-muted" datetime={message.sent_at}
		>{formatTime(message.sent_at)}</time
	>
	<div class="clear-both"></div>
</article>

<style>
	.shadow-bubble {
		box-shadow: 0 1px 0.5px var(--shadow-overlay-color);
	}

	/* The WhatsApp tail: a small wedge on the first bubble of a run. */
	.tail::before {
		content: '';
		position: absolute;
		top: 0;
		left: -8px;
		width: 8px;
		height: 13px;
		background: var(--surface);
		clip-path: polygon(0 0, 100% 0, 100% 100%);
	}

	.photo {
		background: repeating-linear-gradient(135deg, var(--surface-2) 0 12px, var(--bg) 12px 24px);
	}
</style>
