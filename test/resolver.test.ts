import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CsvItem } from '../src/lib/csv.ts';
import type { FetchResult } from '../src/services/http.client.ts';
import { loadModelIndex, Resolver } from '../src/services/resolver.ts';
import { fixture } from './helpers.ts';

const BASE = 'https://www.2ndswing.com';
const item = (parentItem: string, name: string, category = 'Putter'): CsvItem => ({
  parentItem, name, category, brand: '', model: '', year: '',
});

/** Fake HTTP: url -> [status, body, finalUrl?]. Unknown URLs are 404. */
function fakeHttp(routes: Record<string, [number, string, string?]>) {
  const calls: string[] = [];
  return {
    calls,
    async get(url: string): Promise<FetchResult> {
      calls.push(url);
      const [status, body, finalUrl] = routes[url] ?? [404, '<html><body>not found</body></html>'];
      return { url: finalUrl ?? url, status, body, ms: 1, fromCache: false, attempts: 1, fetchedAt: '2026-11-11T00:00:00.000Z' };
    },
  };
}
const models = (entries: Record<string, string>) => async () => new Map(Object.entries(entries));

test('root slug hit: resolves without touching the sitemap', async () => {
  const http = fakeHttp({ [`${BASE}/trtl-max-s2s-put`]: [200, fixture('trtl-max-s2s-put')] });
  let sitemapLoaded = false;
  const resolver = new Resolver(http, BASE, async () => ((sitemapLoaded = true), new Map()));
  const r = await resolver.resolve(item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter'));
  assert.ok(r.ok);
  assert.equal(r.via, 'root_slug');
  assert.equal(r.page.ld?.sku, 'TRTL MAX S2S PUT');
  assert.equal(sitemapLoaded, false);
});

test('root 404 -> model page that redirects to the product is accepted', async () => {
  const modelUrl = `${BASE}/golf-clubs/putters/odyssey-trtl-max-s2s-putter`;
  const http = fakeHttp({ [modelUrl]: [200, fixture('trtl-max-s2s-put'), `${modelUrl}/trtl-max-s2s-put`] });
  const resolver = new Resolver(http, BASE, models({ 'odyssey-trtl-max-s2s-putter': modelUrl }));
  const r = await resolver.resolve(item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter'));
  assert.ok(r.ok);
  assert.equal(r.via, 'model_page');
});

test('root 404 -> model page listing the product link -> product page', async () => {
  const modelUrl = `${BASE}/golf-clubs/putters/odyssey-trtl-max-s2s-putter`;
  const productUrl = `${modelUrl}/trtl-max-s2s-put`;
  const http = fakeHttp({
    [modelUrl]: [200, `<html><body class="catalog-model"><a href="${productUrl}">TRTL</a></body></html>`],
    [productUrl]: [200, fixture('trtl-max-s2s-put')],
  });
  const resolver = new Resolver(http, BASE, models({ 'odyssey-trtl-max-s2s-putter': modelUrl }));
  const r = await resolver.resolve(item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter'));
  assert.ok(r.ok);
  assert.deepEqual(http.calls, [`${BASE}/trtl-max-s2s-put`, modelUrl, productUrl]);
});

test('archived model page (real fixture) -> discontinued', async () => {
  const modelUrl = `${BASE}/accessories/staff-bags/taylormade-2024-tour-staff-bag`;
  const http = fakeHttp({ [modelUrl]: [200, fixture('model-page-staff-bag')] });
  const resolver = new Resolver(http, BASE, models({ 'taylormade-2024-tour-staff-bag': modelUrl }));
  const r = await resolver.resolve(item('2024 TR STAF NEW BAG', 'TaylorMade 2024 Tour Staff Bag', 'Staff Bag'));
  assert.ok(!r.ok);
  assert.equal(r.unmatched.reason, 'discontinued');
  assert.equal(r.unmatched.detail, 'archived model page "TaylorMade 2024 Tour Staff Bag (2024 TR STAF NEW BAG)": This product is no longer available');
  assert.deepEqual(r.unmatched.triedUrls, [`${BASE}/2024-tr-staf-new-bag`, modelUrl]);
});

test('no model page in the sitemap -> not_found', async () => {
  const resolver = new Resolver(fakeHttp({}), BASE, models({}));
  const r = await resolver.resolve(item('AIRBREAK PMT', 'PuttOUT AirBreak Putting Mat', 'Putting Mat'));
  assert.ok(!r.ok);
  assert.equal(r.unmatched.reason, 'not_found');
});

test('page with a different sku is never accepted', async () => {
  const http = fakeHttp({ [`${BASE}/trtl-max-s2s-put`]: [200, fixture('zxi-rkt-max-dvr')] });
  const resolver = new Resolver(http, BASE, models({}));
  const r = await resolver.resolve(item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter'));
  assert.ok(!r.ok);
  assert.equal(r.unmatched.reason, 'sku_mismatch');
});

test('model page without the product link -> model_page_without_sku', async () => {
  const modelUrl = `${BASE}/golf-clubs/putters/some-model`;
  const http = fakeHttp({ [modelUrl]: [200, '<html><body class="catalog-model"><a href="/other">x</a></body></html>'] });
  const resolver = new Resolver(http, BASE, models({ 'odyssey-trtl-max-s2s-putter': modelUrl }));
  const r = await resolver.resolve(item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter'));
  assert.ok(!r.ok);
  assert.equal(r.unmatched.reason, 'model_page_without_sku');
});

test('sitemap index is loaded once and rewrites /media/ to /pub/media/', async () => {
  const http = fakeHttp({
    [`${BASE}/pub/media/sitemap/sitemap.xml`]: [
      200,
      `<sitemapindex><sitemap><loc>${BASE}/media/sitemap/sitemap-product-models.xml</loc></sitemap>` +
        `<sitemap><loc>${BASE}/media/sitemap/sitemap-blog-posts.xml</loc></sitemap></sitemapindex>`,
    ],
    [`${BASE}/pub/media/sitemap/sitemap-product-models.xml`]: [
      200,
      `<urlset><url><loc>${BASE}/accessories/staff-bags/taylormade-2024-tour-staff-bag</loc></url></urlset>`,
    ],
  });
  const index = await loadModelIndex(http, BASE);
  assert.equal(index.get('taylormade-2024-tour-staff-bag'), `${BASE}/accessories/staff-bags/taylormade-2024-tour-staff-bag`);
  assert.ok(!http.calls.some((u) => u.includes('blog-posts')));
});

test('product URL that redirects to an active model page -> product_page_unavailable', async () => {
  const modelUrl = `${BASE}/golf-clubs/wedges/wilson-staff-staff-model-tour-grind-wedge`;
  const modelHtml = '<html><body class="categorymodel-model-view"><a href="/x">used unit</a></body></html>';
  const http = fakeHttp({ [`${BASE}/staff-mod-tg-new-wgs`]: [200, modelHtml, modelUrl] });
  const resolver = new Resolver(http, BASE, models({}));
  const r = await resolver.resolve(item('STAFF MOD TG NEW WGS', 'Wilson Staff Staff Model Tour Grind Wedge', 'Wedge'));
  assert.ok(!r.ok);
  assert.equal(r.unmatched.reason, 'product_page_unavailable');
});

test('archived page showing a different SKU says so in the detail', async () => {
  const modelUrl = `${BASE}/accessories/stand-bags/izzo-versa-stand-bag`;
  const html = `<html><body class="productarchive-model-pmparchive"><span data-ui-id="page-title-wrapper">Izzo Versa Stand Bag (VERSA BAG)</span>
    <p class="out-of-stock-message">This product is no longer available, but you can browse more Izzo items.</p></body></html>`;
  const http = fakeHttp({ [modelUrl]: [200, html] });
  const resolver = new Resolver(http, BASE, models({ 'izzo-versa-stand-bag': modelUrl }));
  const r = await resolver.resolve(item('VERSA NEW BAG', 'Izzo Versa Stand Bag', 'Stand Bag'));
  assert.ok(!r.ok);
  assert.equal(
    r.unmatched.detail,
    'archived model page "Izzo Versa Stand Bag (VERSA BAG)": This product is no longer available; the page shows SKU "VERSA BAG", not "VERSA NEW BAG"',
  );
});
