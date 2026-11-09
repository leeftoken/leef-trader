import { describe, expect, it } from "vitest";
import { buildUniverse } from "./universe";
import { attachUsdPrices, parseAllPools } from "./parse";
import { BROKEN_POOL_IDS, reserveTvlUsd } from "./tvl-estimate";

const WAX = { symbol: "WAX", contract: "eosio.token", decimals: 8 };
const SAT = { symbol: "SAT", contract: "sattoken1111", decimals: 4 };
const LEEF = { symbol: "LEEF", contract: "leefmaincorp", decimals: 4 };
const USDC = { symbol: "WAXUSDC", contract: "eth.token", decimals: 6 };
const WBTC = { symbol: "WAXWBTC", contract: "eth.token", decimals: 8 };
const pool = (id: number, a: object, qa: number, b: object, qb: number, extra: object = {}) => ({
  id, fee: 10000, active: true, liquidity: "1000", tvlUSD: 0,
  tokenA: { ...a, quantity: qa }, tokenB: { ...b, quantity: qb }, ...extra,
});
// Shaped like the live Alcor rows on 2026-11-09.
const RAW = [
  pool(217, WAX, 118420, LEEF, 5.01e9, { tvlUSD: 900, priceA: 30270, priceB: 1 / 30270, fee: 3000 }),
  pool(13235, WAX, 5768.96, SAT, 837856.62, { tvlUSD: 44, priceA: 145.3, priceB: 0.00688 }),
  pool(12925, WAX, 1997.47, SAT, 169574.8, { priceA: 144.5, priceB: 0.0069195, fee: 3000 }),
  pool(13231, USDC, 14.44, SAT, 555837.19, { priceA: 38516.9, priceB: 0.0000259626 }),
  pool(12905, LEEF, 1.38e9, SAT, 7.8e6, { priceA: 0.00571616, priceB: 174.9, fee: 3000 }),
  pool(13238, WBTC, 2e-8, SAT, 0.0001, { liquidity: "0", priceA: 2.9e9, priceB: 3.4e-10, fee: 3000 }),
  pool(13234, { symbol: "WAXUSDT", contract: "eth.token", decimals: 8 }, 0.000009, SAT, 0.4487, { priceA: 50320, priceB: 0.0000198 }),
  pool(9001, WAX, 1000, { symbol: "JUNK", contract: "junk.token", decimals: 4 }, 5, { priceA: 0.005, priceB: 200 }),
];
const WAX_USD = 0.0038;

describe("SAT pool TVL estimate", () => {
  it("keeps Alcor's figure when it has one, estimates 2 x trusted side for SAT pools at $0", () => {
    expect(reserveTvlUsd(44, RAW[1].tokenA, RAW[1].tokenB, WAX_USD)).toEqual({ usd: 44, estimated: false });
    const e = reserveTvlUsd(0, RAW[2].tokenA, RAW[2].tokenB, WAX_USD);
    expect(e.estimated).toBe(true);
    expect(e.usd).toBeCloseTo(2 * 1997.47 * WAX_USD, 6);
    // Non-SAT unpriced pools keep Alcor's $0 (dust signal) — scope is SAT only.
    expect(reserveTvlUsd(0, RAW[7].tokenA, RAW[7].tokenB, WAX_USD)).toEqual({ usd: 0, estimated: false });
  });

  it("buildUniverse prices SAT from its deepest WAX pool and drops broken pools", () => {
    const u = buildUniverse(RAW, WAX_USD);
    const sat = u.find((t) => t.symbol === "SAT" && t.contract === "sattoken1111");
    expect(sat).toBeDefined();
    expect(sat!.tvlUsd).toBeGreaterThanOrEqual(5);
    expect([13235, 12925, 13231]).toContain(sat!.poolId);
    expect(u.some((t) => BROKEN_POOL_IDS.has(t.poolId))).toBe(false);
    expect(u.find((t) => t.symbol === "JUNK")).toBeUndefined();
  });

  it("parseAllPools drops 13238/13234; attachUsdPrices estimates SAT book TVL", () => {
    const { leef, aux } = parseAllPools(RAW);
    const ids = [...leef.map((p) => p.id), ...aux.map((p) => p.id)];
    expect(ids).not.toContain(13238);
    expect(ids).not.toContain(13234);
    attachUsdPrices(leef, aux, WAX_USD);
    const byId = new Map(aux.map((p) => [p.id, p]));
    expect(byId.get(12925)!.tvlUsd).toBeCloseTo(2 * 1997.47 * WAX_USD, 6);
    expect(byId.get(13231)!.tvlUsd).toBeCloseTo(2 * 14.44, 6);
    expect(byId.get(13235)!.tvlUsd).toBe(44);
    expect(byId.get(9001)!.tvlUsd).toBe(0);
    const p12905 = leef.find((p) => p.id === 12905)!;
    expect(p12905.tvlUsd).toBeGreaterThan(5);
  });
});
