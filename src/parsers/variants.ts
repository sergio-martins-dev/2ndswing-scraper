import { priceAmount, type SpConfig } from './magento-init.ts';
import { VARIANT_BASE_FIELDS } from '../schema.ts';

export type Attribute = { code: string; label: string; options: { id: string; label: string }[] };

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
export function parseVariants(sp: SpConfig): { attributes: Attribute[]; variants: Variant[] } {
  // JSON.parse reorders numeric keys, so restore the site's display order from `position`.
  const attrs = Object.values(sp.attributes).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const optionLabel = new Map<string, string>(); // `${attrId}:${optionId}` -> label
  for (const a of attrs) for (const o of a.options) optionLabel.set(`${a.id}:${o.id}`, o.label);

  const attributes: Attribute[] = attrs.map((a) => ({
    code: a.code,
    label: a.label,
    // Drop options that no child product uses (Magento sometimes lists them anyway).
    options: a.options.filter((o) => o.products.length > 0).map((o) => ({ id: o.id, label: o.label })),
  }));

  const variants: Variant[] = Object.entries(sp.index).map(([childId, combo]) => {
    const selections: Record<string, string> = {};
    for (const a of attrs) {
      const optionId = combo[a.id];
      if (optionId !== undefined) selections[a.code] = optionLabel.get(`${a.id}:${optionId}`) ?? optionId;
    }
    const prices = sp.optionPrices[childId] ?? sp.prices;
    const price = priceAmount(prices);
    const old = priceAmount(prices, 'oldPrice');
    return {
      childId,
      sku: sp.sku[childId] ?? childId,
      selections,
      price,
      regularPrice: old > price ? old : null,
      leadTimeDays: leadTime(sp, childId),
    };
  });

  return { attributes, variants };
}

export type VariantMatrix = { fields: string[]; rows: (string | number | null)[][] };

const BASE_FIELDS: readonly string[] = VARIANT_BASE_FIELDS;

/**
 * Compact form of the variant list: one row per child, attribute cells are indexes into
 * `attributes[i].options`. Keeps every exact child SKU while cutting output size ~8x.
 */
export function toVariantMatrix(attributes: Attribute[], variants: Variant[]): VariantMatrix {
  const optionIndex = attributes.map((a) => new Map(a.options.map((o, i) => [o.label, i])));
  return {
    fields: [...BASE_FIELDS, ...attributes.map((a) => a.code)],
    rows: variants.map((v) => [
      v.childId,
      v.sku,
      v.price,
      v.regularPrice,
      v.leadTimeDays,
      ...attributes.map((a, i) => {
        const label = v.selections[a.code];
        return label === undefined ? null : (optionIndex[i]!.get(label) ?? null);
      }),
    ]),
  };
}

/** Inverse of toVariantMatrix — used by the flat CSV writer and tests. */
export function fromVariantMatrix(attributes: Attribute[], matrix: VariantMatrix): Variant[] {
  const base = BASE_FIELDS.length;
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
