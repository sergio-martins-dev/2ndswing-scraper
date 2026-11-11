import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProduct } from '../src/builders/product.ts';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import { checkListedPrices } from '../src/pricing.ts';
import { fixture } from './helpers.ts';

const BASE = 'https://www.2ndswing.com';
const meta = { resolvedVia: 'root_slug', fetchedAt: '2026-11-11T00:00:00.000Z' } as const;
const build = (slug: string, parentItem: string) =>
  buildProduct({ parentItem, name: parentItem, brand: '', category: '', model: '', year: '' }, parseProductPage(fixture(slug)), null, BASE, meta);

test('listed price equals the cheapest configuration on real pages; simple products are not counted', () => {
  const products = [
    build('pro-s4-sts', 'PRO S4 STS'),
    build('zxi-rkt-max-dvr', 'ZXI RKT MAX DVR'),
    build('trtl-max-s2s-put', 'TRTL MAX S2S PUT'),
    build('fenix-9-pro-solar-gpsw', 'FENIX 9 PRO SOLAR GPSW'),
  ];
  assert.deepEqual(checkListedPrices(products), { checked: 3, matched: 3, mismatches: [] });
});

test('a wrong price is reported; products without a listed price are skipped', () => {
  const wrong = build('pro-s4-sts', 'PRO S4 STS');
  wrong.listedPrice = 215; // per-club price without the club multiplier
  const outOfStock = build('zxi-rkt-max-dvr', 'ZXI RKT MAX DVR');
  outOfStock.listedPrice = null;
  assert.deepEqual(checkListedPrices([wrong, outOfStock]), { checked: 1, matched: 0, mismatches: ['PRO S4 STS'] });
});
