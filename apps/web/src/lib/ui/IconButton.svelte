<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.js';

	interface Props extends Omit<HTMLButtonAttributes, 'class' | 'children'> {
		icon: IconName;
		/** Required: the accessible name (also shown as a tooltip). */
		label: string;
		variant?: 'secondary' | 'ghost';
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		icon,
		label,
		variant = 'ghost',
		size = 'md',
		type = 'button',
		class: className,
		...rest
	}: Props = $props();
</script>

<button
	{type}
	aria-label={label}
	title={label}
	class={[
		'ui-icon-button inline-flex items-center justify-center rounded-md border text-ink',
		size === 'md' ? 'h-11 w-11' : 'h-9 w-9',
		variant === 'secondary'
			? 'border-border-strong bg-surface'
			: 'border-transparent bg-transparent',
		className
	]}
	{...rest}
>
	<Icon name={icon} size={20} />
</button>

<style>
	.ui-icon-button {
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--ease-standard);
	}

	.ui-icon-button:hover:not(:disabled) {
		background-color: var(--surface-2);
	}

	.ui-icon-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
