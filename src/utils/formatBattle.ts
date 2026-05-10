/** Compact display similar to in-game result totals (e.g. 12.47M). */
export function formatBattleTotal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const s = m >= 100 ? m.toFixed(0) : m.toFixed(2).replace(/\.?0+$/, "");
    return `${s}M`;
  }
  if (n >= 10_000) {
    const k = n / 1000;
    return `${k.toFixed(1)}K`;
  }
  return n.toLocaleString("en-US");
}

export function formatBattleInteger(n: number): string {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}
