import { afterEach, describe, expect, it } from "vitest";
import { useBot } from "./bot";
import { beginSigning, markBroadcast, markFailed } from "@/lib/wallet/trade-cycle";

const originalStats = useBot.getState().stats;
const originalRunning = useBot.getState().running;
const originalResumeIntent = useBot.getState().resumeAfterRecovery;

afterEach(() => {
  useBot.setState({
    stats: originalStats,
    running: originalRunning,
    resumeAfterRecovery: originalResumeIntent,
    strategyHalt: null,
  });
});

describe("live and paper session accounting", () => {
  it("keeps paper outcomes out of live realized P&L and win rate", () => {
    const before = useBot.getState().stats;

    useBot.getState().recordResult(4.25, 1_004.25, "live");
    useBot.getState().recordResult(-1.5, 1_002.75, "paper");

    const after = useBot.getState().stats;
    expect(after.liveRealizedUsd).toBe((before.liveRealizedUsd ?? 0) + 4.25);
    expect(after.liveClosedTrades).toBe((before.liveClosedTrades ?? 0) + 1);
    expect(after.liveWins).toBe((before.liveWins ?? 0) + 1);

    expect(after.paperRealizedUsd).toBe((before.paperRealizedUsd ?? 0) - 1.5);
    expect(after.paperClosedTrades).toBe((before.paperClosedTrades ?? 0) + 1);
    expect(after.paperWins).toBe(before.paperWins ?? 0);

    // Combined totals remain available, but are explicitly not the live-only
    // values presented by the Bot desk.
    expect(after.realizedUsd).toBe((before.realizedUsd ?? 0) + 2.75);
    expect(after.closedTrades).toBe((before.closedTrades ?? 0) + 2);
  });
});

describe("trading resume after verified recovery", () => {
  it("remembers an active bot's intent to resume after a reload recovery", () => {
    useBot.getState().start(100);

    expect(useBot.getState().resumeAfterRecovery).toBe(true);
  });

  it("does not resume after the user manually stops the bot", () => {
    useBot.getState().start(100);
    useBot.getState().stop("Stopped by user");

    expect(useBot.getState().resumeAfterRecovery).toBe(false);
    expect(useBot.getState().resumeAfterVerifiedSettlement()).toBe(false);
    expect(useBot.getState().running).toBe(false);
  });

  it("resumes the previous session after verified settlement", () => {
    useBot.setState({
      running: false,
      resumeAfterRecovery: true,
      strategyHalt: null,
    });

    expect(useBot.getState().resumeAfterVerifiedSettlement()).toBe(true);
    expect(useBot.getState().running).toBe(true);
  });

  it("does not resume while the live capital lock is still active", () => {
    useBot.setState({ running: false, resumeAfterRecovery: true, strategyHalt: null });
    const txid = "a".repeat(64);

    expect(beginSigning()).toBe(true);
    markBroadcast(txid);
    expect(useBot.getState().resumeAfterVerifiedSettlement()).toBe(false);
    expect(useBot.getState().running).toBe(false);
    markFailed(txid);
  });

  it("does not bypass a strategy retry-storm halt during recovery", () => {
    useBot.setState({
      running: false,
      resumeAfterRecovery: true,
      strategyHalt: { strategy: "auto", reason: "repeated chain rejection", at: Date.now() },
    });

    expect(useBot.getState().resumeAfterVerifiedSettlement()).toBe(false);
    expect(useBot.getState().running).toBe(false);
  });
});
