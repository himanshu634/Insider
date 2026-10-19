import { QueryClient } from '@tanstack/svelte-query';
import { ApiError } from './client.js';

export function createAppQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: true,
				// One retry, and none for 4xx: the default (3 with backoff) leaves pages
				// spinning for seconds when the API is simply not running.
				retry: (failureCount, error) =>
					!(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
					failureCount < 1
			}
		}
	});
}
