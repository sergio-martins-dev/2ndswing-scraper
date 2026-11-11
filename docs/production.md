# Production outline

Design only; none of this is implemented in the repo.

## Run, monitor, maintain

- **Run:** one container job per CSV upload (Cloud Run Job, ECS task…). The proxy URL comes from a
  secret manager. Raw responses go to object storage so any run can be re-parsed without re-crawling.
- **Per-run metrics:** success rate, unmatched by reason, `priceCheck` mismatches, p95 latency,
  406/429 count, retries, share of club products without attributes (layout-drift signal),
  variant count per product vs. the previous run.
- **Alerts:** success rate under a threshold; any 406 (proxy or geo problem); a 429 spike (lower
  concurrency); a product whose variant count drops to 0 after having many (more likely a parser
  break than a catalog change).
- **Maintenance:** when the site changes, save the new page as a fixture, fix the parser, re-run
  from stored raw pages.

## Daily CSV pipeline

```
CSV upload ─► diff vs. catalog ─► queue ─► workers (this scraper, stateless)
                                             ├─ raw page    -> object storage
                                             └─ product     -> PostgreSQL UPSERT -> change events
```

1. **New and changed rows.** Diff the CSV against the catalog by `parent_item`. New SKUs go first;
   existing ones are refreshed; rows that disappear are marked inactive, not deleted. Unmatched
   rows are re-checked every day without the response cache (a discontinued product can come
   back), and an unmatched → scraped transition is recorded as an event. A queue
   (Cloud Tasks, SQS) gives per-item retries and a dead-letter queue.
2. **Identity by the site's ids, never by labels.** `products` keyed by `parent_item`, `variants`
   by `child_id`. Writes are UPSERTs, so a renamed option or a new price updates the existing row
   instead of creating a new variant.
3. **History.** Hash each variant (price, options) and each product's customization set; on change
   write an event (`PRICE_CHANGED`, `VARIANT_ADDED`, `VARIANT_REMOVED`) with old and new values.
   Unchanged products only update `last_seen_at`, so history grows with changes, not with days.
4. **Drift.** Unknown attribute codes, new customization groups or new availability values are
   stored raw and flagged for review instead of being dropped; large price moves (e.g. >20% in a
   day) are reviewed before publishing.
5. **Failures.** Item failures retry with backoff, then go to the dead-letter queue with the raw
   response. Run-level failures (406 everywhere, success rate collapsing) stop the run instead of
   publishing a half-empty catalog.
6. **Scale.** Workers are stateless HTTP, so throughput grows with workers and is bounded by
   politeness to the site, not by memory or CPU.
