import pLimit from 'p-limit';
import { buildProduct, galleryUrl } from '../builders/product.ts';
import type { CsvItem } from '../lib/csv.ts';
import { ProductSchema, type Product, type Unmatched } from '../schema.ts';
import { GeoBlockedError, type FetchResult } from './http.client.ts';
import { Resolver } from './resolver.ts';

type Getter = { get(url: string): Promise<FetchResult> };

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
export async function scrapeAll(items: CsvItem[], http: Getter, opts: ScrapeOptions): Promise<ScrapeResult> {
  const networkMs: number[] = [];
  const timed: Getter = {
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

  await Promise.all(
    items.map((item) =>
      limit(async () => {
        const status = await scrapeOne(item, timed, resolver, opts.baseUrl, result);
        opts.onProgress?.(++done, items.length, item, status);
      }),
    ),
  );

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
  http: Getter,
  resolver: Resolver,
  baseUrl: string,
  out: ScrapeResult,
): Promise<'ok' | 'unmatched' | 'failed'> {
  const failure = (reason: Unmatched['reason'], detail: string): 'failed' => {
    out.failed.push({ parentItem: item.parentItem, name: item.name, category: item.category, reason, detail, triedUrls: [] });
    return 'failed';
  };

  let resolution;
  try {
    resolution = await resolver.resolve(item);
  } catch (error) {
    if (error instanceof GeoBlockedError) throw error;
    return failure('http_error', message(error));
  }
  if (!resolution.ok) {
    out.unmatched.push(resolution.unmatched);
    return 'unmatched';
  }

  const gallery = await fetchGallery(http, baseUrl, item.parentItem);

  const started = performance.now();
  let product: Product;
  try {
    product = buildProduct(item, resolution.page, gallery.images, baseUrl, {
      resolvedVia: resolution.via,
      fetchedAt: new Date().toISOString(),
      httpMs: resolution.fetch.ms + gallery.ms,
      parseMs: 0,
      fromCache: resolution.fetch.fromCache,
    });
  } catch (error) {
    return failure('parse_error', message(error));
  }
  const parseMs = Math.round((resolution.parseMs + performance.now() - started) * 10) / 10;
  product.meta.parseMs = parseMs;

  const valid = ProductSchema.safeParse(product);
  if (!valid.success) {
    const issues = valid.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
    return failure('schema_error', issues.join('; '));
  }
  out.parseMs.push(parseMs);
  out.products.push(valid.data);
  return 'ok';
}

/** Gallery is optional enrichment: any failure falls back to the ld+json image. */
async function fetchGallery(http: Getter, baseUrl: string, parentItem: string): Promise<{ images: string[] | null; ms: number }> {
  try {
    const res = await http.get(galleryUrl(baseUrl, parentItem));
    if (res.status !== 200) return { images: null, ms: res.ms };
    const names = (JSON.parse(res.body) as { imageNames?: unknown }).imageNames;
    const images = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string' && n !== '') : null;
    return { images, ms: res.ms };
  } catch (error) {
    if (error instanceof GeoBlockedError) throw error;
    return { images: null, ms: 0 };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
