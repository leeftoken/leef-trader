/**
 * AI decision producer — the Jev (TypeSafe System One) execution seam.
 *
 * PURE and testable: no I/O, no signing, no keys, no wallet imports.
 * Jev supplies typed judgments over a market summary; code keeps control:
 * this module only builds questions and parses a proposal. The bot loop
 * gates the proposal (confidence floor + freshness) and routes it through
 * the unchanged execution gauntlet when — and only when — the user granted
 * "control".
 */
import type { JevAnswers, JevQuestion } from "./jev-client";
import type { LeefSnapshot } from "./types";

export type AiAction = "hold" | "buy" | "sell" | "swap" | "rebalance" | "reduce_risk" | "cancel_all";

export interface AiProposal {
  action: AiAction;
  /** Identity of the deterministic engine opportunity Jev reviewed. */
  engineCandidateId: string;
  params: Record<string, string>;
  confidence: number;
  /** qid of the weakest judgment that produced `confidence`. */
  weakest: string;
  answers: JevAnswers;
  rationale: string;
  /** Unique identity bound to the exact source snapshot and proposal arguments. */
  proposalId: string;
  snapshotFetchedAt: string;
  model: string;
  fetchedAt: number;
}

export interface AiProposalMetadata {
  snapshotFetchedAt: string;
  engineCandidateId?: string;
  model: string;
  receivedAt?: number;
}

/**
 * Minimum weakest-judgment confidence for an AI proposal to become an
 * execution candidate in "control" mode. Below it the proposal is advisory
 * only (logged, never executed). 0.75 means every relevant judgment —
 * action choice, its arguments, and the risk nouls — is at least 3:1 sure.
 */
export const AI_EXEC_CONFIDENCE_MIN = 0.75;

/** Question ids — parseAiProposal relies on these exact keys. */
export const AI_QID = {
  action: "action",
  sizeBucket: "size_bucket",
  swapTokenIn: "swap_token_in",
  swapTokenOut: "swap_token_out",
  riskStress: "risk_stress",
  riskExecute: "risk_execute",
} as const;

const AI_ACTIONS: AiAction[] = ["hold", "buy"];

/** Actions permitted to reach execution while Jev CONTROL is active. */
export type AiControlEngineAction = "buy" | "sell" | "swap" | "arb" | "hold" | "stop";

export function isAiControlActionSupported(action: AiControlEngineAction): boolean {
  // BUY has the candidate-bound Jev review; SELL/STOP remain engine-protective;
  // HOLD is a no-op. SWAP/ARB need their own review contracts before support.
  return action === "buy" || action === "sell" || action === "hold" || action === "stop";
}

export const SIZE_BUCKET_PCT: Record<string, number> = { quarter: 25, half: 50, full: 100 };

/** One deterministic BUY candidate; Jev can confirm or reject it, never replace it. */
export interface AiEngineCandidate {
  id: string;
  snapshotFetchedAt: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  routeSignature: string;
  netEdgePct: number | null;
  priceImpactPct: number;
  reason: string;
}

/** Terse market/account summary sent as Jev `state`. No secrets, no keys. */
export interface AiSnapshotSummary {
  waxUsd: number;
  leefUsd: number;
  waxPerLeef: number;
  fetchedAt: string;
  base: string;
  quote: string;
  strategy: string;
  balances: Record<string, number>;
  positionUsd: number;
  positionAmount: number;
  topPools: {
    id: number;
    pair: string;
    feePct: number;
    tvlUsd: number;
    volume24Usd: number;
    change24: number;
  }[];
  /** Present only when the deterministic engine has a viable BUY opportunity. */
  engineCandidate?: AiEngineCandidate;
}

/** Structural bot slice for summary building — avoids a store import here. */
export interface AiBotSlice {
  quote?: string;
  base?: string;
  strategy: string;
  position: { amountLeef: number } | null;
}

/**
 * Compact, code-owned market summary for the Jev state payload. Closed sets
 * for the per-arg questions come from held balances plus the traded pair.
 */
export function aiSummaryOf(
  snap: LeefSnapshot,
  b: AiBotSlice,
  balances: Record<string, number>,
): AiSnapshotSummary {
  const quote = (b.quote || "WAX").toUpperCase();
  const base = (b.base || "LEEF").toUpperCase();
  return {
    waxUsd: snap.waxUsd,
    leefUsd: snap.leefUsd,
    waxPerLeef: snap.waxPerLeef,
    fetchedAt: snap.fetchedAt,
    base,
    quote,
    strategy: b.strategy,
    balances: Object.fromEntries(
      Object.entries(balances).map(([s, n]) => [s, Number(n.toPrecision(6))]),
    ),
    positionUsd: b.position ? b.position.amountLeef * (snap.leefUsd || 0) : 0,
    positionAmount: b.position?.amountLeef ?? 0,
    topPools: snap.pools.slice(0, 5).map((p) => ({
      id: p.id,
      pair: `LEEF/${p.pair.symbol}`,
      feePct: p.feePct,
      tvlUsd: p.tvlUsd,
      volume24Usd: p.volume24Usd,
      change24: p.change24,
    })),

  };
}

/**
 * One request, speculative fan-out: the action choice plus every per-arg
 * closed-set question and the risk nouls. Code asks everything up front and
 * ignores answers it does not need (Jev questions are parallel and cheap).
 */
export function buildAiQuestions(summary: AiSnapshotSummary): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    [AI_QID.action]: {
      type: "choice",
      instructions: summary.engineCandidate
        ? "You are an independent entry reviewer. The deterministic trading engine has already produced state.engineCandidate and passed its earlier eligibility checks. Decide only whether to execute THIS EXACT candidate or hold. Never invent another trade, token, route, amount, or risk limit. Choose hold whenever the evidence is uncertain, contradictory, stale, or unattractive after costs."
        : "This is an advisory dry-run without a deterministic live candidate. Assess only the configured base/quote pair and choose hold unless a hypothetical entry is clearly justified. This response is not eligible for automatic execution.",
      criteria: {
        hold: "Do not execute; keep the deterministic candidate on hold.",
        buy: summary.engineCandidate
          ? `Execute exact candidate ${summary.engineCandidate.tokenIn}→${summary.engineCandidate.tokenOut}, amount ${summary.engineCandidate.amountIn}, route ${summary.engineCandidate.routeSignature}, net edge ${summary.engineCandidate.netEdgePct ?? "unknown"}%, impact ${summary.engineCandidate.priceImpactPct.toFixed(3)}%; do not alter it.`
          : `Hypothetically consider entering ${summary.base} using ${summary.quote}; advisory only.`,
      },
    },
    [AI_QID.sizeBucket]: {
      type: "choice",
      instructions: "IF the exact engine-generated BUY candidate were approved, what fraction of its existing proposed amount should remain? Choose a fraction only to reduce the candidate size, never increase it.",
      criteria: {
        quarter: "25% — cautious clip.",
        half: "50% — moderate.",
        full: "100% — full size.",
      },
    },
    [AI_QID.riskStress]: {
      type: "noul",
      instructions: "Is the market in `state` under acute stress RIGHT NOW (crash, cascade, or broken/illiquid books) such that new entries are dangerous?",
      criteria: {
        true: "Clear signs of acute stress or broken books.",
        false: "Market looks orderly for its usual liquidity.",
      },
    },
    [AI_QID.riskExecute]: {
      type: "noul",
      instructions: "Is the market data in `state` coherent and fresh enough that executing a trade on it right now is safe?",
      criteria: {
        true: "Prices, pools and balances look coherent and tradable.",
        false: "Data looks stale, contradictory, or unsafe to act on.",
      },
    },
  };
  return questions;
}

/** Noul → confidence in whichever side it picked (0.5 = pure uncertainty). */
function noulConfidence(noul: number): number {
  return Math.abs(noul - 0.5) * 2;
}

function choiceOf(
  answers: JevAnswers,
  qid: string,
): { choice: string; confidence: number } | null {
  const a = answers[qid];
  if (!a || a.type !== "choice" || typeof a.choice !== "string") return null;
  if (typeof a.confidence !== "number" || !Number.isFinite(a.confidence)) return null;
  if (a.confidence < 0 || a.confidence > 1) return null;
  return { choice: a.choice, confidence: a.confidence };
}

function noulOf(answers: JevAnswers, qid: string): number | null {
  const a = answers[qid];
  if (!a || a.type !== "noul" || typeof a.noul !== "number" || !Number.isFinite(a.noul)) {
    return null;
  }
  if (a.noul < 0 || a.noul > 1) return null;
  return a.noul;
}

/**
 * Typed answers → a proposal. confidence = the WEAKEST relevant judgment
 * (action choice, its arguments, the risk nouls). Returns null when the
 * answers are unusable: unsupported actions, missing/malformed judgments,
 * or the risk nouls contradict the entry (unsafe-to-act data or acute stress).
 */
export function parseAiProposal(
  answers: JevAnswers,
  metadata?: AiProposalMetadata,
): AiProposal | null {
  if (!answers || typeof answers !== "object") return null;
  const actionAns = choiceOf(answers, AI_QID.action);
  if (!actionAns || !(AI_ACTIONS as string[]).includes(actionAns.choice)) return null;
  const action = actionAns.choice as AiAction;

  const execOk = noulOf(answers, AI_QID.riskExecute);
  const stress = noulOf(answers, AI_QID.riskStress);
  if (execOk == null || stress == null) return null;

  const judgments: { qid: string; confidence: number }[] = [
    { qid: AI_QID.action, confidence: actionAns.confidence },
    { qid: AI_QID.riskExecute, confidence: noulConfidence(execOk) },
    { qid: AI_QID.riskStress, confidence: noulConfidence(stress) },
  ];

  const params: Record<string, string> = {};
  const rationale: string[] = [`action=${action} p=${actionAns.confidence.toFixed(2)}`];

  if (action !== "hold") {
    // Acting on incoherent data is never usable.
    if (execOk < 0.5) return null;
  }
  if (action === "buy") {
    if (!metadata?.engineCandidateId) return null;
    const size = choiceOf(answers, AI_QID.sizeBucket);
    if (!size || !(size.choice in SIZE_BUCKET_PCT)) return null;
    params.sizePct = String(SIZE_BUCKET_PCT[size.choice]);
    judgments.push({ qid: AI_QID.sizeBucket, confidence: size.confidence });
    rationale.push(`size=${size.choice} p=${size.confidence.toFixed(2)}`);
    // Acute stress vetoes new entries; Jev cannot veto deterministic exits.
    if (stress > 0.5) return null;
  }
  rationale.push(`exec_ok=${execOk.toFixed(2)}`, `stress=${stress.toFixed(2)}`);

  let weakest = judgments[0]!;
  for (const j of judgments) if (j.confidence < weakest.confidence) weakest = j;

  const receivedAt = metadata?.receivedAt ?? Date.now();
  const snapshotFetchedAt = metadata?.snapshotFetchedAt ?? new Date(receivedAt).toISOString();
  const snapshotMs = Date.parse(snapshotFetchedAt);
  if (!Number.isFinite(receivedAt) || !Number.isFinite(snapshotMs) || snapshotMs > receivedAt + 2_000) {
    return null;
  }
  const engineCandidateId = metadata?.engineCandidateId ?? "advisory-dry-run";
  const proposalId = [
    "jev",
    snapshotMs,
    engineCandidateId,
    action,
    params.sizePct ?? "",
  ].join(":");

  return {
    action,
    params,
    confidence: weakest.confidence,
    weakest: weakest.qid,
    answers,
    rationale: rationale.join(" · "),
    proposalId,
    engineCandidateId,
    snapshotFetchedAt,
    model: metadata?.model ?? "unknown",
    fetchedAt: receivedAt,
  };
}
