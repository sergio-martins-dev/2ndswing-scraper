# 2nd Swing product scraper

Scrapes the 960 products in `data/input.csv` from [2ndswing.com](https://www.2ndswing.com): details,
every valid configuration with its exact price, fitting upcharges, specs and media.
**No headless browser**: 2 HTTP requests per product.

| Full run | |
|---|---|
| Products | **944 / 960** scraped, 16 classified as unmatched, 0 failed |
| Valid configurations | **444,686** child SKUs, each with its price |
| Runtime | **~7 min** live (6.7–8.1 min over two runs), ~23 s from the disk cache |
| Price check | listed price = cheapest computed configuration for **939 / 939** priced products (`metadata.priceCheck`) |

## How to run

Node.js **>= 20.12**.

```bash
npm install
npm start                               # all products -> data/
npm start -- --limit 3                  # quick look -> data/partial/
npm test                                # offline, ~1 s
```

| Option | Effect |
|---|---|
| `--limit N` / `--only "PRO S4 STS"` | Subset (`--only` repeats), written to `data/partial/` |
| `--refresh` | Live run: ignore cached responses, write fresh ones |
| `--no-cache` | Live run, cache neither read nor written |
| `--concurrency N` | Parallel product pipelines (default 8) |
| `--variants-csv` | Also write `variants.csv`, one row per configuration (large) |
| `--input file.csv` / `--out dir` | Input CSV / output directory |

**Geo-block.** The site's CDN answers `HTTP 406` (empty body) to non-US IPs. From outside the US set
a proxy: `PROXY_URL='socks5://user:pass@host:1080' npm start` (or `http://`, or put it in `.env`).
A 406 stops the run at once with that message.

**Cache.** 200/404 responses are kept in `.cache/`, so re-runs and parser changes do not hit the
site. A fresh clone has no cache: its first run is live.

**Outputs** (`data/`): `output.json` (full model + run metadata, ~47 MB; `.gz` ~5 MB),
`products.csv` (one row per product), `unmatched.csv` (every row not scraped, with reason and the
URLs tried). `data/sample/` has 3 products (driver, iron set, GPS watch) with `variants.csv`
expanded, for reading the model by eye.

## Approach

The product page already embeds, as JSON, everything its own JavaScript uses to build the option
dropdowns. The scraper reads that JSON instead of driving the UI:

```
GET /{slug(Parent Item)}         product page — the CSV Parent Item is the site's parent SKU
  ├─ x-magento-init  spConfig        attributes, valid child SKUs, price per child
  │                  ironsetOptions  fitting upcharges, iron-set club selection
  ├─ ld+json                         name, SKU, listed price, availability
  └─ tabs                            description, specs table, videos
GET /gallery/{Parent Item}.json  image list
```

- **Exact matching.** A page is accepted only if its ld+json SKU equals the CSV `Parent Item`. If
  the slug misses, the model page is found through the sitemap (no site search: `robots.txt`
  disallows it, and it was the slowest endpoint).
- **Conditional options are read, not inferred.** `spConfig` lists only the child SKUs that exist.
  The driver `ZXI RKT MAX DVR` has 2×3×7×83 = 3,486 combinations on paper and **660 valid** ones;
  "which shafts exist for a left-handed 9°" is a filter over that list.
- **Iron sets are priced per club**, following the site's own `ironset-options.js`:
  `total = (variant.price + Σ upcharges) × clubCount`. `PRO S4 STS`: $215 × 7 clubs = $1,505, the
  listed price.
- **Polite by default.** 8 concurrent pipelines (no 429 seen), no cookies, backoff with jitter on
  429/5xx/timeouts, `Retry-After` honoured, 404 never retried, raw responses cached.

**Trade-off vs. a headless browser.** A browser reads the same JSON, plus hundreds of tracker
sub-requests per page, and clicking through options would need one UI state per configuration. The
cost of this approach is coupling to Magento's front-end JSON contract; that contract is what the
site's own JavaScript depends on, so it is more stable than CSS selectors, and the fixture tests
fail as soon as it changes.

## Runtime: how it was measured

`performance.now()` around each network request (connect to full body) and each product's
parse/build. Percentiles are nearest-rank; everything is printed at the end and stored in
`output.json → metadata`. Network wait is almost all of the runtime: parsing is p50 ~11 ms per
product, under 5% of the total. Run-by-run numbers: [docs/approach.md](docs/approach.md#runtime).

**Where it could improve:** higher concurrency (the HTML is `no-store`, so time is origin wait;
kept at 8 on purpose), fetching the gallery in parallel with the page, skipping the gallery when
the ld+json image is enough, and, in production, re-fetching only products that changed.

## Data model

One record per product: identity, `attributes` (site display order), `variants` as a
`{fields, rows}` matrix (one row per valid child SKU; attribute cells index into
`attributes[i].options`, which keeps 444k configurations at 47 MB instead of 214 MB),
`customizations` (upcharge groups with `priceDelta`), `pricing` (`per_variant` or `per_club`, club
selection), `specs`, `media`, `meta` (how and when the page was fetched).
Full example and field notes: [docs/data-model.md](docs/data-model.md).

## What is not captured

- **16 unmatched** (`unmatched.csv`): 14 SKUs only exist as archived model pages, 1 is a 404, 1
  redirects to a page with used units only.
- **5 out-of-stock** products publish price 0 and no configurations: kept with `listedPrice: null`
  and no variants (no $0 configuration is invented).
- **Used inventory** (individual items with condition grades) is out of scope: the CSV lists new models.
- **Stock levels**: the page has lead time per configuration, not quantities.
- **Upcharge dependencies**: customization groups are stored per product. Whether a given grip or
  adjustment is restricted to some configurations was not modelled.
- **Specs** are empty for 139 products (mostly bags, GPS and accessories): their pages publish none.
- **Reviews** (third-party Yotpo widget) were not collected; one extra request per product.

## Production

Short version: a container job per CSV upload; the CSV is diffed against the catalog, new SKUs
are queued first; rows are `UPSERT`ed by the site's immutable ids (`parent_item`, `child_id`),
never by labels; price/variant changes are written as history events; per-run metrics (success
rate, unmatched by reason, 406/429, variant count drops) drive alerts. Details:
[docs/production.md](docs/production.md).

## More

- [docs/approach.md](docs/approach.md): URL resolution, unmatched cases, runs, robustness to layout changes
- [docs/data-model.md](docs/data-model.md): full record example, matrix, pricing rule
- [docs/testing.md](docs/testing.md): what the tests cover and how fixtures were captured
- [docs/production.md](docs/production.md): run/monitor/maintain and the daily CSV pipeline
