export type Summary = { count: number; mean: number; p50: number; p95: number; max: number };

/** Nearest-rank percentile; returns 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]!;
}

export function summarize(values: number[]): Summary {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    count: values.length,
    mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    max: values.length ? round(Math.max(...values)) : 0,
  };
}
