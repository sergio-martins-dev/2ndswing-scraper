import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactJson } from '../src/writers.ts';

test('compactJson keeps objects indented but arrays of primitives on one line', () => {
  const json = compactJson({ fields: ['a', 'b'], rows: [['x"]', 1.5, null], [true, -2, 'y']], nested: { list: [] } });
  assert.equal(
    json,
    '{\n  "fields": ["a", "b"],\n  "rows": [\n    ["x\\"]", 1.5, null],\n    [true, -2, "y"]\n  ],\n  "nested": {\n    "list": []\n  }\n}',
  );
  assert.deepEqual(JSON.parse(json).rows[0], ['x"]', 1.5, null]);
});
