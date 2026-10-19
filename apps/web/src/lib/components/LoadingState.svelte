<script lang="ts">
	import { Skeleton } from '#lib/ui/index.js';
	import { getI18n } from '#lib/i18n.svelte.js';

	interface Props {
		/** Number of placeholder lines. */
		rows?: number;
	}

	let { rows = 4 }: Props = $props();
	const i18n = getI18n();
</script>

<div class="rounded-lg border border-border bg-surface p-4" role="status" aria-live="polite">
	<span class="sr-only">{i18n.t('common.loading')}</span>
	<Skeleton lines={rows} />
</div>
