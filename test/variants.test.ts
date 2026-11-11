import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import type { SpConfig } from '../src/parsers/magento-init.ts';
import { fromVariantMatrix, parseVariants } from '../src/parsers/variants.ts';
import { fixture } from './helpers.ts';

const variantsOf = (slug: string) => {
  const { attributes, variants } = parseVariants(parseProductPage(fixture(slug)).spConfig!);
  return { attributes, matrix: variants, variants: fromVariantMatrix(attributes, variants) };
};

test('driver: 660 valid children out of 2x3x7x83 theoretical combinations', () => {
  const { attributes, variants } = variantsOf('zxi-rkt-max-dvr');
  assert.deepEqual(
    attributes.map((a) => a.code),
    ['g2_dexterity', 'g2_club_loft', 'g2_shaft_flex', 'g2_shaft_type'],
  );
  assert.equal(variants.length, 660);
  assert.deepEqual(
    [...new Set(variants.map((v) => v.price))].sort((a, b) => a - b),
    [649.99, 738.99, 824.99, 849.99, 894.99, 949.99, 1049.99],
  );
  for (const v of variants) assert.equal(Object.keys(v.selections).length, 4);
});

test('driver: price depends on the shaft model', () => {
  const { variants } = variantsOf('zxi-rkt-max-dvr');
  const priceByShaft = new Map<string, Set<number>>();
  for (const v of variants) {
    const shaft = v.selections.g2_shaft_type!;
    priceByShaft.set(shaft, (priceByShaft.get(shaft) ?? new Set()).add(v.price));
  }
  for (const prices of priceByShaft.values()) assert.equal(prices.size, 1);
});

test('putters: TRTL Max S2S has 18 children, Link 2.2 has 6', () => {
  assert.equal(variantsOf('trtl-max-s2s-put').variants.length, 18);
  const link = variantsOf('link-2dot2-put');
  assert.equal(link.variants.length, 6);
  const rh33 = link.variants.filter((v) => v.selections.g2_dexterity === 'Right Handed' && v.selections.g2_club_length === '33.0in');
  assert.equal(rh33.length, 1);
  assert.equal(rh33[0]!.price, 499.99);
});

test('child SKUs and lead times come from the matrix', () => {
  const { variants } = variantsOf('link-2dot2-put');
  assert.ok(variants.every((v) => /^C\d+$/.test(v.sku)));
  assert.deepEqual([...new Set(variants.map((v) => v.leadTimeDays))].sort(), [1, 21]);
});

test('complete set uses product-specific attributes (subcategory, gender)', () => {
  const { attributes } = variantsOf('max-j-jr-box');
  const codes = attributes.map((a) => a.code);
  assert.ok(codes.includes('g2_subcategory'));
  assert.ok(codes.includes('g2_club_gender'));
});

test('matrix cells index attributes[].options; options sharing a label stay distinct', () => {
  const sp: SpConfig = {
    productId: '1',
    attributes: {
      '10': {
        id: '10', code: 'g2_shaft_flex', label: 'Flex', position: 0,
        options: [{ id: 'a', label: 'Stiff', products: ['c1'] }, { id: 'b', label: 'Stiff', products: ['c2'] }],
      },
    },
    index: { c1: { '10': 'a' }, c2: { '10': 'b' } },
    optionPrices: {},
    prices: { finalPrice: { amount: 100 } },
    sku: { c1: 'C1', c2: 'C2' },
  };
  const { variants } = parseVariants(sp);
  assert.deepEqual(variants.fields, ['childId', 'sku', 'price', 'regularPrice', 'leadTimeDays', 'g2_shaft_flex']);
  assert.deepEqual(variants.rows, [['c1', 'C1', 100, null, null, 0], ['c2', 'C2', 100, null, null, 1]]);
});
