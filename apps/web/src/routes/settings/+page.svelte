<script lang="ts">
	import { resolve } from '$app/paths';
	import { getI18n, type MessageKey } from '#lib/i18n.svelte.js';
	import {
		Icon,
		SegmentedControl,
		theme,
		type IconName,
		type ThemePreference
	} from '#lib/ui/index.js';
	import { AUTH_MODE } from '#lib/auth.js';
	import { API_BASE_URL } from '#lib/api/client.js';
	import PageHeader from '#lib/components/PageHeader.svelte';

	const i18n = getI18n();

	const links: { href: string; label: MessageKey; body: string; icon: IconName }[] = [
		{
			href: resolve('/settings/groups'),
			label: 'nav.groups',
			body: 'Choose which WhatsApp groups are read.',
			icon: 'users'
		},
		{
			href: resolve('/settings/devices'),
			label: 'nav.devices',
			body: 'Collector health and last sync.',
			icon: 'laptop'
		},
		{
			href: resolve('/settings/dictionaries'),
			label: 'nav.dictionaries',
			body: 'Commodities, mandis and units.',
			icon: 'book'
		}
	];

	let themeValue = $state<ThemePreference>(theme.preference);
</script>

<PageHeader title={i18n.t('settings.title')} />

<ul class="grid gap-3 md:grid-cols-3">
	{#each links as link (link.href)}
		<li>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs below come from resolve() -->
			<a
				href={link.href}
				class="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 hover:bg-surface-2"
			>
				<span class="text-primary"><Icon name={link.icon} size={24} /></span>
				<span>
					<span class="block font-semibold text-ink">{i18n.t(link.label)}</span>
					<span class="block text-sm text-ink-muted">{link.body}</span>
				</span>
			</a>
		</li>
	{/each}
</ul>

<h2 class="mt-8 mb-3 text-base font-semibold text-ink">Appearance</h2>
<SegmentedControl
	label="Theme"
	bind:value={themeValue}
	onchange={(v) => theme.set(v)}
	options={[
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'System' }
	]}
/>

<h2 class="mt-8 mb-3 text-base font-semibold text-ink">About</h2>
<dl class="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
	<dt class="text-ink-muted">API</dt>
	<dd><code>{API_BASE_URL}</code></dd>
	<dt class="text-ink-muted">Sign-in</dt>
	<dd>
		{AUTH_MODE === 'dev-bypass' ? 'Development bypass' : AUTH_MODE}
		(<a class="text-primary underline" href={resolve('/login')}>details</a>)
	</dd>
	<dt class="text-ink-muted">Design system</dt>
	<dd><a class="text-primary underline" href={resolve('/design')}>Mandi Ledger style guide</a></dd>
</dl>
