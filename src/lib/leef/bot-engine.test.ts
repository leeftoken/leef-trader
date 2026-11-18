import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS, evaluateBot } from "./bot-engine";
import { WAX_MICRO_ACTIVE_RISK } from "./risk-profiles";
import type { LeefPool, LeefSnapshot } from "./types";

const WAX_USD = 0.02;

function pool(): LeefPool {
  const waxReserve = 50_000;
  const leefReserve = 500_000_000;
  const waxPerLeef = waxReserve / leefReserve;
  return {
    id: 1159,
    fee: 3000,
    feePct: 0.3,
    leef: { symbol: "LEEF", contract: "leefmaincorp", decimals: 4, quantity: leefReserve },
    pair: { symbol: "WAX", contract: "eosio.token", decimals: 8, quantity: waxReserve },
    leefIsA: true,
    tvlUsd: waxReserve * WAX_USD * 2,
    volume24Usd: 50,
    volumeWeekUsd: 300,
    volumeUsdMonth: 1200,
    volumeUsd90: 3600,
    volumeLeef24: 0,
    volumePair24: 0,
    change24: 0,
    changeWeek: 0,
    liquidity: "0",
    pairPerLeef: waxPerLeef,
    leefPerPair: 1 / waxPerLeef,
    waxPerLeef,
    usdPerLeef: waxPerLeef * WAX_USD,
    tickSpacing: 60,
  };
}

function snapshot(): LeefSnapshot {
  const p = pool();
  const waxPerLeef = 50_000 / 500_000_000;
  const leefUsd = waxPerLeef * WAX_USD;
  return {
    source: "live",
    fetchedAt: new Date().toISOString(),
    waxUsd: WAX_USD,
    leefUsd,
    waxPerLeef,
    pools: [p],
    aux: [],
    trades: [],
    universe: [
      {
        symbol: "WAX", contract: "eosio.token", decimals: 8,
        alcorId: "wax-eosio.token", poolId: 0, waxPerToken: 1,
        usdPrice: WAX_USD, tvlUsd: 1_000_000, stable: false,
      },
      {
        symbol: "LEEF", contract: "leefmaincorp", decimals: 4,
        alcorId: "leef-leefmaincorp", poolId: p.id, waxPerToken: waxPerLeef,
        usdPrice: leefUsd, tvlUsd: p.tvlUsd, stable: false,
      },
    ],
  };
}

describe("Auto strategy WAX micro fallback", () => {
  it("uses a bounded multi-pool tape clip after no profitable candidate or atomic echo exists", () => {
    const snap = snapshot();
    const decision = evaluateBot({
      now: Date.now(),
      snap,
      series: [],
      running: true,
      strategy: "auto",
      goals: { ...DEFAULT_GOALS },
      risk: {
        ...WAX_MICRO_ACTIVE_RISK,
        minTradeUsd: 0.01,
        maxPositionUsd: 100,
        operationalReserveUsd: 0,
      },
      position: null,
      gridAnchor: snap.leefUsd,
      balances: { WAX: 50 },
      cooldownUntil: 0,
      tradesThisHour: 0,
      sessionRealizedUsd: 0,
      sessionStartEquityUsd: 1,
      echoCostUsd: 0,
      flowStates: null,
    });
    expect(decision.kind).toBe("swap");
    if (decision.kind !== "swap") return;
    expect(decision.opportunity?.intent).toBe("volume");
    expect(decision.minNetPct).toBe(-WAX_MICRO_ACTIVE_RISK.maxEchoLossPct);
    expect(decision.reason).toContain("bounded LEEF volume tape");
    expect(decision.amountIn).toBeGreaterThan(0);
  });
});
