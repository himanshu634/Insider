<script lang="ts">
	import { createInfiniteQuery } from '@tanstack/svelte-query';
	import {
		fetchMessages,
		keys,
		LIVE_REFETCH_MS,
		type MessageLabel,
		type MessagesParams
	} from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDateTime } from '#lib/utils/dates.js';
	import {
		Badge,
		Button,
		EmptyState,
		Input,
		SegmentedControl,
		type BadgeTone
	} from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();

	let label = $state<MessageLabel | 'all'>('all');
	let searchInput = $state('');
	let q = $state('');
	let debounce: ReturnType<typeof setTimeout> | undefined;

	function onsearch() {
		clearTimeout(debounce);
		debounce = setTimeout(() => (q = searchInput.trim()), 300);
	}

	const filter = $derived<MessagesParams>({ label: label === 'all' ? undefined : label, q });
	const filtered = $derived(label !== 'all' || q !== '');

	const feed = createInfiniteQuery(() => ({
		queryKey: keys.messages(filter),
		queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
			fetchMessages({ ...filter, cursor: pageParam, limit: 50 }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.next_cursor ?? undefined,
		refetchInterval: LIVE_REFETCH_MS
	}));

	const messages = $derived(feed.data?.pages.flatMap((p) => p.items) ?? []);

	const LABELS: { value: MessageLabel | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'price', label: 'Price' },
		{ value: 'arrivals', label: 'Arrivals' },
		{ value: 'news', label: 'News' },
		{ value: 'advisory', label: 'Advisory' },
		{ value: 'noise', label: 'Noise' }
	];

	const LABEL_TONE: Record<MessageLabel, BadgeTone> = {
		price: 'positive',
		arrivals: 'info',
		news: 'accent',
		advisory: 'warning',
		noise: 'neutral'
	};
</script>

<PageHeader title={i18n.t('feed.title')} subtitle={i18n.t('feed.subtitle')} />

<div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
	<Input
		label="Search messages"
		hideLabel
		type="search"
		icon="search"
		placeholder="Search messages"
		bind:value={searchInput}
		oninput={onsearch}
		class="md:w-80"
	/>
	<SegmentedControl label="Message label" size="sm" bind:value={label} options={LABELS} />
</div>

{#if feed.isPending}
	<LoadingState rows={8} />
{:else if feed.isError}
	<ErrorState error={feed.error} onretry={() => feed.refetch()} />
{:else if messages.length === 0}
	{#if filtered}
		<EmptyState
			icon="search"
			title={i18n.t('feed.noMatch.title')}
			body={i18n.t('feed.noMatch.body')}
		/>
	{:else}
		<EmptyState
			icon="message"
			title={i18n.t('feed.empty.title')}
			body={i18n.t('feed.empty.body')}
		/>
	{/if}
{:else}
	<ol class="divide-y divide-border rounded-lg border border-border bg-surface">
		{#each messages as message (message.id)}
			<li class="p-4">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
					<span class="font-medium text-ink">{message.group.name}</span>
					{#if message.sender_name}<span>{message.sender_name}</span>{/if}
					<time class="num" datetime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
					{#if message.label}<Badge tone={LABEL_TONE[message.label]}>{message.label}</Badge>{/if}
					{#if message.is_forwarded}<Badge>Forwarded</Badge>{/if}
					{#if message.cluster_group_count > 1}
						<Badge tone="info" title="The same content was posted in other groups"
							>In {message.cluster_group_count} groups</Badge
						>
					{/if}
				</div>
				{#if message.text}
					<p class="mt-2 max-w-prose text-sm whitespace-pre-line text-ink">{message.text}</p>
				{:else}
					<p class="mt-2 text-sm text-ink-muted italic">{message.type} message</p>
				{/if}
			</li>
		{/each}
	</ol>
	{#if feed.hasNextPage}
		<div class="mt-4 flex justify-center">
			<Button loading={feed.isFetchingNextPage} onclick={() => feed.fetchNextPage()}
				>Load older messages</Button
			>
		</div>
	{/if}
{/if}
