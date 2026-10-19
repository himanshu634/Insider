<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import { toasts } from './toast.svelte.js';
</script>

<!-- Polite live region: toasts never steal focus. Sits above the phone tab bar. -->
<div
	class="pointer-events-none fixed inset-x-0 bottom-20 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 md:bottom-6"
	aria-live="polite"
	aria-relevant="additions"
>
	{#each toasts.items as toast (toast.id)}
		<div
			transition:fly={{ y: prefersReducedMotion.current ? 0 : 8, duration: 160, easing: cubicOut }}
			class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-2 pl-4 text-sm text-ink shadow-overlay"
		>
			{#if toast.tone === 'positive'}
				<span class="text-positive"><Icon name="check" size={16} /></span>
			{:else if toast.tone === 'negative'}
				<span class="text-negative"><Icon name="alert" size={16} /></span>
			{/if}
			<span class="flex-1">{toast.message}</span>
			<IconButton icon="x" label="Dismiss" size="sm" onclick={() => toasts.dismiss(toast.id)} />
		</div>
	{/each}
</div>
