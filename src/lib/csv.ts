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

/** The input file cannot be used; the message says why (shown without a stack trace). */
export class CsvError extends Error {}

const COLUMNS = {
  parentItem: 'Parent Item',
  name: 'Name',
  brand: 'Brand',
  category: 'Category',
  model: 'Model',
  year: 'Year Release',
} as const;

/**
 * Loads the input CSV. Columns are found by header name (order and extra columns do not matter);
 * the header repeats "Summary", so rows are read as arrays rather than objects.
 * Rows without a Parent Item are dropped; a repeated Parent Item keeps its first row and is
 * reported in `duplicates` (scraping it twice would duplicate the product in the output).
 */
export async function loadCsv(path: string): Promise<{ items: CsvItem[]; duplicates: string[] }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new CsvError(`Cannot read input CSV: ${path}`);
  }
  let rows: string[][];
  try {
    rows = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true });
  } catch (error) {
    throw new CsvError(`Invalid CSV ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [header, ...data] = rows;
  if (!header) throw new CsvError(`Empty CSV: ${path}`);

  const col = (name: string): number => {
    const index = header.map((h) => h.trim()).indexOf(name);
    if (index !== -1) return index;
    const hint = header.length === 1 && header[0]!.includes(';') ? ' (the file looks ";"-separated; save it comma-separated)' : '';
    throw new CsvError(`CSV ${path} is missing column "${name}"${hint}`);
  };
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, col(name)])) as Record<keyof CsvItem, number>;

  const items: CsvItem[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const cell = (key: keyof CsvItem) => (row[idx[key]] ?? '').trim();
    const item: CsvItem = {
      parentItem: cell('parentItem'),
      name: cell('name'),
      brand: cell('brand'),
      category: cell('category'),
      model: cell('model'),
      year: cell('year'),
    };
    if (item.parentItem === '') continue;
    if (seen.has(item.parentItem)) {
      duplicates.push(item.parentItem);
      continue;
    }
    seen.add(item.parentItem);
    items.push(item);
  }
  return { items, duplicates };
}
