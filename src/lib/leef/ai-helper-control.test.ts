import { describe, expect, it } from "vitest";
import {
  AI_HELPER_REVIEW_CONFIDENCE_MIN,
  evaluateAiHelperReview,
  isAiProposalFresh,
  parseAiHelperReview,
  type AiHelperCandidate,
} from "./ai-helper-control";

const now = Date.parse("2026-11-15T12:00:00.000Z");
const candidate: AiHelperCandidate = {
  proposalId: "jev:217:buy:half",
  action: "buy",
  snapshotFetchedAt: "2026-11-15T11:59:50.000Z",
  proposedAt: now - 5_000,
};

function response(over: Record<string, unknown> = {}) {
  return {
    control_review: {
      candidate_id: candidate.proposalId,
      decision: "approve",
      confidence: 0.92,
      risk_flags: [],
      reason: "The candidate clears the strategic review.",
      ...over,
    },
  };
}

describe("parseAiHelperReview", () => {
  it("accepts a well-formed review bound to the exact Jev candidate", () => {
    const review = parseAiHelperReview(response(), candidate, {
      reviewedAt: now,
      model: "helper-model",
    });
    expect(review).not.toBeNull();
    expect(review?.decision).toBe("approve");
    expect(review?.candidateId).toBe(candidate.proposalId);
    expect(review?.confidence).toBe(0.92);
  });

  it("rejects reviews for a different candidate", () => {
    expect(
      parseAiHelperReview(
        response({ candidate_id: "another-candidate" }),
        candidate,
        { reviewedAt: now },
      ),
    ).toBeNull();
  });

  it("rejects malformed, missing, or out-of-range confidence", () => {
    expect(parseAiHelperReview({}, candidate, { reviewedAt: now })).toBeNull();
    expect(
      parseAiHelperReview(response({ confidence: 1.1 }), candidate, { reviewedAt: now }),
    ).toBeNull();
    expect(
      parseAiHelperReview(response({ confidence: "0.99" }), candidate, { reviewedAt: now }),
    ).toBeNull();
  });

  it("accepts veto and abstain as valid non-approval decisions", () => {
    expect(
      parseAiHelperReview(response({ decision: "veto" }), candidate, { reviewedAt: now })?.decision,
    ).toBe("veto");
    expect(
      parseAiHelperReview(response({ decision: "abstain" }), candidate, { reviewedAt: now })?.decision,
    ).toBe("abstain");
  });
});


  it("rejects Jev proposals with invalid, stale, or future source timestamps", () => {
    const freshProposal = {
      fetchedAt: now - 1_000,
      snapshotFetchedAt: new Date(now - 10_000).toISOString(),
    };
    expect(isAiProposalFresh(freshProposal, now)).toBe(true);
    expect(isAiProposalFresh({
      ...freshProposal,
      snapshotFetchedAt: new Date(now - 120_000).toISOString(),
    }, now)).toBe(false);
    expect(isAiProposalFresh({
      ...freshProposal,
      fetchedAt: now + 10_000,
    }, now)).toBe(false);
    expect(isAiProposalFresh({
      ...freshProposal,
      snapshotFetchedAt: "not-a-date",
    }, now)).toBe(false);
  });

describe("evaluateAiHelperReview", () => {
  it("requires a fresh high-confidence approval with no risk flags for entries", () => {
    const review = parseAiHelperReview(response(), candidate, { reviewedAt: now })!;
    expect(evaluateAiHelperReview(review, candidate, now).allowed).toBe(true);
    expect(evaluateAiHelperReview(review, candidate, now).reason).toContain("approved");
    expect(AI_HELPER_REVIEW_CONFIDENCE_MIN).toBeGreaterThanOrEqual(0.8);
  });

  it("fails closed when there is no review or it abstains", () => {
    expect(evaluateAiHelperReview(null, candidate, now).allowed).toBe(false);
    const abstain = parseAiHelperReview(response({ decision: "abstain" }), candidate, {
      reviewedAt: now,
    })!;
    expect(evaluateAiHelperReview(abstain, candidate, now).allowed).toBe(false);
  });

  it("blocks vetoes, risk flags and low confidence", () => {
    const veto = parseAiHelperReview(response({ decision: "veto" }), candidate, {
      reviewedAt: now,
    })!;
    const flagged = parseAiHelperReview(
      response({ risk_flags: ["liquidity deterioration"] }),
      candidate,
      { reviewedAt: now },
    )!;
    const weak = parseAiHelperReview(response({ confidence: 0.79 }), candidate, {
      reviewedAt: now,
    })!;
    expect(evaluateAiHelperReview(veto, candidate, now).allowed).toBe(false);
    expect(evaluateAiHelperReview(flagged, candidate, now).allowed).toBe(false);
    expect(evaluateAiHelperReview(weak, candidate, now).allowed).toBe(false);
  });

  it("rejects stale or future-dated reviews and stale source snapshots", () => {
    const staleReview = parseAiHelperReview(response(), candidate, {
      reviewedAt: now - 60_000,
    })!;
    const futureReview = parseAiHelperReview(response(), candidate, {
      reviewedAt: now + 10_000,
    })!;
    const staleCandidate = {
      ...candidate,
      snapshotFetchedAt: "2026-11-15T11:57:00.000Z",
    };
    const stale = parseAiHelperReview(response(), staleCandidate, { reviewedAt: now })!;
    expect(evaluateAiHelperReview(staleReview, candidate, now).allowed).toBe(false);
    expect(evaluateAiHelperReview(futureReview, candidate, now).allowed).toBe(false);
    expect(evaluateAiHelperReview(stale, staleCandidate, now).allowed).toBe(false);
  });

  it("never lets the helper delay or veto risk-reducing exits", () => {
    const sellCandidate = { ...candidate, action: "sell" as const };
    const reduceCandidate = { ...candidate, action: "reduce_risk" as const };
    expect(evaluateAiHelperReview(null, sellCandidate, now).allowed).toBe(true);
    expect(evaluateAiHelperReview(null, reduceCandidate, now).allowed).toBe(true);
  });

  it("does not reuse a review for another candidate", () => {
    const review = parseAiHelperReview(response(), candidate, { reviewedAt: now })!;
    expect(
      evaluateAiHelperReview(review, { ...candidate, proposalId: "different" }, now).allowed,
    ).toBe(false);
  });
});
