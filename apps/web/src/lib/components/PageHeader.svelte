<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		actions?: Snippet;
	}

	let { title, subtitle, actions }: Props = $props();
</script>

<header class="mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-xl font-semibold text-ink md:text-2xl">{title}</h1>
		{#if subtitle}
			<p class="mt-1 max-w-prose text-sm text-ink-muted">{subtitle}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</header>
