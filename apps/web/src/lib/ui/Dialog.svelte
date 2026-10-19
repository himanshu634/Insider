<script lang="ts">
	import type { Snippet } from 'svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		open: boolean;
		title: string;
		/** "sheet" docks to the bottom on phones; "dialog" stays centred. */
		variant?: 'dialog' | 'sheet';
		onclose?: () => void;
		actions?: Snippet;
		children: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		variant = 'dialog',
		onclose,
		actions,
		children
	}: Props = $props();

	const uid = $props.id();

	// Native <dialog>: focus trapping, Escape and the top layer come from the platform.
	function modal(node: HTMLDialogElement) {
		if (open && !node.open) node.showModal();
		if (!open && node.open) node.close();
	}

	function handleClose() {
		open = false;
		onclose?.();
	}

	function onclick(event: MouseEvent) {
		// A click on the backdrop lands on the <dialog> element itself.
		if (event.target === event.currentTarget) handleClose();
	}
</script>

<dialog
	{@attach modal}
	aria-labelledby="dialog-title-{uid}"
	onclose={handleClose}
	{onclick}
	class={['ui-dialog border border-border bg-surface p-0 text-ink shadow-overlay', variant]}
>
	<div class="flex max-h-[85dvh] flex-col">
		<header class="flex items-center justify-between gap-3 border-b border-border py-2 pr-2 pl-5">
			<h2 id="dialog-title-{uid}" class="text-lg font-semibold">{title}</h2>
			<IconButton icon="x" label="Close" onclick={handleClose} />
		</header>
		<div class="overflow-y-auto px-5 py-4">{@render children()}</div>
		{#if actions}
			<footer class="flex justify-end gap-2 border-t border-border px-5 py-3">
				{@render actions()}
			</footer>
		{/if}
	</div>
</dialog>

<style>
	.ui-dialog {
		width: min(32rem, calc(100vw - 2rem));
		border-radius: var(--radius-lg);
		margin: auto;
	}

	.ui-dialog::backdrop {
		background: var(--scrim);
	}

	.ui-dialog[open] {
		animation: enter var(--duration-slow) var(--ease-standard);
	}

	@media (max-width: 47.99rem) {
		.ui-dialog.sheet {
			width: 100vw;
			max-width: 100vw;
			margin: auto 0 0;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			padding-bottom: env(safe-area-inset-bottom);
		}

		.ui-dialog.sheet[open] {
			animation-name: rise;
		}
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.98);
		}
	}

	@keyframes rise {
		from {
			transform: translateY(16px);
			opacity: 0;
		}
	}
</style>
