/** Growth vs a comparable earlier period, in %. Only when both values are
 * known and the earlier one is positive; otherwise there's no meaningful number. */
export function growth(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || !(prev > 0)) return null;
  return ((cur - prev) / prev) * 100;
}
