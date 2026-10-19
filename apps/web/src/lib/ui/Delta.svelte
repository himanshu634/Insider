<script lang="ts">
	import { changeDirection, formatRupeeChange } from '#lib/utils/format.js';

	interface Props {
		/** Change in ₹ (per quintal for prices). */
		value: number | null | undefined;
		/** What the change is measured against, e.g. "vs yesterday" — used for the accessible label. */
		against?: string;
		size?: 'xs' | 'sm';
	}

	let { value, against, size = 'sm' }: Props = $props();
	const direction = $derived(changeDirection(value));
	const spoken = $derived(
		value == null
			? 'no change data'
			: `${direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'unchanged'} ${formatRupeeChange(Math.abs(value)).replace('+', '')}${against ? ` ${against}` : ''}`
	);
</script>

<!-- Rises and drops carry a glyph and a sign, never colour alone. -->
<span
	class={[
		'num inline-flex items-center justify-end gap-0.5 font-medium',
		size === 'xs' ? 'text-xs' : 'text-sm',
		direction === 'up' && 'text-positive',
		direction === 'down' && 'text-negative',
		direction === 'flat' && 'text-ink-muted'
	]}
	title={against}
>
	<span class="sr-only">{spoken}</span>
	<span aria-hidden="true"
		>{direction === 'up' ? '▲' : direction === 'down' ? '▼' : ''}{formatRupeeChange(value)}</span
	>
</span>
