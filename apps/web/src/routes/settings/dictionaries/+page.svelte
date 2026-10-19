<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import {
		fetchCommodities,
		fetchMarkets,
		fetchUnits,
		keys,
		type Commodity,
		type Market,
		type Unit
	} from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatNumber } from '#lib/utils/format.js';
	import { DataTable, SegmentedControl, type Column } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();
	let tab = $state<'commodities' | 'markets' | 'units'>('commodities');

	const commodities = createQuery(() => ({
		queryKey: keys.commodities(),
		queryFn: fetchCommodities
	}));
	const markets = createQuery(() => ({ queryKey: keys.markets(), queryFn: fetchMarkets }));
	const units = createQuery(() => ({ queryKey: keys.units(), queryFn: fetchUnits }));

	const commodityColumns: Column[] = [
		{ key: 'name', label: 'Commodity' },
		{ key: 'varieties', label: 'Varieties', hideOnMobile: true },
		{ key: 'synonyms', label: 'Also written as' }
	];
	const marketColumns: Column[] = [
		{ key: 'name', label: 'Mandi' },
		{ key: 'where', label: 'District, state' },
		{ key: 'aliases', label: 'Also written as', hideOnMobile: true }
	];
	const unitColumns: Column[] = [
		{ key: 'label', label: 'Unit' },
		{ key: 'code', label: 'Code', hideOnMobile: true },
		{ key: 'factor', label: '× to ₹/quintal', numeric: true },
		{ key: 'aliases', label: 'Also written as', hideOnMobile: true }
	];

	const list = (values: string[] | undefined) => (values?.length ? values.join(', ') : '—');
</script>

<PageHeader title={i18n.t('dictionaries.title')} subtitle={i18n.t('dictionaries.subtitle')} />

<div class="mb-4">
	<SegmentedControl
		label="Dictionary"
		bind:value={tab}
		options={[
			{ value: 'commodities', label: 'Commodities' },
			{ value: 'markets', label: 'Mandis' },
			{ value: 'units', label: 'Units' }
		]}
	/>
</div>

{#snippet emptyRow()}
	<span class="block font-medium text-ink">{i18n.t('dictionaries.empty.title')}</span>
	<span class="mx-auto block max-w-prose">{i18n.t('dictionaries.empty.body')}</span>
{/snippet}

{#if tab === 'commodities'}
	{#if commodities.isError}
		<ErrorState error={commodities.error} onretry={() => commodities.refetch()} />
	{:else}
		<DataTable
			caption="Commodities"
			columns={commodityColumns}
			rows={commodities.data}
			key={(c) => c.id}
			loading={commodities.isPending}
			empty={emptyRow}
		>
			{#snippet cell(c: Commodity, col: string)}
				{#if col === 'name'}
					<span class="font-medium text-ink">{c.name}</span>
					<span class="block text-xs text-ink-muted">{c.slug}</span>
				{:else if col === 'varieties'}{list(c.varieties)}
				{:else if col === 'synonyms'}{list(c.synonyms)}{/if}
			{/snippet}
		</DataTable>
	{/if}
{:else if tab === 'markets'}
	{#if markets.isError}
		<ErrorState error={markets.error} onretry={() => markets.refetch()} />
	{:else}
		<DataTable
			caption="Mandis"
			columns={marketColumns}
			rows={markets.data}
			key={(m) => m.id}
			loading={markets.isPending}
			empty={emptyRow}
		>
			{#snippet cell(m: Market, col: string)}
				{#if col === 'name'}
					<span class="font-medium text-ink">{m.name}</span>
					<span class="block text-xs text-ink-muted">{m.slug}</span>
				{:else if col === 'where'}{[m.district, m.state].filter(Boolean).join(', ')}
				{:else if col === 'aliases'}{list(m.aliases)}{/if}
			{/snippet}
		</DataTable>
	{/if}
{:else if units.isError}
	<ErrorState error={units.error} onretry={() => units.refetch()} />
{:else}
	<DataTable
		caption="Units"
		columns={unitColumns}
		rows={units.data}
		key={(u) => u.id}
		loading={units.isPending}
		empty={emptyRow}
	>
		{#snippet cell(u: Unit, col: string)}
			{#if col === 'label'}<span class="font-medium text-ink">{u.label}</span>
			{:else if col === 'code'}<code>{u.code}</code>
			{:else if col === 'factor'}{formatNumber(u.factor_to_quintal, 2)}
			{:else if col === 'aliases'}{list(u.aliases)}{/if}
		{/snippet}
	</DataTable>
{/if}
