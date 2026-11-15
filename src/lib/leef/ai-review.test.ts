import { describe, expect, it } from "vitest";
import { buildJevEvidence } from "./ai-review";
import type { JournalEntry } from "./journal";

function jevEntry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    ts: 1_000,
    kind: "ai",
    aiSource: "jev",
    aiModel: "jev-latest",
    aiSnapshotAt: "2026-11-15T12:00:00.000Z",
    decision: "buy",
    confidence: 0.8,
    strategy: "auto",
    mode: "paper",
    regime: "range",
    volPct: 0.2,
    dangerScore: 12,
    ...over,
  };
}

describe("buildJevEvidence", () => {
  it("summarizes only structured Jev proposals by action and market regime", () => {
    const evidence = buildJevEvidence([
      jevEntry(),
      jevEntry({ ts: 2_000, decision: "sell", confidence: 0.9, regime: "trend_down" }),
      jevEntry({ ts: 3_000, confidence: 0.6 }),
      jevEntry({ aiSource: "helper", decision: "buy", confidence: 1 }),
      { ts: 4_000, kind: "execution", action: "buy", pnlUsd: 1 },
    ]) as {
      totalProposals: number;
      byAction: Record<string, { count: number; meanReportedConfidence: number | null }>;
      byRegime: Record<string, { count: number; meanReportedConfidence: number | null }>;
      recent: { at: number; action?: string }[];
    };

    expect(evidence.totalProposals).toBe(3);
    expect(evidence.byAction.buy.count).toBe(2);
    expect(evidence.byAction.buy.meanReportedConfidence).toBeCloseTo(0.7);
    expect(evidence.byAction.sell.count).toBe(1);
    expect(evidence.byRegime.range.count).toBe(2);
    expect(evidence.recent[0]?.at).toBe(3_000);
    expect(evidence.recent[0]?.action).toBe("buy");
  });

  it("returns an explicit empty evidence summary when Jev has not proposed anything", () => {
    const evidence = buildJevEvidence([]) as { totalProposals: number; recent: unknown[] };
    expect(evidence.totalProposals).toBe(0);
    expect(evidence.recent).toEqual([]);
  });
});
