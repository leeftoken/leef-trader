import { describe, expect, it } from "vitest";
import { DEFAULT_RISK } from "@/lib/leef/bot-engine";
import { useBot } from "./bot";

type Migrated = {
  goals: { maxDrawdownPct: number; maxDailyLossPct: number; takeProfitPct: number };
  risk: { maxTradesHour: number; cooldownSec: number; maxPoolSharePct: number; maxImpactPct: number };
  stats: { trades: number; closedTrades: number; wins: number; realizedUsd: number; liveWins: number; liveClosedTrades: number; paperWins: number; paperClosedTrades: number };
  riskMigrationNotice: string | null;
};

const migrate = (blob: unknown, version: number) =>
  useBot.persist.getOptions().migrate!(blob, version) as Migrated;

describe("bot store v14 migration", () => {
  it("v12 blob with legacy defaults gets the safer defaults + a notice, other settings kept", () => {
    const out = migrate(
      {
        goals: { takeProfitPct: 9, maxDrawdownPct: 0 },
        risk: { minTradeUsd: 0, maxPositionUsd: 50, maxTradesHour: 120, cooldownSec: 15, maxImpactPct: 2 },
      },
      12,
    );
    expect(out.goals.takeProfitPct).toBe(9);
    expect(out.goals.maxDrawdownPct).toBe(10);
    expect(out.goals.maxDailyLossPct).toBe(3);
    expect(out.risk.maxTradesHour).toBe(20);
    expect(out.risk.cooldownSec).toBe(30);
    expect(out.risk.maxPoolSharePct).toBe(5);
    expect(out.risk.maxImpactPct).toBe(2);
    expect(out.riskMigrationNotice).toMatch(/Safer risk defaults/);
  });

  it("v15 untouched WAX defaults migrate to the bounded active micro profile", () => {
    const out = migrate(
      {
        base: "LEEF",
        quote: "WAX",
        risk: { ...DEFAULT_RISK },
      },
      15,
    );
    expect(out.risk.maxTradesHour).toBe(60);
    expect(out.risk.cooldownSec).toBe(10);
    expect(out.risk.maxImpactPct).toBe(4);
    expect(out.risk.maxPoolSharePct).toBe(7.5);
    expect(out.riskMigrationNotice).toMatch(/WAX Micro Active profile applied/);
  });

  it("does not overwrite a customized legacy WAX risk profile", () => {
    const out = migrate(
      {
        base: "LEEF",
        quote: "WAX",
        risk: { ...DEFAULT_RISK, cooldownSec: 45 },
      },
      15,
    );
    expect(out.risk.maxTradesHour).toBe(20);
    expect(out.risk.cooldownSec).toBe(45);
  });

  it("v13 history keeps realized dollars but resets unreliable win-rate counters", () => {
    const out = migrate(
      { stats: { trades: 20, wins: 7, closedTrades: 7, liveWins: 5, liveClosedTrades: 6, paperWins: 2, paperClosedTrades: 2, realizedUsd: 42 } },
      13,
    );
    expect(out.stats.trades).toBe(20);
    expect(out.stats.closedTrades).toBe(0);
    expect(out.stats.wins).toBe(0);
    expect(out.stats.liveWins).toBe(0);
    expect(out.stats.liveClosedTrades).toBe(0);
    expect(out.stats.paperWins).toBe(0);
    expect(out.stats.paperClosedTrades).toBe(0);
    expect(out.stats.realizedUsd).toBe(42);
  });

  it("v14 completed-trade counters survive migration", () => {
    const out = migrate(
      { stats: { trades: 20, closedTrades: 8, wins: 5, realizedUsd: 42 } },
      14,
    );
    expect(out.stats.trades).toBe(20);
    expect(out.stats.closedTrades).toBe(8);
    expect(out.stats.wins).toBe(5);
  });

  it("an explicit 0 saved AFTER v13 is respected", () => {
    const out = migrate(
      {
        goals: { maxDrawdownPct: 0, maxDailyLossPct: 0, maxSessionLossUsd: 0 },
        risk: { minTradeUsd: 0, maxPositionUsd: 50, maxTradesHour: 120, cooldownSec: 15, maxPoolSharePct: 0 },
      },
      13,
    );
    expect(out.goals.maxDrawdownPct).toBe(0);
    expect(out.goals.maxDailyLossPct).toBe(0);
    expect(out.risk.maxTradesHour).toBe(120);
    expect(out.risk.maxPoolSharePct).toBe(0);
    expect(out.riskMigrationNotice).toBeNull();
  });
});
