import type { Product } from '../schema.ts';
import { priceAmount, type IronsetConfig, type ParsedPage } from './magento-init.ts';

export type Customization = Product['customizations'][number];
export type ClubSelection = NonNullable<Product['pricing']['clubSelection']>;
export type Pricing = Product['pricing'];

/**
 * Reads the fitting options (grips, length/lie/loft, ferrule, ...) and the pricing model
 * (see configurationPrice in pricing.ts). `per_club_price` in the JSON is a price string, not a
 * flag, so it is ignored: the site reprices every upcharge per checked club for iron sets.
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
        priceDelta: priceAmount(o.prices),
        isDefault: Boolean(o.is_default),
      })),
    });
  }

  const defaultClubs = clubSelection
    ? clubSelection.options.filter((o) => o.includedByDefault).length
    : (ironset?.clubInformation?.included_clubs ?? []).filter(Boolean).length;

  return {
    customizations,
    pricing: {
      model: perClub ? 'per_club' : 'per_variant',
      defaultClubCount: perClub ? defaultClubs || Number(ironset?.clubInformation?.total_included_clubs ?? 1) : 1,
      clubSelection,
    },
  };
}
