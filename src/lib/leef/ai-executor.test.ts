import { describe, expect, it } from "vitest";
import {
  AI_EXEC_CONFIDENCE_MIN,
  AI_QID,
  buildAiQuestions,
  isAiProposalFresh,
  parseAiProposal,
  type AiProposalContext,
  type AiSnapshotSummary,
} from "./ai-executor";
import type { JevAnswers } from "./jev-client";

function summary(): AiSnapshotSummary {
  return {
    waxUsd: 0.0047,
    leefUsd: 1.7e-7,
    waxPerLeef: 3.6e-5,
    fetchedAt: "2026-10-20T00:00:00.000Z",
    base: "LEEF",
    quote: "WAX",
    strategy: "auto",
    balances: { WAX: 120, LEEF: 5_000_000 },
    positionUsd: 0.85,
    positionAmount: 5_000_000,
    positionEntryUsd: 1.6e-7,
    positionUnrealizedPct: 6.25,
    positionHighUsd: 1.8e-7,
    positionMode: "live",
    market: {
      quoteAgeMs: 1_000,
      regime: "range",
      volatilityPct: 0.2,
      poolDislocationPct: 0.1,
      dangerScore: 10,
      dangerBand: "normal",
      deepestPoolUsd: 900,
      recentEconomicFailures: 0,
    },
    session: { trades: 4, wins: 3, realizedUsd: 0.12, tradesThisHour: 1, startEquityUsd: 10 },
    riskLimits: { maxPositionUsd: 50, minNetEdgePct: 0.4, maxImpactPct: 2, maxQuoteAgeSec: 45 },
    topPools: [
      { id: 217, pair: "LEEF/WAX", feePct: 0.3, tvlUsd: 900, volume24Usd: 6.6, change24: 1.2 },
    ],
    tokenUniverse: [
      { symbol: "LEEF", contract: "leefmaincorp" },
      { symbol: "WAX", contract: "eosio.token" },
    ],
    candidatesIn: ["WAX", "LEEF"],
    candidatesOut: ["LEEF", "WAX", "WAXUSDC"],
  };
}

function answers(over: Partial<JevAnswers> = {}): JevAnswers {
  return {
    [AI_QID.action]: { type: "choice", choice: "buy", confidence: 0.9 },
    [AI_QID.sizeBucket]: { type: "choice", choice: "half", confidence: 0.8 },
    [AI_QID.swapTokenIn]: { type: "choice", choice: "WAX", confidence: 0.7 },
    [AI_QID.swapTokenOut]: { type: "choice", choice: "LEEF", confidence: 0.7 },
    [AI_QID.riskStress]: { type: "noul", noul: 0.1 },
    [AI_QID.riskExecute]: { type: "noul", noul: 0.9 },
    ...over,
  };
}

const context: AiProposalContext = {
  snapshotFetchedAt: "1970-01-01T00:01:40.000Z",
  requestedAt: 100_000,
  receivedAt: 105_000,
  model: "jev-latest",
  candidatesIn: ["WAX", "LEEF"],
  candidatesOut: ["LEEF", "WAX", "WAXUSDC"],
};

describe("buildAiQuestions", () => {
  it("offers only actions this execution loop actually supports", () => {
    const q = buildAiQuestions(summary());
    expect(q[AI_QID.action]?.type).toBe("choice");
    const criteria = (q[AI_QID.action] as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria)).toEqual(["hold", "buy", "sell", "swap", "reduce_risk"]);
    expect(q[AI_QID.sizeBucket]?.type).toBe("choice");
    expect(q[AI_QID.swapTokenIn]?.type).toBe("choice");
    expect(q[AI_QID.riskStress]?.type).toBe("noul");
    expect(q[AI_QID.riskExecute]?.type).toBe("noul");
    const tin = (q[AI_QID.swapTokenIn] as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(tin)).toEqual(["WAX", "LEEF"]);
  });

  it("includes engine-owned market regime, danger, portfolio and contract context", () => {
    const s = summary();
    expect(s.market.regime).toBe("range");
    expect(s.market.dangerScore).toBe(10);
    expect(s.positionUnrealizedPct).toBe(6.25);
    expect(s.tokenUniverse).toContainEqual({ symbol: "LEEF", contract: "leefmaincorp" });
  });
});

describe("parseAiProposal", () => {
  it("parses a buy proposal; confidence is the weakest relevant judgment", () => {
    const p = parseAiProposal(answers(), context);
    expect(p).not.toBeNull();
    expect(p!.action).toBe("buy");
    expect(p!.params.sizePct).toBe("50");
    expect(p!.confidence).toBeLessThanOrEqual(0.8);
    expect(p!.confidence).toBeGreaterThanOrEqual(AI_EXEC_CONFIDENCE_MIN - 0.2);
    expect(p!.rationale).toContain("action=buy");
    expect(p!.snapshotFetchedAt).toBe(context.snapshotFetchedAt);
    expect(p!.model).toBe("jev-latest");
  });

  it("hold needs no size bucket and ignores swap args", () => {
    const a = answers();
    delete a[AI_QID.sizeBucket];
    const p = parseAiProposal({
      ...a,
      [AI_QID.action]: { type: "choice", choice: "hold", confidence: 0.6 },
    }, context);
    expect(p).not.toBeNull();
    expect(p!.action).toBe("hold");
    expect(p!.params.sizePct).toBeUndefined();
  });

  it("exits are full-position only and do not require an irrelevant size answer", () => {
    const a = answers();
    delete a[AI_QID.sizeBucket];
    const p = parseAiProposal({
      ...a,
      [AI_QID.action]: { type: "choice", choice: "sell", confidence: 0.95 },
    }, context);
    expect(p).not.toBeNull();
    expect(p!.action).toBe("sell");
    expect(p!.params.sizePct).toBeUndefined();
  });

  it("returns null on missing, malformed or unsupported action answers", () => {
    expect(parseAiProposal({})).toBeNull();
    expect(parseAiProposal({ [AI_QID.action]: { type: "choice", choice: "yolo", confidence: 0.99 } } as JevAnswers)).toBeNull();
    expect(parseAiProposal({ ...answers(), [AI_QID.action]: { type: "choice", choice: "buy" } } as unknown as JevAnswers)).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "rebalance", confidence: 0.99 },
    })).toBeNull();
  });

  it("rejects out-of-range confidence and Noul values instead of clamping them", () => {
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "buy", confidence: 1.2 },
    })).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.riskExecute]: { type: "noul", noul: 1.1 },
    })).toBeNull();
  });

  it("never acts on unsafe data (risk_execute < 0.5 vetoes non-hold actions)", () => {
    const p = parseAiProposal({ ...answers(), [AI_QID.riskExecute]: { type: "noul", noul: 0.2 } }, context);
    expect(p).toBeNull();
  });

  it("acute stress vetoes entries but not exits", () => {
    const stressed = { ...answers(), [AI_QID.riskStress]: { type: "noul", noul: 0.9 } };
    expect(parseAiProposal(stressed, context)).toBeNull();
    const exit = parseAiProposal({
      ...stressed,
      [AI_QID.action]: { type: "choice", choice: "reduce_risk", confidence: 0.95 },
    }, context);
    expect(exit).not.toBeNull();
    expect(exit!.action).toBe("reduce_risk");
  });

  it("swap requires distinct, closed-set token args with valid confidences", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
    }, context);
    expect(p).not.toBeNull();
    expect(p!.params.tokenIn).toBe("WAX");
    expect(p!.params.tokenOut).toBe("LEEF");
    expect(p!.confidence).toBeCloseTo(0.7, 6);
    expect(p!.weakest).toBe(AI_QID.swapTokenIn);

    const same = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
      [AI_QID.swapTokenOut]: { type: "choice", choice: "WAX", confidence: 0.9 },
    }, context);
    expect(same).toBeNull();

    const invented = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
      [AI_QID.swapTokenOut]: { type: "choice", choice: "FAKE", confidence: 0.9 },
    }, context);
    expect(invented).toBeNull();
  });

  it("unknown size bucket is unusable", () => {
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.sizeBucket]: { type: "choice", choice: "yuge", confidence: 0.99 },
    }, context)).toBeNull();
  });

  it("exposes the documented execution gate constant", () => {
    expect(AI_EXEC_CONFIDENCE_MIN).toBe(0.75);
  });
});

describe("isAiProposalFresh", () => {
  it("accepts a recent proposal tied to a current market snapshot", () => {
    const p = parseAiProposal(answers(), context)!;
    expect(isAiProposalFresh(p, "1970-01-01T00:01:45.000Z", 106_000)).toBe(true);
  });

  it("rejects missing source metadata, future snapshots and stale market evidence", () => {
    const p = parseAiProposal(answers())!;
    expect(isAiProposalFresh(p, "1970-01-01T00:01:45.000Z", 106_000)).toBe(false);
    const bound = parseAiProposal(answers(), context)!;
    expect(isAiProposalFresh(bound, "1970-01-01T00:04:00.000Z", 240_000)).toBe(false);
    expect(isAiProposalFresh(bound, "1970-01-01T00:01:45.000Z", 99_000)).toBe(false);
  });

  it("rejects delayed, future-dated or late-arriving responses", () => {
    const delayed = parseAiProposal(answers(), { ...context, receivedAt: 140_001 })!;
    expect(isAiProposalFresh(delayed, "1970-01-01T00:01:45.000Z", 141_000)).toBe(false);
    const future = parseAiProposal(answers(), { ...context, receivedAt: 110_000 })!;
    expect(isAiProposalFresh(future, "1970-01-01T00:01:45.000Z", 109_000)).toBe(false);
  });
});
