<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import type { IconName } from './icons.js';

	export type BannerTone = 'info' | 'positive' | 'warning' | 'negative';

	interface Props {
		tone?: BannerTone;
		title: string;
		/** Use role="alert" (interrupts screen readers). Only for errors that need attention. */
		urgent?: boolean;
		icon?: IconName;
		ondismiss?: () => void;
		actions?: Snippet;
		children?: Snippet;
	}

	let {
		tone = 'info',
		title,
		urgent = false,
		icon,
		ondismiss,
		actions,
		children
	}: Props = $props();

	const DEFAULT_ICON: Record<BannerTone, IconName> = {
		info: 'info',
		positive: 'check',
		warning: 'alert',
		negative: 'alert'
	};
</script>

<div
	role={urgent ? 'alert' : 'status'}
	class={[
		'flex gap-3 rounded-lg border p-4',
		tone === 'info' && 'border-info/30 bg-info-soft',
		tone === 'positive' && 'border-positive/30 bg-positive-soft',
		tone === 'warning' && 'border-warning/30 bg-warning-soft',
		tone === 'negative' && 'border-negative/30 bg-negative-soft'
	]}
>
	<span
		class={[
			'mt-0.5',
			tone === 'info' && 'text-info',
			tone === 'positive' && 'text-positive',
			tone === 'warning' && 'text-warning',
			tone === 'negative' && 'text-negative'
		]}
	>
		<Icon name={icon ?? DEFAULT_ICON[tone]} size={20} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="font-semibold text-ink">{title}</p>
		{#if children}<div class="mt-1 text-sm text-ink">{@render children()}</div>{/if}
		{#if actions}<div class="mt-3 flex flex-wrap gap-2">{@render actions()}</div>{/if}
	</div>
	{#if ondismiss}
		<IconButton icon="x" label="Dismiss" size="sm" onclick={ondismiss} class="-mt-1 -mr-1" />
	{/if}
</div>
