/**
 * Reproduces 2ndswing.com's URL-key generator, inferred from canonical URLs and the sitemap:
 *   "L.A.B. Golf VZN.1i" -> "ldotadotbdot-golf-vzndot1i"
 *   "Eclipse E-3.5"      -> "eclipse-e-3dot5"
 *   "RIP+"               -> "ripplus"
 *   '66"'                -> "66in"
 * Symbols are spelled out before the generic "non-alphanumeric run -> hyphen" step.
 */
export function siteSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\./g, 'dot')
    .replace(/\+/g, 'plus')
    .replace(/"/g, 'in')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
