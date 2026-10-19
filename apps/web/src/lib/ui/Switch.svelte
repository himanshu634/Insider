<script lang="ts">
	interface Props {
		checked?: boolean;
		/** Accessible name; visible unless hideLabel. */
		label: string;
		hideLabel?: boolean;
		disabled?: boolean;
		/** Shows a busy state while a change is saving. */
		busy?: boolean;
		onchange?: (checked: boolean) => void;
	}

	let {
		checked = $bindable(false),
		label,
		hideLabel = false,
		disabled = false,
		busy = false,
		onchange
	}: Props = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-busy={busy || undefined}
	disabled={disabled || busy}
	onclick={toggle}
	class="ui-switch inline-flex min-h-11 items-center gap-3 text-sm text-ink"
>
	<span
		class={[
			'track relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border',
			checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-2'
		]}
		aria-hidden="true"
	>
		<span class={['thumb h-4.5 w-4.5 rounded-full', checked ? 'bg-primary-ink' : 'bg-ink-muted']}
		></span>
	</span>
	<span class={hideLabel ? 'sr-only' : ''}>{label}</span>
</button>

<style>
	.ui-switch {
		cursor: pointer;
	}

	.ui-switch:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.track {
		transition:
			background-color var(--duration-base) var(--ease-standard),
			border-color var(--duration-base) var(--ease-standard);
	}

	.thumb {
		transform: translateX(3px);
		transition: transform var(--duration-base) var(--ease-standard);
	}

	[aria-checked='true'] .thumb {
		transform: translateX(21px);
	}
</style>
