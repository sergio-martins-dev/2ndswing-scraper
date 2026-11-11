import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCsv } from '../src/lib/csv.ts';

test('loadCsv reads every row of the challenge CSV with unique Parent Items', async () => {
  const items = await loadCsv('data/input.csv');
  assert.equal(items.length, 960);
  assert.equal(new Set(items.map((i) => i.parentItem)).size, 960);
});

test('loadCsv maps columns despite the duplicated "Summary" header', async () => {
  const [first] = await loadCsv('data/input.csv');
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
  const items = await loadCsv('data/input.csv');
  const kids = items.find((i) => i.parentItem === 'TOUR SERIES 6 66 STS');
  assert.equal(kids?.name, 'US Kids Golf Tour Series 6 66" Iron Set');
});
