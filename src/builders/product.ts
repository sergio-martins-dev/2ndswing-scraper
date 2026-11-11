import type { CsvItem } from '../lib/csv.ts';
import { parseCustomizations } from '../parsers/customizations.ts';
import type { ParsedPage } from '../parsers/magento-init.ts';
import { parseVariants, toVariantMatrix, type Variant } from '../parsers/variants.ts';
import type { Product } from '../schema.ts';

export type BuildMeta = Product['meta'];

export const galleryUrl = (baseUrl: string, parentItem: string): string =>
  `${baseUrl}/gallery/${encodeURIComponent(parentItem)}.json`;

export const imageUrl = (baseUrl: string, imageName: string): string =>
  `${baseUrl}/images/standard/${encodeURIComponent(imageName)}`;

/**
 * Assembles the output record. CSV fields are the fallback for identity data; the page is the
 * source of truth for prices, options and media.
 */
export function buildProduct(
  item: CsvItem,
  page: ParsedPage,
  galleryImages: string[] | null,
  baseUrl: string,
  meta: BuildMeta,
  /** Final URL of the fetched page, used when the page has no canonical link. */
  pageUrl?: string,
): Product {
  const { attributes, variants } = page.spConfig
    ? parseVariants(page.spConfig)
    : { attributes: [], variants: simpleVariant(item, page) };
  const { customizations, pricing } = parseCustomizations(page);

  const images = galleryImages?.length
    ? galleryImages.map((name) => imageUrl(baseUrl, name))
    : page.ld?.image
      ? [normalizeUrl(page.ld.image)]
      : [];

  return {
    parentItem: item.parentItem,
    name: page.ld?.name ?? item.name,
    brand: page.ld?.brand ?? item.brand,
    category: page.ld?.category ?? item.category,
    url: page.canonical ?? pageUrl ?? `${baseUrl}/${item.parentItem}`,
    productId: page.productId,
    // Out-of-stock pages publish price 0; that is "no price", not a free product.
    listedPrice: page.ld?.price ? page.ld.price : null,
    currency: 'USD',
    availability: page.ld?.availability ?? null,
    description: page.description,
    specs: page.specs,
    attributes,
    variants: toVariantMatrix(attributes, variants),
    customizations,
    pricing,
    media: { images, videos: page.videos },
    meta,
  };
}

/**
 * Simple (non-configurable) products: one purchasable unit priced from ld+json.
 * No price (out of stock pages publish 0) means nothing purchasable: no synthetic $0 variant.
 */
function simpleVariant(item: CsvItem, page: ParsedPage): Variant[] {
  if (!page.ld?.price || page.ld.price <= 0) return [];
  return [
    {
      childId: page.productId ?? item.parentItem,
      sku: page.ld.sku ?? item.parentItem,
      selections: {},
      price: page.ld.price,
      regularPrice: null,
      leadTimeDays: null,
    },
  ];
}

/** ld+json image URLs contain raw spaces; encode them, keeping the original if it is malformed. */
function normalizeUrl(url: string): string {
  try {
    return encodeURI(decodeURI(url));
  } catch {
    return url;
  }
}
