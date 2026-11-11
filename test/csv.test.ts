import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCsv } from '../src/lib/csv.ts';

// A 7-row extract of data/input.csv (same header), so tests do not depend on the daily input.
const SAMPLE = 'test/fixtures/input-sample.csv';

test('loadCsv reads every row', async () => {
  const items = await loadCsv(SAMPLE);
  assert.equal(items.length, 7);
  assert.equal(new Set(items.map((i) => i.parentItem)).size, 7);
});

test('loadCsv maps columns despite the duplicated "Summary" header', async () => {
  const [first] = await loadCsv(SAMPLE);
  assert.deepEqual(first, {
    parentItem: 'TRTL MAX S2S PUT',
    name: 'Odyssey TRTL Max S2S Putter',
    brand: 'Odyssey',
    category: 'Putter',
    model: 'TRTL Max S2S',
    year: '2026',
  });
});

test('loadCsv keeps quotes inside names', async () => {
  const items = await loadCsv(SAMPLE);
  const kids = items.find((i) => i.parentItem === 'TOUR SERIES 6 66 STS');
  assert.equal(kids?.name, 'US Kids Golf Tour Series 6 66" Iron Set');
});
