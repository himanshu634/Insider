<script lang="ts">
	import type { PriceObservation } from '#lib/api/queries.js';
	import { formatPriceRange } from '#lib/chats/thread.js';
	import { formatNumber, humanizeSlug } from '#lib/utils/format.js';

	interface Props {
		observations: PriceObservation[];
		onopen: () => void;
	}

	let { observations, onopen }: Props = $props();

	function label(o: PriceObservation): string {
		return o.variety ? `${humanizeSlug(o.commodity)} ${o.variety}` : humanizeSlug(o.commodity);
	}
</script>

<!-- A quoted-reply style block: what Insider read from this message. Opens the details. -->
<button
	type="button"
	onclick={onopen}
	aria-label="Price details: {observations
		.map((o) => `${label(o)}, ${humanizeSlug(o.market)}`)
		.join('; ')}"
	class="quote mt-1 mb-0.5 block w-full cursor-pointer rounded-md border-l-4 border-primary bg-primary-soft/60 px-2.5 py-1.5 text-left"
>
	{#each observations as o (o.id)}
		<!-- Name and market wrap on the left; the figure stays whole on the right. -->
		<span class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm leading-6">
			<span class="min-w-0">
				<span class="font-semibold">{label(o)}</span>
				<span class="text-ink-muted">{humanizeSlug(o.market)}</span>
			</span>
			{#if o.arrivals_quintal != null && o.min_per_quintal == null && o.max_per_quintal == null && o.modal_per_quintal == null}
				<span class="num font-semibold whitespace-nowrap"
					>{formatNumber(o.arrivals_quintal)}
					<span class="text-xs font-normal text-ink-muted">q arrivals</span></span
				>
			{:else}
				<span class="num font-semibold whitespace-nowrap"
					>{formatPriceRange(o)} <span class="text-xs font-normal text-ink-muted">/q</span></span
				>
			{/if}
		</span>
		{#if o.status === 'needs_review'}
			<span
				class="mb-1 inline-flex h-5 items-center rounded-full bg-warning-soft px-2 text-xs font-medium text-warning"
				>Needs review</span
			>
		{/if}
	{/each}
</button>

<style>
	.quote {
		transition: background-color var(--duration-fast) var(--ease-standard);
	}

	.quote:hover {
		background-color: var(--primary-soft);
	}
</style>
