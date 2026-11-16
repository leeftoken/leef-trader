import { afterEach, describe, expect, it } from "vitest";
import { useBot } from "./bot";

const originalStats = useBot.getState().stats;

afterEach(() => {
  useBot.setState({ stats: originalStats });
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
