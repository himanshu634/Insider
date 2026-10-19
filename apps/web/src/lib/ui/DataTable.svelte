<script lang="ts" module>
	export interface Column {
		key: string;
		label: string;
		/** Numbers: right-aligned, tabular figures. */
		numeric?: boolean;
		/** Hide below the md breakpoint to keep phone tables readable. */
		hideOnMobile?: boolean;
		/** Visually hidden header (e.g. for an actions column). */
		srOnly?: boolean;
	}
</script>

<script lang="ts" generics="Row">
	import type { Snippet } from 'svelte';
	import Skeleton from './Skeleton.svelte';

	interface Props {
		columns: Column[];
		rows: Row[] | undefined;
		/** Stable key per row. */
		key: (row: Row) => string | number;
		/** Renders the content of one cell; DataTable owns the <td> and its alignment. */
		cell: Snippet<[Row, string]>;
		/** Accessible table name. */
		caption: string;
		captionVisible?: boolean;
		loading?: boolean;
		loadingRows?: number;
		/** Shown in a full-width row when there are no rows. */
		empty?: Snippet;
		/** Marks a row as the current one (keyboard review). */
		selected?: (row: Row) => boolean;
		onrowclick?: (row: Row) => void;
	}

	let {
		columns,
		rows,
		key,
		cell,
		caption,
		captionVisible = false,
		loading = false,
		loadingRows = 5,
		empty,
		selected,
		onrowclick
	}: Props = $props();
</script>

<div class="overflow-x-auto rounded-lg border border-border bg-surface">
	<table class="ui-table w-full border-collapse text-sm">
		<caption class={captionVisible ? 'px-4 py-3 text-left font-semibold text-ink' : 'sr-only'}>
			{caption}
		</caption>
		<thead>
			<tr>
				{#each columns as col (col.key)}
					<th
						scope="col"
						class={[
							'sticky top-0 z-[1] border-b border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-muted',
							col.numeric ? 'text-right' : 'text-left',
							col.hideOnMobile && 'hidden md:table-cell'
						]}
					>
						<span class={col.srOnly ? 'sr-only' : undefined}>{col.label}</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each { length: loadingRows }, i (i)}
					<tr>
						{#each columns as col (col.key)}
							<td class={['px-3 py-3', col.hideOnMobile && 'hidden md:table-cell']}>
								<Skeleton
									width={col.numeric ? '4rem' : '70%'}
									class={col.numeric ? 'ml-auto' : ''}
								/>
							</td>
						{/each}
					</tr>
				{/each}
			{:else if !rows || rows.length === 0}
				<tr>
					<td colspan={columns.length} class="px-4 py-8 text-center text-sm text-ink-muted">
						{#if empty}{@render empty()}{:else}No rows{/if}
					</td>
				</tr>
			{:else}
				{#each rows as row (key(row))}
					{@const isSelected = selected?.(row) ?? false}
					<tr
						class={[
							'ui-row border-t border-border first:border-t-0',
							isSelected && 'is-selected',
							onrowclick && 'cursor-pointer'
						]}
						aria-selected={selected ? isSelected : undefined}
						onclick={onrowclick ? () => onrowclick(row) : undefined}
					>
						{#each columns as col (col.key)}
							<td
								class={[
									'px-3 py-2.5 align-top',
									col.numeric && 'num',
									col.hideOnMobile && 'hidden md:table-cell'
								]}
							>
								{@render cell(row, col.key)}
							</td>
						{/each}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.ui-row {
		transition: background-color var(--duration-fast) var(--ease-standard);
	}

	.ui-row:hover {
		background: var(--surface-2);
	}

	/* The selected row reads as a ledger line marked in turmeric. */
	.ui-row.is-selected {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
	}
</style>
