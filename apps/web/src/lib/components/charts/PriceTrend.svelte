<script lang="ts">
	import * as echarts from 'echarts/core';
	import { LineChart } from 'echarts/charts';
	import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
	import { CanvasRenderer } from 'echarts/renderers';
	import { MediaQuery } from 'svelte/reactivity';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { DailyPricePoint } from '#lib/api/queries.js';
	import { formatDate, toISTDateString } from '#lib/utils/dates.js';
	import { formatRupees, humanizeSlug } from '#lib/utils/format.js';
	import { theme } from '#lib/ui/index.js';

	echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

	interface Props {
		points: DailyPricePoint[];
		/** Accessible summary of what the chart shows. */
		label: string;
		height?: number;
	}

	let { points, label, height = 320 }: Props = $props();

	// Re-read token colours when the system or forced theme changes.
	const systemDark = new MediaQuery('(prefers-color-scheme: dark)');

	// Distinct marker shapes so series never rely on colour alone.
	const SYMBOLS = ['circle', 'rect', 'triangle', 'diamond', 'roundRect', 'pin'];

	const series = $derived.by(() => {
		const byMarket: Record<string, [string, number][]> = {};
		for (const p of points) (byMarket[p.market] ??= []).push([p.date, p.median_modal]);
		return Object.entries(byMarket)
			.map(([market, data]) => ({ market, data: data.sort((a, b) => a[0].localeCompare(b[0])) }))
			.sort((a, b) => a.market.localeCompare(b.market));
	});

	/** Axis tick label: "19 Oct" (IST calendar day, no year). */
	function axisDate(value: number): string {
		return formatDate(toISTDateString(value)).replace(/\s\d{4}$/, '');
	}

	function readTokens(node: HTMLElement) {
		const css = getComputedStyle(node);
		const v = (name: string) => css.getPropertyValue(name).trim();
		return {
			series: [1, 2, 3, 4, 5, 6].map((i) => v(`--chart-${i}`)),
			ink: v('--ink'),
			muted: v('--ink-muted'),
			grid: v('--chart-grid'),
			surface: v('--surface'),
			border: v('--border'),
			font: v('--font-sans') || 'sans-serif'
		};
	}

	function chart(node: HTMLDivElement) {
		const instance = echarts.init(node, undefined, { renderer: 'canvas' });
		const resize = new ResizeObserver(() => instance.resize());
		resize.observe(node);

		$effect(() => {
			// Dependencies: theme (system + forced), data, motion preference.
			void systemDark.current;
			void theme.preference;
			const t = readTokens(node);
			const dense = series.some((s) => s.data.length > 60);

			instance.setOption(
				{
					animation: !prefersReducedMotion.current,
					animationDuration: 200,
					color: t.series,
					textStyle: { fontFamily: t.font, color: t.muted },
					grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
					legend: {
						top: 0,
						left: 0,
						type: 'scroll',
						textStyle: { color: t.ink },
						icon: 'roundRect'
					},
					tooltip: {
						trigger: 'axis',
						backgroundColor: t.surface,
						borderColor: t.border,
						textStyle: { color: t.ink, fontFamily: t.font },
						valueFormatter: (value: unknown) =>
							typeof value === 'number' ? `${formatRupees(value)}/q` : '—'
					},
					xAxis: {
						type: 'time',
						axisLine: { lineStyle: { color: t.border } },
						axisLabel: {
							color: t.muted,
							hideOverlap: true,
							formatter: axisDate
						}
					},
					yAxis: {
						type: 'value',
						scale: true,
						name: '₹/quintal',
						nameTextStyle: { color: t.muted, align: 'left' },
						splitLine: { lineStyle: { color: t.grid } },
						axisLabel: { color: t.muted, formatter: (value: number) => formatRupees(value) }
					},
					series: series.map((s, i) => ({
						type: 'line',
						name: humanizeSlug(s.market),
						data: s.data,
						symbol: SYMBOLS[i % SYMBOLS.length],
						symbolSize: 6,
						showSymbol: !dense,
						lineStyle: { width: 2 },
						emphasis: { focus: 'series' }
					}))
				},
				{ notMerge: true }
			);
		});

		return () => {
			resize.disconnect();
			instance.dispose();
		};
	}
</script>

<div role="img" aria-label={label} class="w-full" style:height="{height}px" {@attach chart}></div>
