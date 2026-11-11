import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import { fixture } from './helpers.ts';

const pages: [slug: string, sku: string, canonical: string][] = [
  ['trtl-max-s2s-put', 'TRTL MAX S2S PUT', 'https://www.2ndswing.com/golf-clubs/putters/odyssey-trtl-max-s2s-putter/trtl-max-s2s-put'],
  ['zxi-rkt-max-dvr', 'ZXI RKT MAX DVR', 'https://www.2ndswing.com/golf-clubs/drivers/srixon-zxi-rkt-max-driver/zxi-rkt-max-dvr'],
  ['pro-s4-sts', 'PRO S4 STS', 'https://www.2ndswing.com/golf-clubs/iron-sets/mizuno-pro-s-4-iron-set/pro-s4-sts'],
  ['fenix-9-pro-solar-gpsw', 'FENIX 9 PRO SOLAR GPSW', 'https://www.2ndswing.com/accessories/gps-watches/garmin-fenix-9-pro-solar-gps-watch/fenix-9-pro-solar-gpsw'],
];

for (const [slug, sku, canonical] of pages) {
  test(`${slug}: ld+json sku and canonical`, () => {
    const page = parseProductPage(fixture(slug));
    assert.equal(page.ld?.sku, sku);
    assert.equal(page.canonical, canonical);
    assert.equal(page.ld?.currency, 'USD');
    assert.ok(page.productId);
  });
}

test('configurable pages expose spConfig; simple products do not', () => {
  assert.ok(parseProductPage(fixture('zxi-rkt-max-dvr')).spConfig);
  const gps = parseProductPage(fixture('fenix-9-pro-solar-gpsw'));
  assert.equal(gps.spConfig, null);
  assert.equal(gps.ld?.price, 1099.99);
  assert.equal(gps.ld?.availability, 'InStock');
});

test('iron set custom-option groups have visible labels and input types', () => {
  const page = parseProductPage(fixture('pro-s4-sts'));
  const labels = Object.values(page.optionLabels);
  for (const expected of ['Grips', 'Irons In Set', 'Ferrule', 'Length', 'Lie Angle Adjustment', 'Loft Adjustment']) {
    assert.ok(labels.includes(expected), `missing label ${expected}`);
  }
  const clubsGroup = Object.entries(page.optionLabels).find(([, l]) => l === 'Irons In Set')![0];
  assert.equal(page.optionInputTypes[clubsGroup], 'checkbox');
  assert.equal(page.ironset?.isIronsetProduct, 1);
  assert.equal(page.ironset?.clubInformation?.total_included_clubs, 7);
});
