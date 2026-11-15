import { describe, expect, it } from "vitest";
import {
  AI_EXEC_CONFIDENCE_MIN,
  AI_QID,
  buildAiQuestions,
  parseAiProposal,
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
    topPools: [
      { id: 217, pair: "LEEF/WAX", feePct: 0.3, tvlUsd: 900, volume24Usd: 6.6, change24: 1.2 },
    ],
    engineCandidate: {
      id: "engine:buy:217:10.0000000000",
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 10,
      routeSignature: "alcor:217",
      netEdgePct: 1.25,
      priceImpactPct: 0.4,
      reason: "Deterministic engine found a viable BUY candidate after its entry gates.",
    },
  };
}

function metadata(s = summary(), receivedAt = Date.parse("2026-11-15T12:00:00.000Z")) {
  return {
    snapshotFetchedAt: s.fetchedAt,
    engineCandidateId: s.engineCandidate?.id ?? "engine:buy:test",
    model: "jev-latest",
    receivedAt,
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

describe("buildAiQuestions", () => {
  it("asks Jev only whether to execute the exact engine candidate or hold", () => {
    const q = buildAiQuestions(summary());
    expect(q[AI_QID.action]?.type).toBe("choice");
    const criteria = (q[AI_QID.action] as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria)).toEqual(["hold", "buy"]);
    expect((criteria.buy as string)).toContain("WAX→LEEF");
    expect((criteria.buy as string)).toContain("alcor:217");
    expect(q[AI_QID.sizeBucket]?.type).toBe("choice");
    expect(q[AI_QID.riskStress]?.type).toBe("noul");
    expect(q[AI_QID.riskExecute]?.type).toBe("noul");
    // No arbitrary action, token, route, or size can be introduced by Jev.
    expect(criteria).not.toHaveProperty("swap");
    expect(criteria).not.toHaveProperty("sell");
    expect(q[AI_QID.swapTokenIn]).toBeUndefined();
    expect(q[AI_QID.swapTokenOut]).toBeUndefined();
  });
});

describe("parseAiProposal", () => {
  it("parses a buy proposal; confidence is the weakest relevant judgment", () => {
    const p = parseAiProposal(answers(), metadata());
    expect(p).not.toBeNull();
    expect(p!.action).toBe("buy");
    expect(p!.params.sizePct).toBe("50");
    // Weakest = size bucket at 0.8 (risk nouls: |0.9-0.5|*2 = 0.8 tie broken first-seen).
    expect(p!.confidence).toBeLessThanOrEqual(0.8);
    expect(p!.confidence).toBeGreaterThanOrEqual(AI_EXEC_CONFIDENCE_MIN - 0.2);
    expect(p!.rationale).toContain("action=buy");
    expect(p!.proposalId).toContain("jev:");
    expect(p!.snapshotFetchedAt).toBe(summary().fetchedAt);
    expect(p!.model).toBe("jev-latest");
    expect(p!.engineCandidateId).toBe("engine:buy:217:10.0000000000");
    expect(p!.proposalId).toContain(p!.engineCandidateId);
  });

  it("hold needs no size bucket and ignores swap args", () => {
    const a = answers();
    delete a[AI_QID.sizeBucket];
    const p = parseAiProposal({
      ...a,
      [AI_QID.action]: { type: "choice", choice: "hold", confidence: 0.6 },
    });
    expect(p).not.toBeNull();
    expect(p!.action).toBe("hold");
    expect(p!.params.sizePct).toBeUndefined();
  });

  it("returns null on missing/malformed action answers", () => {
    expect(parseAiProposal({})).toBeNull();
    expect(parseAiProposal({ [AI_QID.action]: { type: "choice", choice: "yolo", confidence: 0.99 } } as JevAnswers)).toBeNull();
    expect(parseAiProposal({ ...answers(), [AI_QID.action]: { type: "choice", choice: "buy" } } as unknown as JevAnswers)).toBeNull();
  });

  it("never acts on unsafe data (risk_execute < 0.5 vetoes everything but hold)", () => {
    const p = parseAiProposal({ ...answers(), [AI_QID.riskExecute]: { type: "noul", noul: 0.2 } });
    expect(p).toBeNull();
  });

  it("acute stress vetoes entries and Jev cannot override the engine's exits", () => {
    const stressed = { ...answers(), [AI_QID.riskStress]: { type: "noul", noul: 0.9 } };
    expect(parseAiProposal(stressed, metadata())).toBeNull();
    const sell = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "sell", confidence: 0.99 },
    }, metadata());
    expect(sell).toBeNull();
    const reduce = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "reduce_risk", confidence: 0.99 },
    }, metadata());
    expect(reduce).toBeNull();
  });

  it("rejects free-form token swaps until the API carries contract-exact token identities", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "swap", confidence: 0.99 },
    }, metadata());
    expect(p).toBeNull();
  });

  it("rejects out-of-range model probabilities rather than clamping them", () => {
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.action]: { type: "choice", choice: "buy", confidence: 1.5 },
    }, metadata())).toBeNull();
    expect(parseAiProposal({
      ...answers(),
      [AI_QID.riskStress]: { type: "noul", noul: -0.1 },
    }, metadata())).toBeNull();
  });

  it("unknown size bucket is unusable", () => {
    const p = parseAiProposal({
      ...answers(),
      [AI_QID.sizeBucket]: { type: "choice", choice: "yuge", confidence: 0.99 },
    }, metadata());
    expect(p).toBeNull();
  });

  it("exposes the documented execution gate constant", () => {
    expect(AI_EXEC_CONFIDENCE_MIN).toBe(0.75);
  });
});
