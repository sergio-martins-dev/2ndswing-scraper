import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { buildProduct } from '../src/builders/product.ts';
import { loadCsv } from '../src/lib/csv.ts';
import { summarize } from '../src/lib/metrics.ts';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import { compactJson, writeOutputs, type Output } from '../src/writers.ts';
import { fixture } from './helpers.ts';

const BASE = 'https://www.2ndswing.com';
const items = await loadCsv('test/fixtures/input-sample.csv');
const meta = { resolvedVia: 'root_slug', fetchedAt: '2026-11-11T00:00:00.000Z' } as const;
const product = (slug: string, sku: string) =>
  buildProduct(items.find((i) => i.parentItem === sku)!, parseProductPage(fixture(slug)), null, BASE, meta);

const metadata = (network: number, runtimeMs: number): Output['metadata'] => ({
  scrapedAt: `2026-11-1${network ? 0 : 1}T00:00:00.000Z`,
  totalInput: 2, successful: 2, unmatched: 1, failed: 0, totalVariants: 0,
  runtimeMs, productsPerSecond: 1, concurrency: 8, proxy: network > 0,
  networkMs: summarize(network ? [1000, 2000] : []), parseMs: summarize([10]),
  requests: { network, fromCache: network ? 0 : 4, retries: 0 },
  priceCheck: { checked: 0, matched: 0, mismatches: [] },
});

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'writers-'));
}

test('compactJson keeps objects indented but arrays of primitives on one line', () => {
  const json = compactJson({ fields: ['a', 'b'], rows: [['x"]', 1.5, null], [true, -2, 'y']], nested: { list: [] } });
  assert.equal(
    json,
    '{\n  "fields": ["a", "b"],\n  "rows": [\n    ["x\\"]", 1.5, null],\n    [true, -2, "y"]\n  ],\n  "nested": {\n    "list": []\n  }\n}',
  );
  assert.deepEqual(JSON.parse(json).rows[0], ['x"]', 1.5, null]);
});

test('writeOutputs: json + gzip copy, products.csv summary, unmatched.csv, optional variants.csv', async () => {
  const dir = await tmp();
  const products = [product('pro-s4-sts', 'PRO S4 STS'), product('link-2dot2-put', 'LINK 2.2 PUT')];
  const output: Output = { metadata: metadata(10, 1000), products };
  const unmatched = [{ parentItem: 'AIRBREAK PMT', name: 'PuttOUT, "AirBreak"', category: 'Putting Mat', reason: 'not_found' as const, detail: 'HTTP 404', triedUrls: ['a', 'b'] }];

  const files = await writeOutputs(dir, output, unmatched, { flatVariants: true });
  assert.deepEqual(files.map((f) => f.slice(dir.length + 1)), ['output.json', 'output.json.gz', 'products.csv', 'unmatched.csv', 'variants.csv']);

  const json = await readFile(join(dir, 'output.json'), 'utf8');
  assert.equal(gunzipSync(await readFile(join(dir, 'output.json.gz'))).toString('utf8'), json);
  assert.equal(JSON.parse(json).products.length, 2);

  const productsCsv: Record<string, string>[] = parse(await readFile(join(dir, 'products.csv'), 'utf8'), { columns: true });
  const pro = productsCsv.find((r) => r.parent_item === 'PRO S4 STS')!;
  assert.equal(pro.min_variant_price, '215');
  assert.equal(pro.max_variant_price, '275');
  assert.equal(pro.pricing_model, 'per_club');
  assert.equal(pro.variant_count, String(products[0]!.variants.rows.length));

  const unmatchedCsv: Record<string, string>[] = parse(await readFile(join(dir, 'unmatched.csv'), 'utf8'), { columns: true });
  assert.deepEqual(unmatchedCsv[0], {
    parent_item: 'AIRBREAK PMT', name: 'PuttOUT, "AirBreak"', category: 'Putting Mat',
    reason: 'not_found', detail: 'HTTP 404', tried_urls: 'a | b',
  });

  const variants: Record<string, string>[] = parse(await readFile(join(dir, 'variants.csv'), 'utf8'), { columns: true });
  assert.equal(variants.length, products[0]!.variants.rows.length + products[1]!.variants.rows.length);
  const cheapestSet = variants.find((r) => r.parent_item === 'PRO S4 STS' && r.price === '215')!;
  assert.equal(cheapestSet.default_configuration_total, '1505'); // $215 x 7 default clubs
  assert.match(cheapestSet.selections!, /^Dexterity: /);
  await rm(dir, { recursive: true, force: true });
});

test('variants.csv is not written by default; empty variant lists do not break products.csv', async () => {
  const dir = await tmp();
  const outOfStock = product('fenix-9-pro-solar-gpsw', 'FENIX 9 PRO SOLAR GPSW');
  outOfStock.variants.rows = [];
  const files = await writeOutputs(dir, { metadata: metadata(1, 1), products: [outOfStock] }, []);
  assert.ok(!files.some((f) => f.endsWith('variants.csv')));
  const [row]: Record<string, string>[] = parse(await readFile(join(dir, 'products.csv'), 'utf8'), { columns: true });
  assert.equal(row!.min_variant_price, '');
  assert.equal(row!.variant_count, '0');
  await rm(dir, { recursive: true, force: true });
});

test('products.csv handles a product with 200k variants (no call-stack overflow)', async () => {
  const dir = await tmp();
  const big = product('link-2dot2-put', 'LINK 2.2 PUT');
  const template = big.variants.rows[0]!;
  big.variants.rows = Array.from({ length: 200_000 }, (_, i) => template.map((v, c) => (c === 2 ? 100 + (i % 7) : v)));
  await writeOutputs(dir, { metadata: metadata(1, 1), products: [big] }, []);
  const [row]: Record<string, string>[] = parse(await readFile(join(dir, 'products.csv'), 'utf8'), { columns: true });
  assert.equal(row!.min_variant_price, '100');
  assert.equal(row!.max_variant_price, '106');
  await rm(dir, { recursive: true, force: true });
});
