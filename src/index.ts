import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from './config.ts';
import { loadCsv } from './lib/csv.ts';
import { summarize } from './lib/metrics.ts';
import { GeoBlockedError, HttpClient } from './services/http.client.ts';
import { scrapeAll } from './services/scraper.ts';
import { writeOutputs, type Output } from './writers.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values: args } = parseArgs({
  options: {
    input: { type: 'string', default: config.inputCsv },
    out: { type: 'string', default: config.outDir },
    limit: { type: 'string' },
    only: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: String(config.concurrency) },
    'no-cache': { type: 'boolean', default: false },
    'variants-csv': { type: 'boolean', default: false },
  },
});

async function main(): Promise<void> {
  const started = performance.now();
  const proxyUrl = process.env.PROXY_URL || undefined;
  const concurrency = Math.max(1, Number(args.concurrency));

  let items = await loadCsv(args.input!);
  if (args.only?.length) items = items.filter((i) => args.only!.includes(i.parentItem));
  if (args.limit) items = items.slice(0, Number(args.limit));
  log(`Scraping ${items.length} products (concurrency ${concurrency}, proxy ${proxyUrl ? 'on' : 'off'}, cache ${args['no-cache'] ? 'off' : 'on'})`);

  const http = new HttpClient({
    headers: config.headers,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    backoffBaseMs: config.backoffBaseMs,
    cacheDir: args['no-cache'] ? null : config.cacheDir,
    proxyUrl,
    connections: concurrency,
  });

  try {
    const result = await scrapeAll(items, http, {
      baseUrl: config.baseUrl,
      concurrency,
      onProgress: (done, total, item, status) => {
        if (status !== 'ok' || done % 25 === 0 || done === total) log(`[${done}/${total}] ${status.padEnd(9)} ${item.parentItem}`);
      },
    });

    const runtimeMs = Math.round(performance.now() - started);
    const output: Output = {
      metadata: {
        scrapedAt: new Date().toISOString(),
        totalInput: items.length,
        successful: result.products.length,
        unmatched: result.unmatched.length,
        failed: result.failed.length,
        totalVariants: result.products.reduce((n, p) => n + p.variants.rows.length, 0),
        runtimeMs,
        productsPerSecond: Math.round((result.products.length / (runtimeMs / 1000)) * 100) / 100,
        concurrency,
        proxy: Boolean(proxyUrl),
        networkMs: summarize(result.networkMs),
        parseMs: summarize(result.parseMs),
        requests: { ...http.stats },
      },
      products: result.products,
    };
    const files = await writeOutputs(args.out!, output, [...result.unmatched, ...result.failed], {
      flatVariants: args['variants-csv'],
    });
    printSummary(output, files);
  } finally {
    await http.close();
  }
}

function printSummary({ metadata: m }: Output, files: string[]): void {
  console.table({
    products: { value: `${m.successful} ok / ${m.unmatched} unmatched / ${m.failed} failed (of ${m.totalInput})` },
    variants: { value: `${m.totalVariants} purchasable child SKUs` },
    runtime: { value: `${(m.runtimeMs / 1000).toFixed(1)} s (${m.productsPerSecond} products/s)` },
    network: { value: `p50 ${m.networkMs.p50} ms · p95 ${m.networkMs.p95} ms · n=${m.networkMs.count}` },
    parse: { value: `p50 ${m.parseMs.p50} ms · p95 ${m.parseMs.p95} ms` },
    requests: { value: `${m.requests.network} network · ${m.requests.fromCache} cache · ${m.requests.retries} retries` },
  });
  log(`Wrote ${files.join(', ')}`);
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

main().catch((error) => {
  if (error instanceof GeoBlockedError) log(`\n${error.message}`);
  else log(`\nFatal: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
