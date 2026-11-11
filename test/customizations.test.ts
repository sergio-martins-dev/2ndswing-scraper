import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductPage } from '../src/parsers/magento-init.ts';
import { configurationPrice, parseCustomizations } from '../src/parsers/customizations.ts';
import { parseVariants } from '../src/parsers/variants.ts';
import { fixture } from './helpers.ts';

const load = (slug: string) => {
  const page = parseProductPage(fixture(slug));
  return { page, ...parseCustomizations(page) };
};

test('iron set: per-club pricing with 7 default clubs', () => {
  const { pricing } = load('pro-s4-sts');
  assert.equal(pricing.model, 'per_club');
  assert.deepEqual(pricing.defaultClubs, ['4 Iron', '5 Iron', '6 Iron', '7 Iron', '8 Iron', '9 Iron', 'PW']);
  assert.equal(pricing.defaultClubCount, 7);
});

test('iron set: "Irons In Set" is the club selector, not an upcharge group', () => {
  const { customizations, pricing } = load('pro-s4-sts');
  assert.equal(pricing.clubSelection?.label, 'Irons In Set');
  assert.equal(pricing.clubSelection?.options.length, 8); // 3 Iron .. PW
  assert.ok(!customizations.some((c) => c.label === 'Irons In Set'));
  assert.ok(!customizations.some((c) => c.optionType === 'clubs'));
});

test('iron set: default configuration reproduces the listed price ($215 x 7 = $1,505)', () => {
  const { page, pricing } = load('pro-s4-sts');
  const cheapest = Math.min(...parseVariants(page.spConfig!).variants.map((v) => v.price));
  assert.equal(cheapest, 215);
  assert.equal(configurationPrice(cheapest, [], pricing), 1505);
  assert.equal(page.ld?.price, 1505);
});

test('iron set: an upcharge is multiplied by the club count (ICON ferrule +$2.50 x 7)', () => {
  const { customizations, pricing } = load('pro-s4-sts');
  const ferrule = customizations.find((c) => c.label === 'Ferrule')!;
  const icon = ferrule.options.find((o) => o.name.startsWith('ICON'))!;
  assert.equal(icon.priceDelta, 2.5);
  assert.equal(configurationPrice(215, [icon.priceDelta], pricing), 1522.5);
  // Removing one club (6 clubs) changes both the base and the upcharge.
  assert.equal(configurationPrice(215, [icon.priceDelta], pricing, 6), 1305);
});

test('driver: per-variant pricing, grip upcharges added once', () => {
  const { customizations, pricing } = load('zxi-rkt-max-dvr');
  assert.equal(pricing.model, 'per_variant');
  assert.equal(pricing.clubSelection, null);
  assert.equal(pricing.defaultClubCount, 1);
  const grips = customizations.find((c) => c.label === 'Grips')!;
  assert.equal(grips.options.length, 71);
  const paid = grips.options.find((o) => o.priceDelta > 0)!;
  assert.equal(configurationPrice(649.99, [paid.priceDelta], pricing), Math.round((649.99 + paid.priceDelta) * 100) / 100);
});

test('simple product: no customizations, per-variant pricing', () => {
  const { customizations, pricing } = load('fenix-9-pro-solar-gpsw');
  assert.equal(customizations.length, 0);
  assert.equal(pricing.model, 'per_variant');
});
