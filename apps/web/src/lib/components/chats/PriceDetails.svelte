<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Message, ObservationStatus } from '#lib/api/queries.js';
	import { formatPriceRange, formatRawRange } from '#lib/chats/thread.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { formatDateTime } from '#lib/utils/dates.js';
	import { formatNumber, humanizeSlug } from '#lib/utils/format.js';
	import { UNIT_FACTORS, isUnitCode, unitLabel } from '#lib/utils/units.js';
	import { Badge, Button, type BadgeTone } from '#lib/ui/index.js';

	interface Props {
		message: Message;
	}

	let { message }: Props = $props();
	const i18n = getI18n();

	const STATUS: Record<ObservationStatus, [string, BadgeTone]> = {
		auto: ['Counted', 'positive'],
		approved: ['Approved', 'positive'],
		needs_review: ['Needs review', 'warning'],
		rejected: ['Rejected', 'negative']
	};

	const held = $derived(message.observations.filter((o) => o.status === 'needs_review'));
</script>

<div class="flex flex-col gap-4">
	<blockquote class="m-0 rounded-lg border-l-4 border-accent bg-bg px-3 py-2.5">
		<div class="text-xs text-ink-muted">
			{#if message.sender_name}<b class="font-semibold text-ink">{message.sender_name}</b> in{/if}
			{message.group.name}, <span class="num">{formatDateTime(message.sent_at)}</span>
		</div>
		{#if message.text}
			<p class="mt-1 text-base leading-6 whitespace-pre-line">{message.text}</p>
		{/if}
	</blockquote>

	<table class="w-full border-collapse text-sm">
		<thead>
			<tr class="border-b border-border text-left text-xs font-medium text-ink-muted">
				<th scope="col" class="py-1.5 font-medium">Commodity</th>
				<th scope="col" class="py-1.5 font-medium">As reported</th>
				<th scope="col" class="py-1.5 text-right font-medium">₹/quintal</th>
			</tr>
		</thead>
		<tbody>
			{#each message.observations as o (o.id)}
				{@const [statusText, tone] = STATUS[o.status]}
				<tr class="border-b border-border align-top">
					<td class="py-2.5">
						{humanizeSlug(o.commodity)}{o.variety ? ` ${o.variety}` : ''}
						<span class="block text-ink-muted">{humanizeSlug(o.market)}</span>
					</td>
					<td class="py-2.5 tabular-nums">
						{formatRawRange(o)}
						<span class="block text-ink-muted"
							>{unitLabel(o.unit)}{isUnitCode(o.unit) && UNIT_FACTORS[o.unit] !== 1
								? `, ×${UNIT_FACTORS[o.unit]}`
								: ''}</span
						>
					</td>
					<td class="py-2.5 text-right tabular-nums">
						<b class="font-semibold">
							{#if o.arrivals_quintal != null && o.min_per_quintal == null && o.max_per_quintal == null && o.modal_per_quintal == null}
								{formatNumber(o.arrivals_quintal)} q arrivals
							{:else}
								{formatPriceRange(o)}
							{/if}
						</b>
						<span class="mt-1 block"><Badge {tone}>{statusText}</Badge></span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if held.length}
		<p class="text-sm text-ink-muted">
			{held.length === 1 ? 'One price is' : `${held.length} prices are`} held back: the reader was unsure
			(confidence
			<span class="num">{held.map((o) => o.confidence.toFixed(2)).join(', ')}</span>). They count
			once someone approves them.
		</p>
		<Button variant="primary" href={resolve('/review')}>{i18n.t('chats.openReview')}</Button>
	{/if}
</div>
