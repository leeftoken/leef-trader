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

function answers(over: Partial<JevAnswers> = {}): JevAnswers {
  return {
    [AI_QID.action]: { type: "choice", choice: "buy", confidence: 0.9 },
    [AI_QID.sizeBucket]: { type: "choice", choice: "half", confidence: 0.8 },
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
  it("offers only the action types allowed for the exact deterministic candidate", () => {
    const q = buildAiQuestions(summary());
    const actionQuestion = q[AI_QID.action] as { instructions: string; criteria: Record<string, unknown> };
    expect(actionQuestion.instructions).toContain("USD notional");
    expect(actionQuestion.instructions).toContain("pool liquidity");
    const criteria = actionQuestion.criteria;
    expect(Object.keys(criteria)).toEqual(["hold", "buy"]);
    expect(q[AI_QID.sizeBucket]?.type).toBe("choice");
    expect(q[AI_QID.riskStress]?.type).toBe("noul");
    expect(q[AI_QID.riskExecute]?.type).toBe("noul");
  });

  it("offers swap as accept/reject only and never asks Jev to choose a token pair", () => {
    const s: AiSnapshotSummary = {
      ...summary(),
      candidateKind: "swap",
      candidateKey: swapContext.candidateKey,
      candidate: swapContext.candidate,
      allowedActions: ["hold", "swap"],
    };
    const q = buildAiQuestions(s);
    const criteria = (q[AI_QID.action] as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria)).toEqual(["hold", "swap"]);
    expect(q["swap_token_in"]).toBeUndefined();
    expect(q["swap_token_out"]).toBeUndefined();
  });

  it("includes engine-owned market regime, danger, portfolio and contract context", () => {
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
  it("parses a buy judgement for the matching engine candidate", () => {
    const p = parseAiProposal(answers(), context);
    expect(p).not.toBeNull();
    expect(p!.action).toBe("buy");
    expect(p!.params.sizePct).toBe("50");
    expect(p!.confidence).toBeLessThanOrEqual(0.8);
    expect(p!.confidence).toBeGreaterThanOrEqual(AI_EXEC_CONFIDENCE_MIN - 0.2);
    expect(p!.rationale).toContain("action=buy");
    expect(p!.snapshotFetchedAt).toBe(context.snapshotFetchedAt);
    expect(p!.model).toBe("jev-latest");
    expect(p!.candidateKey).toBe(context.candidateKey);
    expect(p!.candidate?.expectedNetEdgePct).toBe(1.2);
  });

  it("allows Jev to reject a candidate with hold", () => {
    const a = answers();
    delete a[AI_QID.sizeBucket];
    const p = parseAiProposal({
      ...a,
      [AI_QID.action]: { type: "choice", choice: "hold", confidence: 0.9 },
    }, context);
    expect(p).not.toBeNull();
    expect(p!.action).toBe("hold");
    expect(p!.params.sizePct).toBeUndefined();
  });

  it("rejects unsupported actions and actions that do not match the candidate", () => {
    expect(parseAiProposal({})).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "sell", confidence: 0.99 },
    })).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
    }, context)).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "buy", confidence: 0.9 },
    }, swapContext)).toBeNull();
  });

  it("normalizes harmless casing and whitespace in TypeSafe choice labels", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "CHOICE", choice: " BUY ", confidence: 0.91 },
      [AI_QID.sizeBucket]: { type: "choice", choice: " HALF ", confidence: 0.86 },
      [AI_QID.riskStress]: { type: "NOUL", noul: 0.1 },
      [AI_QID.riskExecute]: { type: "noul", noul: 0.9 },
    }, context);
    expect(p?.action).toBe("buy");
    expect(p?.params.sizePct).toBe("50");
  });

  it("derives missing choice confidence from the selected choice probability", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "buy", probabilities: { buy: 0.91, hold: 0.09 } },
      [AI_QID.sizeBucket]: { type: "choice", choice: "half", probabilities: { half: 0.88, quarter: 0.12 } },
    }, context);
    expect(p?.action).toBe("buy");
    expect(p?.confidence).toBeCloseTo(0.88);
  });

  it("reads Noul yes probability when the gateway returns the equivalent probability map", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.riskStress]: { type: "noul", probabilities: { true: 0.1, false: 0.9 } },
      [AI_QID.riskExecute]: { type: "noul", probabilities: { true: 0.9, false: 0.1 } },
    }, context);
    expect(p?.action).toBe("buy");
  });

  it("rejects out-of-range confidence and Noul values instead of clamping them", () => {
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "buy", confidence: 1.2 },
    }, context)).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.riskExecute]: { type: "noul", noul: 1.1 },
    }, context)).toBeNull();
  });

  it("uses TypeSafe Noul probability confidence without the incorrect doubled-distance conversion", () => {
    const p = parseAiProposal(answers({
      [AI_QID.action]: { type: "choice", choice: "buy", confidence: 0.98 },
      [AI_QID.sizeBucket]: { type: "choice", choice: "half", confidence: 0.98 },
      [AI_QID.riskStress]: { type: "noul", noul: 0.2 },
      [AI_QID.riskExecute]: { type: "noul", noul: 0.9 },
    }), context);
    expect(p).not.toBeNull();
    expect(p!.confidence).toBeCloseTo(0.8, 10);
    expect(p!.weakest).toBe(AI_QID.riskStress);
  });

  it("rejects candidates under acute market stress or with unsafe data", () => {
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.riskStress]: { type: "noul", noul: 0.9 },
    }, context)).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.riskExecute]: { type: "noul", noul: 0.2 },
    }, context)).toBeNull();
  });

  it("accepts only the exact swap pair supplied by the engine", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
    }, swapContext);
    expect(p).not.toBeNull();
    expect(p!.params.tokenIn).toBe("WAX");
    expect(p!.params.tokenOut).toBe("LEEF");
    expect(p!.candidate?.tokenIn).toBe("WAX");
    expect(p!.candidate?.tokenOut).toBe("LEEF");
  });

  it("rejects an incomplete swap candidate instead of accepting model-invented tokens", () => {
    const incomplete = {
      ...swapContext,
      candidate: { kind: "swap" as const, key: "bad-candidate" },
    };
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.9 },
    }, incomplete)).toBeNull();
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
  it("accepts a recent proposal tied to the same market snapshot", () => {
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
  const summaryWithArb = {
    ...summary(),
    candidateKind: "arb" as never,
    candidateKey: "volume:atomic:217>218",
    candidate: {
      kind: "arb" as never,
      key: "volume:atomic:217>218",
      arbKind: "volume" as const,
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
    allowedActions: ["hold", "arb"] as never,
  };

  it("offers Jev accept/reject for an atomic volume candidate without asking it to resize the route", () => {
    const questions = buildAiQuestions(summaryWithArb);
    const action = questions[AI_QID.action] as { instructions: string; criteria: Record<string, unknown> };
    expect(Object.keys(action.criteria)).toEqual(["hold", "arb"]);
    expect(action.instructions.toLowerCase()).toContain("atomic");
    expect(questions[AI_QID.sizeBucket]).toBeUndefined();
  });

  it("parses an approval bound to the exact atomic volume candidate", () => {
    const candidateContext = {
      ...context,
      candidateKind: "arb" as never,
      candidateKey: summaryWithArb.candidateKey,
      candidate: summaryWithArb.candidate,
      allowedActions: ["hold", "arb"] as never,
    };
    const response = answers({
      [AI_QID.action]: { type: "choice", choice: "arb", confidence: 0.94 },
    });
    delete response[AI_QID.sizeBucket];
    const proposal = parseAiProposal(response, candidateContext);
    expect(proposal?.action).toBe("arb");
    expect(proposal?.candidateKey).toBe("volume:atomic:217>218");
    expect(proposal?.params.sizePct).toBeUndefined();
  });
});
