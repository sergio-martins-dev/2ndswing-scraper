import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize } from '../src/lib/metrics.ts';

test('percentile uses nearest rank', () => {
  const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
  assert.equal(percentile(values, 50), 5);
  assert.equal(percentile(values, 95), 10);
  assert.equal(percentile(values, 0), 1);
  assert.equal(percentile([42], 95), 42);
});

test('percentile and summarize handle an empty list', () => {
  assert.equal(percentile([], 50), 0);
  assert.deepEqual(summarize([]), { count: 0, mean: 0, p50: 0, p95: 0, max: 0 });
});

test('summarize rounds to one decimal and does not mutate input', () => {
  const values = [10.04, 20.06, 30];
  assert.deepEqual(summarize(values), { count: 3, mean: 20, p50: 20.1, p95: 30, max: 30 });
  assert.deepEqual(values, [10.04, 20.06, 30]);
});
