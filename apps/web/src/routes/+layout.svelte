<script lang="ts">
	import './layout.css';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import { createAppQueryClient } from '#lib/api/query-client.js';
	import { I18n, setI18n } from '#lib/i18n.svelte.js';
	import { Icon, IconButton, Logo, Toaster, theme } from '#lib/ui/index.js';
	import AppNav from '#lib/components/AppNav.svelte';
	import CollectorBadge from '#lib/components/CollectorBadge.svelte';
	import LocaleToggle from '#lib/components/LocaleToggle.svelte';
	import { sidebar } from '#lib/components/sidebar.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const queryClient = createAppQueryClient();
	const i18n = setI18n(new I18n());

	// Chats fill the window like WhatsApp: no page padding, panes scroll on their own.
	const fullBleed = $derived(page.route.id === '/chats');
	// On a phone an open chat takes the whole screen; back returns to the list.
	const chatOpen = $derived(fullBleed && page.url.searchParams.has('chat'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>{i18n.t('brand')}</title>
	<meta
		name="color-scheme"
		content={theme.preference === 'system' ? 'light dark' : theme.preference}
	/>
</svelte:head>

<a
	href="#main"
	class="sr-only z-[var(--z-toast)] rounded-md bg-surface px-4 py-2 text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
	>Skip to content</a
>

<QueryClientProvider client={queryClient}>
	<div
		class={[
			'md:grid',
			fullBleed ? 'h-dvh' : 'min-h-dvh',
			sidebar.collapsed ? 'md:grid-cols-[4.5rem_1fr]' : 'md:grid-cols-[13rem_1fr]'
		]}
	>
		<aside
			id="app-sidebar"
			class={[
				// z-index keeps the collapsed rail's tooltips above the page beside it.
				'sticky top-0 z-[var(--z-nav)] hidden h-dvh flex-col gap-6 border-r border-border bg-surface py-4 md:flex',
				sidebar.collapsed ? 'items-center px-2' : 'px-3'
			]}
		>
			{#if sidebar.collapsed}
				<a href={resolve('/')} aria-label={i18n.t('brand')} class="flex rounded-lg"
					><Logo tile size={40} /></a
				>
			{:else}
				<a href={resolve('/')} class="flex items-center gap-2 px-3 text-lg font-bold text-primary"
					><Logo />{i18n.t('brand')}</a
				>
			{/if}
			<AppNav variant="side" collapsed={sidebar.collapsed} />
			<div class="mt-auto">
				{#if sidebar.collapsed}
					<IconButton
						icon="chevronsRight"
						label={i18n.t('nav.expand')}
						aria-expanded="false"
						aria-controls="app-sidebar"
						onclick={sidebar.toggle}
						class="text-ink-muted"
					/>
				{:else}
					<button
						type="button"
						aria-expanded="true"
						aria-controls="app-sidebar"
						onclick={sidebar.toggle}
						class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
					>
						<Icon name="chevronsLeft" size={20} />
						{i18n.t('nav.collapse')}
					</button>
				{/if}
			</div>
		</aside>

		<div class={['flex min-w-0 flex-col', fullBleed && 'h-dvh']}>
			<header
				class={[
					'sticky top-0 z-[var(--z-sticky)] min-h-14 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-6',
					// Phone: an open chat has its own header. Desktop: the chat list carries the
					// collector badge and language switch instead.
					chatOpen ? 'hidden' : 'flex',
					fullBleed ? 'md:hidden' : 'md:flex'
				]}
			>
				<a
					href={resolve('/')}
					class="flex items-center gap-2 text-lg font-bold text-primary md:invisible"
					><Logo />{i18n.t('brand')}</a
				>
				<div class="flex items-center gap-1">
					<CollectorBadge />
					<LocaleToggle />
				</div>
			</header>

			<main
				id="main"
				tabindex="-1"
				class={[
					'outline-none',
					fullBleed
						? ['flex min-h-0 flex-1 flex-col', !chatOpen && 'pb-14 md:pb-0']
						: 'mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-24 md:px-6 md:pt-6 md:pb-10'
				]}
			>
				{@render children()}
			</main>
		</div>
	</div>

	<div class={['fixed inset-x-0 bottom-0 z-[var(--z-nav)] md:hidden', chatOpen && 'hidden']}>
		<AppNav variant="bottom" />
	</div>

	<Toaster />
</QueryClientProvider>
