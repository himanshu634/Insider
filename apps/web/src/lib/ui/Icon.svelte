<script lang="ts">
	import { icons, type IconName } from './icons.js';

	interface Props {
		name: IconName;
		/** Pixel size; 16 inline, 20 controls, 24 navigation. */
		size?: 16 | 20 | 24 | 32 | 40;
		/** Accessible name. Omit for decorative icons next to text. */
		label?: string;
		strokeWidth?: number;
		class?: string;
	}

	let { name, size = 20, label, strokeWidth = 1.75, class: className }: Props = $props();
</script>

<svg
	class={['shrink-0', className]}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<path d={icons[name]} />
</svg>
