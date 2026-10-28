<script lang="ts">
	/**
	 * The Insider mark ("chatter to one line"): two rows of wavy chatter settle into one straight
	 * line with a point at its end. Same 64-unit geometry as static/favicon.svg and the
	 * collector's apps/collector/src/core/mark.ts — change all three together.
	 *
	 * `tile` draws it on the fixed brand tile (the app icon look) that stays the same in both
	 * themes. Decorative: the link or text next to it carries the name.
	 */
	interface Props {
		size?: number;
		tile?: boolean;
		class?: string;
	}

	let { size = 24, tile = false, class: className }: Props = $props();
</script>

{#if tile}
	<span
		class={['logo-tile inline-flex shrink-0 items-center justify-center rounded-lg', className]}
		style:width="{size}px"
		style:height="{size}px"
		aria-hidden="true"
	>
		{@render mark(Math.round(size * 0.66))}
	</span>
{:else}
	<span class={['inline-flex shrink-0', className]} aria-hidden="true">{@render mark(size)}</span>
{/if}

{#snippet mark(px: number)}
	<svg class={['logo', tile && 'on-tile']} width={px} height={px} viewBox="0 0 64 64" fill="none">
		<path
			class="chatter"
			d="M8 16q6-9 12 0t12 0 12 0 12 0M8 32q8-5 16 0t16 0 16 0"
			stroke-width="5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<path class="line" d="M8 48H42" stroke-width="5" stroke-linecap="round" />
		<circle class="point" cx="52" cy="48" r="5.5" />
	</svg>
{/snippet}

<style>
	.logo .chatter {
		stroke: var(--border-strong);
	}
	.logo .line {
		stroke: var(--primary);
	}
	.logo .point {
		fill: var(--accent);
	}
	.logo-tile {
		background: var(--brand-tile);
	}
	.logo.on-tile .chatter {
		stroke: var(--brand-chatter-on-tile);
	}
	.logo.on-tile .line {
		stroke: var(--brand-on-tile);
	}
	.logo.on-tile .point {
		fill: var(--brand-point);
	}
</style>
