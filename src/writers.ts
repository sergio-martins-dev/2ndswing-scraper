import { createWriteStream } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Summary } from './lib/metrics.ts';
import { configurationPrice } from './parsers/customizations.ts';
import { fromVariantMatrix } from './parsers/variants.ts';
import type { Product, Unmatched } from './schema.ts';

export type Output = {
  metadata: {
    scrapedAt: string;
    totalInput: number;
    successful: number;
    unmatched: number;
    failed: number;
    totalVariants: number;
    runtimeMs: number;
    productsPerSecond: number;
    concurrency: number;
    proxy: boolean;
    networkMs: Summary;
    parseMs: Summary;
    requests: { network: number; fromCache: number; retries: number };
  };
  products: Product[];
};

/**
 * output.json      full model (variant matrices kept one row per line) + output.json.gz
 * products.csv     one row per product — quick overview for spreadsheets
 * unmatched.csv    every CSV row that did not produce a product, with the reason
 * variants.csv     optional (flatVariants): one row per purchasable child, labels expanded (~150 MB)
 */
export async function writeOutputs(
  dir: string,
  output: Output,
  notScraped: Unmatched[],
  { flatVariants = false } = {},
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files = [join(dir, 'output.json'), join(dir, 'output.json.gz'), join(dir, 'products.csv'), join(dir, 'unmatched.csv')];
  const json = compactJson(output);
  await writeFile(files[0]!, json);
  await writeFile(files[1]!, gzipSync(json, { level: 9 }));
  await writeFile(files[2]!, productsCsv(output.products));
  await writeFile(files[3]!, toCsv(unmatchedRows(notScraped)));
  if (flatVariants) {
    files.push(join(dir, 'variants.csv'));
    await writeVariantsCsv(files[4]!, output.products);
  }
  return files;
}

/** Pretty JSON, but arrays of primitives (matrix rows, URL lists) stay on one line. */
export function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /\[\n\s*((?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)(?:,\n\s*(?:"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null))*)\n\s*\]/g,
    (_, items: string) => `[${items.replace(/,\n\s*/g, ', ')}]`,
  );
}

function productsCsv(products: Product[]): string {
  const header = [
    'parent_item', 'name', 'brand', 'category', 'url', 'listed_price', 'min_variant_price', 'max_variant_price',
    'variant_count', 'attributes', 'customization_groups', 'pricing_model', 'default_club_count',
    'image_count', 'video_count', 'availability',
  ];
  const rows = products.map((p) => {
    const priceIdx = p.variants.fields.indexOf('price');
    // A loop, not Math.min(...prices): spreading 100k+ values overflows the call stack.
    let min = Infinity;
    let max = -Infinity;
    for (const row of p.variants.rows) {
      const price = Number(row[priceIdx]);
      if (price < min) min = price;
      if (price > max) max = price;
    }
    const hasPrices = p.variants.rows.length > 0;
    return [
      p.parentItem, p.name, p.brand, p.category, p.url, p.listedPrice ?? '',
      hasPrices ? min : '', hasPrices ? max : '', p.variants.rows.length,
      p.attributes.map((a) => `${a.label} (${a.options.length})`).join('; '),
      p.customizations.map((c) => `${c.label} (${c.options.length})`).join('; '),
      p.pricing.model, p.pricing.defaultClubCount, p.media.images.length, p.media.videos.length, p.availability ?? '',
    ];
  });
  return toCsv([header, ...rows]);
}

async function writeVariantsCsv(path: string, products: Product[]): Promise<void> {
  const out = createWriteStream(path);
  const write = async (line: string) => {
    if (!out.write(line)) await once(out, 'drain');
  };
  await write(toCsv([[
    'parent_item', 'name', 'category', 'child_id', 'sku', 'selections', 'price', 'regular_price',
    'lead_time_days', 'pricing_model', 'default_club_count', 'default_configuration_total',
  ]]));
  for (const p of products) {
    const labels = new Map(p.attributes.map((a) => [a.code, a.label]));
    for (const v of fromVariantMatrix(p.attributes, p.variants)) {
      await write(toCsv([[
        p.parentItem, p.name, p.category, v.childId, v.sku,
        Object.entries(v.selections).map(([code, value]) => `${labels.get(code) ?? code}: ${value}`).join('; '),
        v.price, v.regularPrice ?? '', v.leadTimeDays ?? '', p.pricing.model, p.pricing.defaultClubCount,
        configurationPrice(v.price, [], p.pricing),
      ]]));
    }
  }
  out.end();
  await once(out, 'finish');
}

function unmatchedRows(items: Unmatched[]): (string | number)[][] {
  return [
    ['parent_item', 'name', 'category', 'reason', 'detail', 'tried_urls'],
    ...items.map((u) => [u.parentItem, u.name, u.category, u.reason, u.detail, u.triedUrls.join(' | ')]),
  ];
}

function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
