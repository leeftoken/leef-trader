import { describe, expect, it } from "vitest";
import {
  AI_EXEC_CONFIDENCE_MIN,
  AI_QID,
  buildAiQuestions,
  buildAiCandidateKey,
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
    performance: { trades: 4, wins: 3, realizedUsd: 0.12, tradesThisHour: 1, startEquityUsd: 10 },
    riskLimits: { maxPositionUsd: 50, minNetEdgePct: 0.4, maxImpactPct: 2, maxQuoteAgeSec: 45 },
    topPools: [
      { id: 217, pair: "LEEF/WAX", feePct: 0.3, tvlUsd: 900, volume24Usd: 6.6, change24: 1.2 },
    ],
    tokenUniverse: [
      { symbol: "LEEF", contract: "leefmaincorp" },
      { symbol: "WAX", contract: "eosio.token" },
    ],
    candidateKind: "preview",
    candidateKey: "dry-run",
    candidate: {
      kind: "preview",
      key: "dry-run",
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 10,
      amountUsd: 0.047,
      expectedOut: 1_000_000,
      expectedNetEdgePct: 1.2,
      priceImpactPct: 0.2,
      poolIds: [217],
      hops: 1,
    },
    allowedActions: ["hold", "buy"],
  };
}

function answers(noul = 0.9): JevAnswers {
  return { [AI_QID.tradeDecision]: { type: "noul", noul } };
}

const context: AiProposalContext = {
  snapshotFetchedAt: "1970-01-01T00:01:40.000Z",
  requestedAt: 100_000,
  receivedAt: 105_000,
  model: "jev-latest",
  candidateKind: "buy",
  candidateKey: "auto:buy:WAX@eosio.token:LEEF@leefmaincorp:direct:217",
  candidate: {
    kind: "buy",
    key: "auto:buy:WAX@eosio.token:LEEF@leefmaincorp:direct:217",
    tokenIn: "WAX",
    tokenInContract: "eosio.token",
    tokenOut: "LEEF",
    tokenOutContract: "leefmaincorp",
    amountIn: 10,
    amountUsd: 0.047,
    expectedOut: 1_000_000,
    expectedNetEdgePct: 1.2,
    priceImpactPct: 0.2,
    liquidityUsd: 900,
    poolIds: [217],
    hops: 1,
  },
  allowedActions: ["hold", "buy"],
};
const swapContext: AiProposalContext = {
  ...context,
  candidateKind: "swap",
  candidateKey: "auto:swap:WAX@eosio.token:LEEF@leefmaincorp:direct:217",
  candidate: {
    kind: "swap",
    key: "auto:swap:WAX@eosio.token:LEEF@leefmaincorp:direct:217",
    tokenIn: "WAX",
    tokenInContract: "eosio.token",
    tokenOut: "LEEF",
    tokenOutContract: "leefmaincorp",
    amountIn: 10,
    amountUsd: 0.047,
    expectedOut: 1_000_000,
    priceImpactPct: 0.2,
    poolIds: [217],
    hops: 1,
  },
  allowedActions: ["hold", "swap"],
};

describe("buildAiQuestions", () => {
  it("asks one candidate-bound yes/no question, not four independent gates", () => {
    const q = buildAiQuestions(summary());
    expect(Object.keys(q)).toEqual([AI_QID.tradeDecision]);
    expect(q[AI_QID.tradeDecision]?.type).toBe("noul");
    expect(q[AI_QID.tradeDecision]?.instructions).toContain("state.candidate");
    expect(q[AI_QID.tradeDecision]?.instructions).toMatch(/YES/);
    expect(q[AI_QID.tradeDecision]?.instructions).toMatch(/NO/);
  });

  it("uses the same single yes/no question for buy, swap and atomic arb candidates", () => {
    const swap = buildAiQuestions({
      ...summary(),
      candidateKind: "swap",
      candidateKey: swapContext.candidateKey,
      candidate: swapContext.candidate,
      allowedActions: ["hold", "swap"],
    });
    expect(Object.keys(swap)).toEqual([AI_QID.tradeDecision]);

    const arb = buildAiQuestions({
      ...summary(),
      candidateKind: "arb",
      candidateKey: "volume:atomic:217>218",
      candidate: { ...summary().candidate, kind: "arb", arbKind: "volume" },
      allowedActions: ["hold", "arb"],
    });
    expect(Object.keys(arb)).toEqual([AI_QID.tradeDecision]);
    expect(arb[AI_QID.tradeDecision]?.instructions).toContain("atomic");
  });

  it("keeps engine-owned market regime, danger, portfolio and contract context", () => {
    const s = summary();
    expect(s.market.regime).toBe("range");
    expect(s.market.dangerScore).toBe(10);
    expect(s.positionUnrealizedPct).toBe(6.25);
    expect(s.tokenUniverse).toContainEqual({ symbol: "LEEF", contract: "leefmaincorp" });
    expect(s.candidate.expectedNetEdgePct).toBe(1.2);
  });
});

describe("buildAiCandidateKey", () => {
  const details = {
    tokenIn: "WAX",
    tokenInContract: "eosio.token",
    tokenOut: "LEEF",
    tokenOutContract: "leefmaincorp",
    amountIn: 10,
    amountUsd: 0.047,
    expectedOut: 1_000_000,
    expectedNetEdgePct: 1.2,
    priceImpactPct: 0.2,
    poolIds: [217],
    hops: 1,
  };

  it("binds approval identity to exact size, economics, contracts, route and strategy", () => {
    const base = buildAiCandidateKey("auto", "buy", details, "direct:217");
    expect(buildAiCandidateKey("auto", "buy", { ...details, amountIn: 11 }, "direct:217")).not.toBe(base);
    expect(buildAiCandidateKey("auto", "buy", { ...details, expectedOut: 999_999 }, "direct:217")).not.toBe(base);
    expect(buildAiCandidateKey("auto", "buy", { ...details, expectedNetEdgePct: 0.4 }, "direct:217")).not.toBe(base);
    expect(buildAiCandidateKey("auto", "buy", { ...details, liquidityUsd: 800 }, "direct:217")).not.toBe(base);
    expect(buildAiCandidateKey("auto", "buy", { ...details, tokenOutContract: "clone.token" }, "direct:217")).not.toBe(base);
    expect(buildAiCandidateKey("auto", "buy", details, "direct:218")).not.toBe(base);
    expect(buildAiCandidateKey("grid", "buy", details, "direct:217")).not.toBe(base);
  });

  it("binds atomic arb identity to its arb kind", () => {
    const volume = buildAiCandidateKey("volume", "arb", { ...details, arbKind: "volume" }, "atomic:217>218");
    const spread = buildAiCandidateKey("volume", "arb", { ...details, arbKind: "spread" }, "atomic:217>218");
    expect(volume).not.toBe(spread);
  });

  it("normalizes token identity while preserving exact numeric candidate values", () => {
    const base = buildAiCandidateKey("auto", "buy", details, "direct:217");
    const normalized = buildAiCandidateKey("auto", "buy", {
      ...details,
      tokenIn: "wax",
      tokenInContract: "EOSIO.TOKEN",
      tokenOut: "leef",
      tokenOutContract: "LEEFMAINCORP",
    }, "direct:217");
    expect(normalized).toBe(base);
  });
});

describe("parseAiProposal", () => {
  it("approves the exact engine buy candidate when Jev returns a strong yes", () => {
    const proposal = parseAiProposal(answers(0.91), context);
    expect(proposal?.action).toBe("buy");
    expect(proposal?.confidence).toBeCloseTo(0.91, 10);
    expect(proposal?.params).toEqual({});
    expect(proposal?.rationale).toContain("trade=yes");
    expect(proposal?.candidateKey).toBe(context.candidateKey);
    expect(proposal?.model).toBe("jev-latest");
  });

  it("rejects a candidate when Jev says no", () => {
    const proposal = parseAiProposal(answers(0.05), context);
    expect(proposal?.action).toBe("hold");
    expect(proposal?.rationale).toContain("trade=no");
  });

  it("fails closed below the 0.75 affirmative probability floor", () => {
    expect(parseAiProposal(answers(0.74), context)?.action).toBe("hold");
  });

  it("maps yes to the one allowed code-owned action for a swap candidate", () => {
    const proposal = parseAiProposal(answers(0.92), swapContext);
    expect(proposal?.action).toBe("swap");
    expect(proposal?.params).toEqual({ tokenIn: "WAX", tokenOut: "LEEF" });
    expect(proposal?.candidateKey).toBe(swapContext.candidateKey);
  });

  it("maps a preview yes to buy without asking the model to name the action", () => {
    const proposal = parseAiProposal(answers(0.9), context);
    expect(proposal?.action).toBe("buy");
  });

  it("rejects missing, malformed and out-of-range Noul answers", () => {
    expect(parseAiProposal({}, context)).toBeNull();
    expect(parseAiProposal({ [AI_QID.tradeDecision]: { type: "choice", choice: "buy" } }, context)).toBeNull();
    expect(parseAiProposal(answers(1.01), context)).toBeNull();
    expect(parseAiProposal(answers(-0.01), context)).toBeNull();
  });

  it("rejects an affirmative judgement without exactly one executable candidate action", () => {
    expect(parseAiProposal(answers(0.95), {
      ...context,
      allowedActions: ["hold", "buy", "swap"],
    })).toBeNull();
    expect(parseAiProposal(answers(0.95), {
      ...swapContext,
      candidate: { kind: "swap", key: "bad-candidate" },
    })).toBeNull();
  });

  it("exposes the documented affirmative confidence floor", () => {
    expect(AI_EXEC_CONFIDENCE_MIN).toBe(0.75);
  });
});

describe("isAiProposalFresh", () => {
  it("accepts a recent proposal tied to the same market snapshot", () => {
    const p = parseAiProposal(answers(), context)!;
    expect(isAiProposalFresh(p, "1970-01-01T00:01:45.000Z", 106_000)).toBe(true);
  });

  it("rejects missing source metadata, future snapshots and stale market evidence", () => {
    const p = parseAiProposal(answers(0.9), context)!;
    expect(isAiProposalFresh(
      { ...p, snapshotFetchedAt: undefined },
      "1970-01-01T00:01:45.000Z",
      106_000,
    )).toBe(false);
    const bound = parseAiProposal(answers(), context)!;
    expect(isAiProposalFresh(bound, "1970-01-01T00:04:00.000Z", 240_000)).toBe(false);
    expect(isAiProposalFresh(bound, "1970-01-01T00:01:45.000Z", 99_000)).toBe(false);
  });

  it("does not treat a response as fresh at request-start time before it has arrived", () => {
    const proposal = parseAiProposal(answers(), context)!;
    expect(isAiProposalFresh(proposal, "1970-01-01T00:01:45.000Z", context.requestedAt)).toBe(false);
    expect(isAiProposalFresh(proposal, "1970-01-01T00:01:45.000Z", context.receivedAt)).toBe(true);
  });

  it("rejects delayed, future-dated or late-arriving responses", () => {
    const delayed = parseAiProposal(answers(), { ...context, receivedAt: 140_001 })!;
    expect(isAiProposalFresh(delayed, "1970-01-01T00:01:45.000Z", 141_000)).toBe(false);
    const future = parseAiProposal(answers(), { ...context, receivedAt: 110_000 })!;
    expect(isAiProposalFresh(future, "1970-01-01T00:01:45.000Z", 109_000)).toBe(false);
  });
});


describe("atomic arb Jev judgement", () => {
  const arbContext: AiProposalContext = {
    ...context,
    candidateKind: "arb",
    candidateKey: "volume:atomic:217>218",
    candidate: {
      kind: "arb",
      key: "volume:atomic:217>218",
      arbKind: "volume",
      tokenIn: "WAX",
      tokenInContract: "eosio.token",
      tokenOut: "WAX",
      tokenOutContract: "eosio.token",
      amountIn: 10,
      amountUsd: 0.047,
      expectedOut: 9.9,
      expectedNetEdgePct: -1,
      priceImpactPct: 0.2,
      liquidityUsd: 900,
      poolIds: [217, 218],
      hops: 2,
    },
    allowedActions: ["hold", "arb"],
  };

  it("approves only the exact engine-generated atomic volume candidate", () => {
    const proposal = parseAiProposal(answers(0.94), arbContext);
    expect(proposal?.action).toBe("arb");
    expect(proposal?.candidateKey).toBe("volume:atomic:217>218");
    expect(proposal?.params).toEqual({});
  });

  it("refuses an atomic arb candidate missing exact pool evidence", () => {
    expect(parseAiProposal(answers(0.94), {
      ...arbContext,
      candidate: { ...arbContext.candidate!, poolIds: [] },
    })).toBeNull();
  });
});
