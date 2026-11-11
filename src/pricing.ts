import type { Product } from './schema.ts';

type PricingRule = Pick<Product['pricing'], 'model' | 'defaultClubCount'>;

/**
 * Price of one concrete configuration, following the site's own rule
 * (SecondSwing_Ironset/js/ironset-options.js):
 *   per_variant: total = variant.price + sum(selected priceDelta)
 *   per_club:    total = (variant.price + sum(selected priceDelta)) * clubCount
 */
export function configurationPrice(
  variantPrice: number,
  selectedDeltas: number[],
  pricing: PricingRule,
  clubCount = pricing.defaultClubCount,
): number {
  const unit = variantPrice + selectedDeltas.reduce((sum, d) => sum + d, 0);
  const total = pricing.model === 'per_club' ? unit * clubCount : unit;
  return Math.round(total * 100) / 100;
}

export type PriceCheck = { checked: number; matched: number; mismatches: string[] };

/**
 * Self-check run after every scrape: the price the page shows (ld+json) must equal the cheapest
 * valid configuration computed from our data. Products without a listed price (out of stock) or
 * without variants are skipped.
 */
export function checkListedPrices(products: Product[]): PriceCheck {
  const result: PriceCheck = { checked: 0, matched: 0, mismatches: [] };
  for (const p of products) {
    if (p.listedPrice === null || p.variants.rows.length === 0) continue;
    const priceIdx = p.variants.fields.indexOf('price');
    let cheapest = Infinity;
    for (const row of p.variants.rows) cheapest = Math.min(cheapest, Number(row[priceIdx]));
    result.checked++;
    if (configurationPrice(cheapest, [], p.pricing) === p.listedPrice) result.matched++;
    else result.mismatches.push(p.parentItem);
  }
  return result;
}
