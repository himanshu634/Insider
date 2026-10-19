<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.js';

	interface Props {
		title: string;
		/** Say what will appear here and why it is not there yet. */
		body: string;
		icon?: IconName;
		/** Heading level, to keep the page outline sequential. */
		level?: 2 | 3;
		/** Optional next step (a Button). */
		action?: Snippet;
		/** Flat variant for use inside a Card or table. */
		bare?: boolean;
	}

	let { title, body, icon = 'sprout', level = 2, action, bare = false }: Props = $props();
</script>

<section
	class={[
		'flex flex-col items-center px-6 py-10 text-center',
		!bare && 'rounded-lg border border-dashed border-border-strong bg-surface'
	]}
>
	<span
		class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary"
	>
		<Icon name={icon} size={24} />
	</span>
	<svelte:element this={`h${level}`} class="text-base font-semibold text-ink"
		>{title}</svelte:element
	>
	<p class="mt-2 max-w-prose text-sm text-ink-muted">{body}</p>
	{#if action}
		<div class="mt-5">{@render action()}</div>
	{/if}
</section>
