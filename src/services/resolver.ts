import * as cheerio from 'cheerio';
import type { CsvItem } from '../lib/csv.ts';
import { siteSlug } from '../lib/slug.ts';
import { parseProductPage, type ParsedPage } from '../parsers/magento-init.ts';
import { toUnmatched, type Unmatched } from '../schema.ts';
import type { FetchResult, HttpGetter } from './http.client.ts';


export type Resolved = {
  ok: true;
  page: ParsedPage;
  fetch: FetchResult;
  parseMs: number;
  via: 'root_slug' | 'model_page';
};
export type Resolution = Resolved | { ok: false; unmatched: Unmatched };

/** Product-model landing pages, keyed by their last path segment (= siteSlug(product name)). */
export type ModelIndex = Map<string, string>;

const MODEL_SITEMAPS = ['sitemap-product-models.xml', 'sitemap-pmp-archive.xml'];

/**
 * Finds the product page for a CSV row without the site search (disallowed by robots.txt):
 *   1. GET /{siteSlug(parentItem)} — Magento resolves the URL key at the root (55/57 in the spike).
 *   2. Fallback: model landing page from the sitemap (by siteSlug(name)) -> follow it or the link
 *      whose last segment is the product slug. Only accepted when ld+json sku === parentItem.
 *   3. Otherwise an Unmatched record with a specific reason.
 */
export class Resolver {
  private modelIndex: Promise<ModelIndex> | null = null;

  constructor(
    private readonly http: HttpGetter,
    private readonly baseUrl: string,
    private readonly loadModels: (http: HttpGetter, baseUrl: string) => Promise<ModelIndex> = loadModelIndex,
  ) {}

  async resolve(item: CsvItem): Promise<Resolution> {
    const tried: string[] = [];
    const productSlug = siteSlug(item.parentItem);

    const rootUrl = `${this.baseUrl}/${productSlug}`;
    tried.push(rootUrl);
    const root = await this.tryProduct(rootUrl, item, 'root_slug');
    if (root.ok) return root;

    // Fallback: model landing page. The sitemap index is fetched once, only if needed.
    this.modelIndex ??= this.loadModels(this.http, this.baseUrl);
    const modelUrl = (await this.modelIndex).get(siteSlug(item.name));
    if (!modelUrl) return fail(item, root.reason, root.detail, tried);

    tried.push(modelUrl);
    const model = await this.http.get(modelUrl);
    if (model.status !== 200) return fail(item, 'not_found', `model page HTTP ${model.status}`, tried);

    // A model with a single product redirects straight to it.
    const direct = this.accept(model, item, 'model_page');
    if (direct) return direct;

    const $ = cheerio.load(model.body);
    if (/\bpmparchive\b/.test($('body').attr('class') ?? '')) {
      return fail(item, 'archive_page_or_discontinued', 'model page is an archive page without an active SKU', tried);
    }

    const link = $('a[href]')
      .map((_, a) => $(a).attr('href')!)
      .get()
      .find((href) => href.split('?')[0]!.replace(/\/+$/, '').endsWith(`/${productSlug}`));
    if (!link) return fail(item, 'model_page_without_sku', 'no link to the product on the model page', tried);

    const productUrl = new URL(link, this.baseUrl).toString();
    tried.push(productUrl);
    const viaModel = await this.tryProduct(productUrl, item, 'model_page');
    return viaModel.ok ? viaModel : fail(item, viaModel.reason, viaModel.detail, tried);
  }

  private async tryProduct(
    url: string,
    item: CsvItem,
    via: Resolved['via'],
  ): Promise<Resolved | { ok: false; reason: Unmatched['reason']; detail: string }> {
    const res = await this.http.get(url);
    if (res.status !== 200) return { ok: false, reason: 'not_found', detail: `HTTP ${res.status} at ${url}` };
    const accepted = this.accept(res, item, via);
    if (accepted) return accepted;
    // The product URL exists but redirects to its model page: the new SKU is not on sale right now.
    if (res.url.replace(/\/+$/, '') !== url.replace(/\/+$/, '') && !/"@type":\s*"Product"/.test(res.body)) {
      return { ok: false, reason: 'redirected_to_model_page', detail: `${url} redirects to ${res.url} (no active SKU)` };
    }
    return { ok: false, reason: 'sku_mismatch', detail: `page at ${url} is not ${item.parentItem}` };
  }

  /** The page counts as the product only when its schema.org sku is the CSV Parent Item. */
  private accept(res: FetchResult, item: CsvItem, via: Resolved['via']): Resolved | null {
    const started = performance.now();
    const page = parseProductPage(res.body);
    const parseMs = Math.round((performance.now() - started) * 10) / 10;
    return page.ld?.sku === item.parentItem ? { ok: true, page, fetch: res, parseMs, via } : null;
  }
}

/** Reads the model landing-page URLs from the sitemap index (product models + archived models). */
export async function loadModelIndex(http: HttpGetter, baseUrl: string): Promise<ModelIndex> {
  const index: ModelIndex = new Map();
  const root = await http.get(`${baseUrl}/pub/media/sitemap/sitemap.xml`);
  if (root.status !== 200) return index;
  const children = locs(root.body)
    .filter((u) => MODEL_SITEMAPS.some((name) => u.endsWith(name)))
    // The index lists /media/sitemap/* but those paths time out; the files live under /pub/media/.
    .map((u) => u.replace(/\/(?:pub\/)?media\/sitemap\//, '/pub/media/sitemap/'));
  for (const child of children) {
    const res = await http.get(child);
    if (res.status !== 200) continue;
    for (const url of locs(res.body)) {
      const slug = new URL(url).pathname.replace(/\/+$/, '').split('/').pop();
      if (slug && !index.has(slug)) index.set(slug, url);
    }
  }
  return index;
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

function fail(item: CsvItem, reason: Unmatched['reason'], detail: string, triedUrls: string[]): Resolution {
  return { ok: false, unmatched: toUnmatched(item, reason, detail, triedUrls) };
}
