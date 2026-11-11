import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backoffMs, GeoBlockedError, HttpClient, RetryableStatusError } from '../src/services/http.client.ts';

let server: Server;
let base: string;
let cacheDir: string;
const hits: Record<string, number> = {};

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'http-cache-'));
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === '/ok') return void res.end('hello');
    if (path === '/missing') return void ((res.statusCode = 404), res.end('nope'));
    if (path === '/geo') return void ((res.statusCode = 406), res.end());
    if (path === '/flaky') {
      if (hits[path] === 1) return void ((res.statusCode = 429), res.end());
      if (hits[path] === 2) return void ((res.statusCode = 503), res.end());
      return void res.end('recovered');
    }
    if (path === '/always500') return void ((res.statusCode = 500), res.end());
    if (path === '/slow-once') {
      if (hits[path] === 1) return; // never answer -> client timeout
      return void res.end('late but fine');
    }
    res.statusCode = 400;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await rm(cacheDir, { recursive: true, force: true });
});

const client = (cache: string | null = null) =>
  new HttpClient({ headers: {}, timeoutMs: 300, maxRetries: 3, backoffBaseMs: 5, cacheDir: cache });

test('returns body, status, timing and attempts on success', async () => {
  const http = client();
  const r = await http.get(`${base}/ok`);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'hello');
  assert.equal(r.attempts, 1);
  assert.equal(r.fromCache, false);
  assert.ok(r.ms >= 0);
  await http.close();
});

test('retries 429 and 5xx until success', async () => {
  const http = client();
  const r = await http.get(`${base}/flaky`);
  assert.equal(r.body, 'recovered');
  assert.equal(r.attempts, 3);
  assert.equal(http.stats.retries, 2);
  await http.close();
});

test('does not retry 404', async () => {
  const http = client();
  const r = await http.get(`${base}/missing`);
  assert.equal(r.status, 404);
  assert.equal(r.attempts, 1);
  assert.equal(hits['/missing'], 1);
  await http.close();
});

test('retries a timeout', async () => {
  const http = client();
  const r = await http.get(`${base}/slow-once`);
  assert.equal(r.body, 'late but fine');
  assert.equal(r.attempts, 2);
  await http.close();
});

test('gives up after maxRetries on persistent 5xx', async () => {
  const http = client();
  await assert.rejects(http.get(`${base}/always500`), /failed after 4 attempts/);
  assert.equal(hits['/always500'], 4);
  await http.close();
});

test('406 raises a geo-block error without retrying', async () => {
  const http = client();
  await assert.rejects(http.get(`${base}/geo`), GeoBlockedError);
  assert.equal(hits['/geo'], 1);
  await http.close();
});

test('second call is served from the disk cache (200 and 404)', async () => {
  const first = client(cacheDir);
  await first.get(`${base}/ok`);
  await first.get(`${base}/missing`);
  await first.close();
  const okBefore = hits['/ok'];
  const missingBefore = hits['/missing'];

  const second = client(cacheDir);
  const ok = await second.get(`${base}/ok`);
  const missing = await second.get(`${base}/missing`);
  assert.equal(ok.fromCache, true);
  assert.equal(ok.body, 'hello');
  assert.equal(missing.status, 404);
  assert.equal(hits['/ok'], okBefore);
  assert.equal(hits['/missing'], missingBefore);
  assert.deepEqual(second.stats, { network: 0, fromCache: 2, retries: 0 });
  await second.close();
});

test('readCache=false (--refresh) always hits the network and rewrites the cache', async () => {
  const warm = client(cacheDir);
  await warm.get(`${base}/ok`);
  await warm.close();
  const before = hits['/ok']!;

  const refresh = new HttpClient({ headers: {}, timeoutMs: 300, maxRetries: 0, backoffBaseMs: 5, cacheDir, readCache: false });
  const r = await refresh.get(`${base}/ok`);
  assert.equal(r.fromCache, false);
  assert.equal(hits['/ok'], before + 1);
  assert.deepEqual(refresh.stats, { network: 1, fromCache: 0, retries: 0 });
  await refresh.close();
});

test('Retry-After is honoured but capped at 60 s; HTTP dates are understood', () => {
  const err = (h: string) => new RetryableStatusError(429, h);
  assert.equal(backoffMs(1000, 1, err('5')), 5000);
  assert.equal(backoffMs(1000, 1, err('3600')), 60_000);
  const inTen = new Date(Date.now() + 10_000).toUTCString();
  const ms = backoffMs(1000, 1, err(inTen));
  assert.ok(ms > 8000 && ms <= 10_000, String(ms));
  const fallback = backoffMs(1000, 2, err('soon'));
  assert.ok(fallback >= 2000 && fallback <= 2600, String(fallback));
});
