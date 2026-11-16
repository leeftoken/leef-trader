import { afterEach, describe, expect, it } from "vitest";
import { useBot } from "./bot";

afterEach(() => {
  useBot.getState().resetSession(1_000);
});

describe("bot performance accounting", () => {
  it("keeps executed transactions separate from completed round trips", () => {
    const bot = useBot.getState();
    bot.resetSession(1_000);
    bot.markTrade(30); // entry transaction
    bot.markTrade(30); // exit transaction
    bot.recordResult(12, 1_012);

    const stats = useBot.getState().stats;
    expect(stats.trades).toBe(2);
    expect(stats.closedTrades).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.realizedUsd).toBe(12);
  });

  it("counts a losing completed trade once and never divides wins by executions", () => {
    const bot = useBot.getState();
    bot.resetSession(1_000);
    bot.markTrade(30);
    bot.markTrade(30);
    bot.recordResult(-5, 995);

    const stats = useBot.getState().stats;
    expect(stats.trades).toBe(2);
    expect(stats.closedTrades).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.closedTrades > 0 ? stats.wins / stats.closedTrades : null).toBe(0);
  });

  it("does not fabricate a win-rate denominator for legacy sessions", () => {
    const bot = useBot.getState();
    bot.resetSession(1_000);
    bot.markTrade(30);
    expect(useBot.getState().stats.closedTrades).toBe(0);
  });
});
