<script lang="ts">
	interface Props {
		/** CSS width, e.g. "60%" or "8rem". */
		width?: string;
		height?: string;
		/** Render as a block of N text lines. */
		lines?: number;
		class?: string;
	}

	let { width = '100%', height = '1rem', lines, class: className }: Props = $props();
</script>

{#if lines}
	<span class={['flex flex-col gap-2', className]} aria-hidden="true">
		{#each { length: lines }, i (i)}
			<span
				class="skeleton block rounded-sm"
				style:width="{Math.max(40, 92 - i * 14)}%"
				style:height
			></span>
		{/each}
	</span>
{:else}
	<span class={['skeleton block rounded-sm', className]} style:width style:height aria-hidden="true"
	></span>
{/if}

<style>
	.skeleton {
		background: var(--surface-2);
		animation: pulse 1.4s var(--ease-standard) infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
</style>
