# 2nd Swing product scraper

Single-run scraper for the 960 products listed in `data/input.csv`. For each product it captures
details, every valid configuration with its price, the fitting/customization upcharges, specs and
media from [2ndswing.com](https://www.2ndswing.com) — **without a headless browser**.

| Result (full run) | |
|---|---|
| Products scraped | **944 / 960** (98.3%), 0 failures, 16 classified as unmatched |
| Valid purchasable configurations | **444,686** child SKUs, each with its exact price |
| Live runs (network) | **6.7–8.1 min** across two runs (401 s and 484 s), ~1,920 requests, 0–1 retries, p50 1.3–1.9 s / p95 3.8–4.4 s per request |
| Warm run (disk cache) | **~23 s**, 0 network requests |
| Parse cost | p50 **10–12 ms** CPU per product |
| Price check | listed price = cheapest valid configuration for **939 / 939** priced products (the 5 out-of-stock items have no price) |

---

## 1. How to run

Requirements: Node.js **>= 20.12**.

```bash
npm install
npm start                       # all 960 products -> data/
npm test                        # 91 offline tests against real captured pages
```

| Option | Effect |
|---|---|
| `--limit 20` / `--only "PRO S4 STS"` | Run a subset (`--only` can repeat). Written to `data/partial/`, so the full-run outputs are never overwritten |
| `--concurrency 8` | Parallel product pipelines (default 8) |
| `--refresh` | Live run: ignore cached responses but write the fresh ones (use this for a demo) |
| `--no-cache` | Live run without reading or writing the cache |
| `--variants-csv` | Also write `data/variants.csv`, one row per configuration (~146 MB) |
| `--input path.csv` | Input CSV (default `data/input.csv`; needs the `Parent Item`, `Name`, `Brand`, `Category`, `Model`, `Year Release` columns) |
| `--out dir` | Output directory (default `data/`, or `data/partial/` for `--limit`/`--only`) |

**Geo-block.** 2ndswing.com's CDN (Fastly) answers **HTTP 406 with an empty body** to non-US IPs.
Running from the US needs nothing extra. From elsewhere, set a US proxy (`http(s)://` or `socks5://`):

```bash
PROXY_URL='socks5://user:pass@host:1080' npm start      # or put PROXY_URL in .env (see .env.example)
```

A 406 stops the run immediately with an explicit message instead of producing 960 failures.
Invalid options (`--limit 0`, unknown flags…) print the usage and exit with code 2.

**Cache.** Every 200/404 response is stored in `.cache/{sha1(url)}.json`. Re-runs reuse it, so the
parser can be changed and re-run without touching the site. A fresh clone has no cache, so its
first run is live.

### Outputs (`data/`)

| File | Content |
|---|---|
| `output.json` | Full model, including run metadata (47.5 MB) |
| `output.json.gz` | Same file compressed (5.4 MB) |
| `products.csv` | One row per product: price range, variant count, option groups, media counts |
| `unmatched.csv` | Every CSV row that did not produce a product, with the reason and the URLs tried |
| `variants.csv` | Optional (`--variants-csv`): one row per valid configuration |

---

## 2. Approach and trade-offs: direct HTTP vs. a headless browser

The product page already ships everything the front-end needs as JSON. The site's own JavaScript
reads it to build the option dropdowns, so the scraper reads the same data:

```
CSV row (Parent Item)
  └─ GET /{siteSlug(parentItem)}               product page (Magento resolves the URL key at the root)
       ├─ <script type="text/x-magento-init">  spConfig        -> attributes, valid child SKUs, prices
       │                                       ironsetOptions  -> fitting upcharges, iron-set club rules
       ├─ <script type="application/ld+json">  name, SKU, listed price, availability, canonical URL
       └─ #details / #specs / #video tabs      description, spec table, YouTube videos
  └─ GET /gallery/{parentItem}.json            image list
```

That is **2 requests per product**. Main decisions:

- **No site search.** `robots.txt` disallows `/catalogsearch/`, and search was the slowest endpoint
  (4.5 s at origin). The CSV `Parent Item` is the site's parent SKU, and its slug resolves directly:
  `TRTL MAX S2S PUT` → `/trtl-max-s2s-put`. The slug rule (`.`→`dot`, `+`→`plus`, `"`→`in`)
  was reverse-engineered from canonical URLs and reproduces all observed cases. A page is accepted
  only if its ld+json SKU equals the CSV `Parent Item`.
- **Fallback without search.** If the root slug fails, the model landing page is looked up in the
  sitemap (`sitemap-product-models.xml`, `sitemap-pmp-archive.xml`, loaded lazily on the first miss
  only) and the product link is followed. The same SKU check applies.
- **Polite by default.** 8 concurrent pipelines (zero 429s observed), no cookies or sessions,
  exponential backoff with jitter on 429/5xx/timeouts, `Retry-After` honoured, 404 never retried.
- **Plain `undici`, no TLS impersonation.** Testing showed the site checks geography, not TLS fingerprints.

**Trade-offs in short**
- **Pros:** no browser; low CPU and memory; easy to run in parallel; no UI flakiness (timeouts, popups, lazy-rendered dropdowns).
- **Cons:** tied to Magento's front-end JSON contract (`spConfig`, `ironsetOptions`). A platform migration or a change to that contract means updating the parsers. That contract is still more stable than CSS selectors, and the fixture tests catch a change immediately.

**Why not Puppeteer/Playwright.** A headless browser would get the same JSON, but at a much higher
cost. The following is an **estimate, not a measurement**:
- Loading one product page in a browser triggers hundreds of sub-requests (a recorded session made
  642, most of them trackers).
- Discovering conditional options by clicking means one UI state per valid configuration. Even at
  an optimistic 0.2 s per selection change, 444,686 configurations come to about 25 browser-hours.
  Sampling instead of enumerating would trade that time for incomplete data.

The HTTP pipeline gets the complete list in 6.7–8.1 minutes with one Node process. Network wait is
almost all of the runtime; parsing adds up to ~4% of it (10–12 ms per product).

### How runtime was measured

`performance.now()` around every network request (connect, response and body) and around each
product's parse/build step. Percentiles are nearest-rank. Results are printed at the end of the run
and stored in `output.json → metadata`. When a run is served entirely from the cache, `metadata`
keeps the numbers of the last network run and reports the cached run under `metadata.cachedRun`.

| Run | Wall time | Requests | Retries | Network p50 / p95 | Result |
|---|---|---|---|---|---|
| Live #1 | 484 s | 1,884 (+40 cached) | 1 | 1.9 s / 4.4 s | 944 ok / 16 unmatched / 0 failed |
| Live #2 (`--refresh`) | 401 s | 1,923 | 0 | 1.3 s / 3.8 s | 944 ok / 16 unmatched / 0 failed |
| From cache | ~23 s | 0 | 0 | — | identical output |

Both live runs produced the same products and the same unmatched list. The time difference comes
from origin latency and the proxy exit node, not the code.

### Where performance could improve further

1. **Concurrency** is the main lever, because almost all of the time is spent waiting on origin (the HTML
   is `no-store`, never served from the CDN cache). It was kept at 8 on purpose; the site tolerated
   it with zero 429s.
2. **Skip `/gallery/*.json`** (half of all requests) when the ld+json image is enough. It is cheap
   (~0.1 s) but doubles the request count.
3. **Incremental runs**: in production, re-fetch only products whose page changed (see §5).
4. HTTP/2 multiplexing (`allowH2`) and a streaming HTML parser are possible but would gain little,
   since parsing is ~4% of the runtime.

---

## 3. Data model and conditional option discovery

Each product in `output.json` (abridged):

```jsonc
{
  "parentItem": "ZXI RKT MAX DVR",
  "url": "https://www.2ndswing.com/golf-clubs/drivers/srixon-zxi-rkt-max-driver/zxi-rkt-max-dvr",
  "listedPrice": 649.99, "availability": "InStock",
  "attributes": [                                   // site's display order
    { "code": "g2_dexterity",  "label": "Dexterity",   "options": [{ "id": "32795", "label": "Right Handed" }, { "id": "32789", "label": "Left Handed" }] },
    { "code": "g2_club_loft",  "label": "Club Loft",   "options": [...] },
    { "code": "g2_shaft_flex", "label": "Shaft Flex",  "options": [...] },
    { "code": "g2_shaft_type", "label": "Shaft Model", "options": [...] }  // 83 shafts
  ],
  "variants": {                                     // every valid configuration
    "fields": ["childId", "sku", "price", "regularPrice", "leadTimeDays",
               "g2_dexterity", "g2_club_loft", "g2_shaft_flex", "g2_shaft_type"],
    "rows": [["9279969", "C4613261", 849.99, null, 21, 1, 1, 1, 64], ...]  // 660 rows; attribute cells = option index
  },
  "customizations": [                               // upcharges on top of the configuration
    { "label": "Grips", "options": [{ "name": "Golf Pride MCC Plus 4 Blue Standard", "priceDelta": 11.99, "isDefault": false }, ...] },
    { "label": "Length Adjustment", "options": [...] }
  ],
  "pricing": { "model": "per_variant", "formula": "total = variant.price + sum(selected customization priceDelta)", ... },
  "specs": [{ "Loft": "9°", "Length": "45.75\"", "Lie": "59°", "Head Volume": "460cc", "Swing Weight": "D3", "Hand": "RH Only" }, ...],
  "media": { "images": ["https://www.2ndswing.com/images/standard/ZXI%20RKT%20MAX%20DVR.jpg", ...],
             "videos": ["https://www.youtube.com/watch?v=ThtESvbOyBI"] },
  "meta": { "resolvedVia": "root_slug", "fetchedAt": "...", "httpMs": ..., "parseMs": ..., "fromCache": false }
}
```

**Conditional options are read, not inferred.** Magento's configurable-product JSON (`spConfig`)
lists only the child SKUs that actually exist: `index` maps each child to its attribute combination,
`optionPrices` gives its price, and `leadtimes` its lead time. For example:
- **`ZXI RKT MAX DVR`:** 2 hands × 3 lofts × 7 flexes × 83 shafts = 3,486 theoretical combinations,
  of which exactly **660 are valid**. There are 7 price points, set by the shaft model.
- **`VZN1 I CUSTOM PUT`:** 26,400 valid configurations, 5 price points.

"Which shafts are available for a left-handed 9° driver?" is a filter over `variants.rows`. No
dependency rules are guessed, so none can be wrong.

**Why a matrix.** The site has 444,686 valid configurations. As one JSON object per configuration
the file was 214 MB; as `{fields, rows}` with option indexes it is **47.5 MB** (5.4 MB gzipped)
with nothing lost. A test round-trips the matrix back to the full objects.

**Iron sets are priced per club.** The pricing rule comes from the site's own
`SecondSwing_Ironset/js/ironset-options.js`:

```
total = (variant.price + Σ selected upcharges) × clubCount     // pricing.model = "per_club"
total =  variant.price + Σ selected upcharges                  // everything else
```

- `PRO S4 STS`: $215.00 per club × 7 default clubs (4-PW) = **$1,505.00**, which is the listed price.
- The ICON ferrule (+$2.50) therefore costs $17.50 for the full set.
- The "Irons In Set" checkbox group decides the club count. It is stored as `pricing.clubSelection`,
  **separate from `customizations`**, so it is never added as an upcharge on top of the multiplier.

Simple products (GPS, bags, carts…) have no `spConfig` and are stored as a single configuration.

---

## 4. Results and what could not be captured reliably

| Outcome | Count | Notes |
|---|---|---|
| Scraped | 944 | 841 priced per configuration, 103 iron sets priced per club |
| `archive_page_or_discontinued` | 14 | The SKU only exists as an archived model page with no active product (bags, simulators, launch monitors, one putter, one single iron) |
| `not_found` | 1 | `AIRBREAK PMT`: 404 at the product slug and absent from the model sitemaps |
| `redirected_to_model_page` | 1 | `STAFF MOD TG NEW WGS`: the product URL redirects to its model page, which lists only used units |
| Failed | 0 | |

Known limitations:

- **5 products are out of stock** (`2026 HL MAX D WGS`, `2026 HL MAX D FWG`, `G740 LIS`,
  `STACK RADAR ACC`, `SRIXON UL NEW BAG`). Their pages publish price `0` and no configuration
  matrix. They are kept with `availability: "OutOfStock"`, `listedPrice: null` and no variants;
  no $0 configuration is invented.
- **Used inventory is out of scope.** The CSV is a catalog of new models (`EOL = No` for all rows,
  131 SKUs carry a `NEW` token). Used clubs on 2nd Swing are individual physical items with their
  own SKU, photos and condition grade, listed separately from the new-product configurator.
- **Stock levels are not available.** `leadTimeDays` (typically 21 days or 1 day) is exposed per
  configuration, but the page reports no per-configuration stock (`salable` is always empty).
  Availability comes from ld+json at the product level.
- **Labels are stored as the site writes them**, including inconsistencies such as
  `InstallGrip/GripSize` vs `Install Grips / Grip Size`. They are not normalized.
- **Reviews are not collected.** They come from a third-party widget (Yotpo) keyed by the same
  `productId`. They could be added with one extra request per product.
- Descriptions include the store's standard "Get Fit" paragraph.

### Robustness to site changes

| Data | Source | If the layout changes |
|---|---|---|
| Configurations, prices, upcharges | `x-magento-init` JSON, the contract the site's own JS depends on | Independent of HTML/CSS layout |
| Name, SKU, price, availability | schema.org ld+json (used for Google Shopping) | Very stable |
| Group labels, description, specs, videos | HTML selectors | Degrades gracefully: label falls back to the group id, fields become empty, schema validation still passes |

The real risk is silent: if `spConfig` disappeared from configurable products, they would look
like simple products. In production that is a monitored metric (§5).

### Testing

`npm test` runs 91 tests offline against real pages captured from the site (`test/fixtures/`):
- slug rule;
- CSV parsing;
- HTTP retry, timeout, cache and 406 handling against a local server;
- variant counts (driver 660, putter 18);
- iron-set pricing ($1,505, ferrule ×7, 6-club set);
- `rowspan` spec tables;
- out-of-stock handling;
- resolver fallbacks, including a real archived model page;
- pipeline behaviour: CSV order kept, per-product error isolation, gallery fallback, a geo-block draining the queue instead of retrying every product;
- CLI validation and `Retry-After` handling (capped at 60 s);
- writers: JSON/gzip, CSV quoting, the flat variants export and the metadata carry-over.

---

## 5. Running it in production, and the daily CSV pipeline

### Run, monitor, maintain

- **Run:** one container job (e.g. Cloud Run Job, or ECS task) triggered by the CSV upload; the
  proxy URL comes from a secret manager.
- **Health metrics per run:** success rate, `unmatched` by reason, p95 latency, 406/429 rate,
  retries, share of club categories without `spConfig` (layout-drift signal), variants per product
  compared with the previous run.
- **Alerts:** success rate below a threshold, any 406 (proxy or geo problem), 429 spike (lower
  concurrency automatically), or a product's variant count dropping to 0 when it had many
  yesterday (more likely a parser break than a real catalog change).
- **Maintenance:** the parser is covered by fixture tests. When the site changes, save the new page
  as a fixture, fix the parser, and re-run from the raw cache without re-crawling.

### Daily CSV: design outline (not implemented)

```
CSV upload ─► diff vs. catalog ─► queues ─► workers (this scraper, stateless HTTP)
                                   │            │
                     new: high priority     raw page -> object storage (replay/debug)
                     existing: regular      parsed product -> PostgreSQL (UPSERT)
                                                         -> change events -> review / alerts
```

1. **New products and deltas.** Parse the daily CSV and compare against the catalog table by
   `parent_item`. New SKUs go to a high-priority queue, existing ones to a regular refresh queue,
   and rows that disappeared are marked `inactive` (never deleted). Queues such as Cloud Tasks or SQS
   give per-task retries and a dead-letter queue.
2. **Identity by immutable ids, never by labels.** Tables are keyed by the site's ids: `products`
   by `parent_item` + `product_id`, `variants` by `child_id` (internal SKU, e.g. `C4652714`).
   Writes are `UPSERT`s on those keys. A changed label, spec or price therefore updates the existing
   row instead of creating a "new" variant. Joining on label strings is what duplicates rows when a
   vendor renames "Stiff" to "Stiff Flex".
3. **Change detection and history.** Store a hash of each variant's price and attributes and a hash
   of the customization set. On a mismatch, write an event row such as
   `variant_price_history(child_id, old_price, new_price, observed_at)` or a
   `VARIANT_ADDED` / `VARIANT_REMOVED` / `PRICE_CHANGED` event. Unchanged products only bump
   `last_seen_at`, so history grows with changes, not with days.
4. **Drift and review queue.** Unknown attribute codes, new customization groups or new
   availability values are not dropped. The raw payload is stored and the product is flagged
   `needs_review`. A lightweight async classifier could map new labels to the canonical schema;
   an LLM call with Zod-validated output is a cheap option. A person reviews only low-confidence
   mappings and large price moves (e.g. >20% day-over-day).
5. **Failures.** Product-level failures are retried with backoff, then land in the dead-letter
   queue with the raw response attached. Run-level failures (all 406, or success rate collapsing)
   stop the run and page someone, instead of writing a half-empty catalog.
6. **Scale.** Workers are stateless HTTP, so throughput scales with workers and is limited by
   politeness per site, not by memory. For sources that need login, a separate session service
   keeps cookies/tokens fresh in Redis and the scrapers only read them.

---

## Project layout

```
src/
  index.ts                 entry point, metrics summary
  cli.ts                   argument parsing and validation
  config.ts                base URL, concurrency, timeouts, headers
  lib/                     csv loader, slug rule, percentiles
  services/
    http.client.ts         undici + optional proxy, retry/backoff, disk cache
    resolver.ts            Parent Item -> product page (root slug, model-page fallback, SKU check)
    scraper.ts             bounded-concurrency pipeline, per-item error isolation
  parsers/
    magento-init.ts        x-magento-init JSON, ld+json, tabs (description, specs, videos)
    variants.ts            spConfig -> attributes + variant matrix
    customizations.ts      ironsetOptions -> upcharge groups + per-club pricing
  builders/product.ts      assembles the output record
  schema.ts                Zod schema (every product is validated before it is written)
  writers.ts               output.json(.gz), products.csv, unmatched.csv, variants.csv
test/                      node:test suites + real page fixtures
```
