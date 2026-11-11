import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

export type CsvItem = {
  parentItem: string;
  name: string;
  brand: string;
  category: string;
  model: string;
  year: string;
};

/**
 * Loads the input CSV. The header repeats "Summary", so rows are read as arrays and
 * mapped by the index of the columns we need instead of by header name.
 */
export async function loadCsv(path: string): Promise<CsvItem[]> {
  const rows: string[][] = parse(await readFile(path, 'utf8'), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const [header, ...data] = rows;
  if (!header) throw new Error(`Empty CSV: ${path}`);

  const col = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`CSV is missing column "${name}"`);
    return index;
  };
  const idx = {
    parentItem: col('Parent Item'),
    name: col('Name'),
    brand: col('Brand'),
    category: col('Category'),
    model: col('Model'),
    year: col('Year Release'),
  };

  return data
    .map((row) => ({
      parentItem: (row[idx.parentItem] ?? '').trim(),
      name: (row[idx.name] ?? '').trim(),
      brand: (row[idx.brand] ?? '').trim(),
      category: (row[idx.category] ?? '').trim(),
      model: (row[idx.model] ?? '').trim(),
      year: (row[idx.year] ?? '').trim(),
    }))
    .filter((item) => item.parentItem !== '');
}
