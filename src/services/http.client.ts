import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Agent, ProxyAgent, fetch, type Dispatcher } from 'undici';

export type FetchResult = {
  url: string;
  status: number;
  body: string;
  /** Wall time of the successful (or last) network attempt; 0 when served from cache. */
  ms: number;
  fromCache: boolean;
  attempts: number;
  /** When the response was fetched from the network (original time for cached responses). */
  fetchedAt: string;
};

/** What the pipeline needs from an HTTP client (lets tests pass a fake). */
export type HttpGetter = { get(url: string): Promise<FetchResult> };

export type HttpClientOptions = {
  headers: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  /** Directory for the raw-response cache; null disables caching. */
  cacheDir: string | null;
  /** false = always hit the network but still write fresh responses (--refresh). */
  readCache?: boolean;
  proxyUrl?: string;
  connections?: number;
};

/** Statuses worth retrying: rate limit and transient server errors. 404/406 are final. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Statuses that are deterministic enough to cache for re-runs. */
const CACHEABLE = new Set([200, 404]);

export class GeoBlockedError extends Error {
  constructor(url: string) {
    super(`HTTP 406 from ${url}: 2ndswing.com blocks non-US traffic. Set PROXY_URL to a US proxy.`);
  }
}

export class HttpClient {
  readonly stats = { network: 0, fromCache: 0, retries: 0 };
  private dispatcherPromise: Promise<Dispatcher>;

  constructor(private readonly opts: HttpClientOptions) {
    this.dispatcherPromise = createDispatcher(opts.proxyUrl, opts.connections ?? 8);
  }

  async get(url: string): Promise<FetchResult> {
    const cached = this.opts.readCache === false ? null : await this.readCache(url);
    if (cached) {
      this.stats.fromCache++;
      return cached;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.opts.maxRetries + 1; attempt++) {
      if (attempt > 1) {
        this.stats.retries++;
        await sleep(backoffMs(this.opts.backoffBaseMs, attempt - 1, lastError));
      }
      const started = performance.now();
      try {
        this.stats.network++;
        const res = await fetch(url, {
          dispatcher: await this.dispatcherPromise,
          headers: this.opts.headers,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        const body = await res.text();
        const result: FetchResult = {
          url: res.url || url,
          status: res.status,
          body,
          ms: Math.round(performance.now() - started),
          fromCache: false,
          attempts: attempt,
          fetchedAt: new Date().toISOString(),
        };
        if (res.status === 406) throw new GeoBlockedError(url);
        if (RETRYABLE.has(res.status)) {
          lastError = new RetryableStatusError(res.status, res.headers.get('retry-after'));
          continue;
        }
        if (CACHEABLE.has(res.status)) await this.writeCache(url, result);
        return result;
      } catch (error) {
        if (error instanceof GeoBlockedError) throw error;
        lastError = error; // timeout or network error: retry
      }
    }
    throw new Error(`GET ${url} failed after ${this.opts.maxRetries + 1} attempts: ${describe(lastError)}`);
  }

  async close(): Promise<void> {
    await (await this.dispatcherPromise).close();
  }

  private cachePath(url: string): string | null {
    if (!this.opts.cacheDir) return null;
    return join(this.opts.cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  }

  private async readCache(url: string): Promise<FetchResult | null> {
    const path = this.cachePath(url);
    if (!path) return null;
    try {
      const entry = JSON.parse(await readFile(path, 'utf8')) as FetchResult;
      // Older cache entries have no fetchedAt; the file's mtime is when it was fetched.
      const fetchedAt = entry.fetchedAt ?? (await stat(path)).mtime.toISOString();
      return { ...entry, ms: 0, fromCache: true, attempts: 0, fetchedAt };
    } catch {
      return null;
    }
  }

  private async writeCache(url: string, result: FetchResult): Promise<void> {
    const path = this.cachePath(url);
    if (!path) return;
    await mkdir(this.opts.cacheDir!, { recursive: true });
    await writeFile(path, JSON.stringify({ url: result.url, status: result.status, body: result.body, fetchedAt: result.fetchedAt }));
  }
}

export class RetryableStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Longest wait accepted from a Retry-After header; beyond that the item is retried on our own schedule. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Exponential backoff with jitter; honours Retry-After (seconds or HTTP date), capped at 60 s. */
export function backoffMs(baseMs: number, retry: number, lastError: unknown): number {
  if (lastError instanceof RetryableStatusError && lastError.retryAfter) {
    const header = lastError.retryAfter;
    const seconds = /^\d+$/.test(header.trim()) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
    if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const exp = baseMs * 2 ** (retry - 1);
  return exp + Math.random() * exp * 0.3;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    return cause ? `${error.message} (${cause})` : error.message;
  }
  return String(error);
}

async function createDispatcher(proxyUrl: string | undefined, connections: number): Promise<Dispatcher> {
  if (!proxyUrl) return new Agent({ connections, keepAliveTimeout: 30_000 });
  if (/^socks5?h?:\/\//i.test(proxyUrl)) {
    const { socksDispatcher } = await import('fetch-socks');
    const u = new URL(proxyUrl);
    return socksDispatcher({
      type: 5,
      host: u.hostname,
      port: Number(u.port || 1080),
      userId: decodeURIComponent(u.username) || undefined,
      password: decodeURIComponent(u.password) || undefined,
    }) as unknown as Dispatcher;
  }
  return new ProxyAgent(proxyUrl);
}
