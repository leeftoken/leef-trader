/**
 * AI decision producer — the Jev (TypeSafe System One) execution seam.
 *
 * PURE and testable: no I/O, no signing, no keys, no wallet imports.
 * Jev supplies typed judgments over a code-owned market summary; the app
 * validates the proposal and the deterministic execution gauntlet remains
 * the only authority that can size, route, approve and sign a transaction.
 */
import { classifyRegime, dangerScore } from "./regime";
import type { JevAnswers, JevQuestion } from "./jev-client";
import { snapFreshAtMs, type LeefSnapshot } from "./types";

export type AiAction = "hold" | "buy" | "swap";
export type AiCandidateKind = "buy" | "swap" | "other" | "preview";

export interface AiProposal {
  action: AiAction;
  params: Record<string, string>;
  confidence: number;
  /** qid of the weakest judgment that produced `confidence`. */
  weakest: string;
  answers: JevAnswers;
  rationale: string;
  /** Time the answer arrived, not the time of the market data it judged. */
  fetchedAt: number;
  /** Source market snapshot time. Required for live CONTROL freshness checks. */
  snapshotFetchedAt?: string;
  /** Request start time, used to reject unexpectedly delayed responses. */
  requestedAt?: number;
  /** Model identifier returned by TypeSafe, retained for auditability. */
  model?: string;
  /** Deterministic candidate this judgement was restricted to. */
  candidateKind?: AiCandidateKind;
  /** Exact deterministic route candidate identity, not a model-generated value. */
  candidateKey?: string;
  /** Code-owned candidate details used for the dry-run UI and audit. */
  candidate?: AiCandidateSummary;
}

export interface AiCandidateSummary {
  kind: AiCandidateKind;
  key: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  amountUsd?: number;
  expectedOut?: number;
  expectedNetEdgePct?: number;
  priceImpactPct?: number;
  poolIds?: number[];
  hops?: number;
}

export interface AiProposalContext {
  snapshotFetchedAt: string;
  requestedAt: number;
  receivedAt: number;
  model: string;
  candidateKind: AiCandidateKind;
  candidateKey: string;
  candidate: AiCandidateSummary;
  allowedActions: readonly AiAction[];
}

/**
 * Minimum weakest-judgment confidence for an AI proposal to become an
 * execution candidate in CONTROL. It is a filter, not a claim of calibrated
 * 75% real-world accuracy; calibration must be measured against outcomes.
 */
export const AI_EXEC_CONFIDENCE_MIN = 0.75;
export const AI_PROPOSAL_MAX_AGE_MS = 120_000;
export const AI_RESPONSE_MAX_LATENCY_MS = 35_000;

/** Question ids — parseAiProposal relies on these exact keys. */
export const AI_QID = {
  action: "action",
  sizeBucket: "size_bucket",
  swapTokenIn: "swap_token_in",
  swapTokenOut: "swap_token_out",
  riskStress: "risk_stress",
  riskExecute: "risk_execute",
} as const;

const AI_ACTIONS: AiAction[] = ["hold", "buy", "swap"];

export const SIZE_BUCKET_PCT: Record<string, number> = { quarter: 25, half: 50, full: 100 };

/** Terse market/account summary sent as Jev state. No secrets, keys or memos. */
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
  positionEntryUsd: number;
  positionUnrealizedPct: number;
  positionHighUsd: number;
  positionMode: string | null;
  market: {
    quoteAgeMs: number;
    regime: string;
    volatilityPct: number;
    poolDislocationPct: number;
    dangerScore: number;
    dangerBand: string;
    deepestPoolUsd: number;
    recentEconomicFailures: number;
  };
  session: {
    trades: number;
    wins: number;
    realizedUsd: number;
    tradesThisHour: number;
    startEquityUsd: number;
  };
  riskLimits: {
    maxPositionUsd: number;
    minNetEdgePct: number;
    maxImpactPct: number;
    maxQuoteAgeSec: number;
  };
  topPools: {
    id: number;
    pair: string;
    feePct: number;
    tvlUsd: number;
    volume24Usd: number;
    change24: number;
  }[];
  /** Contract-aware token inventory for the model's context and audit trail. */
  tokenUniverse: { symbol: string; contract: string }[];
  /** The deterministic engine candidate Jev is judging this cycle. */
  candidateKind: AiCandidateKind;
  candidateKey: string;
  candidate: AiCandidateSummary;
  /** Actions permitted for this exact candidate; the parser enforces this set. */
  allowedActions: AiAction[];
}

/** Structural bot slice — avoids importing the Zustand store into this module. */
export interface AiBotSlice {
  quote?: string;
  base?: string;
  strategy: string;
  position: {
    amountLeef: number;
    entryUsd: number;
    highUsd: number;
    mode: "paper" | "live";
  } | null;
  series?: { t: number; usd: number }[];
  risk?: {
    maxQuoteAgeSec: number;
    maxPositionUsd: number;
    minNetEdgePct: number;
    maxImpactPct: number;
  };
  stats?: {
    trades: number;
    wins: number;
    realizedUsd: number;
    startEquityUsd: number;
  };
  decisions?: { kind: string; reason: string; t: string }[];
  tradesThisHour?: number;
}

/**
 * Build compact context from the same market and risk primitives used by the
 * engine. The model sees measured inputs, not a parallel AI-created market
 * interpretation. Candidate token symbols are still resolved by the
 * contract-aware route optimizer before any execution.
 */
export function aiSummaryOf(
  snap: LeefSnapshot,
  b: AiBotSlice,
  balances: Record<string, number>,
  candidateKind: AiCandidateKind = "other",
  candidateKey = "none",
  candidateDetails: Omit<AiCandidateSummary, "kind" | "key"> = {},
): AiSnapshotSummary {
  const quote = (b.quote || "WAX").toUpperCase();
  const base = (b.base || "LEEF").toUpperCase();
  const poolPricesUsd = snap.pools.map((p) => p.usdPerLeef ?? 0).filter((v) => v > 0);
  const regime = classifyRegime({ series: b.series ?? [], poolPricesUsd });
  const freshestAtMs = snapFreshAtMs(snap);
  const freshestAt = Number.isFinite(freshestAtMs)
    ? new Date(freshestAtMs).toISOString()
    : snap.fetchedAt;
  const quoteAgeMsRaw = Date.now() - freshestAtMs;
  const quoteAgeMs = Number.isFinite(quoteAgeMsRaw) ? Math.max(0, quoteAgeMsRaw) : 2_147_483_647;
  const recentEconomicFailures = (b.decisions ?? []).filter((d) => {
    const at = Date.parse(d.t);
    return d.kind === "error" && Number.isFinite(at) && Date.now() - at >= 0 &&
      Date.now() - at < 600_000 && /slippage|impact|liquidity|edge|price|market/i.test(d.reason);
  }).length;
  const deepestPoolUsd = Math.max(0, ...snap.pools.map((p) => p.tvlUsd));
  const danger = dangerScore({
    quoteAgeMs,
    maxQuoteAgeMs: Math.max(15, b.risk?.maxQuoteAgeSec ?? 30) * 1000,
    volPct: regime.volPct,
    dislocationPct: regime.dislocationPct,
    liquidityUsd: deepestPoolUsd,
    recentFailures: recentEconomicFailures,
  });

  const tokenMap = new Map<string, { symbol: string; contract: string }>();
  for (const p of snap.pools) {
    for (const token of [p.leef, p.pair]) {
      const symbol = token.symbol.toUpperCase();
      const contract = token.contract.toLowerCase();
      if (symbol && contract) tokenMap.set(symbol + "@" + contract, { symbol, contract });
    }
  }
  for (const p of snap.aux) {
    for (const token of [p.tokenA, p.tokenB]) {
      const symbol = token.symbol.toUpperCase();
      const contract = token.contract.toLowerCase();
      if (symbol && contract) tokenMap.set(symbol + "@" + contract, { symbol, contract });
    }
  }
  const tokenUniverse = [...tokenMap.values()].sort((a, c) =>
    a.symbol.localeCompare(c.symbol) || a.contract.localeCompare(c.contract),
  );
  const allowedActions: AiAction[] =
    candidateKind === "buy"
      ? ["hold", "buy"]
      : candidateKind === "swap"
        ? ["hold", "swap"]
        : candidateKind === "preview"
          ? ["hold", "buy"]
          : ["hold"];

  const position = b.position;
  const positionEntryUsd = position?.entryUsd ?? 0;
  const positionUnrealizedPct =
    positionEntryUsd > 0 && snap.leefUsd > 0
      ? ((snap.leefUsd / positionEntryUsd) - 1) * 100
      : 0;

  return {
    waxUsd: snap.waxUsd,
    leefUsd: snap.leefUsd,
    waxPerLeef: snap.waxPerLeef,
    fetchedAt: freshestAt,
    base,
    quote,
    strategy: b.strategy,
    balances: Object.fromEntries(
      Object.entries(balances).map(([s, n]) => [s, Number(n.toPrecision(6))]),
    ),
    positionUsd: position ? position.amountLeef * (snap.leefUsd || 0) : 0,
    positionAmount: position?.amountLeef ?? 0,
    positionEntryUsd,
    positionUnrealizedPct,
    positionHighUsd: position?.highUsd ?? 0,
    positionMode: position?.mode ?? null,
    market: {
      quoteAgeMs,
      regime: regime.regime,
      volatilityPct: regime.volPct,
      poolDislocationPct: regime.dislocationPct,
      dangerScore: danger.score,
      dangerBand: danger.band,
      deepestPoolUsd,
      recentEconomicFailures,
    },
    session: {
      trades: b.stats?.trades ?? 0,
      wins: b.stats?.wins ?? 0,
      realizedUsd: b.stats?.realizedUsd ?? 0,
      tradesThisHour: b.tradesThisHour ?? 0,
      startEquityUsd: b.stats?.startEquityUsd ?? 0,
    },
    riskLimits: {
      maxPositionUsd: b.risk?.maxPositionUsd ?? 0,
      minNetEdgePct: b.risk?.minNetEdgePct ?? 0,
      maxImpactPct: b.risk?.maxImpactPct ?? 0,
      maxQuoteAgeSec: b.risk?.maxQuoteAgeSec ?? 30,
    },
    topPools: [...snap.pools]
      .sort((a, c) => c.tvlUsd - a.tvlUsd)
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        pair: "LEEF/" + p.pair.symbol,
        feePct: p.feePct,
        tvlUsd: p.tvlUsd,
        volume24Usd: p.volume24Usd,
        change24: p.change24,
      })),
    tokenUniverse,
    candidateKind,
    candidateKey,
    candidate: { kind: candidateKind, key: candidateKey, ...candidateDetails },
    allowedActions,

  };
}

/**
 * One request, speculative fan-out: each question is independent and
 * structured. The model chooses only from actions the current loop can
 * actually execute; unsupported rebalancing/cancel actions are not offered.
 */
export function buildAiQuestions(summary: AiSnapshotSummary): Record<string, JevQuestion> {
  const actionCriteria: Record<string, string> = {
    hold: "Reject this candidate and do nothing this cycle.",
  };
  if (summary.allowedActions.includes("buy")) {
    actionCriteria.buy = "Accept the deterministic engine's already-generated buy candidate. Do not change its token pair or invent a route.";
  }
  if (summary.allowedActions.includes("swap")) {
    actionCriteria.swap = "Accept the deterministic engine's already-generated swap candidate. Do not change its token pair or invent a route.";
  }

  const questions: Record<string, JevQuestion> = {
    [AI_QID.action]: {
      type: "choice",
      instructions:
        "Judge ONLY state.candidate, the deterministic engine's already-generated candidate. Evaluate its token pair, amount, expected output/edge, route impact and pool path together with state.market and state.portfolio. Choose hold to reject it, or the matching candidate action to accept it. Never invent a new trade, change the candidate type, amount, token pair or route.",
      criteria: actionCriteria,
    },
    [AI_QID.riskStress]: {
      type: "noul",
      instructions:
        "Is the market under acute stress RIGHT NOW such that this candidate should be rejected? Consider state.market.regime, volatilityPct, poolDislocationPct, dangerScore, liquidity and recent failures.",
      criteria: {
        true: "Clear evidence of acute stress, cascade risk, dislocation or broken liquidity.",
        false: "Market is orderly enough for its observed liquidity and regime.",
      },
    },
    [AI_QID.riskExecute]: {
      type: "noul",
      instructions:
        "Is the supplied market, portfolio and token-universe evidence coherent and fresh enough to evaluate this candidate? Treat missing, stale, contradictory or ambiguous evidence as unsafe.",
      criteria: {
        true: "Evidence is coherent and fresh enough for a decision.",
        false: "Evidence is stale, incomplete, contradictory or unsafe to act on.",
      },
    },
  };

  if (summary.allowedActions.includes("buy") || summary.allowedActions.includes("swap")) {
    questions[AI_QID.sizeBucket] = {
      type: "choice",
      instructions:
        "IF the candidate is accepted, choose the fraction of its deployable input balance to request. The deterministic governor may reduce it further.",
      criteria: {
        quarter: "25% — cautious clip.",
        half: "50% — moderate clip.",
        full: "100% — full deployable amount, still subject to deterministic limits.",
      },
    };
  }
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
  if (
    typeof a.confidence !== "number" ||
    !Number.isFinite(a.confidence) ||
    a.confidence < 0 ||
    a.confidence > 1
  ) return null;
  return { choice: a.choice, confidence: a.confidence };
}

function noulOf(answers: JevAnswers, qid: string): number | null {
  const a = answers[qid];
  if (
    !a ||
    a.type !== "noul" ||
    typeof a.noul !== "number" ||
    !Number.isFinite(a.noul) ||
    a.noul < 0 ||
    a.noul > 1
  ) return null;
  return a.noul;
}

/**
 * Typed answers → a proposal. confidence = the weakest relevant judgment.
 * When context is supplied (all live call sites), swap tokens are checked
 * against the exact question's closed sets and the source snapshot/model are
 * attached for the execution freshness gate.
 */
export function parseAiProposal(
  answers: JevAnswers,
  context?: AiProposalContext,
): AiProposal | null {
  if (!answers || typeof answers !== "object") return null;
  const actionAns = choiceOf(answers, AI_QID.action);
  if (!actionAns || !(AI_ACTIONS as string[]).includes(actionAns.choice)) return null;
  const action = actionAns.choice as AiAction;
  if (context && !context.allowedActions.includes(action)) return null;
  if (context && action !== "hold" && action !== context.candidateKind) return null;

  const execOk = noulOf(answers, AI_QID.riskExecute);
  const stress = noulOf(answers, AI_QID.riskStress);
  if (execOk == null || stress == null) return null;

  const judgments: { qid: string; confidence: number }[] = [
    { qid: AI_QID.action, confidence: actionAns.confidence },
    { qid: AI_QID.riskExecute, confidence: noulConfidence(execOk) },
    { qid: AI_QID.riskStress, confidence: noulConfidence(stress) },
  ];
  const params: Record<string, string> = {};
  const rationale: string[] = ["action=" + action + " p=" + actionAns.confidence.toFixed(2)];

  if (action !== "hold") {
    // Acting on incoherent data is never usable. Exits still require coherent data.
    if (execOk < 0.5) return null;
  }
  if (action === "buy" || action === "swap") {
    // Acute stress vetoes entries and discretionary swaps.
    if (stress > 0.5) return null;
    const size = choiceOf(answers, AI_QID.sizeBucket);
    if (!size || !(size.choice in SIZE_BUCKET_PCT)) return null;
    params.sizePct = String(SIZE_BUCKET_PCT[size.choice]);
    judgments.push({ qid: AI_QID.sizeBucket, confidence: size.confidence });
    rationale.push("size=" + size.choice + " p=" + size.confidence.toFixed(2));
  }

  if (action === "swap") {
    // The token pair belongs to the deterministic candidate, never to Jev.
    const candidate = context?.candidate;
    if (!candidate?.tokenIn || !candidate.tokenOut || candidate.tokenIn === candidate.tokenOut) {
      if (context) return null;
    } else {
      params.tokenIn = candidate.tokenIn;
      params.tokenOut = candidate.tokenOut;
      rationale.push(candidate.tokenIn + "→" + candidate.tokenOut);
    }
  }

  rationale.push("exec_ok=" + execOk.toFixed(2), "stress=" + stress.toFixed(2));
  let weakest = judgments[0]!;
  for (const j of judgments) if (j.confidence < weakest.confidence) weakest = j;

  return {
    action,
    params,
    confidence: weakest.confidence,
    weakest: weakest.qid,
    answers,
    rationale: rationale.join(" · "),
    fetchedAt: context?.receivedAt ?? Date.now(),
    ...(context
      ? {
          snapshotFetchedAt: context.snapshotFetchedAt,
          requestedAt: context.requestedAt,
          model: context.model,
          candidateKind: context.candidateKind,
          candidateKey: context.candidateKey,
          candidate: context.candidate,
        }
      : {}),
  };
}

/**
 * A live proposal must refer to a recent source snapshot, have arrived after
 * its request began, and have completed within the proxy's bounded timeout.
 * Missing metadata fails closed; old session/dry-run proposals cannot trade.
 */
export function isAiProposalFresh(
  proposal: AiProposal | null | undefined,
  currentSnapshotFetchedAt: string,
  now: number = Date.now(),
  maxAgeMs: number = AI_PROPOSAL_MAX_AGE_MS,
): boolean {
  if (!proposal || !proposal.snapshotFetchedAt || !proposal.model || !proposal.candidateKind || !proposal.candidateKey) return false;
  const sourceAt = Date.parse(proposal.snapshotFetchedAt);
  const currentAt = Date.parse(currentSnapshotFetchedAt);
  if (!Number.isFinite(sourceAt) || !Number.isFinite(currentAt)) return false;
  if (sourceAt > now || currentAt > now || currentAt < sourceAt - 5_000) return false;
  if (now - sourceAt > maxAgeMs || currentAt - sourceAt > maxAgeMs) return false;
  if (!Number.isFinite(proposal.fetchedAt) || proposal.fetchedAt > now) return false;
  if (now - proposal.fetchedAt > maxAgeMs) return false;
  if (
    proposal.requestedAt == null ||
    !Number.isFinite(proposal.requestedAt) ||
    proposal.requestedAt > proposal.fetchedAt ||
    proposal.fetchedAt - proposal.requestedAt > AI_RESPONSE_MAX_LATENCY_MS
  ) return false;
  return true;
}
