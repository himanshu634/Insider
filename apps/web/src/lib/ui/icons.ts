/**
 * One icon family: 24×24 outline strokes (Lucide-style), 1.75px, round caps.
 * Add icons here rather than inlining SVG in routes.
 */
export const icons = {
	sun: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
	chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
	bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z',
	message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z',
	check: 'M20 6 9 17l-5-5',
	checkSquare: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
	sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
	x: 'M18 6 6 18M6 6l12 12',
	chevronLeft: 'M15 18l-6-6 6-6',
	chevronRight: 'M9 18l6-6-6-6',
	chevronsLeft: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
	chevronsRight: 'M13 17l5-5-5-5M6 17l5-5-5-5',
	eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
	forward: 'M15 6l6 6-6 6M21 12H9a6 6 0 0 0-6 6',
	image: 'M4 5h16v14H4ZM4 16l5-5 4 4 3-3 4 4M15.5 9.5h0',
	search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
	refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
	sprout: 'M12 21V9M12 13c-3 0-5-2-5-5 3 0 5 2 5 5ZM12 11c0-3 2-5 5-5 0 3-2 5-5 5ZM5 21h14',
	alert:
		'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
	info: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
	wifiOff:
		'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11.5a10 10 0 0 1 2.2 1.4M12 20h.01',
	users:
		'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
	laptop: 'M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10M2 20h20M4 16h16',
	book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5',
	keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
	palette:
		'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22ZM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
	login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
	store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6'
} as const;

export type IconName = keyof typeof icons;
