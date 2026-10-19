<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import Spinner from './Spinner.svelte';
	import type { IconName } from './icons.js';

	export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
	export type ButtonSize = 'sm' | 'md' | 'lg';

	interface Props extends Omit<HTMLButtonAttributes, 'class'> {
		variant?: ButtonVariant;
		size?: ButtonSize;
		/** Shows a spinner, disables the button and sets aria-busy. */
		loading?: boolean;
		icon?: IconName;
		/** When set, renders an <a> styled as a button. Pass a value from resolve(). */
		href?: string;
		class?: string;
		children: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		loading = false,
		icon,
		href,
		type = 'button',
		disabled,
		class: className,
		children,
		...rest
	}: Props = $props();

	const classes = $derived([
		'ui-button inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap select-none',
		size === 'sm' && 'min-h-9 px-3 text-sm',
		size === 'md' && 'min-h-11 px-4 text-sm',
		size === 'lg' && 'min-h-12 px-5 text-base',
		variant === 'primary' && 'border-primary bg-primary text-primary-ink',
		variant === 'secondary' && 'border-border-strong bg-surface text-ink',
		variant === 'ghost' && 'border-transparent bg-transparent text-ink',
		variant === 'danger' && 'border-negative bg-surface text-negative',
		className
	]);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass a resolve()d href -->
	<a {href} class={classes}>
		{#if icon}<Icon name={icon} size={size === 'lg' ? 20 : 16} />{/if}
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class={classes}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...rest}
	>
		{#if loading}
			<Spinner />
		{:else if icon}
			<Icon name={icon} size={size === 'lg' ? 20 : 16} />
		{/if}
		{@render children()}
	</button>
{/if}

<style>
	/* State layer: a currentColor wash works on every variant in both themes. */
	.ui-button {
		position: relative;
		isolation: isolate;
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-standard);
	}

	.ui-button::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: currentColor;
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--duration-fast) var(--ease-standard);
	}

	.ui-button:hover:not(:disabled)::after {
		opacity: 0.07;
	}

	.ui-button:active:not(:disabled)::after {
		opacity: 0.14;
	}

	.ui-button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
