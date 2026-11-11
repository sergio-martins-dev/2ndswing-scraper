import { join } from 'node:path';
import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export type CliOptions = {
  input: string;
  out: string;
  limit: number | null;
  only: string[];
  concurrency: number;
  noCache: boolean;
  refresh: boolean;
  variantsCsv: boolean;
  /** --limit/--only: a subset run, written to <outDir>/partial unless --out is given. */
  partial: boolean;
};

export const USAGE = `Usage: npm start -- [options]
  --limit N            first N products only
  --only "PARENT ITEM" one product (repeatable)
  --concurrency N      parallel product pipelines (default 8)
  --refresh            live run, rewrite the cache
  --no-cache           live run, no cache at all
  --variants-csv       also write variants.csv
  --input path.csv     input CSV (default data/input.csv)
  --out dir            output directory (default data/, or data/partial/ for --limit/--only)`;

export function parseCli(
  argv: string[],
  defaults: { inputCsv: string; outDir: string; concurrency: number },
): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        input: { type: 'string' },
        out: { type: 'string' },
        limit: { type: 'string' },
        only: { type: 'string', multiple: true },
        concurrency: { type: 'string' },
        'no-cache': { type: 'boolean' },
        refresh: { type: 'boolean' },
        'variants-csv': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const limit = values.limit === undefined ? null : positiveInt('--limit', values.limit);
  const only = values.only ?? [];
  const partial = limit !== null || only.length > 0;
  return {
    input: values.input ?? defaults.inputCsv,
    out: values.out ?? (partial ? join(defaults.outDir, 'partial') : defaults.outDir),
    limit,
    only,
    concurrency: values.concurrency === undefined ? defaults.concurrency : positiveInt('--concurrency', values.concurrency),
    noCache: values['no-cache'] ?? false,
    refresh: values.refresh ?? false,
    variantsCsv: values['variants-csv'] ?? false,
    partial,
  };
}

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} must be a positive integer (got "${raw}")`);
  return n;
}
