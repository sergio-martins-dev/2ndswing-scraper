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
): Product {
  const { attributes, variants } = page.spConfig
    ? parseVariants(page.spConfig)
    : { attributes: [], variants: simpleVariant(item, page) };
  const { customizations, pricing } = parseCustomizations(page);

  const images = galleryImages?.length
    ? galleryImages.map((name) => imageUrl(baseUrl, name))
    : page.ld?.image
      ? [encodeURI(decodeURI(page.ld.image))]
      : [];

  return {
    parentItem: item.parentItem,
    name: page.ld?.name ?? item.name,
    brand: page.ld?.brand ?? item.brand,
    category: page.ld?.category ?? item.category,
    url: page.canonical ?? `${baseUrl}/`,
    productId: page.productId,
    listedPrice: page.ld?.price ?? null,
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

/** Simple (non-configurable) products: one purchasable unit priced from ld+json. */
function simpleVariant(item: CsvItem, page: ParsedPage): Variant[] {
  if (page.ld?.price == null) return [];
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
