<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { fetchDailyPrices, keys, type DailyPricePoint } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { addDays, formatDate, todayIST } from '#lib/utils/dates.js';
	import { formatNumber, humanizeSlug } from '#lib/utils/format.js';
	import {
		Badge,
		Card,
		DataTable,
		EmptyState,
		PriceCell,
		SegmentedControl,
		Skeleton,
		type BadgeTone,
		type Column
	} from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import PriceTrend from '#lib/components/charts/PriceTrend.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const i18n = getI18n();

	type Range = '30' | '90' | '365';
	let range = $state<Range>('90');
	const to = todayIST();
	const from = $derived(addDays(to, -Number(range)));

	const daily = createQuery(() => ({
		queryKey: keys.dailyPrices({ commodity: params.commodity, from, to }),
		queryFn: () => fetchDailyPrices({ commodity: params.commodity, from, to })
	}));

	// Latest point per market, for the table under the chart (also the chart's text alternative).
	const latestByMarket = $derived.by(() => {
		const latest: Record<string, DailyPricePoint> = {};
		for (const p of daily.data ?? []) {
			const prev = latest[p.market];
			if (!prev || p.date > prev.date) latest[p.market] = p;
		}
		return Object.values(latest).sort((a, b) => b.median_modal - a.median_modal);
	});

	const QUALITY: Record<DailyPricePoint['quality_flag'], { tone: BadgeTone; label: string }> = {
		ok: { tone: 'positive', label: 'Confirmed' },
		single_source: { tone: 'warning', label: 'Single source' },
		conflicting: { tone: 'negative', label: 'Conflicting' },
		out_of_bounds: { tone: 'negative', label: 'Out of bounds' }
	};

	const columns: Column[] = [
		{ key: 'market', label: 'Mandi' },
		{ key: 'modal', label: 'Median ₹/q', numeric: true },
		{ key: 'range', label: 'Min – max', numeric: true, hideOnMobile: true },
		{ key: 'sources', label: 'Sources', numeric: true, hideOnMobile: true },
		{ key: 'quality', label: 'Quality' },
		{ key: 'date', label: 'Date', numeric: true, hideOnMobile: true }
	];

	const name = $derived(humanizeSlug(params.commodity));
</script>

<PageHeader title={name} subtitle="Daily median price by mandi, ₹ per quintal.">
	{#snippet actions()}
		<SegmentedControl
			label="Date range"
			bind:value={range}
			options={[
				{ value: '30', label: '30 days' },
				{ value: '90', label: '90 days' },
				{ value: '365', label: '1 year' }
			]}
		/>
	{/snippet}
</PageHeader>

<p class="mb-4 text-sm">
	<a class="text-primary underline-offset-2 hover:underline" href={resolve('/prices')}>All prices</a
	>
</p>

{#if daily.isPending}
	<Card padding="md"><Skeleton height="320px" /></Card>
{:else if daily.isError}
	<ErrorState error={daily.error} onretry={() => daily.refetch()} />
{:else if daily.data.length === 0}
	<EmptyState icon="chart" title={i18n.t('trend.empty.title')} body={i18n.t('trend.empty.body')} />
{:else}
	<Card padding="sm">
		<PriceTrend
			points={daily.data}
			label="{name} daily median price per mandi from {formatDate(from)} to {formatDate(
				to
			)}, in rupees per quintal. The table below lists the latest value per mandi."
		/>
	</Card>

	<h2 class="mt-6 mb-3 text-base font-semibold text-ink">Latest by mandi</h2>
	<DataTable
		caption="Latest daily price per mandi for {name}"
		{columns}
		rows={latestByMarket}
		key={(r) => r.market}
	>
		{#snippet cell(row: DailyPricePoint, col: string)}
			{#if col === 'market'}
				<a
					class="font-medium text-ink underline-offset-2 hover:underline"
					href={resolve('/markets/[market]', { market: row.market })}>{humanizeSlug(row.market)}</a
				>
			{:else if col === 'modal'}
				<PriceCell value={row.median_modal} emphasis />
			{:else if col === 'range'}
				<PriceCell value={row.min} /> – <PriceCell value={row.max} />
			{:else if col === 'sources'}
				{formatNumber(row.source_count)} / {formatNumber(row.group_count)}
			{:else if col === 'quality'}
				<Badge tone={QUALITY[row.quality_flag].tone}>{QUALITY[row.quality_flag].label}</Badge>
			{:else if col === 'date'}
				<time class="text-ink-muted" datetime={row.date}>{formatDate(row.date)}</time>
			{/if}
		{/snippet}
	</DataTable>
{/if}
