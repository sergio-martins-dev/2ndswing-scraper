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
| `archive_page_or_discontinued` | 14 | The SKU only exists as an archived model page with no active product |
| `not_found` | 1 | `AIRBREAK PMT`: 404 at the slug, absent from the model sitemaps |
| `redirected_to_model_page` | 1 | `STAFF MOD TG NEW WGS`: redirects to a model page that lists used units only |

Each row of `unmatched.csv` lists the URLs tried, so they can be checked by hand.

## Runtime

| Run | Wall time | Requests | Retries | Network p50 / p95 | Result |
|---|---|---|---|---|---|
| Live #1 | 484 s | 1,884 (+40 cached) | 1 | 1.9 s / 4.4 s | 944 ok / 16 unmatched / 0 failed |
| Live #2 (`--refresh`) | 401 s | 1,923 | 0 | 1.3 s / 3.8 s | 944 ok / 16 unmatched / 0 failed |
| From cache | ~23 s | 0 | 0 | — | identical output |

Both live runs produced the same products and unmatched list; the difference is origin latency
and the proxy exit node. `data/output.json → metadata` holds the numbers of the run that wrote it.

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
