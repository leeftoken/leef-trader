/**
 * AI auto-review — the analyst looks at the evidence every N trades and
 * proposes typed learning artifacts. Never per-trade, never on the decision
 * path, never blocking: the engine trades on while the review is in flight,
 * and a failed review is a journal line, not an incident.
 *
 *   every N executions (default 8, user-set 5/10/20)
 *     → evidence_review (journal stats + pool profiles + artifacts)
 *     → learning_artifacts proposals
 *     → governor pre-validation (injectArtifacts)
 *     → shadow → promotion per the learning mode
 *
 * The AI discovers; statistics decide. OFF mode = zero auto calls.
 */
import {
  aiBudget,
  aiTask,
  DEFAULT_AI_GATEWAY,
} from "./ai-analyst";
import {
  bucketMeanEdge,
  extractLearningArtifacts,
  DEFAULT_LEARNING_CONFIG,
  SIZE_BUCKET_LABELS,
} from "./learning";
import {
  bootLearningFromJournal,
  getArtifacts,
  getProfiles,
  injectArtifacts,
  refreshProposals,
} from "./learning-store";
import { aggregateEntries, journal, type JournalEntry } from "./journal";

/**
 * Compact, structured Jev evidence for the strategic AI Helper. Confidence is
 * model-reported, not proven calibration; these summaries are for pattern
 * discovery only and never authorize a trade or change a risk limit.
 */
export function buildJevEvidence(entries: JournalEntry[]): Record<string, unknown> {
  const proposals = entries
    .filter((e) => e.kind === "ai" && e.aiSource === "jev" && e.decision && Number.isFinite(e.confidence))
    .sort((a, b) => b.ts - a.ts);
  const summarize = (items: JournalEntry[]) => {
    const values = items
      .map((e) => e.confidence)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
    return {
      count: items.length,
      meanReportedConfidence: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
    };
  };
  const byAction: Record<string, JournalEntry[]> = {};
  const byRegime: Record<string, JournalEntry[]> = {};
  for (const entry of proposals) {
    const action = entry.decision ?? "unknown";
    const regime = entry.regime ?? "unknown";
    (byAction[action] ??= []).push(entry);
    (byRegime[regime] ??= []).push(entry);
  }
  return {
    totalProposals: proposals.length,
    note:
      "Jev confidence is model-reported, not calibrated accuracy. Proposal counts and confidence do not prove profitability. Do not infer a proposal's outcome unless a matching execution record exists.",
    byAction: Object.fromEntries(Object.entries(byAction).map(([key, items]) => [key, summarize(items)])),
    byRegime: Object.fromEntries(Object.entries(byRegime).map(([key, items]) => [key, summarize(items)])),
    recent: proposals.slice(0, 25).map((e) => ({
      at: e.ts,
      action: e.decision,
      confidence: e.confidence,
      model: e.aiModel,
      snapshotAt: e.aiSnapshotAt,
      strategy: e.strategy,
      mode: e.mode,
      regime: e.regime,
      volatilityPct: e.volPct,
      dangerScore: e.dangerScore,
    })),
  };
}

/** The evidence_review payload — shared by the desk button and auto-review. */
export async function evidenceReviewContext(): Promise<Record<string, unknown>> {
  const entries = await bootLearningFromJournal();
  refreshProposals();
  const poolProfiles = Object.values(getProfiles())
    .filter((p) => p.kind === "pool")
    .sort((a, b) => b.executions - a.executions)
    .slice(0, 10)
    .map((p) => ({
      key: p.key,
      pool: p.label,
      executions: p.executions,
      confirmed: p.buckets.reduce((s, b) => s + b.confirmed, 0),
      ewmaSlippagePct: p.ewmaSlipPct,
      gateFails: p.gateFails,
      regimes: Object.fromEntries(
        Object.entries(p.byRegime).map(([r, s]) => [
          r,
          { samples: s.samples, confirmed: s.confirmed },
        ]),
      ),
      sizeCurve: p.buckets
        .map((b, i) =>
          b.confirmed >= 3
            ? { bucket: SIZE_BUCKET_LABELS[i], meanRealizedEdgePct: bucketMeanEdge(b) }
            : null,
        )
        .filter(Boolean),
    }));
  return {
    instruction:
      "Review the evidence and the structured Jev proposal history. Treat model-reported " +
      "confidence as uncalibrated until paired with outcomes; do not infer profitability " +
      "from confidence alone. If — and only if — the data supports it, you may add a " +
      "`learning_artifacts` array of {type, scopeKey, value, confidence, reason}. " +
      "type must be POOL_SLIPPAGE_PROFILE (expected realized slippage %, 0.02–0.75) or " +
      "POOL_SIZE_MULTIPLIER (size-ceiling factor, 0.5–1.0; 1 = no constraint). scopeKey " +
      "must be a `key` from poolProfiles. Every proposal is shadow-tested by the " +
      "deterministic LearningGovernor before it can affect anything.",
    stats: aggregateEntries(entries),
    jevEvidence: buildJevEvidence(entries),
    poolProfiles,
    artifacts: getArtifacts().map((a) => ({
      id: a.id,
      status: a.status,
      value: a.value,
      samples: a.samples,
      confidence: a.confidence,
      shadowSamples: a.shadow.n,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                            */
/* ------------------------------------------------------------------ */

let lastReviewAt = 0;
let tradesAtLastReview = 0;
let reviewInFlight = false;
let lastNote = "never run";
let lastProposalCount = 0;

export function autoReviewStatus(): {
  lastReviewAt: number;
  tradesAtLastReview: number;
  inFlight: boolean;
  note: string;
  lastProposalCount: number;
} {
  return { lastReviewAt, tradesAtLastReview, inFlight: reviewInFlight, note: lastNote, lastProposalCount };
}

/** Minimum wall time between auto-reviews regardless of trade cadence. */
const MIN_REVIEW_GAP_MS = 5 * 60_000;

export async function maybeAutoReview(opts: {
  aiEnabled: boolean;
  running: boolean;
  trades: number;
  everyTrades: number;
  gatewayUrl?: string;
}): Promise<void> {
  if (!opts.aiEnabled || !opts.running || reviewInFlight) return;
  const every = Math.max(3, Math.min(50, Math.round(opts.everyTrades)));
  if (opts.trades - tradesAtLastReview < every) return;
  if (Date.now() - lastReviewAt < MIN_REVIEW_GAP_MS) return;
  if (aiBudget().remaining <= 0) {
    lastNote = "rate budget exhausted";
    return;
  }
  reviewInFlight = true;
  try {
    const data = await evidenceReviewContext();
    const res = await aiTask("evidence_review", data, { url: opts.gatewayUrl ?? DEFAULT_AI_GATEWAY });
    const proposed = extractLearningArtifacts(
      res.content,
      getProfiles(),
      Date.now(),
      DEFAULT_LEARNING_CONFIG,
      { slippagePct: 0.05 },
    );
    const r = proposed.length > 0 ? injectArtifacts(proposed) : { added: 0, rejected: 0 };
    lastReviewAt = Date.now();
    tradesAtLastReview = opts.trades;
    lastProposalCount = r.added;
    lastNote = `ok · ${r.added} proposed · ${r.rejected} rejected`;
    journal({
      kind: "ai",
      reason: `auto evidence_review (every ${every} trades): ${lastNote} · ${res.raw.slice(0, 120)}`,
      latencyMs: res.latencyMs,
    });
  } catch (err) {
    // Failure is a journal line, never an incident. Skip to the next cadence.
    tradesAtLastReview = opts.trades;
    lastNote = err instanceof Error ? err.message : "failed";
    journal({ kind: "ai", reason: `auto evidence_review: failed · ${lastNote}` });
  } finally {
    reviewInFlight = false;
  }
}
