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
  /** Optional: 2ndswing.com answers 406 to non-US traffic. http(s):// or socks5:// */
  proxyUrl: process.env.PROXY_URL || undefined,
  headers: {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  } as Record<string, string>,
};
