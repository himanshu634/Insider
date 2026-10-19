<script lang="ts">
	import { resolve } from '$app/paths';
	import { ApiError, API_BASE_URL } from '#lib/api/client.js';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { Banner, Button } from '#lib/ui/index.js';

	interface Props {
		error: unknown;
		onretry?: () => void;
	}

	let { error, onretry }: Props = $props();
	const i18n = getI18n();

	const apiError = $derived(error instanceof ApiError ? error : null);
	const offline = $derived(apiError?.kind === 'network');
	const unauthorized = $derived(apiError?.status === 401);
	const message = $derived(error instanceof Error ? error.message : String(error));
</script>

<Banner
	tone="negative"
	urgent
	icon={offline ? 'wifiOff' : 'alert'}
	title={offline ? i18n.t('common.offlineTitle') : i18n.t('common.errorTitle')}
>
	{#if offline}
		<p>{i18n.t('common.offlineBody')}</p>
		<p class="mt-1 text-xs text-ink-muted">API: <code>{API_BASE_URL}</code></p>
	{:else}
		<p>
			{#if apiError}<span class="num">HTTP {apiError.status}</span>:
			{/if}{message}
		</p>
	{/if}

	{#snippet actions()}
		{#if onretry}
			<Button size="sm" icon="refresh" onclick={onretry}>{i18n.t('common.retry')}</Button>
		{/if}
		{#if unauthorized}
			<Button size="sm" variant="primary" icon="login" href={resolve('/login')}>Sign in</Button>
		{/if}
	{/snippet}
</Banner>
