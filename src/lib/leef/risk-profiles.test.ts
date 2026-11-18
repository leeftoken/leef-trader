import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS, DEFAULT_RISK } from "./bot-engine";
import { WAX_MICRO_ACTIVE_RISK } from "./risk-profiles";

describe("WAX micro active risk profile", () => {
  it("increases opportunity cadence for micropayment markets", () => {
    expect(WAX_MICRO_ACTIVE_RISK.cooldownSec).toBe(10);
    expect(WAX_MICRO_ACTIVE_RISK.maxTradesHour).toBe(60);
    expect(WAX_MICRO_ACTIVE_RISK.minConfidence).toBeLessThan(DEFAULT_RISK.minConfidence);
    expect(WAX_MICRO_ACTIVE_RISK.minEdgePct).toBeLessThan(DEFAULT_RISK.minEdgePct);
  });

  it("widens execution tolerance without removing deterministic economic limits", () => {
    expect(WAX_MICRO_ACTIVE_RISK.maxImpactPct).toBe(4);
    expect(WAX_MICRO_ACTIVE_RISK.slippage).toBe(0.8);
    expect(WAX_MICRO_ACTIVE_RISK.minNetEdgePct).toBe(DEFAULT_RISK.minNetEdgePct);
    expect(WAX_MICRO_ACTIVE_RISK.maxPoolSharePct).toBe(7.5);
    expect(WAX_MICRO_ACTIVE_RISK.maxHops).toBe(4);
  });

  it("keeps volume loss bounded and preserves account-level circuit breakers", () => {
    expect(WAX_MICRO_ACTIVE_RISK.maxEchoLossPct).toBe(0.5);
    expect(WAX_MICRO_ACTIVE_RISK.echoBudgetUsd).toBe(DEFAULT_RISK.echoBudgetUsd);
    expect(WAX_MICRO_ACTIVE_RISK.echoBudgetUsd).toBeGreaterThan(0);
    expect(DEFAULT_GOALS.maxDrawdownPct).toBeGreaterThan(0);
    expect(DEFAULT_GOALS.maxDailyLossPct).toBeGreaterThan(0);
  });
});
