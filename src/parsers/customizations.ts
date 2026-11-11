import type { IronsetConfig, MagentoPrices, ParsedPage } from './magento-init.ts';

export type Customization = {
  groupId: string;
  label: string;
  inputType: 'select' | 'checkbox';
  optionType: string;
  options: { id: string; name: string; priceDelta: number; isDefault: boolean }[];
};

/**
 * Iron sets are priced per club. The "Irons In Set" checkbox group is NOT an upcharge: it decides
 * how many clubs are bought (the multiplier), so it lives here and never in `customizations`.
 */
export type ClubSelection = {
  groupId: string;
  label: string;
  options: { id: string; name: string; includedByDefault: boolean }[];
};

export type Pricing = {
  model: 'per_variant' | 'per_club';
  defaultClubs: string[];
  defaultClubCount: number;
  clubSelection: ClubSelection | null;
  formula: string;
};

const FORMULA = {
  per_variant: 'total = variant.price + sum(selected customization priceDelta)',
  per_club: 'total = (variant.price + sum(selected customization priceDelta)) * clubCount',
} as const;

/**
 * Reads the fitting options (grips, length/lie/loft, ferrule, ...) and the pricing rule.
 * Rule source: the site's own SecondSwing_Ironset/js/ironset-options.js — for iron sets every
 * selected upcharge is repriced as `base_amount * checkedClubs`, and each checked club adds the
 * variant's per-club price. `per_club_price` in the JSON is a price string, not a flag, so it is ignored.
 */
export function parseCustomizations(page: Pick<ParsedPage, 'ironset' | 'optionLabels' | 'optionInputTypes'>): {
  customizations: Customization[];
  pricing: Pricing;
} {
  const ironset: IronsetConfig | null = page.ironset;
  const perClub = Boolean(Number(ironset?.isIronsetProduct ?? 0));
  const customizations: Customization[] = [];
  let clubSelection: ClubSelection | null = null;

  for (const [groupId, values] of Object.entries(ironset?.optionConfig ?? {})) {
    const entries = Object.entries(values);
    if (entries.length === 0) continue;
    const label = page.optionLabels[groupId] ?? groupId;

    if (entries.some(([, o]) => o.option_type === 'clubs')) {
      clubSelection = {
        groupId,
        label,
        options: entries.map(([id, o]) => ({ id, name: o.name.trim(), includedByDefault: Boolean(o.is_default) })),
      };
      continue;
    }

    customizations.push({
      groupId,
      label,
      inputType: page.optionInputTypes[groupId] ?? 'select',
      optionType: entries[0]![1].option_type,
      options: entries.map(([id, o]) => ({
        id,
        name: o.name.trim(),
        priceDelta: finalAmount(o.prices),
        isDefault: Boolean(o.is_default),
      })),
    });
  }

  const defaultClubs = perClub
    ? clubSelection?.options.filter((o) => o.includedByDefault).map((o) => o.name) ??
      (ironset?.clubInformation?.included_clubs ?? []).filter(Boolean)
    : [];
  const model = perClub ? 'per_club' : 'per_variant';

  return {
    customizations,
    pricing: {
      model,
      defaultClubs,
      defaultClubCount: perClub ? defaultClubs.length || Number(ironset?.clubInformation?.total_included_clubs ?? 1) : 1,
      clubSelection,
      formula: FORMULA[model],
    },
  };
}

/** Price of one concrete configuration, following the site's rule. */
export function configurationPrice(
  variantPrice: number,
  selectedDeltas: number[],
  pricing: Pick<Pricing, 'model' | 'defaultClubCount'>,
  clubCount = pricing.defaultClubCount,
): number {
  const unit = variantPrice + selectedDeltas.reduce((sum, d) => sum + d, 0);
  const total = pricing.model === 'per_club' ? unit * clubCount : unit;
  return Math.round(total * 100) / 100;
}

function finalAmount(prices: MagentoPrices): number {
  const value = Number(prices.finalPrice?.amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
