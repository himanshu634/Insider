import type {
  CatalogGroup,
  DeviceConfig,
  GroupCatalogResponse,
  HeartbeatRequest,
  IngestMessage,
  IngestMessagesResponse,
} from './types.js';
import { MAX_BATCH } from './types.js';

/** The collector endpoints of packages/contracts/openapi.yaml. Tests use a fake. */
export interface CollectorApi {
  ingestMessages(messages: IngestMessage[]): Promise<IngestMessagesResponse>;
  getDeviceConfig(): Promise<DeviceConfig>;
  heartbeat(body: HeartbeatRequest): Promise<void>;
  postGroupCatalog(groups: CatalogGroup[]): Promise<GroupCatalogResponse>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for a network error / timeout. */
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  deviceToken: string;
  /** Retries after the first attempt (network errors, 408, 429, 5xx). */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** fetch-based client with bearer device token and exponential backoff (with jitter). */
export class ApiClient implements CollectorApi {
  private readonly baseUrl: string;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: ApiClientOptions) {
    if (!options.deviceToken) throw new Error('No device token configured');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.retries = options.retries ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async ingestMessages(messages: IngestMessage[]): Promise<IngestMessagesResponse> {
    if (messages.length === 0 || messages.length > MAX_BATCH) {
      throw new Error(`ingestMessages needs 1..${MAX_BATCH} messages, got ${messages.length}`);
    }
    return (await this.request('POST', '/v1/ingest/messages', { messages })) as IngestMessagesResponse;
  }

  async getDeviceConfig(): Promise<DeviceConfig> {
    return (await this.request('GET', '/v1/devices/config')) as DeviceConfig;
  }

  async heartbeat(body: HeartbeatRequest): Promise<void> {
    await this.request('POST', '/v1/devices/heartbeat', body);
  }

  async postGroupCatalog(groups: CatalogGroup[]): Promise<GroupCatalogResponse> {
    return (await this.request('POST', '/v1/groups/catalog', { groups })) as GroupCatalogResponse;
  }

  private backoff(attempt: number, retryAfterSeconds: number | null): number {
    if (retryAfterSeconds !== null) return Math.min(this.maxDelayMs, retryAfterSeconds * 1000);
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(exp / 2 + (exp / 2) * this.random());
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.deviceToken}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
    const payload = body === undefined ? undefined : JSON.stringify(body);

    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let retryAfter: number | null = null;
      try {
        const res = await this.fetchImpl(this.baseUrl + path, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) {
          if (res.status === 204) return undefined;
          const text = await res.text();
          return text ? (JSON.parse(text) as unknown) : undefined;
        }
        const detail = await res.text().catch(() => '');
        lastError = new ApiError(
          `${method} ${path} → ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
          res.status,
          isRetryableStatus(res.status),
        );
        const header = res.headers.get('retry-after');
        if (header && /^\d+$/.test(header.trim())) retryAfter = Number(header.trim());
      } catch (err) {
        lastError = new ApiError(
          `${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
          0,
          true,
        );
      }
      if (!lastError.retryable || attempt === this.retries) break;
      await this.sleep(this.backoff(attempt, retryAfter));
    }
    throw lastError ?? new ApiError(`${method} ${path} failed`, 0, true);
  }
}
