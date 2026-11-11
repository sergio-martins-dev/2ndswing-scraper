# Approach notes

## URL resolution

The CSV `Parent Item` is the site's parent SKU (the ld+json `sku` of the product page), and Magento
resolves the product's URL key at the root: `TRTL MAX S2S PUT` → `/trtl-max-s2s-put`.

`siteSlug()` reproduces the site's URL-key rule, reverse-engineered from canonical URLs and the
sitemap: lowercase, `.`→`dot`, `+`→`plus`, `"`→`in`, other non-alphanumeric runs → `-`.

1. `GET /{siteSlug(parentItem)}`. Accepted only if the page's ld+json `sku` equals the `Parent Item`.
2. On a miss, the model sitemaps (`sitemap-product-models.xml`, `sitemap-pmp-archive.xml`) are
   loaded once and indexed by `siteSlug(Name)`. The model page is fetched and the link ending with
   the product slug is followed; the same SKU check applies.
3. Otherwise the row goes to `unmatched.csv` with a reason and every URL tried.

Site search is not used: `robots.txt` disallows `/catalogsearch/`, and it was the slowest endpoint
(~4.5 s at origin).

## Unmatched rows

| Reason | Count | Meaning |
|---|---|---|
| `discontinued` | 14 | Archived model page saying "This product is no longer available"; `detail` quotes it |
| `not_found` | 1 | `AIRBREAK PMT`: 404 at the slug, absent from the model sitemaps |
| `product_page_unavailable` | 1 | `STAFF MOD TG NEW WGS`: the model page shows it as NEW ("Starting at $999.99"), but its product link redirects back to the model page |

Each row of `unmatched.csv` has `check_url` (the URL that decided the outcome, to open by hand),
`retryable` (`true` only for network failures; the reasons above are the site's state and a re-run
gives the same answer) and `tried_urls` (every URL requested, in order).

## Runtime

| Run | Wall time | Requests | Retries | Network p50 / p95 | Result |
|---|---|---|---|---|---|
| Live #1 | 484 s | 1,884 (+40 cached) | 1 | 1.9 s / 4.4 s | 944 ok / 16 unmatched / 0 failed |
| Live #2 (`--refresh`) | 401 s | 1,923 | 0 | 1.3 s / 3.8 s | 944 ok / 16 unmatched / 0 failed |
| Live #3, final code (`--refresh`) | 446 s | 1,931 | 8 | 1.1 s / 4.2 s | 944 ok / 16 unmatched / 0 failed |
| Live #4, final code (`--refresh`) | 394 s | 1,924 | 1 | 1.3 s / 3.8 s | 944 ok / 16 unmatched / 0 failed |
| Live #5, final code (`--refresh`) | 451 s | 1,925 | 2 | 1.7 s / 4.5 s | 944 ok / 16 unmatched / 0 failed — this is `data/output.json` |
| From cache | ~23 s | 0 | 0 | — | same products |

All live runs produced the same products and unmatched list; the time difference is origin latency
and the proxy exit node. `data/output.json → metadata` holds the numbers of run #5, the one that
wrote it (runs #1 and #2 used earlier code with the same request pattern).

Measured with `performance.now()`: per network request (connect to full body, cached responses
excluded) and per product parse/build (HTML parse + JSON extraction + build + schema validation).

## Robustness to site changes

| Data | Source | If the HTML layout changes |
|---|---|---|
| Configurations, prices, upcharges | `x-magento-init` JSON read by the site's own JS | Unaffected |
| Name, SKU, price, availability | schema.org ld+json | Unaffected |
| Group labels, description, specs, videos | HTML selectors | Degrade to empty / group id; the product is still valid |

The silent risk: if `spConfig` disappeared, configurable products would look like simple ones
(one variant at the listed price), and `priceCheck` would still pass for them. In production the
share of club products without attributes is therefore a monitored metric.
