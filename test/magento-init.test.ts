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

test('specs: rowspan in the first column is propagated instead of shifting values left', () => {
  const html = `<div id="specs"><table>
    <tr><td>Type</td><td>Flex</td><td>Weight</td></tr>
    <tr><td rowspan="3">Diamana BB 83 HY</td><td>Regular</td><td>83g</td></tr>
    <tr><td>Stiff</td><td>84g</td></tr>
    <tr><td>X-Stiff</td><td>88g</td></tr>
  </table></div>`;
  assert.deepEqual(parseProductPage(html).specs, [
    { Type: 'Diamana BB 83 HY', Flex: 'Regular', Weight: '83g' },
    { Type: 'Diamana BB 83 HY', Flex: 'Stiff', Weight: '84g' },
    { Type: 'Diamana BB 83 HY', Flex: 'X-Stiff', Weight: '88g' },
  ]);
});

test('specs: colspan fills every covered column', () => {
  const html = `<div id="specs"><table>
    <tr><td>Club</td><td>Loft</td><td>Lie</td></tr>
    <tr><td>7 Iron</td><td colspan="2">Adjustable</td></tr>
  </table></div>`;
  assert.deepEqual(parseProductPage(html).specs, [{ Club: '7 Iron', Loft: 'Adjustable', Lie: 'Adjustable' }]);
});

test('specs: a bullet list becomes one record; unlabeled items are numbered', () => {
  const html = `<div id="specs"><h4>Specs</h4><ul>
    <li><span>Magnification: 6x </span></li><li>5.4 lbs</li><li>Range:  5 - 1,300 yards</li></ul></div>`;
  assert.deepEqual(parseProductPage(html).specs, [{ Magnification: '6x', 'Item 2': '5.4 lbs', Range: '5 - 1,300 yards' }]);
});

test('specs: no table and no list gives an empty list', () => {
  assert.deepEqual(parseProductPage('<div id="specs"><p> </p></div>').specs, []);
});
