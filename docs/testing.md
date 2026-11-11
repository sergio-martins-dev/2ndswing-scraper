# Testing

`npm test` runs the `node:test` suites in `test/` offline in about a second; `npm run typecheck`
runs `tsc --noEmit`.

Parsers are tested against real product pages saved from the site in `test/fixtures/`
(driver, putters, iron set, junior complete set, GPS watch, an archived model page), so a test
fails if the site's JSON contract changes in the saved shape. Tests read
`test/fixtures/input-sample.csv`, a 7-row extract of the input with the same header, not the
daily `data/input.csv`.

| Area | Covered |
|---|---|
| `siteSlug` | dots, `+`, inch marks, hyphens, spacing, against real canonical URL segments |
| CSV | duplicated `Summary` header, quotes in names, any column order, BOM, short rows, repeated Parent Item (first row kept, reported), missing file/column, `;`-separated file |
| HTTP client (local server) | retry on 429/5xx/timeout, no retry on 404, 406 → `GeoBlockedError`, cache read/write, `--refresh`, `Retry-After` (seconds, HTTP date, 60 s cap) |
| Variants | driver 660 valid children with 7 price points, putters 18 and 6, lead times, child SKUs, options sharing a label |
| Customizations / pricing | iron set $215 × 7 = $1,505, ferrule upcharge × clubs, 6-club set, "Irons In Set" kept out of upcharges, `priceCheck` on real pages and on a wrong price |
| Page parsing | ld+json (incl. `brand: null`), specs tables with `rowspan`/`colspan`, specs as bullet lists with repeated labels, videos |
| Builder / schema | every fixture builds a schema-valid product, out of stock without a $0 variant, canonical fallback, malformed image URL, in-stock product without variants rejected |
| Resolver | root slug, sitemap fallback, archived model page, redirect to a model page, SKU mismatch |
| Pipeline | CSV order kept whatever the completion order, per-product error isolation, gallery fallback, a geo-block drains the queue, unexpected bugs are not swallowed |
| Writers / CLI | JSON + gzip, CSV quoting, flat variants export, 200k-variant product, option validation |
