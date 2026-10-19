/**
 * Theme preference: follow the system, or force light / dark via <html data-theme>.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'insider.theme';

function read(): ThemePreference {
	try {
		const v = globalThis.localStorage?.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

function apply(pref: ThemePreference) {
	if (typeof document === 'undefined') return;
	if (pref === 'system') delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = pref;
}

class Theme {
	preference = $state<ThemePreference>(read());

	constructor() {
		apply(this.preference);
	}

	set(pref: ThemePreference): void {
		this.preference = pref;
		apply(pref);
		try {
			globalThis.localStorage?.setItem(KEY, pref);
		} catch {
			// Blocked storage: the choice still applies for this visit.
		}
	}
}

/** Module-level is safe: client-only SPA. */
export const theme = new Theme();
