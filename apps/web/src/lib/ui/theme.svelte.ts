/**
 * Theme preference: light (default), dark, or follow the system, via <html data-theme>.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'insider.theme';

function read(): ThemePreference {
	try {
		const v = globalThis.localStorage?.getItem(KEY);
		return v === 'system' || v === 'dark' ? v : 'light';
	} catch {
		return 'light';
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
