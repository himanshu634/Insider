<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchInsights, keys, type InsightType } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { EmptyState, SegmentedControl } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import InsightCard from '#lib/components/InsightCard.svelte';

	const i18n = getI18n();
	let type = $state<InsightType | 'all'>('all');
	const filter = $derived(type === 'all' ? {} : { type });

	const insights = createQuery(() => ({
		queryKey: keys.insights(filter),
		queryFn: () => fetchInsights(filter)
	}));

	const options: { value: InsightType | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'price_move', label: 'Moves' },
		{ value: 'spread', label: 'Spreads' },
		{ value: 'arrival_spike', label: 'Arrivals' },
		{ value: 'conflict', label: 'Conflicts' },
		{ value: 'news', label: 'News' }
	];
</script>

<PageHeader title={i18n.t('insights.title')} subtitle={i18n.t('insights.subtitle')} />

<div class="mb-4">
	<SegmentedControl label="Insight type" size="sm" bind:value={type} {options} />
</div>

{#if insights.isPending}
	<LoadingState rows={6} />
{:else if insights.isError}
	<ErrorState error={insights.error} onretry={() => insights.refetch()} />
{:else if insights.data.items.length === 0}
	<EmptyState
		icon="bulb"
		title={i18n.t('insights.empty.title')}
		body={i18n.t('insights.empty.body')}
	/>
{:else}
	<div class="grid gap-3 md:grid-cols-2">
		{#each insights.data.items as insight (insight.id)}
			<InsightCard {insight} showDate />
		{/each}
	</div>
{/if}
