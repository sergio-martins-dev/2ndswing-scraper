import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, UsageError } from '../src/cli.ts';

const defaults = { inputCsv: 'data/input.csv', outDir: 'data', concurrency: 8 };

test('defaults: full run writes to data/', () => {
  assert.deepEqual(parseCli([], defaults), {
    input: 'data/input.csv', out: 'data', limit: null, only: [], concurrency: 8,
    noCache: false, refresh: false, variantsCsv: false, partial: false,
  });
});

test('--limit / --only are partial runs and default to data/partial so the deliverable is not overwritten', () => {
  assert.equal(parseCli(['--limit', '20'], defaults).out, 'data/partial');
  const only = parseCli(['--only', 'PRO S4 STS', '--only', 'TRTL MAX S2S PUT'], defaults);
  assert.deepEqual(only.only, ['PRO S4 STS', 'TRTL MAX S2S PUT']);
  assert.equal(only.out, 'data/partial');
  assert.equal(parseCli(['--limit', '20', '--out', 'tmp/x'], defaults).out, 'tmp/x');
});

test('flags are parsed', () => {
  const o = parseCli(['--refresh', '--variants-csv', '--concurrency', '4', '--input', 'x.csv'], defaults);
  assert.equal(o.refresh, true);
  assert.equal(o.variantsCsv, true);
  assert.equal(o.concurrency, 4);
  assert.equal(o.input, 'x.csv');
});

for (const argv of [['--limit', '0'], ['--limit', 'abc'], ['--concurrency', '-1'], ['--concurrency', '2.5'], ['--bogus']]) {
  test(`rejects ${argv.join(' ')} with a usage error`, () => {
    assert.throws(() => parseCli(argv, defaults), UsageError);
  });
}
