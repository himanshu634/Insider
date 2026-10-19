<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { fetchCommodities, fetchLatestPrices, keys, type LatestPrice } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDate } from '#lib/utils/dates.js';
	import { formatNumber, humanizeSlug } from '#lib/utils/format.js';
	import { DataTable, Delta, EmptyState, PriceCell, Select, type Column } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();
	let commodity = $state('');

	const commodities = createQuery(() => ({
		queryKey: keys.commodities(),
		queryFn: fetchCommodities,
		staleTime: 10 * 60_000
	}));

	const prices = createQuery(() => ({
		queryKey: keys.latestPrices({ commodity }),
		queryFn: () => fetchLatestPrices({ commodity })
	}));

	const commodityOptions = $derived([
		{ value: '', label: i18n.t('common.all') },
		...(commodities.data ?? []).map((c) => ({ value: c.slug, label: c.name }))
	]);

	const columns: Column[] = [
		{ key: 'commodity', label: 'Commodity' },
		{ key: 'market', label: 'Mandi' },
		{ key: 'range', label: 'Min – max', numeric: true, hideOnMobile: true },
		{ key: 'modal', label: 'Modal ₹/q', numeric: true },
		{ key: 'd7', label: 'vs 7-day avg', numeric: true, hideOnMobile: true },
		{ key: 'sources', label: 'Sources', numeric: true, hideOnMobile: true },
		{ key: 'date', label: 'Date', numeric: true, hideOnMobile: true }
	];

	const rowKey = (r: LatestPrice) => `${r.commodity}|${r.variety ?? ''}|${r.market}`;
</script>

<PageHeader title={i18n.t('prices.title')} subtitle={i18n.t('prices.subtitle')}>
	{#snippet actions()}
		<Select label="Commodity" hideLabel options={commodityOptions} bind:value={commodity} />
	{/snippet}
</PageHeader>

{#if prices.isError}
	<ErrorState error={prices.error} onretry={() => prices.refetch()} />
{:else if prices.isSuccess && prices.data.length === 0}
	<EmptyState
		icon="chart"
		title={i18n.t('prices.empty.title')}
		body={i18n.t('prices.empty.body')}
	/>
{:else}
	<DataTable
		caption="Latest prices in rupees per quintal"
		{columns}
		rows={prices.data}
		key={rowKey}
		loading={prices.isPending}
	>
		{#snippet cell(row: LatestPrice, col: string)}
			{#if col === 'commodity'}
				<a
					class="font-medium text-ink underline-offset-2 hover:underline"
					href={resolve('/prices/[commodity]', { commodity: row.commodity })}
					>{humanizeSlug(row.commodity)}</a
				>
				{#if row.variety}<span class="block text-xs text-ink-muted">{row.variety}</span>{/if}
			{:else if col === 'market'}
				<a
					class="text-ink underline-offset-2 hover:underline"
					href={resolve('/markets/[market]', { market: row.market })}>{humanizeSlug(row.market)}</a
				>
				{#if row.district}<span class="block text-xs text-ink-muted">{row.district}</span>{/if}
			{:else if col === 'range'}
				<span class="text-ink-muted">
					<PriceCell value={row.min_per_quintal} /> – <PriceCell value={row.max_per_quintal} />
				</span>
			{:else if col === 'modal'}
				<PriceCell
					value={row.modal_per_quintal}
					delta={row.change_vs_yesterday}
					deltaLabel="vs yesterday"
					emphasis
				/>
			{:else if col === 'd7'}
				<Delta value={row.change_vs_7d_avg} against="vs 7-day average" />
			{:else if col === 'sources'}
				<span title="{row.source_count} independent sources across {row.group_count} groups"
					>{formatNumber(row.source_count)} / {formatNumber(row.group_count)}</span
				>
			{:else if col === 'date'}
				<time datetime={row.obs_date} class="text-ink-muted">{formatDate(row.obs_date)}</time>
			{/if}
		{/snippet}
	</DataTable>
	<p class="mt-2 text-xs text-ink-muted">
		All prices in ₹ per quintal (100 kg). Sources shows independent reports / WhatsApp groups.
	</p>
{/if}
