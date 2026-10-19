<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchDevices, keys, type Device } from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDateTime, formatRelative } from '#lib/utils/dates.js';
	import { formatNumber } from '#lib/utils/format.js';
	import { Badge, DataTable, EmptyState, type BadgeTone, type Column } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();

	const devices = createQuery(() => ({
		queryKey: keys.devices(),
		queryFn: fetchDevices,
		refetchInterval: 60_000
	}));

	const STATUS: Record<Device['status'], { tone: BadgeTone; label: string }> = {
		active: { tone: 'positive', label: 'Active' },
		paused: { tone: 'warning', label: 'Paused' },
		silent: { tone: 'negative', label: 'Silent' },
		schema_mismatch: { tone: 'negative', label: 'Schema mismatch' },
		revoked: { tone: 'neutral', label: 'Revoked' }
	};

	const columns: Column[] = [
		{ key: 'name', label: 'Device' },
		{ key: 'status', label: 'Status' },
		{ key: 'heartbeat', label: 'Last heartbeat' },
		{ key: 'sync', label: 'Last sync', hideOnMobile: true },
		{ key: 'outbox', label: 'Outbox', numeric: true, hideOnMobile: true }
	];
</script>

<PageHeader title={i18n.t('devices.title')} subtitle={i18n.t('devices.subtitle')} />

{#if devices.isError}
	<ErrorState error={devices.error} onretry={() => devices.refetch()} />
{:else if devices.isSuccess && devices.data.length === 0}
	<EmptyState
		icon="laptop"
		title={i18n.t('devices.empty.title')}
		body={i18n.t('devices.empty.body')}
	/>
{:else}
	<DataTable
		caption="Registered collectors"
		{columns}
		rows={devices.data}
		key={(d) => d.id}
		loading={devices.isPending}
	>
		{#snippet cell(device: Device, col: string)}
			{#if col === 'name'}
				<span class="font-medium text-ink">{device.name}</span>
				{#if device.app_version}<span class="block text-xs text-ink-muted"
						>v{device.app_version}</span
					>{/if}
			{:else if col === 'status'}
				<Badge tone={STATUS[device.status].tone} dot>{STATUS[device.status].label}</Badge>
			{:else if col === 'heartbeat'}
				{#if device.last_heartbeat_at}
					<time datetime={device.last_heartbeat_at} title={formatDateTime(device.last_heartbeat_at)}
						>{formatRelative(device.last_heartbeat_at)}</time
					>
				{:else}<span class="text-ink-muted">Never</span>{/if}
			{:else if col === 'sync'}
				{#if device.last_sync_at}
					<time datetime={device.last_sync_at}>{formatDateTime(device.last_sync_at)} IST</time>
				{:else}<span class="text-ink-muted">Never</span>{/if}
			{:else if col === 'outbox'}
				{formatNumber(device.outbox_size)}
			{/if}
		{/snippet}
	</DataTable>
{/if}
