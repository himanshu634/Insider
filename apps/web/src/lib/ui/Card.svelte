<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Heading shown in the card header. */
		title?: string;
		/** Heading level for the title, to keep the page outline sequential. */
		level?: 2 | 3;
		padding?: 'none' | 'sm' | 'md';
		/** Optional header actions (right side). */
		actions?: Snippet;
		element?: 'section' | 'article' | 'div';
		class?: string;
		children: Snippet;
	}

	let {
		title,
		level = 2,
		padding = 'md',
		actions,
		element = 'section',
		class: className,
		children
	}: Props = $props();
</script>

<svelte:element this={element} class={['rounded-lg border border-border bg-surface', className]}>
	{#if title || actions}
		<header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
			{#if title}
				<svelte:element this={`h${level}`} class="text-base font-semibold text-ink"
					>{title}</svelte:element
				>
			{/if}
			{#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={[padding === 'sm' && 'p-3', padding === 'md' && 'p-4']}>
		{@render children()}
	</div>
</svelte:element>
