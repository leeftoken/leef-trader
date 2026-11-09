import { isLeefToken, isWaxToken } from "./amm";
import { isTrustedStable } from "@/lib/market/stables";

/**
 * Pools that must never be priced, routed or listed as tradable: broken /
 * near-empty SAT pools whose quoted price is meaningless (13238 holds ~0
 * liquidity, 13234 is dust). Dropped at parse time, so nothing downstream
 * can pick them up.
 */
export const BROKEN_POOL_IDS: ReadonlySet<number> = new Set([13238, 13234]);
export const isBrokenPool = (id: unknown): boolean => BROKEN_POOL_IDS.has(Number(id));

/**
 * Tokens whose pools get the reserve-based TVL estimate. Scoped to our own
 * SAT token on purpose: Alcor's $0 for random unpriced tokens is usually a
 * good dust signal, so widening this is a separate decision.
 */
export const ESTIMATE_TVL_TOKENS: ReadonlySet<string> = new Set(["SAT@sattoken1111"]);
export const wantsTvlEstimate = (a: Side, b: Side): boolean =>
  [a, b].some((t) => ESTIMATE_TVL_TOKENS.has(`${String(t.symbol ?? "").toUpperCase()}@${t.contract ?? ""}`));

type Side = { symbol?: string; contract?: string; quantity?: number };

/**
 * USD value of the one side of a pool we can price WITHOUT trusting that
 * pool's own quote: WAX (live WAX/USD), a trusted stable ($1), or LEEF (priced
 * from the deep main WAX/LEEF pool). 0 when neither side qualifies.
 */
export function trustedSideUsd(a: Side, b: Side, waxUsd: number, leefUsd = 0): number {
  const val = (t: Side): number => {
    const q = Number(t.quantity) || 0;
    if (!(q > 0) || !t.contract || !t.symbol) return 0;
    if (isWaxToken(t)) return waxUsd > 0 ? q * waxUsd : 0;
    if (isTrustedStable(String(t.symbol).toUpperCase(), String(t.contract))) return q;
    if (isLeefToken(t)) return leefUsd > 0 ? q * leefUsd : 0;
    return 0;
  };
  return val(a) || val(b);
}

/**
 * Alcor reports tvlUSD = 0 for pools it cannot price (e.g. every SAT pair),
 * which made them fall under the $5 dust filters. When Alcor has no figure,
 * estimate it from the reserves as 2 × the trusted side (same idea as the SAT
 * site). An Alcor figure > 0 is always kept as-is.
 */
export function reserveTvlUsd(
  alcorTvlUsd: number,
  a: Side,
  b: Side,
  waxUsd: number,
  leefUsd = 0,
): { usd: number; estimated: boolean } {
  if (alcorTvlUsd > 0 || !wantsTvlEstimate(a, b)) return { usd: Math.max(0, alcorTvlUsd), estimated: false };
  const side = trustedSideUsd(a, b, waxUsd, leefUsd);
  return side > 0 ? { usd: 2 * side, estimated: true } : { usd: 0, estimated: false };
}
