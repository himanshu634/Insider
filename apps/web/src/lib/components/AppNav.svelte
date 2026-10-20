<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getI18n, type MessageKey } from '#lib/i18n.svelte.js';
	import { Icon, type IconName } from '#lib/ui/index.js';

	interface Props {
		variant: 'side' | 'bottom';
		/** Side variant only: icons without labels (the collapsed sidebar rail). */
		collapsed?: boolean;
	}

	let { variant, collapsed = false }: Props = $props();
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
		{ href: resolve('/chats'), label: 'nav.chats', match: ['/chats', '/feed'], icon: 'message' },
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
				aria-label={collapsed ? i18n.t(item.label) : undefined}
				class={[
					'nav-link relative flex min-h-11 items-center rounded-md text-sm font-medium',
					collapsed ? 'w-11 justify-center' : 'gap-3 px-3',
					active
						? 'bg-primary-soft text-primary'
						: 'text-ink-muted hover:bg-surface-2 hover:text-ink'
				]}
			>
				<Icon name={item.icon} size={20} strokeWidth={active ? 2.25 : 1.75} />
				{#if collapsed}
					<span class="nav-tip" aria-hidden="true">{i18n.t(item.label)}</span>
				{:else}
					{i18n.t(item.label)}
				{/if}
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
	/* Collapsed rail: the label shows as a tooltip on hover and keyboard focus. */
	.nav-tip {
		position: absolute;
		left: calc(100% + 0.5rem);
		top: 50%;
		z-index: var(--z-toast);
		translate: 0 -50%;
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-sm, 6px);
		background: var(--ink);
		color: var(--surface);
		font-size: 0.8125rem;
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-standard);
	}

	.nav-link:hover .nav-tip,
	.nav-link:focus-visible .nav-tip {
		opacity: 1;
	}

	.nav-link {
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard);
	}
</style>
