/**
 * Desktop sidebar: open (labels) or collapsed to an icon rail. Remembered per browser.
 * Phones never show the sidebar; they use the bottom bar.
 */
const KEY = 'insider.sidebar';

function read(): boolean {
	try {
		return globalThis.localStorage?.getItem(KEY) === 'collapsed';
	} catch {
		return false;
	}
}

class Sidebar {
	collapsed = $state(read());

	toggle = (): void => {
		this.collapsed = !this.collapsed;
		try {
			globalThis.localStorage?.setItem(KEY, this.collapsed ? 'collapsed' : 'open');
		} catch {
			// Blocked storage: the choice still applies for this visit.
		}
	};
}

/** Module-level is safe: client-only SPA. */
export const sidebar = new Sidebar();
