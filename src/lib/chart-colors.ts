/** Categorical series colours, as theme variables (light/dark steps of the
 * same validated hues live in globals.css). Fixed order — assign by entity,
 * never by rank, and never generate a 9th hue: fold into "Other". */
export const CHART_CATEGORICAL = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export const CHART_GRID = "var(--border)";
export const CHART_AXIS = "var(--muted-foreground)";

export const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
  boxShadow: "var(--shadow-pop)",
} as const;

export function topNWithOther<T extends { value: number }>(items: T[], n = 7): (T | { name: string; value: number })[] {
  if (items.length <= n + 1) return items;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, n);
  const otherValue = sorted.slice(n).reduce((sum, i) => sum + i.value, 0);
  return [...top, { name: "Other", value: otherValue }];
}
