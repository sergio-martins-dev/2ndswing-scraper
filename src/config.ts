export const config = {
  baseUrl: 'https://www.2ndswing.com',
  inputCsv: 'data/input.csv',
  outDir: 'data',
  cacheDir: '.cache',
  /** Parallel product pipelines. 8 produced zero 429s in testing; keep it polite. */
  concurrency: 8,
  timeoutMs: 30_000,
  maxRetries: 3,
  backoffBaseMs: 1_000,
  /**
   * Plain browser-like headers, no cookies or session. A browser User-Agent is kept because the
   * CDN's bot rules were only tested with one; the crawl stays polite through concurrency 8,
   * retries with backoff, honouring Retry-After and a disk cache that avoids repeat requests.
   */
  headers: {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  } as Record<string, string>,
};
