import pLimit from 'p-limit';
import { buildProduct, galleryUrl } from '../builders/product.ts';
import type { CsvItem } from '../lib/csv.ts';
import { siteSlug } from '../lib/slug.ts';
import { toUnmatched, ValidProductSchema, type Product, type Unmatched } from '../schema.ts';
import { GeoBlockedError, type HttpGetter } from './http.client.ts';
import { Resolver } from './resolver.ts';

export type ScrapeResult = {
  products: Product[];
  unmatched: Unmatched[];
  failed: Unmatched[];
  /** Network time of every non-cached request (ms). */
  networkMs: number[];
  /** CPU time spent parsing + building each product (ms). */
  parseMs: number[];
};

export type ScrapeOptions = {
  baseUrl: string;
  concurrency: number;
  onProgress?: (done: number, total: number, item: CsvItem, status: 'ok' | 'unmatched' | 'failed') => void;
};

/**
 * Runs every CSV row through resolve -> gallery -> build -> validate with bounded concurrency.
 * One bad product never stops the run; a geo-block (406) does, because every request would fail.
 */
export async function scrapeAll(items: CsvItem[], http: HttpGetter, opts: ScrapeOptions): Promise<ScrapeResult> {
  const networkMs: number[] = [];
  const timed: HttpGetter = {
    async get(url) {
      const res = await http.get(url);
      if (!res.fromCache) networkMs.push(res.ms);
      return res;
    },
  };
  const resolver = new Resolver(timed, opts.baseUrl);
  const result: ScrapeResult = { products: [], unmatched: [], failed: [], networkMs, parseMs: [] };
  const limit = pLimit(opts.concurrency);
  let done = 0;
  let abort: GeoBlockedError | null = null;

  // On a geo-block every queued task returns immediately (the `abort` check), the few in-flight
  // ones hit the same 406 (never retried), and the error is reported once all have settled.
  // (p-limit's clearQueue() is not used: it leaves the dropped tasks' promises pending forever.)
  const settled = await Promise.allSettled(
    items.map((item) =>
      limit(async () => {
        if (abort) return;
        try {
          const status = await scrapeOne(item, timed, resolver, opts.baseUrl, result);
          opts.onProgress?.(++done, items.length, item, status);
        } catch (error) {
          if (!(error instanceof GeoBlockedError)) throw error;
          abort ??= error;
        }
      }),
    ),
  );
  if (abort) throw abort;
  const unexpected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (unexpected) throw unexpected.reason; // a bug, not a per-product failure: do not hide it

  // Keep the CSV order in the output, regardless of completion order.
  const order = new Map(items.map((item, i) => [item.parentItem, i]));
  const byInput = (a: { parentItem: string }, b: { parentItem: string }) =>
    order.get(a.parentItem)! - order.get(b.parentItem)!;
  result.products.sort(byInput);
  result.unmatched.sort(byInput);
  result.failed.sort(byInput);
  return result;
}

async function scrapeOne(
  item: CsvItem,
  http: HttpGetter,
  resolver: Resolver,
  baseUrl: string,
  out: ScrapeResult,
): Promise<'ok' | 'unmatched' | 'failed'> {
  const failure = (reason: Unmatched['reason'], detail: string, triedUrls: string[]): 'failed' => {
    out.failed.push(toUnmatched(item, reason, detail, triedUrls));
    return 'failed';
  };

  let resolution;
  try {
    resolution = await resolver.resolve(item);
  } catch (error) {
    if (error instanceof GeoBlockedError) throw error;
    return failure('http_error', message(error), [`${baseUrl}/${siteSlug(item.parentItem)}`]);
  }
  if (!resolution.ok) {
    out.unmatched.push(resolution.unmatched);
    return 'unmatched';
  }

  const galleryImages = await fetchGallery(http, baseUrl, item.parentItem);

  const started = performance.now();
  let product: Product;
  try {
    const meta = { resolvedVia: resolution.via, fetchedAt: resolution.fetch.fetchedAt };
    product = buildProduct(item, resolution.page, galleryImages, baseUrl, meta, resolution.fetch.url);
  } catch (error) {
    return failure('parse_error', message(error), [resolution.fetch.url]);
  }
  const parseMs = Math.round((resolution.parseMs + performance.now() - started) * 10) / 10;

  const valid = ValidProductSchema.safeParse(product);
  if (!valid.success) {
    const issues = valid.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
    return failure('schema_error', issues.join('; '), [resolution.fetch.url]);
  }
  out.parseMs.push(parseMs);
  out.products.push(valid.data);
  return 'ok';
}

/** Gallery is optional enrichment: any failure falls back to the ld+json image. */
async function fetchGallery(http: HttpGetter, baseUrl: string, parentItem: string): Promise<string[] | null> {
  try {
    const res = await http.get(galleryUrl(baseUrl, parentItem));
    if (res.status !== 200) return null;
    const names = (JSON.parse(res.body) as { imageNames?: unknown }).imageNames;
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string' && n !== '') : null;
  } catch (error) {
    if (error instanceof GeoBlockedError) throw error;
    return null;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
