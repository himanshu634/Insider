<script lang="ts" module>
	export interface Segment<V extends string = string> {
		value: V;
		label: string;
	}
</script>

<script lang="ts" generics="T extends string">
	interface Props {
		/** Accessible group name. */
		label: string;
		options: Segment<T>[];
		value: T;
		onchange?: (value: T) => void;
		size?: 'sm' | 'md';
	}

	let { label, options, value = $bindable(), onchange, size = 'md' }: Props = $props();

	function select(next: T) {
		value = next;
		onchange?.(next);
	}

	// Radio-group keyboard model: arrows move and select, Home/End jump.
	function onkeydown(event: KeyboardEvent) {
		const index = options.findIndex((o) => o.value === value);
		let next: number;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
			next = (index + 1) % options.length;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
			next = (index - 1 + options.length) % options.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = options.length - 1;
		else return;
		event.preventDefault();
		select(options[next].value);
		const group = event.currentTarget as HTMLElement;
		group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	tabindex="-1"
	{onkeydown}
	class="inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5"
>
	{#each options as option (option.value)}
		{@const active = option.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={active}
			tabindex={active ? 0 : -1}
			onclick={() => select(option.value)}
			class={[
				'segment rounded-sm px-3 font-medium whitespace-nowrap',
				size === 'sm' ? 'min-h-8 text-xs' : 'min-h-10 text-sm',
				active ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]' : 'text-ink-muted'
			]}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segment {
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard);
	}

	.segment:hover {
		color: var(--ink);
	}
</style>
