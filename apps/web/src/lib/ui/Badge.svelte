<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.js';

	export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'accent';

	interface Props {
		tone?: BadgeTone;
		/** Leading status dot. */
		dot?: boolean;
		icon?: IconName;
		title?: string;
		children: Snippet;
	}

	let { tone = 'neutral', dot = false, icon, title, children }: Props = $props();
</script>

<span
	{title}
	class={[
		'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
		tone === 'neutral' && 'border-border bg-surface-2 text-ink-muted',
		tone === 'positive' && 'border-transparent bg-positive-soft text-positive',
		tone === 'negative' && 'border-transparent bg-negative-soft text-negative',
		tone === 'warning' && 'border-transparent bg-warning-soft text-warning',
		tone === 'info' && 'border-transparent bg-info-soft text-info',
		tone === 'accent' && 'border-transparent bg-accent-soft text-accent-text'
	]}
>
	{#if dot}<span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{/if}
	{#if icon}<Icon name={icon} size={16} />{/if}
	{@render children()}
</span>
