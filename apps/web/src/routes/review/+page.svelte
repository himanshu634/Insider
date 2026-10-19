<script lang="ts">
	import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
	import {
		fetchReviewQueue,
		keys,
		reviewObservation,
		type ObservationReview,
		type PriceObservation
	} from '#lib/api/queries.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDate } from '#lib/utils/dates.js';
	import { formatPercent, humanizeSlug } from '#lib/utils/format.js';
	import {
		Badge,
		Button,
		DataTable,
		Dialog,
		EmptyState,
		PriceCell,
		toasts,
		type Column
	} from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';

	const i18n = getI18n();
	const queryClient = useQueryClient();
	const filter = { status: 'needs_review' } as const;

	const queue = createQuery(() => ({
		queryKey: keys.review(filter),
		queryFn: () => fetchReviewQueue(filter)
	}));

	const items = $derived(queue.data?.items ?? []);
	let selectedIndex = $state(0);
	const current = $derived(
		items[Math.min(selectedIndex, items.length - 1)] as PriceObservation | undefined
	);
	let showHelp = $state(false);

	const review = createMutation(() => ({
		mutationFn: (body: ObservationReview) => reviewObservation(body),
		onSuccess: (_data, body) => {
			toasts.show(body.action === 'approve' ? 'Approved' : 'Rejected', 'positive');
			return queryClient.invalidateQueries({ queryKey: keys.reviewAll() });
		},
		onError: (error) => toasts.show(`Could not save: ${error.message}`, 'negative')
	}));

	function act(observation: PriceObservation | undefined, action: 'approve' | 'reject') {
		if (!observation || review.isPending) return;
		review.mutate({ id: observation.id, action });
	}

	function isTyping(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
		if (event.key === '?') {
			showHelp = true;
			return;
		}
		if (showHelp || items.length === 0) return;
		switch (event.key) {
			case 'j':
				selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
				break;
			case 'k':
				selectedIndex = Math.max(selectedIndex - 1, 0);
				break;
			case 'a':
				act(current, 'approve');
				break;
			case 'r':
				act(current, 'reject');
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	const columns: Column[] = [
		{ key: 'what', label: 'Commodity / mandi' },
		{ key: 'reported', label: 'Reported', numeric: true, hideOnMobile: true },
		{ key: 'modal', label: 'Modal ₹/q', numeric: true },
		{ key: 'confidence', label: 'Confidence', numeric: true, hideOnMobile: true },
		{ key: 'actions', label: 'Actions', srOnly: true }
	];
</script>

<svelte:window {onkeydown} />

<PageHeader title={i18n.t('review.title')} subtitle={i18n.t('review.subtitle')}>
	{#snippet actions()}
		<Button size="sm" variant="ghost" icon="keyboard" onclick={() => (showHelp = true)}
			>Shortcuts</Button
		>
	{/snippet}
</PageHeader>

{#if queue.isError}
	<ErrorState error={queue.error} onretry={() => queue.refetch()} />
{:else if queue.isSuccess && items.length === 0}
	<EmptyState
		icon="checkSquare"
		title={i18n.t('review.empty.title')}
		body={i18n.t('review.empty.body')}
	/>
{:else}
	<DataTable
		caption="Observations waiting for review"
		{columns}
		rows={items}
		key={(r) => r.id}
		loading={queue.isPending}
		selected={(r) => r.id === current?.id}
		onrowclick={(r) => (selectedIndex = items.indexOf(r))}
	>
		{#snippet cell(row: PriceObservation, col: string)}
			{#if col === 'what'}
				<span class="font-medium text-ink">{humanizeSlug(row.commodity)}</span>
				{#if row.variety}<span class="text-ink-muted"> · {row.variety}</span>{/if}
				<span class="block text-xs text-ink-muted"
					>{humanizeSlug(row.market)},
					<time datetime={row.obs_date}>{formatDate(row.obs_date)}</time></span
				>
			{:else if col === 'reported'}
				<span class="text-ink-muted"
					>{row.modal_raw ?? '—'} <span class="text-xs">{row.unit}</span></span
				>
			{:else if col === 'modal'}
				<PriceCell
					value={row.modal_per_quintal}
					raw={{ value: row.modal_raw, unit: row.unit }}
					emphasis
				/>
			{:else if col === 'confidence'}
				<Badge tone={row.confidence < 0.5 ? 'negative' : 'warning'}
					>{formatPercent(row.confidence)}</Badge
				>
			{:else if col === 'actions'}
				<span class="flex justify-end gap-2">
					<Button
						size="sm"
						variant="primary"
						icon="check"
						disabled={review.isPending}
						onclick={() => act(row, 'approve')}>Approve</Button
					>
					<Button
						size="sm"
						variant="danger"
						icon="x"
						disabled={review.isPending}
						onclick={() => act(row, 'reject')}>Reject</Button
					>
				</span>
			{/if}
		{/snippet}
	</DataTable>
	<p class="mt-2 text-xs text-ink-muted">
		Keys: <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>a</kbd> approve, <kbd>r</kbd> reject, <kbd>?</kbd> help.
		Hover a price to see the value as reported.
	</p>
{/if}

<Dialog bind:open={showHelp} title="Review shortcuts">
	<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
		<dt><kbd>j</kbd></dt>
		<dd>Next observation</dd>
		<dt><kbd>k</kbd></dt>
		<dd>Previous observation</dd>
		<dt><kbd>a</kbd></dt>
		<dd>Approve the selected observation</dd>
		<dt><kbd>r</kbd></dt>
		<dd>Reject the selected observation</dd>
		<dt><kbd>?</kbd></dt>
		<dd>Show this list</dd>
	</dl>
</Dialog>

<style>
	kbd {
		display: inline-block;
		min-width: 1.5rem;
		padding: 0 0.375rem;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		background: var(--surface);
		font-family: inherit;
		font-size: var(--text-xs);
		text-align: center;
	}
</style>
