<script lang="ts">
	import { formatRupees } from '#lib/utils/format.js';
	import { unitLabel } from '#lib/utils/units.js';
	import Delta from './Delta.svelte';

	interface Props {
		/** Price in ₹ per quintal — the only unit prices are shown in. */
		value: number | null | undefined;
		/** The price as reported, when known; shown on hover / long-press via title. */
		raw?: { value: number | null | undefined; unit: string } | null;
		/** Optional change in ₹/quintal, shown under the price with ▲/▼. */
		delta?: number | null;
		deltaLabel?: string;
		/** Show the "/q" unit suffix. */
		unit?: boolean;
		emphasis?: boolean;
	}

	let { value, raw = null, delta, deltaLabel, unit = false, emphasis = false }: Props = $props();

	const reported = $derived(
		raw && raw.value != null
			? `reported as ${formatRupees(raw.value, 2)} ${unitLabel(raw.unit).replace('₹', '')}`
			: null
	);
	const title = $derived(
		raw && raw.value != null
			? `${formatRupees(value)} per quintal · reported as ${formatRupees(raw.value, 2)} ${unitLabel(raw.unit).replace('₹', '')}`
			: `${formatRupees(value)} per quintal`
	);
</script>

<span class="inline-flex flex-col items-end gap-0.5">
	<span class={['num', emphasis ? 'text-base font-semibold' : 'text-sm', 'text-ink']} {title}>
		{formatRupees(value)}{#if unit}<span class="ml-0.5 text-xs font-normal text-ink-muted">/q</span
			>{/if}
		{#if reported}<span class="sr-only">, {reported}</span>{/if}
	</span>
	{#if delta !== undefined}
		<Delta value={delta} against={deltaLabel} size="xs" />
	{/if}
</span>
