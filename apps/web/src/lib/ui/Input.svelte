<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.js';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value'> {
		label: string;
		/** Keep the label for screen readers only (e.g. a search box with a visible icon). */
		hideLabel?: boolean;
		value?: string;
		hint?: string;
		error?: string;
		icon?: IconName;
		class?: string;
	}

	let {
		label,
		hideLabel = false,
		value = $bindable(''),
		hint,
		error,
		icon,
		id,
		class: className,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const inputId = $derived(id ?? `input-${uid}`);
	const describedBy = $derived(
		[hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class={['flex flex-col gap-1', className]}>
	<label for={inputId} class={hideLabel ? 'sr-only' : 'text-sm font-medium text-ink'}>{label}</label
	>
	<div class="relative">
		{#if icon}
			<span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">
				<Icon name={icon} size={16} />
			</span>
		{/if}
		<input
			id={inputId}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
			class={[
				'ui-field min-h-11 w-full rounded-md border bg-surface px-3 text-base text-ink placeholder:text-ink-muted md:text-sm',
				icon && 'pl-9',
				error ? 'border-negative' : 'border-border-strong'
			]}
			{...rest}
		/>
	</div>
	{#if hint}<p id="{inputId}-hint" class="text-xs text-ink-muted">{hint}</p>{/if}
	{#if error}<p id="{inputId}-error" class="text-xs text-negative" role="alert">{error}</p>{/if}
</div>

<style>
	.ui-field:focus {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
		border-color: var(--focus);
		box-shadow: none;
	}
</style>
