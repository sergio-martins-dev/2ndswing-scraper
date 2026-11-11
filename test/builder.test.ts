import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProduct, galleryUrl } from '../src/builders/product.ts';
import { loadCsv } from '../src/lib/csv.ts';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import { ValidProductSchema as ProductSchema } from '../src/schema.ts';
import { fromVariantMatrix, parseVariants } from '../src/parsers/variants.ts';
import { fixture } from './helpers.ts';

const BASE = 'https://www.2ndswing.com';
const meta = { resolvedVia: 'root_slug', fetchedAt: '2026-11-11T00:00:00.000Z' } as const;
const items = await loadCsv('data/input.csv');
const item = (sku: string) => items.find((i) => i.parentItem === sku)!;

const cases: [slug: string, sku: string][] = [
  ['trtl-max-s2s-put', 'TRTL MAX S2S PUT'],
  ['zxi-rkt-max-dvr', 'ZXI RKT MAX DVR'],
  ['pro-s4-sts', 'PRO S4 STS'],
  ['link-2dot2-put', 'LINK 2.2 PUT'],
  ['max-j-jr-box', 'MAX J JR BOX'],
  ['fenix-9-pro-solar-gpsw', 'FENIX 9 PRO SOLAR GPSW'],
];

for (const [slug, sku] of cases) {
  test(`${slug}: builds a schema-valid product`, () => {
    const product = buildProduct(item(sku), parseProductPage(fixture(slug)), [`${sku}.jpg`, `${sku}_2.jpg`], BASE, meta);
    const parsed = ProductSchema.safeParse(product);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)));
    assert.equal(product.parentItem, sku);
    assert.ok(product.description);
  });
}

test('simple product: one synthetic variant priced from ld+json, no customizations', () => {
  const product = buildProduct(item('FENIX 9 PRO SOLAR GPSW'), parseProductPage(fixture('fenix-9-pro-solar-gpsw')), null, BASE, meta);
  assert.equal(product.variants.rows.length, 1);
  assert.equal(product.variants.rows[0]![2], 1099.99);
  assert.deepEqual(product.variants.fields, ['childId', 'sku', 'price', 'regularPrice', 'leadTimeDays']);
  assert.equal(product.attributes.length, 0);
  assert.equal(product.customizations.length, 0);
});

test('media: gallery names become encoded image URLs; ld+json image is the fallback', () => {
  const page = parseProductPage(fixture('trtl-max-s2s-put'));
  const withGallery = buildProduct(item('TRTL MAX S2S PUT'), page, ['TRTL MAX S2S PUT.jpg'], BASE, meta);
  assert.deepEqual(withGallery.media.images, [`${BASE}/images/standard/TRTL%20MAX%20S2S%20PUT.jpg`]);
  const withoutGallery = buildProduct(item('TRTL MAX S2S PUT'), page, null, BASE, meta);
  assert.deepEqual(withoutGallery.media.images, [`${BASE}/images/standard/TRTL%20MAX%20S2S%20PUT.jpg`]);
});

test('driver carries videos and specs from the detail tabs', () => {
  const product = buildProduct(item('ZXI RKT MAX DVR'), parseProductPage(fixture('zxi-rkt-max-dvr')), null, BASE, meta);
  assert.deepEqual(product.media.videos, ['https://www.youtube.com/watch?v=ThtESvbOyBI']);
  assert.equal(product.specs[0]!.Loft, '9°');
});

test('gallery URL keeps dots and encodes spaces', () => {
  assert.equal(galleryUrl(BASE, 'MEZZ.1 MAX CB PUT'), `${BASE}/gallery/MEZZ.1%20MAX%20CB%20PUT.json`);
});

test('variant matrix: one row per child, attribute cells decode to the selected labels', () => {
  const page = parseProductPage(fixture('zxi-rkt-max-dvr'));
  const product = buildProduct(item('ZXI RKT MAX DVR'), page, null, BASE, meta);
  assert.deepEqual(product.variants.fields, [
    'childId', 'sku', 'price', 'regularPrice', 'leadTimeDays', 'g2_dexterity', 'g2_club_loft', 'g2_shaft_flex', 'g2_shaft_type',
  ]);
  assert.equal(product.variants.rows.length, 660);
  assert.deepEqual(product.variants, parseVariants(page.spConfig!).variants);
  const decoded = fromVariantMatrix(product.attributes, product.variants);
  assert.ok(decoded.every((v) => Object.keys(v.selections).length === 4));
  assert.ok(decoded.some((v) => v.selections.g2_dexterity === 'Left Handed' && v.price === 649.99));
});

test('out-of-stock page with price 0: no $0 variant, listedPrice null, still schema-valid', () => {
  const html = fixture('fenix-9-pro-solar-gpsw')
    .replace(/"price":"1099\.99"/, '"price":"0"')
    .replace('https:\\/\\/schema.org\\/InStock', 'https:\\/\\/schema.org\\/OutOfStock');
  const product = buildProduct(item('FENIX 9 PRO SOLAR GPSW'), parseProductPage(html), null, BASE, meta);
  assert.equal(product.availability, 'OutOfStock');
  assert.equal(product.listedPrice, null);
  assert.equal(product.variants.rows.length, 0);
  assert.ok(ProductSchema.safeParse(product).success);
});

test('schema rejects an in-stock product without variants', () => {
  const product = buildProduct(item('FENIX 9 PRO SOLAR GPSW'), parseProductPage(fixture('fenix-9-pro-solar-gpsw')), null, BASE, meta);
  product.variants.rows = [];
  assert.equal(ProductSchema.safeParse(product).success, false);
});

test('a malformed ld+json image URL is kept as-is instead of failing the product', () => {
  const html = fixture('fenix-9-pro-solar-gpsw').replace(/"image":"[^"]*"/, '"image":"https:\\/\\/www.2ndswing.com\\/images\\/standard\\/BAD%ZZ.jpg"');
  const product = buildProduct(item('FENIX 9 PRO SOLAR GPSW'), parseProductPage(html), null, BASE, meta);
  assert.deepEqual(product.media.images, ['https://www.2ndswing.com/images/standard/BAD%ZZ.jpg']);
});

test('without a canonical link the fetched page URL is used, never the home page', () => {
  const html = fixture('fenix-9-pro-solar-gpsw').replace(/<link rel="canonical"[^>]*>/, '');
  const product = buildProduct(item('FENIX 9 PRO SOLAR GPSW'), parseProductPage(html), null, BASE, meta, `${BASE}/fenix-9-pro-solar-gpsw`);
  assert.equal(product.url, `${BASE}/fenix-9-pro-solar-gpsw`);
});
