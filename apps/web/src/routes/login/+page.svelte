<script lang="ts">
	import { resolve } from '$app/paths';
	import { getI18n } from '#lib/i18n.svelte.js';
	import { Banner, Button, Card } from '#lib/ui/index.js';

	const i18n = getI18n();
</script>

<div class="mx-auto max-w-md pt-6">
	<Card title={i18n.t('login.title')} level={2}>
		<p class="text-sm text-ink">{i18n.t('login.body')}</p>
		<div class="mt-4">
			<Banner tone="info" title="Development mode">
				The API runs with AUTH_DEV_BYPASS, so no token is sent. Sign-in will be wired up in
				<code>src/lib/auth.ts</code> once the provider is chosen.
			</Banner>
		</div>
		<div class="mt-5">
			<Button variant="primary" href={resolve('/')}>{i18n.t('login.continue')}</Button>
		</div>
	</Card>
</div>
