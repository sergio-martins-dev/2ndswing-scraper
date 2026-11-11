import { readFileSync } from 'node:fs';

/** Real product pages captured from 2ndswing.com (see README "Testing"). */
export const fixture = (slug: string): string => readFileSync(`test/fixtures/${slug}.html`, 'utf8');
