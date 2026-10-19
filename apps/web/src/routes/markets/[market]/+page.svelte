<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { fetchLatestPrices, fetchMarkets, keys, type LatestPrice } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDate } from '#lib/utils/dates.js';
	import { formatNumber, humanizeSlug } from '#lib/utils/format.js';
	import { DataTable, Delta, EmptyState, PriceCell, type Column } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const i18n = getI18n();

	// No per-market endpoint in the contract yet: read the latest board and filter it here.
	const prices = createQuery(() => ({
		queryKey: keys.latestPrices(),
		queryFn: () => fetchLatestPrices()
	}));

	const markets = createQuery(() => ({
		queryKey: keys.markets(),
		queryFn: fetchMarkets,
		staleTime: 10 * 60_000
	}));

	const slug = $derived(params.market.toLowerCase());
	const market = $derived(
		markets.data?.find((m) => m.slug === slug || m.name.toLowerCase() === slug) ?? null
	);
	const rows = $derived(
		(prices.data ?? []).filter(
			(p) =>
				p.market.toLowerCase() === slug || p.market.toLowerCase() === market?.name.toLowerCase()
		)
	);

	const columns: Column[] = [
		{ key: 'commodity', label: 'Commodity' },
		{ key: 'modal', label: 'Modal ₹/q', numeric: true },
		{ key: 'd7', label: 'vs 7-day avg', numeric: true, hideOnMobile: true },
		{ key: 'sources', label: 'Sources', numeric: true, hideOnMobile: true },
		{ key: 'date', label: 'Date', numeric: true }
	];

	const subtitle = $derived(
		market
			? [market.district, market.state].filter(Boolean).join(', ')
			: 'Latest prices reported from this mandi, ₹ per quintal.'
	);
</script>

<PageHeader title={market?.name ?? humanizeSlug(params.market)} {subtitle} />

{#if prices.isError}
	<ErrorState error={prices.error} onretry={() => prices.refetch()} />
{:else if prices.isSuccess && rows.length === 0}
	<EmptyState
		icon="store"
		title={i18n.t('market.empty.title')}
		body={i18n.t('market.empty.body')}
	/>
{:else}
	<DataTable
		caption="Latest prices at this mandi"
		{columns}
		{rows}
		key={(r: LatestPrice) => `${r.commodity}|${r.variety ?? ''}`}
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
				{formatNumber(row.source_count)} / {formatNumber(row.group_count)}
			{:else if col === 'date'}
				<time class="text-ink-muted" datetime={row.obs_date}>{formatDate(row.obs_date)}</time>
			{/if}
		{/snippet}
	</DataTable>
{/if}

{#if market?.aliases?.length}
	<p class="mt-4 text-xs text-ink-muted">Also written as: {market.aliases.join(', ')}</p>
{/if}
