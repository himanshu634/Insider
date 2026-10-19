<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getI18n, type MessageKey } from '#lib/i18n.svelte.js';
	import { Icon, type IconName } from '#lib/ui/index.js';

	interface Props {
		variant: 'side' | 'bottom';
	}

	let { variant }: Props = $props();
	const i18n = getI18n();

	type Item = {
		href: string;
		label: MessageKey;
		/** Route-ID prefixes that mark this tab active. */
		match: string[];
		icon: IconName;
	};

	const items: Item[] = [
		{ href: resolve('/'), label: 'nav.today', match: ['/'], icon: 'sun' },
		{
			href: resolve('/prices'),
			label: 'nav.prices',
			match: ['/prices', '/markets'],
			icon: 'chart'
		},
		{ href: resolve('/insights'), label: 'nav.insights', match: ['/insights'], icon: 'bulb' },
		{ href: resolve('/feed'), label: 'nav.feed', match: ['/feed'], icon: 'message' },
		{ href: resolve('/review'), label: 'nav.review', match: ['/review'], icon: 'checkSquare' },
		{
			href: resolve('/settings'),
			label: 'nav.settings',
			match: ['/settings', '/login', '/design'],
			icon: 'sliders'
		}
	];

	function isActive(item: Item): boolean {
		const id = page.route.id ?? '';
		return item.match.some((m) => (m === '/' ? id === '/' : id === m || id.startsWith(`${m}/`)));
	}
</script>

{#if variant === 'side'}
	<nav aria-label={i18n.t('nav.main')} class="flex flex-col gap-1">
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs below come from resolve() -->
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				class={[
					'nav-link flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium',
					active
						? 'bg-primary-soft text-primary'
						: 'text-ink-muted hover:bg-surface-2 hover:text-ink'
				]}
			>
				<Icon name={item.icon} size={20} strokeWidth={active ? 2.25 : 1.75} />
				{i18n.t(item.label)}
			</a>
		{/each}
	</nav>
{:else}
	<nav
		aria-label={i18n.t('nav.main')}
		class="grid grid-cols-6 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
	>
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				class={[
					'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-xs leading-tight font-medium',
					active ? 'text-primary' : 'text-ink-muted'
				]}
			>
				{#if active}
					<span class="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true"
					></span>
				{/if}
				<Icon name={item.icon} size={20} strokeWidth={active ? 2.25 : 1.75} />
				<span>{i18n.t(item.label)}</span>
			</a>
		{/each}
	</nav>
{/if}

<style>
	.nav-link {
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard);
	}
</style>
