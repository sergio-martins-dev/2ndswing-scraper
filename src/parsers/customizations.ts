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
      kind: customizationKind(label),
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

/** Label spellings of the same group (key = label lowercased, letters only) -> canonical kind. */
const KIND_SYNONYMS: Record<string, string> = {
  grips: 'grip',
  gripmodel: 'grip',
  gripmodelinstallpriceincluded: 'grip',
  installgripsgripsize: 'grip_install',
  installgripgripsize: 'grip_install',
  instalgripgripsize: 'grip_install',
  gripinstall: 'grip_install',
  installoptions: 'grip_install',
  wraps: 'grip_install',
  lengthadjustment: 'length',
  loftadjustment: 'loft',
  lieangle: 'lie',
  lieangleadjustment: 'lie',
  lieadjustment: 'lie',
  headweight: 'head_weight',
  alignmentmarkback: 'alignment_back',
  alignmentmarkfront: 'alignment_front',
};

/**
 * Canonical, comparable name for a customization group. The site writes the same group many ways
 * ("Install Grips / Grip Size", "InstallGrip/GripSize", "Grip Install"); `label` keeps the original.
 * Unlisted labels fall back to snake_case ("Hosel Setting" / "HoselSetting" -> hosel_setting).
 */
export function customizationKind(label: string): string {
  const key = label.toLowerCase().replace(/[^a-z]/g, '');
  return (
    KIND_SYNONYMS[key] ??
    label
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}
