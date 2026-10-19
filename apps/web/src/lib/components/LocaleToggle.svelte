<script lang="ts">
	import { getI18n } from '#lib/i18n.svelte.js';
	import { Button } from '#lib/ui/index.js';

	const i18n = getI18n();
</script>

<Button
	size="sm"
	variant="ghost"
	onclick={i18n.toggle}
	aria-label={i18n.t('locale.switchLabel')}
	lang={i18n.locale === 'en' ? 'gu' : 'en'}
>
	{i18n.t('locale.switch')}
</Button>
