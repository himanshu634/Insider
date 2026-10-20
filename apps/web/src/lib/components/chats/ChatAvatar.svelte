<script lang="ts">
	import { avatarTone, initials } from '#lib/chats/thread.js';
	import { Icon } from '#lib/ui/index.js';

	interface Props {
		name: string;
		/** Stable key for the colour (the group JID). */
		key: string;
		size?: 'md' | 'lg';
		/** The "All chats" row: a filled chat icon instead of initials. */
		all?: boolean;
	}

	let { name, key, size = 'lg', all = false }: Props = $props();
	const tone = $derived(avatarTone(key));
	const isLatin = $derived(/^[A-Za-z0-9]/.test(name.trim()));
</script>

<span
	aria-hidden="true"
	lang={isLatin ? undefined : 'gu'}
	class={[
		'inline-flex flex-none items-center justify-center rounded-full font-semibold select-none',
		size === 'lg' ? 'h-12 w-12 text-base' : 'h-10 w-10 text-sm',
		all
			? 'bg-primary text-primary-ink'
			: {
					primary: 'bg-primary-soft text-primary',
					info: 'bg-info-soft text-info',
					accent: 'bg-accent-soft text-accent-text',
					neutral: 'bg-surface-2 text-ink-muted'
				}[tone]
	]}
>
	{#if all}
		<Icon name="message" size={20} />
	{:else}
		{initials(name)}
	{/if}
</span>
