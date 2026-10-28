<script lang="ts">
	import { contrastRatio, wcagRating } from '#lib/ui/contrast.js';
	import {
		Badge,
		Banner,
		Button,
		Card,
		DataTable,
		Delta,
		Dialog,
		EmptyState,
		IconButton,
		Input,
		Logo,
		PriceCell,
		SegmentedControl,
		Select,
		Skeleton,
		Stat,
		Switch,
		toasts,
		type Column
	} from '#lib/ui/index.js';
	import PageHeader from '#lib/components/PageHeader.svelte';

	type Role = {
		name: string;
		token: string;
		on: string;
		note: string;
		/** text: 4.5:1 rule; ui: 3:1 non-text rule; decorative: not rated. */
		kind?: 'text' | 'ui' | 'decorative';
	};

	// Each role with the background it is checked against.
	const roles: Role[] = [
		{ name: 'bg', token: '--bg', on: '--ink', note: 'Page (warm paper)' },
		{ name: 'surface', token: '--surface', on: '--ink', note: 'Cards, tables' },
		{ name: 'surface-2', token: '--surface-2', on: '--ink', note: 'Headers, wells, hover' },
		{
			name: 'border',
			token: '--border',
			on: '--surface',
			note: 'Hairline rules',
			kind: 'decorative'
		},
		{
			name: 'border-strong',
			token: '--border-strong',
			on: '--surface',
			note: 'Control outlines (≥3:1)'
		},
		{ name: 'ink', token: '--ink', on: '--surface', note: 'Body text' },
		{ name: 'ink-muted', token: '--ink-muted', on: '--surface', note: 'Secondary text' },
		{ name: 'primary', token: '--primary', on: '--surface', note: 'Field green: actions, links' },
		{ name: 'primary-ink', token: '--primary-ink', on: '--primary', note: 'Text on primary' },
		{
			name: 'accent',
			token: '--accent',
			on: '--accent-ink',
			note: 'Turmeric: attention, selection'
		},
		{ name: 'accent-text', token: '--accent-text', on: '--surface', note: 'Accent as text' },
		{ name: 'positive', token: '--positive', on: '--surface', note: 'Leaf green: rises' },
		{ name: 'negative', token: '--negative', on: '--surface', note: 'Clay red: drops, alerts' },
		{ name: 'warning', token: '--warning', on: '--surface', note: 'Needs a look' },
		{ name: 'info', token: '--info', on: '--surface', note: 'Neutral information' },
		{ name: 'focus', token: '--focus', on: '--bg', note: 'Focus ring (≥3:1)', kind: 'ui' }
	];

	function rate(role: Role, ratio: number | null): string {
		if (role.kind === 'decorative') return 'decorative';
		if (role.kind === 'ui') return ratio != null && ratio >= 3 ? 'UI pass' : 'UI fail';
		return wcagRating(ratio);
	}

	type Measured = Record<string, { value: string; ratio: number | null }>;
	let measured = $state<Record<string, Measured>>({});

	// Reads the resolved token values inside a themed panel to show real contrast.
	function measure(themeName: string) {
		return (node: HTMLElement) => {
			const css = getComputedStyle(node);
			const get = (t: string) => css.getPropertyValue(t).trim();
			const result: Measured = {};
			for (const r of roles) {
				const value = get(r.token);
				result[r.name] = { value, ratio: contrastRatio(value, get(r.on)) };
			}
			measured[themeName] = result;
		};
	}

	const typeScale = [
		{ name: 'text-2xl', px: '32 / 40', sample: 'Castor ₹6,250' },
		{ name: 'text-xl', px: '24 / 32', sample: 'Today in Unjha' },
		{ name: 'text-lg', px: '20 / 28', sample: 'Groundnut bold, Rajkot' },
		{
			name: 'text-base',
			px: '16 / 24',
			sample: 'Arrivals rose after the rains. એરંડાના ભાવ વધ્યા.'
		},
		{ name: 'text-sm', px: '14 / 20', sample: 'Modal ₹/quintal · 3 sources across 2 groups' },
		{ name: 'text-xs', px: '12 / 16', sample: 'Reported as ₹1,250 per 20 kg' }
	];

	const spacing = [1, 2, 3, 4, 6, 8, 12, 16];
	const radii = [
		{ name: 'rounded-sm', value: '6px' },
		{ name: 'rounded-md', value: '8px' },
		{ name: 'rounded-lg', value: '10px' }
	];

	let switchOn = $state(true);
	let range = $state<'30' | '90' | '365'>('90');
	let commodity = $state('castor');
	let search = $state('');
	let dialogOpen = $state(false);
	let sheetOpen = $state(false);

	type SampleRow = { id: number; market: string; modal: number; raw: number; d: number | null };
	const sampleRows: SampleRow[] = [
		{ id: 1, market: 'Unjha', modal: 6250, raw: 1250, d: 120 },
		{ id: 2, market: 'Rajkot', modal: 6105, raw: 1221, d: -45 },
		{ id: 3, market: 'Gondal', modal: 6180, raw: 1236, d: 0 }
	];
	const sampleColumns: Column[] = [
		{ key: 'market', label: 'Mandi' },
		{ key: 'modal', label: 'Modal ₹/q', numeric: true },
		{ key: 'd', label: 'vs yesterday', numeric: true }
	];
</script>

<PageHeader
	title="Mandi Ledger"
	subtitle="The Insider design system: tokens and components, in light and dark. Every route uses only what is on this page."
/>

<section class="mb-8">
	<h2 class="mb-3 text-lg font-semibold">Logo</h2>
	<p class="mb-3 text-sm text-ink-muted">
		Chatter to one line: rows of chatter settle into one clean line with a point at its end. The
		plain mark follows the theme; the tile keeps one look in both themes, like the app icon.
	</p>
	<Card>
		<div class="flex flex-wrap items-center gap-8">
			<Logo size={64} />
			<Logo tile size={64} />
			<span class="flex items-center gap-2 text-lg font-bold text-primary"><Logo />Insider</span>
			<Logo size={16} />
		</div>
	</Card>
</section>

<section class="mb-8">
	<h2 class="mb-3 text-lg font-semibold">Type</h2>
	<p class="mb-3 text-sm text-ink-muted">
		Inter for Latin and every numeral (tabular, lining), Noto Sans Gujarati for Gujarati glyphs.
	</p>
	<Card padding="none">
		<ul class="divide-y divide-border">
			{#each typeScale as t (t.name)}
				<li class="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6">
					<code class="w-28 shrink-0 text-xs text-ink-muted"
						>{t.name} <span class="num">{t.px}</span></code
					>
					<span class={t.name}>{t.sample}</span>
				</li>
			{/each}
		</ul>
	</Card>
</section>

<section class="mb-8 grid gap-6 md:grid-cols-3">
	<div>
		<h2 class="mb-3 text-lg font-semibold">Spacing (4px grid)</h2>
		<ul class="space-y-2">
			{#each spacing as s (s)}
				<li class="flex items-center gap-3 text-xs">
					<code class="num w-14 text-ink-muted">{s * 4}px</code>
					<span class="h-3 rounded-sm bg-primary" style:width="{s * 4}px"></span>
				</li>
			{/each}
		</ul>
	</div>
	<div>
		<h2 class="mb-3 text-lg font-semibold">Radius</h2>
		<ul class="flex gap-3">
			{#each radii as r (r.name)}
				<li class="flex flex-col items-center gap-1 text-xs text-ink-muted">
					<span class={['h-14 w-14 border border-border-strong bg-surface', r.name]}></span>
					{r.value}
				</li>
			{/each}
		</ul>
	</div>
	<div>
		<h2 class="mb-3 text-lg font-semibold">Elevation and motion</h2>
		<div class="rounded-lg border border-border bg-surface p-4 text-sm shadow-overlay">
			One overlay shadow, used only by dialogs, sheets and toasts. Everything else uses hairline
			borders.
		</div>
		<p class="mt-3 text-xs text-ink-muted">
			Motion: 120 / 160 / 200 ms, ease-out. Turned off under prefers-reduced-motion.
		</p>
	</div>
</section>

{#snippet gallery(themeName: 'light' | 'dark')}
	<section
		data-theme={themeName}
		{@attach measure(themeName)}
		class="rounded-lg border border-border bg-bg p-4 text-ink md:p-6"
		aria-labelledby="theme-{themeName}"
	>
		<h2 id="theme-{themeName}" class="mb-4 text-lg font-semibold">
			{themeName === 'light' ? 'Light theme' : 'Dark theme'}
		</h2>

		<h3 class="mb-2 text-base font-semibold">Colour roles</h3>
		<ul class="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#each roles as role (role.name)}
				{@const m = measured[themeName]?.[role.name]}
				<li class="flex items-center gap-3 rounded-md border border-border bg-surface p-2">
					<span
						class="h-10 w-10 shrink-0 rounded-sm border border-border"
						style:background="var({role.token})"
					></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{role.name}</span>
						<span class="block text-xs text-ink-muted">{role.note}</span>
					</span>
					<span class="num text-xs">
						<span class="block">{m?.value ?? ''}</span>
						{#if m?.ratio}
							<span class="block text-ink-muted">{m.ratio.toFixed(1)}:1 {rate(role, m.ratio)}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>

		<h3 class="mb-2 text-base font-semibold">Buttons</h3>
		<div class="mb-2 flex flex-wrap gap-2">
			<Button variant="primary">Approve</Button>
			<Button>Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="danger" icon="x">Reject</Button>
		</div>
		<div class="mb-6 flex flex-wrap items-center gap-2">
			<Button variant="primary" size="sm">Small</Button>
			<Button variant="primary" size="lg">Large</Button>
			<Button variant="primary" loading>Saving</Button>
			<Button disabled>Disabled</Button>
			<IconButton icon="refresh" label="Refresh" variant="secondary" />
			<IconButton icon="x" label="Close" />
		</div>

		<h3 class="mb-2 text-base font-semibold">Badges</h3>
		<div class="mb-6 flex flex-wrap gap-2">
			<Badge>Neutral</Badge>
			<Badge tone="positive" dot>Collector online</Badge>
			<Badge tone="negative">Conflicting</Badge>
			<Badge tone="warning">Single source</Badge>
			<Badge tone="info">In 3 groups</Badge>
			<Badge tone="accent">Notable</Badge>
		</div>

		<h3 class="mb-2 text-base font-semibold">Stats, prices and deltas</h3>
		<div class="mb-4 grid gap-3 sm:grid-cols-3">
			<Stat label="Castor, Unjha" value="₹6,250/q" delta={120} deltaLabel="vs yesterday" />
			<Stat label="Groundnut, Rajkot" value="₹6,105/q" delta={-45} deltaLabel="vs yesterday" />
			<Stat label="Arrivals today" value="1.2 L bags" delta={0} deltaLabel="vs 7-day avg" />
		</div>
		<div class="mb-6 flex flex-wrap items-start gap-6">
			<PriceCell
				value={6250}
				raw={{ value: 1250, unit: 'per_20kg' }}
				delta={120}
				deltaLabel="vs yesterday"
				emphasis
				unit
			/>
			<PriceCell value={6105} delta={-45} />
			<PriceCell value={null} />
			<Delta value={300} against="vs 7-day average" />
			<Delta value={-120} />
			<Delta value={0} />
		</div>

		<h3 class="mb-2 text-base font-semibold">Data table</h3>
		<div class="mb-3">
			<DataTable
				caption="Sample prices"
				columns={sampleColumns}
				rows={sampleRows}
				key={(r) => r.id}
				selected={(r) => r.id === 2}
			>
				{#snippet cell(row: SampleRow, col: string)}
					{#if col === 'market'}{row.market}
					{:else if col === 'modal'}<PriceCell
							value={row.modal}
							raw={{ value: row.raw, unit: 'per_20kg' }}
						/>
					{:else if col === 'd'}<Delta value={row.d} />{/if}
				{/snippet}
			</DataTable>
		</div>
		<div class="mb-6 grid gap-3 md:grid-cols-2">
			<DataTable
				caption="Loading table"
				columns={sampleColumns}
				rows={undefined}
				key={(r: SampleRow) => r.id}
				loading
				loadingRows={2}
			>
				{#snippet cell()}{/snippet}
			</DataTable>
			<DataTable
				caption="Empty table"
				columns={sampleColumns}
				rows={[]}
				key={(r: SampleRow) => r.id}
			>
				{#snippet cell()}{/snippet}
			</DataTable>
		</div>

		<h3 class="mb-2 text-base font-semibold">Form controls</h3>
		<div class="mb-6 grid gap-4 md:grid-cols-2">
			<Input
				label="Search messages"
				icon="search"
				placeholder="એરંડા, castor…"
				bind:value={search}
			/>
			<Select
				label="Commodity"
				bind:value={commodity}
				options={[
					{ value: 'castor', label: 'Castor' },
					{ value: 'groundnut', label: 'Groundnut' }
				]}
			/>
			<Input label="Modal price" hint="Per quintal" inputmode="decimal" value="6250" />
			<Input label="Market" error="Choose a mandi from the dictionary" value="Unja" />
			<div class="flex flex-col gap-1">
				<Switch bind:checked={switchOn} label="Watch this group" />
				<Switch checked={false} label="Disabled switch" disabled />
			</div>
			<SegmentedControl
				label="Date range"
				bind:value={range}
				options={[
					{ value: '30', label: '30 days' },
					{ value: '90', label: '90 days' },
					{ value: '365', label: '1 year' }
				]}
			/>
		</div>

		<h3 class="mb-2 text-base font-semibold">Feedback</h3>
		<div class="mb-4 grid gap-3">
			<Banner tone="info" title="Prices refresh every two minutes" />
			<Banner tone="positive" title="Observation approved" />
			<Banner tone="warning" title="Collector last synced 3 hours ago"
				>Check the team Mac is awake.</Banner
			>
			<Banner tone="negative" title="Cannot reach the Insider API">
				Start it with <code>bin/insider api</code>.
				{#snippet actions()}<Button size="sm" icon="refresh">Try again</Button>{/snippet}
			</Banner>
		</div>
		<div class="mb-4 flex flex-wrap gap-2">
			<Button onclick={() => toasts.show('Saved', 'positive')}>Show success toast</Button>
			<Button onclick={() => toasts.show('Could not save', 'negative')}>Show error toast</Button>
			<Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
			<Button onclick={() => (sheetOpen = true)}>Open sheet</Button>
		</div>
		<div class="mb-4 grid gap-3 md:grid-cols-2">
			<EmptyState
				icon="chart"
				level={3}
				title="No prices yet"
				body="Prices appear here once watched groups post rate lists."
			>
				{#snippet action()}<Button variant="primary" size="sm">Choose groups</Button>{/snippet}
			</EmptyState>
			<Card title="Loading card" level={3}>
				<Skeleton lines={4} />
			</Card>
		</div>
	</section>
{/snippet}

<div class="grid gap-6 xl:grid-cols-2">
	{@render gallery('light')}
	{@render gallery('dark')}
</div>

<Dialog bind:open={dialogOpen} title="Reject this observation?">
	<p class="text-sm">
		The price will not count towards today's board. You can approve it again later.
	</p>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
		<Button variant="danger" onclick={() => (dialogOpen = false)}>Reject</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={sheetOpen} title="Filters" variant="sheet">
	<p class="text-sm">On phones a sheet docks to the bottom edge, above the home indicator.</p>
</Dialog>
