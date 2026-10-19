import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@insider/contracts';
import { getAccessToken } from '#lib/auth.js';

/** API origin. Override with VITE_API_BASE_URL (e.g. in apps/web/.env.local). */
export const API_BASE_URL: string = (
	import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

const auth: Middleware = {
	async onRequest({ request }) {
		const token = await getAccessToken();
		if (token) request.headers.set('Authorization', `Bearer ${token}`);
		return request;
	}
};

/** Typed client generated from packages/contracts/openapi.yaml. */
export const api = createClient<paths>({ baseUrl: API_BASE_URL });
api.use(auth);

/** Error thrown by query functions; carries the HTTP status (0 when the API was unreachable). */
export class ApiError extends Error {
	readonly status: number;
	readonly kind: 'network' | 'http';

	constructor(message: string, status: number, kind: 'network' | 'http') {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.kind = kind;
	}
}

function detailOf(error: unknown): string | null {
	if (error && typeof error === 'object' && 'detail' in error) {
		const detail = (error as { detail: unknown }).detail;
		if (typeof detail === 'string') return detail;
		if (Array.isArray(detail)) return detail.map((d) => JSON.stringify(d)).join('; ');
	}
	return null;
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/**
 * Await an openapi-fetch call and return its data, throwing `ApiError` on any
 * failure so TanStack Query reaches its error state. openapi-fetch itself never
 * throws for HTTP errors, only when `fetch` fails (API down, CORS).
 */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
	let result: Result<T>;
	try {
		result = await call;
	} catch (cause) {
		throw new ApiError(
			cause instanceof Error ? cause.message : 'Network request failed',
			0,
			'network'
		);
	}
	const { data, error, response } = result;
	if (error !== undefined || !response.ok) {
		throw new ApiError(
			detailOf(error) ?? `${response.status} ${response.statusText || 'Request failed'}`,
			response.status,
			'http'
		);
	}
	return data as T;
}

/** Like `unwrap`, but a 404 resolves to `null` (used where "not there yet" is a normal state). */
export async function unwrapOrNull<T>(call: Promise<Result<T>>): Promise<T | null> {
	try {
		return await unwrap(call);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) return null;
		throw e;
	}
}
