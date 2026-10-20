<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import { fetchChats, keys, LIVE_REFETCH_MS, type Chat, type Message } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { Dialog, EmptyState, IconButton, Skeleton, Button } from '#lib/ui/index.js';
	import CollectorBadge from '#lib/components/CollectorBadge.svelte';
	import LocaleToggle from '#lib/components/LocaleToggle.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import ChatRow from '#lib/components/chats/ChatRow.svelte';
	import ChatThread from '#lib/components/chats/ChatThread.svelte';
	import PriceDetails from '#lib/components/chats/PriceDetails.svelte';

	const i18n = getI18n();

	const chats = createQuery(() => ({
		queryKey: keys.chats(),
		queryFn: fetchChats,
		refetchInterval: LIVE_REFETCH_MS
	}));

	/** `?chat=<jid>` or `?chat=all`. No param: the list on a phone, "All chats" on desktop. */
	const param = $derived(page.url.searchParams.get('chat'));
	const jid = $derived(param ?? 'all');
	const chatHref = (key: string) => `${resolve('/chats')}?chat=${encodeURIComponent(key)}`;

	type Show = 'all' | 'prices' | 'quiet';
	let show = $state<Show>('all');
	let search = $state('');

	const list = $derived(chats.data ?? []);
	const visible = $derived.by(() => {
		const term = search.trim().toLowerCase();
		return list.filter((c) => {
			if (show === 'prices' && c.today_price_count === 0) return false;
			if (show === 'quiet' && c.today_count > 0) return false;
			if (!term) return true;
			return (
				c.name.toLowerCase().includes(term) ||
				(c.last_message?.text ?? '').toLowerCase().includes(term)
			);
		});
	});

	const totals = $derived({
		messages: list.reduce((n, c) => n + c.today_count, 0),
		prices: list.reduce((n, c) => n + c.today_price_count, 0),
		active: list.filter((c) => c.today_count > 0).length,
		lastAt: list.find((c) => c.last_message)?.last_message?.sent_at ?? null
	});

	const current = $derived<Chat | null>(list.find((c) => c.jid === jid) ?? null);

	// Price details: a right-hand drawer on wide screens, a bottom sheet below that.
	let picked = $state<Message | null>(null);
	// Details belong to the open chat; switching chats closes them.
	const selected = $derived(picked && (jid === 'all' || picked.group.jid === jid) ? picked : null);
	const wide = new MediaQuery('min-width: 1280px');
	let sheetOpen = $derived(selected !== null && !wide.current);

	function open(message: Message) {
		picked = message;
	}
	function closeDetails() {
		picked = null;
	}

	const FILTERS: {
		value: Show;
		key: 'chats.filter.all' | 'chats.filter.prices' | 'chats.filter.quiet';
	}[] = [
		{ value: 'all', key: 'chats.filter.all' },
		{ value: 'prices', key: 'chats.filter.prices' },
		{ value: 'quiet', key: 'chats.filter.quiet' }
	];
</script>

<svelte:head><title>{i18n.t('chats.title')} · {i18n.t('brand')}</title></svelte:head>

<div class="flex min-h-0 flex-1">
	<!-- Chat list: the whole screen on a phone until a chat opens; a fixed pane on desktop. -->
	<section
		aria-label={i18n.t('chats.title')}
		class={[
			'min-h-0 w-full flex-col overflow-y-auto border-r border-border bg-surface md:flex md:w-[22rem] md:flex-none lg:w-[24rem]',
			param ? 'hidden' : 'flex'
		]}
	>
		<div class="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
			<h1 class="text-2xl font-bold md:text-[1.375rem]">{i18n.t('chats.title')}</h1>
			<div class="hidden items-center gap-1 md:flex">
				<CollectorBadge />
				<LocaleToggle />
			</div>
		</div>
		<label
			class="mx-3 flex h-11 items-center gap-2.5 rounded-full bg-surface-2 px-4 text-ink-muted md:rounded-lg"
		>
			<span class="sr-only">{i18n.t('chats.search')}</span>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				aria-hidden="true"><path d="M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg
			>
			<input
				type="search"
				bind:value={search}
				placeholder={i18n.t('chats.search')}
				class="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-ink placeholder:text-ink-muted focus:ring-0"
			/>
		</label>
		<div role="group" aria-label={i18n.t('chats.filter')} class="flex gap-2 px-3 pt-2.5 pb-1.5">
			{#each FILTERS as f (f.value)}
				<button
					type="button"
					aria-pressed={show === f.value}
					onclick={() => (show = f.value)}
					class={[
						'min-h-8 cursor-pointer rounded-full px-3.5 text-sm font-medium',
						show === f.value
							? 'bg-primary-soft text-primary'
							: 'bg-surface-2 text-ink-muted hover:text-ink'
					]}
				>
					{i18n.t(f.key)}
				</button>
			{/each}
		</div>

		{#if chats.isPending}
			<div class="space-y-4 p-4" role="status">
				<span class="sr-only">{i18n.t('common.loading')}</span>
				{#each [1, 2, 3, 4, 5] as n (n)}
					<div class="flex items-center gap-3">
						<Skeleton width="3rem" height="3rem" class="flex-none rounded-full" />
						<div class="flex-1"><Skeleton lines={2} /></div>
					</div>
				{/each}
			</div>
		{:else if chats.isError}
			<div class="p-4"><ErrorState error={chats.error} onretry={() => chats.refetch()} /></div>
		{:else if list.length === 0}
			<div class="p-4">
				<EmptyState
					icon="message"
					title={i18n.t('chats.empty.title')}
					body={i18n.t('chats.empty.body')}
				>
					{#snippet action()}
						<Button variant="primary" href={resolve('/settings/groups')}
							>{i18n.t('chats.empty.action')}</Button
						>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<nav aria-label={i18n.t('chats.title')}>
				<ChatRow
					href={chatHref('all')}
					selected={jid === 'all'}
					chat={{
						all: true,
						name: i18n.t('chats.all'),
						summary: `${totals.messages} today from ${totals.active} ${totals.active === 1 ? 'chat' : 'chats'}`,
						priceCount: totals.prices,
						lastAt: totals.lastAt
					}}
				/>
				{#each visible as chat (chat.jid)}
					<ChatRow href={chatHref(chat.jid)} selected={chat.jid === jid} {chat} />
				{/each}
				{#if visible.length === 0}
					<p class="px-4 py-6 text-center text-sm text-ink-muted">{i18n.t('chats.noMatch.body')}</p>
				{/if}
			</nav>
		{/if}
	</section>

	<!-- The open chat: full screen on a phone, the main pane on desktop. -->
	<div class={['min-h-0 min-w-0 flex-1', param ? 'flex' : 'hidden md:flex']}>
		{#key jid}
			<ChatThread
				{jid}
				chat={current}
				selectedId={selected?.id ?? null}
				onopen={open}
			/>
		{/key}
	</div>

	{#if selected && wide.current}
		<aside
			aria-labelledby="price-details-title"
			class="flex w-[22.5rem] flex-none flex-col overflow-y-auto border-l border-border bg-surface"
		>
			<div class="flex min-h-15 items-center gap-2 border-b border-border px-2">
				<IconButton icon="x" label="Close price details" onclick={closeDetails} />
				<h2 id="price-details-title" class="text-base font-semibold">{i18n.t('chats.details')}</h2>
			</div>
			<div class="p-4"><PriceDetails message={selected} /></div>
		</aside>
	{/if}
</div>

{#if selected && !wide.current}
	<Dialog
		bind:open={sheetOpen}
		title={i18n.t('chats.details')}
		variant="sheet"
		onclose={closeDetails}
	>
		<PriceDetails message={selected} />
	</Dialog>
{/if}
