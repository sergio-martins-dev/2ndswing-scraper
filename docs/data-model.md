# Data model

`output.json` = `{ metadata, products[] }`. The schema is `src/schema.ts` (zod); every product is
validated before it is written. `data/sample/` shows three real records and their expanded
`variants.csv`.

## One product (abridged)

```jsonc
{
  "parentItem": "ZXI RKT MAX DVR",
  "name": "Srixon ZXi RKT MAX Driver", "brand": "Srixon", "category": "Driver",
  "url": "https://www.2ndswing.com/golf-clubs/drivers/srixon-zxi-rkt-max-driver/zxi-rkt-max-dvr",
  "productId": "9239929", "listedPrice": 649.99, "currency": "USD", "availability": "InStock",
  "description": "...",
  "specs": [{ "Loft": "9°", "Length": "45.75\"", "Lie": "59°", "Head Volume": "460cc" }, ...],
  "attributes": [                                   // site display order
    { "code": "g2_dexterity",  "label": "Dexterity",   "options": [{ "id": "32795", "label": "Right Handed" }, { "id": "32789", "label": "Left Handed" }] },
    { "code": "g2_club_loft",  "label": "Club Loft",   "options": [...] },
    { "code": "g2_shaft_flex", "label": "Shaft Flex",  "options": [...] },
    { "code": "g2_shaft_type", "label": "Shaft Model", "options": [...] }   // 83 shafts
  ],
  "variants": {                                     // every valid configuration
    "fields": ["childId", "sku", "price", "regularPrice", "leadTimeDays",
               "g2_dexterity", "g2_club_loft", "g2_shaft_flex", "g2_shaft_type"],
    "rows": [["9279969", "C4613261", 849.99, null, 21, 1, 1, 1, 64], ...]   // 660 rows
  },
  "customizations": [                               // upcharges on top of a configuration
    { "groupId": "...", "label": "Grips", "kind": "grip", "inputType": "select", "optionType": "grips",
      "options": [{ "id": "622724080", "name": "Golf Pride CP2 Pro Jumbo", "priceDelta": 9.99, "isDefault": false }, ...] }
  ],
  "pricing": { "model": "per_variant", "defaultClubCount": 1, "clubSelection": null },
  "media": { "images": ["https://www.2ndswing.com/images/standard/ZXI%20RKT%20MAX%20DVR.jpg", ...],
             "videos": ["https://www.youtube.com/watch?v=ThtESvbOyBI"] },
  "meta": { "resolvedVia": "root_slug", "fetchedAt": "..." }
}
```

## Variants: why a matrix

Each row is one purchasable child product: `childId` (Magento entity id), `sku` (internal SKU,
e.g. `C4613261`), `price`, `regularPrice` (only when a higher "was" price is shown),
`leadTimeDays`, then one cell per attribute holding the **index** of the option in
`attributes[i].options` (`null` if the child has no value for it).

The row above decodes to Left Handed / 10.5° / Stiff / Fujikura Ventus TR Black VeloCore 6,
$849.99, 21 days lead time. `--variants-csv` writes that decoded form, one line per configuration.

444,686 configurations are 214 MB as one JSON object each and 47 MB as a matrix, with nothing lost.

## Conditional options

Magento's `spConfig` ships only the child SKUs that exist: `index` maps each child to its option
ids, `optionPrices` gives its price, `leadtimes` its lead time. Nothing is inferred:

- `ZXI RKT MAX DVR`: 2 hands × 3 lofts × 7 flexes × 83 shafts = 3,486 combinations, **660 valid**,
  7 price points set by the shaft model.
- `VZN1 I CUSTOM PUT`: 26,400 valid configurations, 5 price points.

Customization groups (grips, lie/loft/length adjustments, ferrules…) are stored per product with
their price delta. Whether some of their options are restricted to certain configurations was
not modelled.

## Pricing

From the site's `SecondSwing_Ironset/js/ironset-options.js` (implemented in `src/pricing.ts`):

```
per_variant:  total =  variant.price + Σ selected priceDelta
per_club:     total = (variant.price + Σ selected priceDelta) × clubCount
```

- Iron sets (103 products) are `per_club`. `PRO S4 STS`: $215 per club × 7 default clubs (4–PW) =
  **$1,505**, the listed price. The ICON ferrule (+$2.50) costs $17.50 for the set.
- The "Irons In Set" checkbox group sets `clubCount`. It is kept in `pricing.clubSelection`, not in
  `customizations`, so it is never added as an upcharge on top of the multiplier.
- `metadata.priceCheck` re-checks the rule on every run: listed price = cheapest configuration
  with the default clubs.

Simple products (GPS, bags…) have no `spConfig`: one variant priced from ld+json, or none when the
page publishes price 0 (out of stock).

## Labels

Labels are stored as the site writes them. Customization groups also get a normalized `kind`:
the site uses 47 spellings for 20 groups (`Install Grips / Grip Size`, `InstallGrip/GripSize`,
`Grip Install` → `grip_install`; `Lie Angle`, `LieAngle`, `Lie Adjustment` → `lie`). Known synonyms
are listed in `src/parsers/customizations.ts`; any other label falls back to snake_case. Attribute
codes (`g2_shaft_flex`…) are already canonical.
