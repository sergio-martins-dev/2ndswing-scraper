import * as cheerio from 'cheerio';

/** Price triple Magento uses everywhere (`basePrice`, `finalPrice`, `oldPrice`). */
export type MagentoPrices = Record<string, { amount: number | string; base_amount?: number }>;

/** Reads `prices[key].amount` as a 2-decimal number; 0 when missing or not numeric. */
export function priceAmount(prices: MagentoPrices | undefined, key = 'finalPrice'): number {
  const value = Number(prices?.[key]?.amount);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/** Shape of `#product_addtocart_form.configurable.spConfig` (only the fields we read). */
export type SpConfig = {
  productId: string;
  attributes: Record<
    string,
    { id: string; code: string; label: string; position?: string | number; options: { id: string; label: string; products: string[] }[] }
  >;
  /** childId -> { attributeId: optionId } */
  index: Record<string, Record<string, string>>;
  optionPrices: Record<string, MagentoPrices>;
  prices: MagentoPrices;
  sku: Record<string, string>;
  /** attributeId -> childId -> [days] */
  leadtimes?: Record<string, Record<string, (number | string)[]>>;
};

export type IronsetOptionValue = {
  name: string;
  type: string;
  option_type: string;
  is_default: boolean;
  prices: MagentoPrices;
};

/** Shape of `#product_addtocart_form.ironsetOptions` (custom options / fitting upcharges). */
export type IronsetConfig = {
  optionConfig: Record<string, Record<string, IronsetOptionValue>>;
  isIronsetProduct: number | boolean;
  clubInformation?: { included_clubs?: string[]; total_included_clubs?: number };
  basePrice?: number | string;
};

export type LdProduct = {
  sku: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  image: string | null;
};

/** The `x-magento-init` block that configures the add-to-cart form. */
type MagentoInit = {
  '#product_addtocart_form'?: { configurable?: { spConfig?: SpConfig }; ironsetOptions?: IronsetConfig };
};

/** The schema.org fields read from `application/ld+json` (values are not trusted to be strings). */
type LdNode = {
  '@type'?: string;
  '@graph'?: LdNode[];
  sku?: unknown;
  name?: unknown;
  brand?: string | { name?: unknown } | null;
  category?: unknown;
  description?: unknown;
  image?: unknown;
  offers?: LdOffer | LdOffer[];
};
type LdOffer = { price?: unknown; priceCurrency?: unknown; availability?: unknown };

export type ParsedPage = {
  productId: string | null;
  canonical: string | null;
  ld: LdProduct | null;
  spConfig: SpConfig | null;
  ironset: IronsetConfig | null;
  /** groupId -> visible label ("Grips", "Irons In Set", ...) */
  optionLabels: Record<string, string>;
  /** groupId -> HTML control type */
  optionInputTypes: Record<string, 'select' | 'checkbox'>;
  /** "Description" tab, plain text with paragraph breaks. */
  description: string | null;
  /** "Specs" tab table: one record per row, keyed by the header row (e.g. Loft, Length, Lie). */
  specs: Record<string, string>[];
  /** YouTube embeds from the "Videos" tab. */
  videos: string[];
};

/**
 * Extracts everything the product page front-end itself uses: the `x-magento-init` JSON blocks
 * (configurable matrix + custom options), the schema.org Product block and the canonical URL.
 * No DOM interaction is simulated; this is the same data the page's JavaScript reads.
 */
export function parseProductPage(html: string): ParsedPage {
  const $ = cheerio.load(html);

  let spConfig: SpConfig | null = null;
  let ironset: IronsetConfig | null = null;
  $('script[type="text/x-magento-init"]').each((_, el) => {
    const form = (safeJson($(el).text()) as MagentoInit | null)?.['#product_addtocart_form'];
    if (!form || typeof form !== 'object') return;
    if (form.configurable?.spConfig) spConfig = form.configurable.spConfig;
    if (form.ironsetOptions?.optionConfig) ironset = form.ironsetOptions;
  });

  const optionLabels: Record<string, string> = {};
  const optionInputTypes: Record<string, 'select' | 'checkbox'> = {};
  for (const groupId of Object.keys((ironset as IronsetConfig | null)?.optionConfig ?? {})) {
    const label = $(`label[for="select_${groupId}"] span`).first().text().trim();
    if (label) optionLabels[groupId] = label;
    optionInputTypes[groupId] = $(`input[type="checkbox"][name^="options[${groupId}]"]`).length ? 'checkbox' : 'select';
  }

  const productId =
    (spConfig as SpConfig | null)?.productId ?? $('[data-product-id]').first().attr('data-product-id') ?? null;

  return {
    productId,
    canonical: $('link[rel="canonical"]').attr('href') ?? null,
    ld: parseLdProduct($),
    spConfig,
    ironset,
    optionLabels,
    optionInputTypes,
    description: parseDescription($),
    specs: parseSpecs($),
    videos: parseVideos($),
  };
}

function parseDescription($: cheerio.CheerioAPI): string | null {
  const root = $('#details').first();
  if (!root.length) return null;
  const blocks = root
    .find('p, li, h2, h3, h4')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);
  const text = blocks.length ? blocks.join('\n') : root.text().replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Clubs publish a table (one record per row). Bags, GPS units and accessories often publish a bullet
 * list instead ("Magnification: 6x", "5.4 lbs"): it becomes a single record. Unlabeled items are
 * keyed "Item 1", "Item 2"...; a repeated label gets a suffix ("Weight (2)") instead of overwriting.
 */
function parseSpecs($: cheerio.CheerioAPI): Record<string, string>[] {
  const [header, ...body] = tableGrid($, '#specs table').filter((r) => r.some(Boolean));
  if (header) return body.map((cells) => Object.fromEntries(header.map((h, i) => [h || `col${i}`, cells[i] ?? ''])));

  const items = $('#specs li')
    .map((_, li) => $(li).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);
  if (items.length === 0) return [];
  const record: Record<string, string> = {};
  let unlabeled = 0;
  for (const text of items) {
    const match = /^([^:]{1,40}):\s*(.+)$/.exec(text);
    const label = match ? match[1]!.trim() : `Item ${++unlabeled}`;
    let key = label;
    for (let n = 2; key in record; n++) key = `${label} (${n})`;
    record[key] = match ? match[2]! : text;
  }
  return [record];
}

/**
 * Expands a table into a rectangular grid, copying merged cells (rowspan/colspan) into every
 * position they cover. Spec tables often merge the first column ("Type", "Club") across rows;
 * reading cells by index would shift the remaining values one column to the left.
 */
function tableGrid($: cheerio.CheerioAPI, selector: string): string[][] {
  const grid: string[][] = [];
  $(selector).first().find('tr').each((rowIndex, tr) => {
    const row = (grid[rowIndex] ??= []);
    let col = 0;
    $(tr)
      .find('th, td')
      .each((_, cell) => {
        while (row[col] !== undefined) col++; // skip slots filled by a rowspan from above
        const text = $(cell).text().replace(/\s+/g, ' ').trim();
        const rowspan = Math.max(1, Number($(cell).attr('rowspan')) || 1);
        const colspan = Math.max(1, Number($(cell).attr('colspan')) || 1);
        for (let r = 0; r < rowspan; r++) {
          const target = (grid[rowIndex + r] ??= []);
          for (let c = 0; c < colspan; c++) target[col + c] = text;
        }
        col += colspan;
      });
  });
  return grid.map((row) => Array.from(row, (cell) => cell ?? ''));
}

function parseVideos($: cheerio.CheerioAPI): string[] {
  // The iframe markup is HTML-escaped inside the tab, so match on the raw HTML.
  const html = $('#video').html() ?? '';
  const ids = [...html.matchAll(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/g)].map((m) => m[1]!);
  return [...new Set(ids)].map((id) => `https://www.youtube.com/watch?v=${id}`);
}

function parseLdProduct($: cheerio.CheerioAPI): LdProduct | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const json = safeJson($(el).text()) as LdNode | LdNode[] | null;
    const nodes = Array.isArray(json) ? json : (json?.['@graph'] ?? [json]);
    const product = nodes.find((n) => n?.['@type'] === 'Product');
    if (!product) continue;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    return {
      sku: str(product.sku),
      name: str(product.name),
      brand: str(typeof product.brand === 'object' ? product.brand?.name : product.brand),
      category: str(product.category),
      description: str(product.description),
      price: offer?.price != null && offer.price !== '' ? Number(offer.price) : null,
      currency: str(offer?.priceCurrency),
      availability: str(offer?.availability)?.replace('https://schema.org/', '') ?? null,
      image: str(Array.isArray(product.image) ? product.image[0] : product.image),
    };
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
