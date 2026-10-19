/**
 * Minimal toast store. A module-level instance is fine here: the app is a
 * client-only SPA, so there is no server render to leak state between users.
 */
export type ToastTone = 'neutral' | 'positive' | 'negative';

export interface Toast {
	id: number;
	message: string;
	tone: ToastTone;
}

const DEFAULT_MS = 4000;

class Toasts {
	items = $state<Toast[]>([]);
	#next = 1;

	show(message: string, tone: ToastTone = 'neutral', ms = DEFAULT_MS): number {
		const id = this.#next++;
		this.items.push({ id, message, tone });
		if (ms > 0) setTimeout(() => this.dismiss(id), ms);
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
