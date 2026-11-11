import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvError, loadCsv } from '../src/lib/csv.ts';

// A 7-row extract of data/input.csv (same header), so tests do not depend on the daily input.
const SAMPLE = 'test/fixtures/input-sample.csv';
const HEADER = 'Parent Item,Name,Model,Category,Year Release,Brand';

const dir = await mkdtemp(join(tmpdir(), 'csv-'));
after(() => rm(dir, { recursive: true, force: true }));
let n = 0;
async function csvFile(content: string): Promise<string> {
  const path = join(dir, `${n++}.csv`);
  await writeFile(path, content);
  return path;
}

test('loadCsv reads every row', async () => {
  const { items, duplicates } = await loadCsv(SAMPLE);
  assert.equal(items.length, 7);
  assert.equal(new Set(items.map((i) => i.parentItem)).size, 7);
  assert.deepEqual(duplicates, []);
});

test('loadCsv maps columns despite the duplicated "Summary" header', async () => {
  const [first] = (await loadCsv(SAMPLE)).items;
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
  const kids = (await loadCsv(SAMPLE)).items.find((i) => i.parentItem === 'TOUR SERIES 6 66 STS');
  assert.equal(kids?.name, 'US Kids Golf Tour Series 6 66" Iron Set');
});

test('column order does not matter; BOM, blank lines, short rows and empty Parent Item are tolerated', async () => {
  const path = await csvFile(`﻿Brand,Year Release,Category,Model,Name,Parent Item,Extra\n\nOdyssey,2026,Putter,X, Some Putter ,  ABC PUT \nPing,2025\n`);
  const { items } = await loadCsv(path);
  assert.deepEqual(items, [{ parentItem: 'ABC PUT', name: 'Some Putter', brand: 'Odyssey', category: 'Putter', model: 'X', year: '2026' }]);
});

test('a repeated Parent Item keeps its first row and is reported', async () => {
  const path = await csvFile(`${HEADER}\nA PUT,First,,Putter,,\nB PUT,Other,,Putter,,\nA PUT,Second,,Putter,,\n`);
  const { items, duplicates } = await loadCsv(path);
  assert.deepEqual(items.map((i) => [i.parentItem, i.name]), [['A PUT', 'First'], ['B PUT', 'Other']]);
  assert.deepEqual(duplicates, ['A PUT']);
});

test('unusable files fail with a clear CsvError', async () => {
  await assert.rejects(loadCsv(join(dir, 'nope.csv')), (e: Error) => e instanceof CsvError && /Cannot read input CSV/.test(e.message));
  await assert.rejects(loadCsv(await csvFile('')), (e: Error) => e instanceof CsvError && /Empty CSV/.test(e.message));
  await assert.rejects(loadCsv(await csvFile('Name,Brand\nX,Y\n')), (e: Error) => e instanceof CsvError && /missing column "Parent Item"/.test(e.message));
  await assert.rejects(
    loadCsv(await csvFile('Parent Item;Name;Model;Category;Year Release;Brand\nA;B;C;D;E;F\n')),
    (e: Error) => e instanceof CsvError && /";"-separated/.test(e.message),
  );
});
