/**
 * The one place the web app knows about user auth.
 *
 * TODO(auth): the login provider is still open (Bull Connect token or a separate
 * Supabase Auth project — docs/scaffolding-plan.md §11, open decision 1). Until it
 * is decided the API runs with AUTH_DEV_BYPASS and accepts any caller, so this
 * module sends no token. When the provider lands:
 *   1. implement `getAccessToken()` (read / refresh the session token),
 *   2. implement `signIn()` / `signOut()` and the `/login` page,
 *   3. flip `AUTH_MODE` to the provider; the API client picks the token up automatically.
 */

export type AuthMode = 'dev-bypass';

export const AUTH_MODE: AuthMode = 'dev-bypass';

/** Bearer token for API calls, or `null` to send none (dev bypass). */
export async function getAccessToken(): Promise<string | null> {
	return null;
}

/** Whether the current visitor may use the app. Always true under the dev bypass. */
export function isSignedIn(): boolean {
	return AUTH_MODE === 'dev-bypass';
}

/** Start the provider's sign-in flow. No-op until a provider is chosen. */
export async function signIn(): Promise<void> {
	// TODO(auth): redirect to the chosen provider.
}

/** End the session. No-op until a provider is chosen. */
export async function signOut(): Promise<void> {
	// TODO(auth): clear the provider session.
}
