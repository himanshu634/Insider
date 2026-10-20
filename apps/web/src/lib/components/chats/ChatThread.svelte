<script lang="ts">
	import { createInfiniteQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Attachment } from 'svelte/attachments';
	import {
		fetchMessages,
		keys,
		LIVE_REFETCH_MS,
		type Chat,
		type Message
	} from '#lib/api/queries.js';
	import { buildThread, dayLabel } from '#lib/chats/thread.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatTime, todayIST } from '#lib/utils/dates.js';
	import { EmptyState, Icon, IconButton, Spinner } from '#lib/ui/index.js';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import ChatAvatar from './ChatAvatar.svelte';
	import MessageBubble from './MessageBubble.svelte';

	interface Props {
		/** A group JID, or "all" for every chat interleaved. */
		jid: string;
		/** The chat's list row, when known (null for "All chats" or while loading). */
		chat: Chat | null;
		selectedId: number | null;
		onopen: (message: Message) => void;
	}

	let { jid, chat, selectedId, onopen }: Props = $props();
	const i18n = getI18n();

	const isAll = $derived(jid === 'all');
	const title = $derived(isAll ? i18n.t('chats.all') : (chat?.name ?? jid));

	let searching = $state(false);
	let searchInput = $state('');
	let q = $state('');
	let debounce: ReturnType<typeof setTimeout> | undefined;
	function onsearch() {
		clearTimeout(debounce);
		debounce = setTimeout(() => (q = searchInput.trim()), 300);
	}
	function closeSearch() {
		searching = false;
		searchInput = '';
		q = '';
	}

	let pricesOnly = $state(false);
	const expanded = new SvelteSet<string>();

	const filter = $derived({ group: isAll ? undefined : jid, q });
	const feed = createInfiniteQuery(() => ({
		queryKey: keys.messages(filter),
		queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
			fetchMessages({ ...filter, cursor: pageParam, limit: 50 }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.next_cursor ?? undefined,
		refetchInterval: LIVE_REFETCH_MS
	}));

	// Pages arrive newest first; the thread reads oldest first.
	const messages = $derived.by(() => {
		const all = (feed.data?.pages.flatMap((p) => p.items) ?? []).toReversed();
		return pricesOnly ? all.filter((m) => m.observations.length > 0 || m.media.length > 0) : all;
	});
	const items = $derived(
		buildThread(messages, { expanded, byGroup: isAll, expandNoise: pricesOnly || q !== '' })
	);
	const today = $derived(todayIST());

	const subtitle = $derived.by(() => {
		if (isAll) return 'Every watched group, newest at the bottom';
		if (!chat) return '';
		const parts = [];
		if (chat.member_count) parts.push(`${chat.member_count} members`);
		if (chat.primary_commodities.length) parts.push(chat.primary_commodities.join(', '));
		if (chat.region_tag) parts.push(chat.region_tag);
		return parts.join('. ');
	});

	/** Load older messages when the top of the thread scrolls into view. */
	const loadOlder: Attachment<HTMLElement> = (node) => {
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting) && feed.hasNextPage && !feed.isFetchingNextPage)
					feed.fetchNextPage();
			},
			{ rootMargin: '400px 0px 0px 0px' }
		);
		io.observe(node);
		return () => io.disconnect();
	};
</script>

<section class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-2" aria-label={title}>
	<header
		class="flex min-h-15 flex-none items-center gap-2 border-b border-border bg-surface py-2 pr-2 pl-1 md:pl-4"
	>
		<a
			href={resolve('/chats')}
			aria-label={i18n.t('chats.back')}
			class="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink hover:bg-surface-2 md:hidden"
		>
			<Icon name="chevronLeft" size={20} />
		</a>
		<ChatAvatar name={title} key={isAll ? 'all' : jid} all={isAll} size="md" />
		{#if searching}
			<label class="flex min-w-0 flex-1 items-center gap-2 pl-2">
				<span class="sr-only">{i18n.t('chats.searchInChat')}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="search"
					autofocus
					bind:value={searchInput}
					oninput={onsearch}
					onkeydown={(e) => e.key === 'Escape' && closeSearch()}
					placeholder={i18n.t('chats.searchInChat')}
					class="h-11 min-w-0 flex-1 rounded-lg border-0 bg-surface-2 px-3 text-base focus:ring-2 focus:ring-focus"
				/>
			</label>
			<IconButton icon="x" label="Close search" onclick={closeSearch} />
		{:else}
			<div class="min-w-0 flex-1 pl-2">
				<h2
					class="truncate text-base leading-snug font-semibold"
					lang={/^[A-Za-z0-9]/.test(title) ? undefined : 'gu'}
				>
					{title}
				</h2>
				{#if subtitle}<p class="truncate text-xs text-ink-muted md:text-[0.8125rem]">
						{subtitle}
					</p>{/if}
			</div>
			<IconButton
				icon="search"
				label={i18n.t('chats.searchInChat')}
				onclick={() => (searching = true)}
			/>
			<button
				type="button"
				aria-pressed={pricesOnly}
				onclick={() => (pricesOnly = !pricesOnly)}
				class={[
					'inline-flex min-h-9 flex-none cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium',
					pricesOnly ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-ink-muted hover:text-ink'
				]}
			>
				{#if pricesOnly}<Icon name="check" size={16} />{/if}
				{i18n.t('chats.pricesOnly')}
			</button>
		{/if}
	</header>

	{#if feed.isPending}
		<div class="flex flex-1 items-center justify-center" role="status">
			<Spinner /><span class="sr-only">{i18n.t('common.loading')}</span>
		</div>
	{:else if feed.isError}
		<div class="p-4"><ErrorState error={feed.error} onretry={() => feed.refetch()} /></div>
	{:else if items.length === 0}
		<div class="p-4">
			{#if q || pricesOnly}
				<EmptyState
					icon="search"
					title={i18n.t('chats.noMatch.title')}
					body={i18n.t('chats.noMatch.body')}
				/>
			{:else}
				<EmptyState
					icon="message"
					title={i18n.t('chats.thread.empty.title')}
					body={i18n.t('chats.thread.empty.body')}
				/>
			{/if}
		</div>
	{:else}
		<!-- column-reverse: opens at the newest message, and older pages load above without a jump. -->
		<div
			class="wall flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3 md:px-10 lg:px-16"
		>
			<ol class="m-0 flex list-none flex-col gap-[3px] p-0">
				<li
					{@attach loadOlder}
					class="flex justify-center py-2"
					aria-hidden={!feed.isFetchingNextPage}
				>
					{#if feed.isFetchingNextPage}<Spinner />{/if}
				</li>
				{#each items as item (item.key)}
					{#if item.kind === 'day'}
						<li class="sticky top-1 z-[1] my-2 flex justify-center">
							<span class="pill rounded-lg bg-surface px-3 py-1 text-[0.8125rem] text-ink-muted"
								>{dayLabel(item.date, today, i18n.intlLocale)}</span
							>
						</li>
					{:else if item.kind === 'noise'}
						<li class="my-1 flex justify-center">
							<button
								type="button"
								onclick={() => expanded.add(item.key)}
								class="pill min-h-8 cursor-pointer rounded-lg bg-surface px-3 text-[0.8125rem] text-ink-muted hover:text-ink"
							>
								<span class="num"
									>{item.messages.length}
									{item.messages.length === 1 ? 'greeting' : 'greetings'}, {formatTime(
										item.from
									)}{item.messages.length > 1 ? `–${formatTime(item.to)}` : ''}.</span
								>
								<span class="font-medium text-primary">Show</span>
							</button>
						</li>
					{:else}
						<li class="flex flex-col">
							<MessageBubble
								message={item.message}
								tail={item.tail}
								showGroup={isAll}
								selected={selectedId === item.message.id}
								{onopen}
							/>
						</li>
					{/if}
				{/each}
			</ol>
		</div>
	{/if}

	<footer
		class="flex min-h-14 flex-none items-center justify-center gap-2 border-t border-border bg-surface px-4 pb-[env(safe-area-inset-bottom)] text-center text-sm text-ink-muted"
	>
		<Icon name="eye" size={20} />
		{i18n.t('chats.readOnly')}
	</footer>
</section>

<style>
	.pill {
		box-shadow: 0 1px 0.5px var(--shadow-overlay-color);
	}
</style>
