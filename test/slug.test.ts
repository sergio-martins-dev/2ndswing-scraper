import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteSlug } from '../src/lib/slug.ts';

// Expected values are real canonical URL segments observed on 2ndswing.com.
const cases: [string, string][] = [
  ['TRTL MAX S2S PUT', 'trtl-max-s2s-put'],
  ['L.A.B. Golf VZN.1i Black Cherry Seasonal Premium Putter', 'ldotadotbdot-golf-vzndot1i-black-cherry-seasonal-premium-putter'],
  ['Sun Mountain 2026 Eclipse E-3.5 14-Way Stand Bag', 'sun-mountain-2026-eclipse-e-3dot5-14-way-stand-bag'],
  ['Mitsubishi Golf Tensei 1K Pro Orange RIP+ Driver Shaft', 'mitsubishi-golf-tensei-1k-pro-orange-ripplus-driver-shaft'],
  ['US Kids Golf Tour Series 6 66" Iron Set', 'us-kids-golf-tour-series-6-66in-iron-set'],
  ['Srixon ZXi5+ Iron Set', 'srixon-zxi5plus-iron-set'],
  ['IC-602 STS', 'ic-602-sts'],
  ['MODEL 4.5 PULL', 'model-4dot5-pull'],
  ['MEZZ.1 MAX CB PUT', 'mezzdot1-max-cb-put'],
  ['  Mixed   Spaces  ', 'mixed-spaces'],
];

for (const [input, expected] of cases) {
  test(`siteSlug(${JSON.stringify(input)})`, () => {
    assert.equal(siteSlug(input), expected);
  });
}
