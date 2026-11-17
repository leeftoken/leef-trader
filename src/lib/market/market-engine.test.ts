import { describe, expect, it } from "vitest";
import { marketEngine, patchOnchainPools } from "./market-engine";
import { routeCache } from "./route-cache";
import { marketBus } from "./event-bus";

describe("auxiliary on-chain patching", () => {
  it("commits a changed WAX reference pool even when no LEEF pool changed", async () => {
    const snap = {
      source: "live" as const,
      fetchedAt: "2026-11-17T00:00:00.000Z",
      waxUsd: 0.02,
      leefUsd: 0.00001,
      waxPerLeef: 0.0005,
      pools: [],
      aux: [{
        id: 2_001,
        fee: 3000,
        feePct: 0.3,
        tokenA: { symbol: "WAX", contract: "eosio.token", decimals: 8, quantity: 10 },
        tokenB: { symbol: "USDT", contract: "tethertether", decimals: 4, quantity: 20 },
        priceA: 1,
        priceB: 1,
        sqrtPriceX64: "1",
        liquidity: "1000",
        tvlUsd: 1_000,
        volume24Usd: 100,
      }],
      trades: [],
      universe: [],
    };
    const row = {
      id: 2_001,
      active: true,
      fee: 3000,
      tickSpacing: 60,
      liquidity: "2000",
      sqrtPriceX64: "2",
      tick: 0,
      tokenA: { symbol: "WAX", contract: "eosio.token", decimals: 8, quantity: 20 },
      tokenB: { symbol: "USDT", contract: "tethertether", decimals: 4, quantity: 10 },
      priceAInB: 2,
    };

    const patched = patchOnchainPools(snap, new Map([[row.id, row]]), true);
    expect(patched.changed).toBe(1);
    expect(patched.nextAux[0]!.tokenA.quantity).toBe(20);
    expect(patched.nextAux[0]!.priceA).toBe(2);

    const unchanged = patchOnchainPools(
      { ...snap, aux: patched.nextAux },
      new Map([[row.id, row]]),
      true,
    );
    expect(unchanged.changed).toBe(0);
  });
});

describe("MarketEngine (state surface — timers/network are unit-test-disabled)", () => {
  it("start() is idempotent: a second start never restarts anything", () => {
    marketEngine.start();
    const stateAfterFirst = marketEngine.getState();
    expect(stateAfterFirst.status).toBe("running");
    marketEngine.start(); // no-op
    expect(marketEngine.getState()).toBe(stateAfterFirst); // same object → no re-commit
  });

  it("exposes an immutable state snapshot for useSyncExternalStore", () => {
    const s1 = marketEngine.getState();
    const v1 = s1.version;
    marketEngine.reloadEndpoints(); // forces a commit without network
    const s2 = marketEngine.getState();
    expect(s2).not.toBe(s1);
    expect(s2.version).toBeGreaterThan(v1);
  });

  it("subscribers are notified on commits and can unsubscribe", () => {
    let calls = 0;
    const off = marketEngine.subscribe(() => {
      calls += 1;
    });
    marketEngine.reloadEndpoints();
    expect(calls).toBe(1);
    off();
    marketEngine.reloadEndpoints();
    expect(calls).toBe(1);
  });
});

describe("event bus wiring", () => {
  it("pool-change events reach listeners (routes invalidate per dependency)", () => {
    const seen: number[][] = [];
    const off = marketBus.on("pools", (p) => seen.push(p.changedIds));
    marketBus.emit("pools", { changedIds: [217], headBlock: 100 });
    expect(seen).toEqual([[217]]);
    off();
  });
});

describe("resume discipline (stale data never trades)", () => {
  it("invalidateAll drops every dependency version assumption", () => {
    // Simulate a long browser suspension: the engine calls this on wake.
    routeCache.invalidateAll();
    const stats = routeCache.stats();
    expect(stats.fresh).toBe(0);
  });
});
