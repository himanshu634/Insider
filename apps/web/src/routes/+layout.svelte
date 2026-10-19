<script lang="ts">
	import './layout.css';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import { createAppQueryClient } from '#lib/api/query-client.js';
	import { I18n, setI18n } from '#lib/i18n.svelte.js';
	import { Toaster, theme } from '#lib/ui/index.js';
	import AppNav from '#lib/components/AppNav.svelte';
	import CollectorBadge from '#lib/components/CollectorBadge.svelte';
	import LocaleToggle from '#lib/components/LocaleToggle.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const queryClient = createAppQueryClient();
	const i18n = setI18n(new I18n());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
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
	<div class="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
		<aside
			class="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-border bg-surface px-3 py-4 md:flex"
		>
			<a href={resolve('/')} class="px-3 text-lg font-bold text-primary">{i18n.t('brand')}</a>
			<AppNav variant="side" />
		</aside>

		<div class="flex min-w-0 flex-col">
			<header
				class="sticky top-0 z-[var(--z-sticky)] flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-6"
			>
				<a href={resolve('/')} class="text-lg font-bold text-primary md:invisible"
					>{i18n.t('brand')}</a
				>
				<div class="flex items-center gap-1">
					<CollectorBadge />
					<LocaleToggle />
				</div>
			</header>

			<main
				id="main"
				tabindex="-1"
				class="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-24 outline-none md:px-6 md:pt-6 md:pb-10"
			>
				{@render children()}
			</main>
		</div>
	</div>

	<div class="fixed inset-x-0 bottom-0 z-[var(--z-nav)] md:hidden">
		<AppNav variant="bottom" />
	</div>

	<Toaster />
</QueryClientProvider>
