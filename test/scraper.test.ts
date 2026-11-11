import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CsvItem } from '../src/lib/csv.ts';
import { GeoBlockedError, type FetchResult } from '../src/services/http.client.ts';
import { scrapeAll } from '../src/services/scraper.ts';
import { fixture } from './helpers.ts';

const BASE = 'https://www.2ndswing.com';
const item = (parentItem: string, name: string, category: string): CsvItem => ({
  parentItem, name, category, brand: '', model: '', year: '',
});
const putter = item('TRTL MAX S2S PUT', 'Odyssey TRTL Max S2S Putter', 'Putter');
const ironSet = item('PRO S4 STS', 'Mizuno Pro S-4 Iron Set', 'Iron Set');
const missing = item('AIRBREAK PMT', 'PuttOUT AirBreak Putting Mat', 'Putting Mat');

type Route = { status?: number; body?: string; waitFor?: Promise<void>; fromCache?: boolean; throws?: Error };

/** Fake HTTP client: unknown URLs answer 404 (sitemap included, so the model index is empty). */
function fakeHttp(routes: Record<string, Route>) {
  return {
    async get(url: string): Promise<FetchResult> {
      const r = routes[url] ?? { status: 404, body: '' };
      await r.waitFor;
      if (r.throws) throw r.throws;
      return {
        url, status: r.status ?? 200, body: r.body ?? '', ms: r.fromCache ? 0 : 50,
        fromCache: Boolean(r.fromCache), attempts: 1, fetchedAt: '2026-11-11T00:00:00.000Z',
      };
    },
  };
}

const gallery = (names: string[]): Route => ({ body: JSON.stringify({ imageNames: names }) });

test('scrapes, classifies and keeps CSV order regardless of completion order', async () => {
  // The first CSV row only answers once the other two are done, so it completes last.
  let othersDone!: () => void;
  const http = fakeHttp({
    [`${BASE}/trtl-max-s2s-put`]: { body: fixture('trtl-max-s2s-put'), waitFor: new Promise((resolve) => (othersDone = resolve)) },
    [`${BASE}/gallery/TRTL%20MAX%20S2S%20PUT.json`]: gallery(['TRTL MAX S2S PUT.jpg', 'TRTL MAX S2S PUT_2.jpg']),
    [`${BASE}/pro-s4-sts`]: { body: fixture('pro-s4-sts'), fromCache: true },
    [`${BASE}/gallery/PRO%20S4%20STS.json`]: gallery(['PRO S4 STS.jpg']),
  });
  const progress: string[] = [];
  const result = await scrapeAll([putter, missing, ironSet], http, {
    baseUrl: BASE,
    concurrency: 3,
    onProgress: (_done, _total, it, status) => {
      progress.push(`${it.parentItem}:${status}`);
      if (progress.length === 2) othersDone();
    },
  });

  assert.deepEqual(result.products.map((p) => p.parentItem), ['TRTL MAX S2S PUT', 'PRO S4 STS']);
  assert.deepEqual(result.unmatched.map((u) => [u.parentItem, u.reason]), [['AIRBREAK PMT', 'not_found']]);
  assert.equal(result.failed.length, 0);
  assert.equal(progress.length, 3);
  assert.equal(progress.at(-1), 'TRTL MAX S2S PUT:ok');

  const [trtl, pro] = result.products;
  assert.equal(trtl!.media.images.length, 2);
  assert.equal(pro!.pricing.model, 'per_club');
  assert.equal(result.parseMs.length, 2);
});

test('network timings exclude cached responses', async () => {
  const http = fakeHttp({
    [`${BASE}/pro-s4-sts`]: { body: fixture('pro-s4-sts'), fromCache: true },
    [`${BASE}/gallery/PRO%20S4%20STS.json`]: { ...gallery([]), fromCache: true },
  });
  const result = await scrapeAll([ironSet], http, { baseUrl: BASE, concurrency: 1 });
  assert.deepEqual(result.networkMs, []);
});

test('gallery failure falls back to the ld+json image', async () => {
  const http = fakeHttp({
    [`${BASE}/trtl-max-s2s-put`]: { body: fixture('trtl-max-s2s-put') },
    [`${BASE}/gallery/TRTL%20MAX%20S2S%20PUT.json`]: { body: 'not json' },
  });
  const [product] = (await scrapeAll([putter], http, { baseUrl: BASE, concurrency: 1 })).products;
  assert.deepEqual(product!.media.images, [`${BASE}/images/standard/TRTL%20MAX%20S2S%20PUT.jpg`]);
});

test('a network error on one product is isolated as failed/http_error', async () => {
  const http = fakeHttp({
    [`${BASE}/trtl-max-s2s-put`]: { throws: new Error('GET failed after 4 attempts: fetch failed') },
    [`${BASE}/pro-s4-sts`]: { body: fixture('pro-s4-sts') },
  });
  const result = await scrapeAll([putter, ironSet], http, { baseUrl: BASE, concurrency: 2 });
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.failed.map((f) => [f.parentItem, f.reason]), [['TRTL MAX S2S PUT', 'http_error']]);
  assert.match(result.failed[0]!.detail, /fetch failed/);
});

test('a geo-block (406) aborts the whole run', async () => {
  const http = fakeHttp({ [`${BASE}/trtl-max-s2s-put`]: { throws: new GeoBlockedError(`${BASE}/trtl-max-s2s-put`) } });
  await assert.rejects(scrapeAll([putter, ironSet], http, { baseUrl: BASE, concurrency: 1 }), GeoBlockedError);
});

test('a geo-block drains the queue instead of trying every remaining product', async () => {
  let calls = 0;
  const http = {
    async get(url: string): Promise<FetchResult> {
      calls++;
      await Promise.resolve();
      throw new GeoBlockedError(url);
    },
  };
  const many = Array.from({ length: 50 }, (_, i) => item(`SKU ${i}`, `Product ${i}`, 'Putter'));
  await assert.rejects(scrapeAll(many, http, { baseUrl: BASE, concurrency: 2 }), GeoBlockedError);
  assert.ok(calls <= 2, `expected only the in-flight requests, got ${calls}`);
});

test('failed rows record the URL that was tried', async () => {
  const http = fakeHttp({ [`${BASE}/trtl-max-s2s-put`]: { throws: new Error('boom') } });
  const result = await scrapeAll([putter], http, { baseUrl: BASE, concurrency: 1 });
  assert.deepEqual(result.failed[0]!.triedUrls, [`${BASE}/trtl-max-s2s-put`]);
});

test('an unexpected bug still surfaces instead of being swallowed', async () => {
  const http = fakeHttp({ [`${BASE}/trtl-max-s2s-put`]: { body: fixture('trtl-max-s2s-put') } });
  const onProgress = () => {
    throw new TypeError('bug in progress callback');
  };
  await assert.rejects(scrapeAll([putter], http, { baseUrl: BASE, concurrency: 1, onProgress }), TypeError);
});
