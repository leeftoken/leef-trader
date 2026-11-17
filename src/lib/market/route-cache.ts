/**
 * Dependency-aware route invalidation.
 *
 * A route is only as fresh as the live pool graph it was computed against.
 * Alcor LEEF pools and auxiliary WAX/stable reference pools both participate:
 * state, price, fee, identity, and dependency-set changes invalidate a memo.
 */
import type { AuxPool, LeefPool, SwapRoute } from "@/lib/leef/types";

export type CachedRouteEntry = {
  /** Caller's identity for the computation (e.g. "swap:WAX>LEEF"). */
  key: string;
  /** Fingerprint of the computation inputs (amount, tokens, knobs). */
  inputsKey: string;
  /** The computed route list (full ranking, not just the best). */
  routes: SwapRoute[];
  poolIds: number[];
  /** Pool versions the routes were computed against. */
  poolVersions: Record<number, number>;
  createdAt: number;
};

export type TrackedRoutePool = LeefPool | AuxPool;

/** Fields that matter for executable route identity and pricing. */
export function poolFingerprint(pool: TrackedRoutePool): string {
  if ("leef" in pool) {
    return [
      "leef",
      pool.id,
      pool.fee,
      pool.leef.symbol,
      pool.leef.contract,
      pool.pair.symbol,
      pool.pair.contract,
      pool.sqrtPriceX64 ?? "0",
      pool.liquidity,
      pool.leef.quantity,
      pool.pair.quantity,
      pool.pairPerLeef,
    ].join("|");
  }
  return [
    "aux",
    pool.id,
    pool.venue ?? "alcor",
    pool.fee,
    pool.tokenA.symbol,
    pool.tokenA.contract,
    pool.tokenB.symbol,
    pool.tokenB.contract,
    pool.sqrtPriceX64 ?? "0",
    pool.liquidity ?? "0",
    pool.tokenA.quantity,
    pool.tokenB.quantity,
    pool.priceA ?? "0",
    pool.priceB ?? "0",
  ].join("|");
}

function normalizedPoolIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function samePoolSet(a: number[], b: number[]): boolean {
  const left = normalizedPoolIds(a);
  const right = normalizedPoolIds(b);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export class RouteCache {
  private versions = new Map<number, number>();
  private prints = new Map<number, string>();
  private entries = new Map<string, CachedRouteEntry>();

  versionOf(poolId: number): number {
    return this.versions.get(poolId) ?? 0;
  }

  /**
   * Compare incoming rows with the last fingerprint; bump versions of changed
   * pools and discard state for pools no longer in the live snapshot.
   * Callers must pass BOTH snapshot.pools and snapshot.aux.
   */
  notePools(pools: TrackedRoutePool[]): number[] {
    const activeIds = new Set(pools.map((pool) => pool.id));
    const removedIds = new Set<number>();

    for (const id of this.prints.keys()) {
      if (activeIds.has(id)) continue;
      this.prints.delete(id);
      this.versions.delete(id);
      removedIds.add(id);
    }

    if (removedIds.size > 0) {
      for (const [key, entry] of this.entries) {
        if (entry.poolIds.some((id) => removedIds.has(id))) this.entries.delete(key);
      }
    }

    const changed: number[] = [];
    for (const pool of pools) {
      const fp = poolFingerprint(pool);
      if (this.prints.get(pool.id) !== fp) {
        this.prints.set(pool.id, fp);
        this.versions.set(pool.id, (this.versions.get(pool.id) ?? 0) + 1);
        changed.push(pool.id);
      }
    }
    return changed;
  }

  /** Explicit invalidation (e.g. browser resume — nothing can be trusted). */
  invalidateAll(): void {
    for (const id of this.prints.keys()) {
      this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    }
    this.entries.clear();
  }

  bumpPool(poolId: number): void {
    this.versions.set(poolId, (this.versions.get(poolId) ?? 0) + 1);
  }

  put(entry: Omit<CachedRouteEntry, "createdAt">): void {
    this.entries.set(entry.key, { ...entry, createdAt: Date.now() });
  }

  get(key: string): CachedRouteEntry | null {
    return this.entries.get(key) ?? null;
  }

  /** None of the entry's dependency pools bumped since it was computed. */
  isFresh(entry: CachedRouteEntry): boolean {
    for (const id of entry.poolIds) {
      if (this.versionOf(id) !== entry.poolVersions[id]) return false;
    }
    return true;
  }

  /** Status-panel stats: cached routes still dependency-valid vs dropped. */
  stats(): { fresh: number; stale: number; trackedPools: number } {
    let fresh = 0;
    let stale = 0;
    for (const [key, entry] of this.entries) {
      if (this.isFresh(entry)) {
        fresh++;
      } else {
        stale++;
        this.entries.delete(key);
      }
    }
    return { fresh, stale, trackedPools: this.prints.size };
  }

  clear(): void {
    this.entries.clear();
    this.prints.clear();
    this.versions.clear();
  }
}

export const routeCache = new RouteCache();

/**
 * Memoized route computation with dependency awareness: recompute when inputs,
 * pool versions, OR the live dependency set changes. A pool disappearing from
 * the book must never leave a cached path pointing at that removed pool.
 */
export function routesCached(
  compute: () => SwapRoute[],
  opts: { key: string; poolIds: number[]; inputsKey: string },
): SwapRoute[] {
  const poolIds = normalizedPoolIds(opts.poolIds);
  const versions: Record<number, number> = {};
  for (const id of poolIds) versions[id] = routeCache.versionOf(id);
  const entry = routeCache.get(opts.key);
  if (
    entry &&
    entry.inputsKey === opts.inputsKey &&
    samePoolSet(entry.poolIds, poolIds) &&
    poolIds.every((id) => versions[id] === entry.poolVersions[id])
  ) {
    return entry.routes;
  }
  const routes = compute();
  if (routes.length > 0) {
    routeCache.put({
      key: opts.key,
      inputsKey: opts.inputsKey,
      routes,
      poolIds,
      poolVersions: versions,
    });
  }
  return routes;
}
