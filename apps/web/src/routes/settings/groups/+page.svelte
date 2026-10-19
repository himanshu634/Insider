<script lang="ts">
	import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
	import {
		fetchGroups,
		keys,
		updateGroup,
		type Group,
		type GroupUpdate
	} from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatRelative } from '#lib/utils/dates.js';
	import { formatNumber } from '#lib/utils/format.js';
	import { Badge, DataTable, EmptyState, Switch, toasts, type Column } from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();
	const queryClient = useQueryClient();

	const groups = createQuery(() => ({ queryKey: keys.groups(), queryFn: fetchGroups }));

	const toggle = createMutation(() => ({
		mutationFn: (body: GroupUpdate) => updateGroup(body),
		// Optimistic: flip the switch now, roll back if the API refuses.
		onMutate: async (body: GroupUpdate) => {
			await queryClient.cancelQueries({ queryKey: keys.groups() });
			const previous = queryClient.getQueryData<Group[]>(keys.groups());
			queryClient.setQueryData<Group[]>(keys.groups(), (old) =>
				old?.map((g) =>
					g.id === body.id ? { ...g, is_watched: body.is_watched ?? g.is_watched } : g
				)
			);
			return { previous };
		},
		onError: (error, _body, context) => {
			queryClient.setQueryData(keys.groups(), context?.previous);
			toasts.show(`Could not update the group: ${error.message}`, 'negative');
		},
		onSuccess: (group) =>
			toasts.show(
				group.is_watched ? `Watching ${group.name}` : `Stopped watching ${group.name}`,
				'positive'
			),
		onSettled: () => queryClient.invalidateQueries({ queryKey: keys.groups() })
	}));

	const watchedCount = $derived(groups.data?.filter((g) => g.is_watched).length ?? 0);

	const columns: Column[] = [
		{ key: 'name', label: 'Group' },
		{ key: 'members', label: 'Members', numeric: true, hideOnMobile: true },
		{ key: 'last', label: 'Last message', hideOnMobile: true },
		{ key: 'watched', label: 'Watched' }
	];
</script>

<PageHeader title={i18n.t('groups.title')} subtitle={i18n.t('groups.subtitle')}>
	{#snippet actions()}
		{#if groups.isSuccess && groups.data.length > 0}
			<Badge tone="positive">{watchedCount} of {groups.data.length} watched</Badge>
		{/if}
	{/snippet}
</PageHeader>

{#if groups.isError}
	<ErrorState error={groups.error} onretry={() => groups.refetch()} />
{:else if groups.isSuccess && groups.data.length === 0}
	<EmptyState
		icon="users"
		title={i18n.t('groups.empty.title')}
		body={i18n.t('groups.empty.body')}
	/>
{:else}
	<DataTable
		caption="WhatsApp groups seen by the collector"
		{columns}
		rows={groups.data}
		key={(g) => g.id}
		loading={groups.isPending}
	>
		{#snippet cell(group: Group, col: string)}
			{#if col === 'name'}
				<span class="font-medium text-ink">{group.name}</span>
				<span class="mt-1 flex flex-wrap gap-1">
					{#if group.region_tag}<Badge>{group.region_tag}</Badge>{/if}
					{#each group.primary_commodities as c (c)}<Badge tone="accent">{c}</Badge>{/each}
				</span>
			{:else if col === 'members'}
				{formatNumber(group.member_count)}
			{:else if col === 'last'}
				<span class="text-ink-muted"
					>{group.last_message_at ? formatRelative(group.last_message_at) : 'Never'}</span
				>
			{:else if col === 'watched'}
				<Switch
					checked={group.is_watched}
					label="Watch {group.name}"
					hideLabel
					busy={toggle.isPending && toggle.variables?.id === group.id}
					onchange={(checked) => toggle.mutate({ id: group.id, is_watched: checked })}
				/>
			{/if}
		{/snippet}
	</DataTable>
{/if}
