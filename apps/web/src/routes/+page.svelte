<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchBrief, keys, LIVE_REFETCH_MS } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { addDays, formatDate, formatDateTime, todayIST } from '#lib/utils/dates.js';
	import { EmptyState, IconButton } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import InsightCard from '#lib/components/InsightCard.svelte';

	const i18n = getI18n();
	// `today` follows the IST clock, so a tab left open overnight moves on to the new brief.
	let today = $state(todayIST());
	let date = $state(todayIST());
	const isToday = $derived(date === today);

	function syncToday() {
		const now = todayIST();
		if (now === today) return;
		if (date === today) date = now;
		today = now;
	}

	$effect(() => {
		const timer = setInterval(syncToday, 60_000);
		return () => clearInterval(timer);
	});

	const brief = createQuery(() => ({
		queryKey: keys.brief(date),
		queryFn: () => fetchBrief(date),
		refetchInterval: isToday ? LIVE_REFETCH_MS : false
	}));
</script>

<svelte:document onvisibilitychange={syncToday} />

<PageHeader title={i18n.t('today.title')} subtitle={i18n.t('today.subtitle')}>
	{#snippet actions()}
		<IconButton
			icon="chevronLeft"
			label="Previous day"
			variant="secondary"
			onclick={() => (date = addDays(date, -1))}
		/>
		<time class="num min-w-28 text-center text-sm font-medium" datetime={date} aria-live="polite"
			>{formatDate(date, i18n.intlLocale)}</time
		>
		<IconButton
			icon="chevronRight"
			label="Next day"
			variant="secondary"
			disabled={isToday}
			onclick={() => (date = addDays(date, 1))}
		/>
	{/snippet}
</PageHeader>

{#if brief.isPending}
	<LoadingState rows={6} />
{:else if brief.isError}
	<ErrorState error={brief.error} onretry={() => brief.refetch()} />
{:else if !brief.data}
	<EmptyState icon="sun" title={i18n.t('today.empty.title')} body={i18n.t('today.empty.body')} />
{:else}
	<article class="rounded-lg border border-border bg-surface p-5">
		{#if brief.data.generated_at}
			<p class="mb-3 text-xs text-ink-muted">
				Written {formatDateTime(brief.data.generated_at, i18n.intlLocale)} IST
			</p>
		{/if}
		<!-- The body is Markdown built from WhatsApp content; shown as plain text until a sanitizing renderer is added. -->
		<div class="max-w-prose text-base whitespace-pre-line text-ink">{brief.data.body}</div>
	</article>

	{#if brief.data.insights.length > 0}
		<h2 class="mt-6 mb-3 text-base font-semibold text-ink">{i18n.t('nav.insights')}</h2>
		<div class="grid gap-3 md:grid-cols-2">
			{#each brief.data.insights as insight (insight.id)}
				<InsightCard {insight} />
			{/each}
		</div>
	{/if}
{/if}
