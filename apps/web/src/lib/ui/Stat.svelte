<script lang="ts">
	import Delta from './Delta.svelte';

	interface Props {
		label: string;
		/** Pre-formatted value (use the format helpers). */
		value: string;
		/** Optional change in ₹. */
		delta?: number | null;
		deltaLabel?: string;
		hint?: string;
	}

	let { label, value, delta, deltaLabel, hint }: Props = $props();
</script>

<div class="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
	<span class="text-sm text-ink-muted">{label}</span>
	<span class="num text-left text-xl font-semibold text-ink">{value}</span>
	{#if delta !== undefined}
		<span class="flex items-center gap-1.5">
			<Delta value={delta} against={deltaLabel} />
			{#if deltaLabel}<span class="text-xs text-ink-muted">{deltaLabel}</span>{/if}
		</span>
	{/if}
	{#if hint}<span class="text-xs text-ink-muted">{hint}</span>{/if}
</div>
