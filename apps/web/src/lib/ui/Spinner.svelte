<script lang="ts">
	interface Props {
		size?: 16 | 20;
		label?: string;
	}

	let { size = 16, label }: Props = $props();
</script>

<svg
	class="spinner shrink-0"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	role={label ? 'status' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
	<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
</svg>

<style>
	.spinner {
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
