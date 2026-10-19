<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { fetchDevices, keys, type Device } from '#lib/api/queries.js';
	import { getI18n, type MessageKey } from '#lib/i18n.svelte.js';
	import { Badge, type BadgeTone } from '#lib/ui/index.js';

	const i18n = getI18n();

	// Same key as /settings/devices, so the two share one request and cache entry.
	const devices = createQuery(() => ({
		queryKey: keys.devices(),
		queryFn: fetchDevices,
		refetchInterval: 60_000
	}));

	// Worst status wins, so one broken collector is never hidden behind a healthy one.
	const RANK: Record<Device['status'], [number, MessageKey, BadgeTone]> = {
		schema_mismatch: [0, 'collector.schema', 'negative'],
		silent: [1, 'collector.silent', 'negative'],
		revoked: [2, 'collector.revoked', 'negative'],
		paused: [3, 'collector.paused', 'warning'],
		active: [4, 'collector.online', 'positive']
	};

	const summary = $derived.by((): { key: MessageKey; tone: BadgeTone } => {
		if (devices.isError) return { key: 'collector.unknown', tone: 'neutral' };
		const list = devices.data ?? [];
		if (devices.isPending || list.length === 0) return { key: 'collector.none', tone: 'neutral' };
		const worst = list.reduce((a, b) => (RANK[a.status][0] <= RANK[b.status][0] ? a : b));
		const [, key, tone] = RANK[worst.status];
		return { key, tone };
	});
</script>

<a href={resolve('/settings/devices')} class="inline-flex min-h-11 items-center rounded-md">
	<Badge tone={summary.tone} dot>{i18n.t(summary.key)}</Badge>
</a>
