/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Insider API origin, e.g. http://localhost:8000 (default in dev). */
	readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
