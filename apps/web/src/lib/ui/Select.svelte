<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	export interface SelectOption {
		value: string;
		label: string;
	}

	interface Props extends Omit<HTMLSelectAttributes, 'class' | 'value' | 'children'> {
		label: string;
		hideLabel?: boolean;
		options: SelectOption[];
		value?: string;
		hint?: string;
		class?: string;
	}

	let {
		label,
		hideLabel = false,
		options,
		value = $bindable(''),
		hint,
		id,
		class: className,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const selectId = $derived(id ?? `select-${uid}`);
</script>

<div class={['flex flex-col gap-1', className]}>
	<label for={selectId} class={hideLabel ? 'sr-only' : 'text-sm font-medium text-ink'}
		>{label}</label
	>
	<select
		id={selectId}
		bind:value
		aria-describedby={hint ? `${selectId}-hint` : undefined}
		class="ui-field min-h-11 w-full rounded-md border border-border-strong bg-surface py-2 pr-9 pl-3 text-base text-ink md:text-sm"
		{...rest}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
	{#if hint}<p id="{selectId}-hint" class="text-xs text-ink-muted">{hint}</p>{/if}
</div>

<style>
	.ui-field:focus {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
		border-color: var(--focus);
		box-shadow: none;
	}
</style>
