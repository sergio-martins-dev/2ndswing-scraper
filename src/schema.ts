import { z } from 'zod';
import type { CsvItem } from './lib/csv.ts';

const money = z.number().nonnegative().finite();

export const ProductSchema = z.object({
  parentItem: z.string().min(1),
  name: z.string().min(1),
  brand: z.string(),
  category: z.string(),
  url: z.url(),
  productId: z.string().nullable(),
  /** Price shown on the page (ld+json). For iron sets it already includes the default club count. */
  listedPrice: money.nullable(),
  currency: z.literal('USD'),
  availability: z.string().nullable(),
  description: z.string().nullable(),
  specs: z.array(z.record(z.string(), z.string())),
  attributes: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  ),
  /**
   * Every purchasable child product, as a compact matrix (some products have 20k+ valid children).
   * `fields` = VARIANT_BASE_FIELDS followed by one attribute code per column; attribute cells hold
   * the index of the option in `attributes[i].options`.
   */
  variants: z
    .object({
      fields: z.array(z.string()),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    })
    .refine((m) => m.rows.every((r) => r.length === m.fields.length), 'every row must match fields'),
  customizations: z.array(
    z.object({
      groupId: z.string(),
      /** As written on the page. */
      label: z.string(),
      /** Normalized group name for comparisons across products (grip, grip_install, lie, loft, ...). */
      kind: z.string(),
      inputType: z.enum(['select', 'checkbox']),
      optionType: z.string(),
      options: z.array(z.object({ id: z.string(), name: z.string(), priceDelta: z.number(), isDefault: z.boolean() })),
    }),
  ),
  /** How a configuration is priced; the rule itself is in src/pricing.ts. */
  pricing: z.object({
    model: z.enum(['per_variant', 'per_club']),
    /** Clubs bought when the shopper changes nothing (iron sets); 1 otherwise. */
    defaultClubCount: z.number().int().positive(),
    /**
     * Iron sets only: the "Irons In Set" checkbox group. It is not an upcharge — it decides how
     * many clubs are bought (the multiplier), so it never appears in `customizations`.
     */
    clubSelection: z
      .object({
        groupId: z.string(),
        label: z.string(),
        options: z.array(z.object({ id: z.string(), name: z.string(), includedByDefault: z.boolean() })),
      })
      .nullable(),
  }),
  media: z.object({ images: z.array(z.url()), videos: z.array(z.url()) }),
  /** Provenance: how the page was found and when it was downloaded. Run timings live in metadata. */
  meta: z.object({
    resolvedVia: z.enum(['root_slug', 'model_page']),
    fetchedAt: z.string(),
  }),
});

export const ValidProductSchema = ProductSchema.refine(
  (p) => p.variants.rows.length > 0 || p.availability !== 'InStock',
  { message: 'an in-stock product must have at least one purchasable variant', path: ['variants', 'rows'] },
);

export type Product = z.infer<typeof ProductSchema>;

export const VARIANT_BASE_FIELDS = ['childId', 'sku', 'price', 'regularPrice', 'leadTimeDays'] as const;

export const UNMATCHED_REASONS = [
  'not_found',
  'archive_page_or_discontinued',
  'redirected_to_model_page',
  'model_page_without_sku',
  'sku_mismatch',
  'http_error',
  'parse_error',
  'schema_error',
] as const;

/**
 * Only transient failures are worth re-running. The other reasons describe the site's state
 * (archived, 404, redirect) or a parser problem: running again gives the same answer.
 */
export const RETRYABLE_REASONS: ReadonlySet<Unmatched['reason']> = new Set(['http_error']);

export type Unmatched = {
  parentItem: string;
  name: string;
  category: string;
  reason: (typeof UNMATCHED_REASONS)[number];
  detail: string;
  /** Every URL requested, in order. The last one decided the outcome. */
  triedUrls: string[];
};

export function toUnmatched(
  item: CsvItem,
  reason: Unmatched['reason'],
  detail: string,
  triedUrls: string[] = [],
): Unmatched {
  return { parentItem: item.parentItem, name: item.name, category: item.category, reason, detail, triedUrls };
}
