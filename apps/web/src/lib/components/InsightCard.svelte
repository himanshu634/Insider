<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Insight } from '#lib/api/queries.js';
	import { formatDate } from '#lib/utils/dates.js';
	import { humanizeSlug } from '#lib/utils/format.js';
	import { Badge, type BadgeTone } from '#lib/ui/index.js';

	interface Props {
		insight: Insight;
		showDate?: boolean;
	}

	let { insight, showDate = false }: Props = $props();

	const TYPE_LABEL: Record<Insight['type'], string> = {
		price_move: 'Price move',
		spread: 'Spread',
		arrival_spike: 'Arrival spike',
		conflict: 'Conflicting reports',
		news: 'News'
	};

	const SEVERITY: Record<Insight['severity'], { tone: BadgeTone; label: string }> = {
		high: { tone: 'negative', label: 'High' },
		notable: { tone: 'accent', label: 'Notable' },
		info: { tone: 'neutral', label: 'Info' }
	};
</script>

<article
	class={[
		'rounded-lg border border-border bg-surface p-4',
		insight.severity === 'high' && 'shadow-[inset_3px_0_0_var(--negative)]',
		insight.severity === 'notable' && 'shadow-[inset_3px_0_0_var(--accent)]'
	]}
>
	<div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
		<Badge tone={SEVERITY[insight.severity].tone}>{SEVERITY[insight.severity].label}</Badge>
		<span class="font-medium text-ink">{TYPE_LABEL[insight.type]}</span>
		{#if insight.commodity}
			<a
				class="underline-offset-2 hover:text-ink hover:underline"
				href={resolve('/prices/[commodity]', { commodity: insight.commodity })}
				>{humanizeSlug(insight.commodity)}</a
			>
		{/if}
		{#if insight.market}
			<a
				class="underline-offset-2 hover:text-ink hover:underline"
				href={resolve('/markets/[market]', { market: insight.market })}
				>{humanizeSlug(insight.market)}</a
			>
		{/if}
		{#if showDate}
			<time class="num ml-auto" datetime={insight.date}>{formatDate(insight.date)}</time>
		{/if}
	</div>
	<h3 class="mt-2 text-base font-semibold text-ink">{insight.title}</h3>
	<p class="mt-1 text-sm whitespace-pre-line text-ink-muted">{insight.detail}</p>
</article>
