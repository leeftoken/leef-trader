import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS, DEFAULT_RISK } from "./bot-engine";
import { shouldUpgradeLegacyWaxDefaults, WAX_HIGH_ACTIVITY_RISK, WAX_MICRO_ACTIVE_RISK } from "./risk-profiles";

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
    // Must exceed the typical 0.6% combined cost of two 0.3% LP legs;
    // the independent session echo budget still bounds cumulative loss.
    expect(WAX_MICRO_ACTIVE_RISK.maxEchoLossPct).toBe(1.5);
    expect(WAX_MICRO_ACTIVE_RISK.maxEchoLossPct).toBeGreaterThan(0.6);
    expect(WAX_MICRO_ACTIVE_RISK.echoBudgetUsd).toBe(DEFAULT_RISK.echoBudgetUsd);
    expect(WAX_MICRO_ACTIVE_RISK.echoBudgetUsd).toBeGreaterThan(0);
    expect(DEFAULT_GOALS.maxDrawdownPct).toBeGreaterThan(0);
    expect(DEFAULT_GOALS.maxDailyLossPct).toBeGreaterThan(0);
  });
});


describe("legacy WAX risk migration", () => {
  it("upgrades only the untouched legacy defaults", () => {
    expect(shouldUpgradeLegacyWaxDefaults(DEFAULT_RISK)).toBe(true);
    expect(shouldUpgradeLegacyWaxDefaults({
      ...DEFAULT_RISK,
      cooldownSec: 45,
    })).toBe(false);
    expect(shouldUpgradeLegacyWaxDefaults(undefined)).toBe(false);
  });
});

describe("WAX high activity risk profile", () => {
  it("raises trading cadence and quote tolerance for thin WAX books", () => {
    expect(WAX_HIGH_ACTIVITY_RISK.cooldownSec).toBe(10);
    expect(WAX_HIGH_ACTIVITY_RISK.maxTradesHour).toBe(120);
    expect(WAX_HIGH_ACTIVITY_RISK.maxImpactPct).toBe(5);
    expect(WAX_HIGH_ACTIVITY_RISK.slippage).toBe(1);
    expect(WAX_HIGH_ACTIVITY_RISK.minConfidence).toBeLessThan(WAX_MICRO_ACTIVE_RISK.minConfidence);
  });

  it("keeps each echo and the cumulative session cost bounded", () => {
    expect(WAX_HIGH_ACTIVITY_RISK.maxEchoLossPct).toBe(1.75);
    expect(WAX_HIGH_ACTIVITY_RISK.echoBudgetUsd).toBe(10);
    expect(WAX_HIGH_ACTIVITY_RISK.maxPoolSharePct).toBe(10);
    expect(WAX_HIGH_ACTIVITY_RISK.minNetEdgePct).toBe(DEFAULT_RISK.minNetEdgePct);
    expect(DEFAULT_GOALS.maxDrawdownPct).toBeGreaterThan(0);
    expect(DEFAULT_GOALS.maxDailyLossPct).toBeGreaterThan(0);
  });
});

