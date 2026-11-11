import { priceAmount, type SpConfig } from './magento-init.ts';
import { VARIANT_BASE_FIELDS, type Product } from '../schema.ts';

export type Attribute = Product['attributes'][number];

/**
 * Every purchasable child product as a compact matrix: one row per child, `fields` =
 * VARIANT_BASE_FIELDS + one attribute code per column, attribute cells = index into
 * `attributes[i].options`. Keeps every exact child SKU while cutting output size ~8x.
 */
export type VariantMatrix = Product['variants'];

/** One matrix row decoded for humans (flat CSV, tests). */
export type Variant = {
  childId: string;
  sku: string;
  /** attribute code -> option label, e.g. { g2_dexterity: "Right Handed", g2_club_loft: "10.5°" } */
  selections: Record<string, string>;
  price: number;
  /** Set only when the site shows a higher "was" price. */
  regularPrice: number | null;
  leadTimeDays: number | null;
};

/**
 * Turns Magento's configurable matrix into attributes + the exact list of purchasable child
 * products. The site only ships valid combinations, so conditional availability ("Left Handed
 * only comes in 10.5°") is implicit in this list; nothing is inferred or brute-forced.
 */
export function parseVariants(sp: SpConfig): { attributes: Attribute[]; variants: VariantMatrix } {
  // JSON.parse reorders numeric keys, so restore the site's display order from `position`.
  const attrs = Object.values(sp.attributes).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

  const attributes: Attribute[] = attrs.map((a) => ({
    code: a.code,
    label: a.label,
    // Drop options that no child product uses (Magento sometimes lists them anyway).
    options: a.options.filter((o) => o.products.length > 0).map((o) => ({ id: o.id, label: o.label })),
  }));
  // Cells are looked up by option id, never by label: two options may share a label.
  const indexById = attributes.map((a) => new Map(a.options.map((o, i) => [o.id, i])));

  const rows = Object.entries(sp.index).map(([childId, combo]) => {
    const prices = sp.optionPrices[childId] ?? sp.prices;
    const price = priceAmount(prices);
    const old = priceAmount(prices, 'oldPrice');
    return [
      childId,
      sp.sku[childId] ?? childId,
      price,
      old > price ? old : null,
      leadTime(sp, childId),
      ...attrs.map((a, i) => {
        const optionId = combo[a.id];
        return optionId === undefined ? null : (indexById[i]!.get(optionId) ?? null);
      }),
    ];
  });

  return { attributes, variants: { fields: [...VARIANT_BASE_FIELDS, ...attributes.map((a) => a.code)], rows } };
}

/** Decodes the matrix into labelled variants (flat CSV writer, tests). */
export function fromVariantMatrix(attributes: Attribute[], matrix: VariantMatrix): Variant[] {
  const base = VARIANT_BASE_FIELDS.length;
  return matrix.rows.map((row) => {
    const selections: Record<string, string> = {};
    attributes.forEach((a, i) => {
      const idx = row[base + i];
      if (typeof idx === 'number') selections[a.code] = a.options[idx]!.label;
    });
    return {
      childId: String(row[0]),
      sku: String(row[1]),
      price: Number(row[2]),
      regularPrice: row[3] === null ? null : Number(row[3]),
      leadTimeDays: row[4] === null ? null : Number(row[4]),
      selections,
    };
  });
}

/** `leadtimes` is keyed by attribute then child; every attribute repeats the same value. */
function leadTime(sp: SpConfig, childId: string): number | null {
  for (const byChild of Object.values(sp.leadtimes ?? {})) {
    const days = Number(byChild[childId]?.[0]);
    if (Number.isFinite(days)) return days;
  }
  return null;
}
