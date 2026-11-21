/** Fractional ordering helpers: insert between neighbours without renumbering siblings. */

export const ORDER_STEP = 1024;

export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return ORDER_STEP;
  if (before === undefined) return (after as number) - ORDER_STEP;
  if (after === undefined) return before + ORDER_STEP;
  return (before + after) / 2;
}

/** True when two neighbours are so close that float precision would collapse further inserts. */
export function needsRebalance(before: number | undefined, after: number | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  return Math.abs(after - before) < 1e-6;
}

export function rebalanced(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * ORDER_STEP);
}
