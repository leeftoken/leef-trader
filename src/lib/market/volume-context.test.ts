import { describe, expect, it } from "vitest";
import { buildBotVolumeContext } from "./volume-context";
import type { PoolFlowState } from "./swap-flow";

const freshFlow: PoolFlowState = {
  poolId: 217,
  swapsInWindow: 2,
  buys: 1,
  sells: 1,
  signedBaseFlow: 0,
  signedQuoteFlow: 0,
  imbalancePct: 12,
  volumeQuotePerMin: 3,
  largestSwapQuote: 2,
  lastSwapAt: 9_900,
  lastSwapAgeMs: 100,
  lastMovePct: 0.4,
};

describe("buildBotVolumeContext", () => {
  it("keeps the flow kill-switch distinct from an enabled empty tracker", () => {
    expect(buildBotVolumeContext({
      flowStates: null,
      echoCostUsd: 1.25,
      quoteWindowMs: 10_000,
    })).toEqual({ flowStates: null, flow: null, echoCostUsd: 1.25 });

    expect(buildBotVolumeContext({
      flowStates: [],
      echoCostUsd: 1.25,
      quoteWindowMs: 10_000,
    })).toEqual({ flowStates: [], flow: null, echoCostUsd: 1.25 });
  });

  it("aggregates recent flow using the exact quote-freshness window", () => {
    const context = buildBotVolumeContext({
      flowStates: [freshFlow],
      echoCostUsd: 2.5,
      quoteWindowMs: 1_000,
    });
    expect(context.flowStates).toEqual([freshFlow]);
    expect(context.flow).toEqual({
      lastSwapAgeMs: 100,
      lastMovePct: 0.4,
      imbalancePct: 12,
    });
    expect(context.echoCostUsd).toBe(2.5);
  });

  it("does not treat stale swaps as current flow evidence", () => {
    const context = buildBotVolumeContext({
      flowStates: [{ ...freshFlow, lastSwapAgeMs: 10_001 }],
      echoCostUsd: 0,
      quoteWindowMs: 10_000,
    });
    expect(context.flow).toBeNull();
  });

  it("fails closed when the persisted echo-cost counter is invalid", () => {
    const context = buildBotVolumeContext({
      flowStates: null,
      echoCostUsd: Number.NaN,
      quoteWindowMs: 10_000,
    });
    expect(context.echoCostUsd).toBe(Number.POSITIVE_INFINITY);
  });
});
