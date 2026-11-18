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

export type AiAction = "hold" | "buy" | "swap" | "arb";
export type AiCandidateKind = "buy" | "swap" | "arb" | "other" | "preview";

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
  /** Atomic round-trip intent; present only for arb candidates. */
  arbKind?: "volume" | "spread";
  tokenIn?: string;
  tokenInContract?: string;
  tokenOut?: string;
  tokenOutContract?: string;
  amountIn?: number;
  amountUsd?: number;
  expectedOut?: number;
  expectedNetEdgePct?: number;
  priceImpactPct?: number;
  liquidityUsd?: number;
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

/** The only TypeSafe field: P(yes) = approve this exact candidate. */
export const AI_QID = {
  tradeDecision: "trade_decision",
} as const;

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
  performance: {
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

  // Bound prompt size: include the ten deepest primary pools plus every
  // pool on the current candidate route, and a small aux sample. Never ship
  // the full discovery universe to Jev.
  const candidatePoolIds = new Set(candidateDetails.poolIds ?? []);
  const topPoolIds = new Set(
    [...snap.pools]
      .sort((a, c) => c.tvlUsd - a.tvlUsd)
      .slice(0, 10)
      .map((p) => p.id),
  );
  const topAuxIds = new Set(snap.aux.slice(0, 10).map((p) => p.id));
  const displayPoolIds = new Set(
    [...snap.pools]
      .sort((a, c) => c.tvlUsd - a.tvlUsd)
      .slice(0, 5)
      .map((p) => p.id),
  );
  candidatePoolIds.forEach((id) => displayPoolIds.add(id));
  const tokenMap = new Map<string, { symbol: string; contract: string }>();
  for (const p of snap.pools) {
    if (!candidatePoolIds.has(p.id) && !topPoolIds.has(p.id)) continue;
    for (const token of [p.leef, p.pair]) {
      const symbol = token.symbol.toUpperCase();
      const contract = token.contract.toLowerCase();
      if (symbol && contract) tokenMap.set(symbol + "@" + contract, { symbol, contract });
    }
  }
  for (const p of snap.aux) {
    if (!candidatePoolIds.has(p.id) && !topAuxIds.has(p.id)) continue;
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
        : candidateKind === "arb"
          ? ["hold", "arb"]
          : candidateKind === "preview"
            ? ["hold", "buy"]
            : ["hold"];
  const uniqueContract = (symbol: string): string | undefined => {
    const matches = tokenUniverse.filter((t) => t.symbol === symbol);
    return matches.length === 1 ? matches[0]!.contract : undefined;
  };
  const resolvedCandidateDetails =
    candidateKind === "preview"
      ? {
          tokenIn: quote,
          tokenInContract: uniqueContract(quote),
          tokenOut: base,
          tokenOutContract: uniqueContract(base),
          amountIn: balances[quote] ?? 0,
          ...candidateDetails,
        }
      : candidateDetails;

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
    performance: {
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
      .filter((p) => displayPoolIds.has(p.id))
      .sort((a, c) => c.tvlUsd - a.tvlUsd)
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
    candidate: { kind: candidateKind, key: candidateKey, ...resolvedCandidateDetails },
    allowedActions,

  };
}

/**
 * One request, speculative fan-out: each question is independent and
 * structured. The model chooses only from actions the current loop can
 * actually execute; unsupported rebalancing/cancel actions are not offered.
 */
export function buildAiQuestions(summary: AiSnapshotSummary): Record<string, JevQuestion> {
  const action = summary.candidateKind === "preview"
    ? "buy"
    : summary.candidateKind;
  const hasOneExecutableAction =
    (action === "buy" || action === "swap" || action === "arb") &&
    summary.allowedActions.filter((a) => a !== "hold").length === 1 &&
    summary.allowedActions.includes(action);

  const actionDescription = action === "arb"
    ? "the exact atomic quote→base→quote arbitrage"
    : action === "swap"
      ? "the exact inventory swap"
      : "the exact directional buy";

  return {
    [AI_QID.tradeDecision]: {
      type: "noul",
      instructions:
        "Return YES only if the exact candidate in state.candidate should execute NOW. " +
        "Return NO if its expected net result after LP/platform fees, price impact, liquidity, " +
        "route complexity, pool concentration, market regime, price freshness, wallet/position " +
        "limits or recent execution evidence makes it unattractive or unsafe. " +
        "This is a WAX micro-liquidity market: small positive net opportunities can be valid; " +
        "do not apply large-chain volume/liquidity assumptions. But never approve a route whose " +
        "economics are negative merely to print volume. Consider the LEEF pool and multi-pool " +
        "routing context shown, but judge only this one code-generated candidate. " +
        `The only allowed candidate action is ${hasOneExecutableAction ? action : "none"} (${actionDescription}). ` +
        "Do not invent trades, change token contracts, resize the amount, select different pools, " +
        "change route hops, or sign anything. Missing, stale, contradictory or incomplete evidence means NO. " +
        "The deterministic engine and exact venue/risk gates remain authoritative.",
      criteria: {
        true: "YES — this exact candidate is worth attempting on its current evidence and bounded economics.",
        false: "NO — reject this candidate; do not trade this cycle.",
      },
    },
  };
}

export function buildAiCandidateKey(
  strategy: string,
  kind: AiCandidateKind,
  candidate: Omit<AiCandidateSummary, "kind" | "key">,
  routeSignature: string,
): string {
  const finite = (value: number | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const token = (value: string | undefined, upper = false): string | null => {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    return upper ? value.trim().toUpperCase() : value.trim().toLowerCase();
  };
  const fingerprint = [
    "jev-candidate-v1",
    strategy,
    kind,
    token(candidate.tokenIn, true),
    token(candidate.tokenInContract),
    token(candidate.tokenOut, true),
    token(candidate.tokenOutContract),
    candidate.arbKind ?? null,
    finite(candidate.amountIn),
    finite(candidate.amountUsd),
    finite(candidate.expectedOut),
    finite(candidate.expectedNetEdgePct),
    finite(candidate.priceImpactPct),
    finite(candidate.liquidityUsd),
    Array.isArray(candidate.poolIds) ? candidate.poolIds : [],
    finite(candidate.hops),
    routeSignature,
  ];
  return JSON.stringify(fingerprint);
}

function noulOf(answers: JevAnswers, qid: string): number | null {
  const a = answers[qid];
  if (!a || a.type.trim().toLowerCase() !== "noul") return null;
  // The canonical gateway field is noul (P(true)); accept the equivalent
  // boolean probability map used by some TypeSafe response adapters.
  const mapped = a.probabilities?.true ?? a.probabilities?.yes ?? a.probabilities?.["1"];
  const noul = typeof a.noul === "number" ? a.noul : mapped;
  if (
    typeof noul !== "number" ||
    !Number.isFinite(noul) ||
    noul < 0 ||
    noul > 1
  ) return null;
  return noul;
}

/**
 * Typed answers → a proposal. confidence = the weakest relevant judgment.
 * When context is supplied (all live call sites), action and candidate identity
 * are checked against the exact engine-generated candidate; swap token details
 * come from code-owned candidate data, never from model-selected strings.
 */
export function parseAiProposal(
  answers: JevAnswers,
  context?: AiProposalContext,
): AiProposal | null {
  if (!context || !answers || typeof answers !== "object") return null;

  const probabilityYes = noulOf(answers, AI_QID.tradeDecision);
  if (probabilityYes == null) return null;

  // One candidate, one allowed action. Jev cannot select an action, size,
  // route or token pair; it only approves/rejects the deterministic candidate.
  const candidate = context.candidate;
  const action: AiAction = context.candidateKind === "preview" || context.candidateKind === "buy"
    ? "buy"
    : context.candidateKind === "swap"
      ? "swap"
      : context.candidateKind === "arb"
        ? "arb"
        : "hold";
  const allowed = context.allowedActions.filter((item) => item !== "hold");
  if (
    (action !== "buy" && action !== "swap" && action !== "arb") ||
    allowed.length !== 1 ||
    allowed[0] !== action ||
    candidate.kind !== context.candidateKind ||
    candidate.key !== context.candidateKey
  ) return null;

  const finitePositive = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const validIdentity =
    typeof candidate.tokenIn === "string" && candidate.tokenIn.length > 0 &&
    typeof candidate.tokenInContract === "string" && candidate.tokenInContract.length > 0 &&
    typeof candidate.tokenOut === "string" && candidate.tokenOut.length > 0 &&
    typeof candidate.tokenOutContract === "string" && candidate.tokenOutContract.length > 0;
  const validRouteEvidence =
    Array.isArray(candidate.poolIds) &&
    candidate.poolIds.length > 0 &&
    candidate.poolIds.every((id) => Number.isInteger(id) && id >= 0) &&
    typeof candidate.hops === "number" &&
    Number.isInteger(candidate.hops) &&
    candidate.hops > 0;
  if (!validIdentity || !validRouteEvidence ||
      !finitePositive(candidate.amountIn) || !finitePositive(candidate.expectedOut)) {
    return null;
  }

  if (action === "arb") {
    if (
      (candidate.arbKind !== "volume" && candidate.arbKind !== "spread") ||
      candidate.tokenIn.toUpperCase() !== candidate.tokenOut.toUpperCase() ||
      candidate.tokenInContract.toLowerCase() !== candidate.tokenOutContract.toLowerCase() ||
      candidate.poolIds.length < 2 ||
      candidate.hops < 2
    ) return null;
  } else if (
    candidate.tokenIn.toUpperCase() === candidate.tokenOut.toUpperCase() ||
    candidate.tokenInContract.toLowerCase() === candidate.tokenOutContract.toLowerCase()
  ) {
    return null;
  }

  const approved = probabilityYes >= AI_EXEC_CONFIDENCE_MIN;
  const selectedAction: AiAction = approved ? action : "hold";
  const rationale = [
    `trade=${approved ? "yes" : "no"} p=${probabilityYes.toFixed(2)}`,
    `${action} ${candidate.tokenIn}@${candidate.tokenInContract}→${candidate.tokenOut}@${candidate.tokenOutContract}`,
    `pools=${candidate.poolIds.join(",")}`,
    `netEdge=${typeof candidate.expectedNetEdgePct === "number" ? candidate.expectedNetEdgePct.toFixed(3) + "%" : "not supplied"}`,
  ];

  const params: Record<string, string> = {};
  if (action === "swap") {
    params.tokenIn = candidate.tokenIn;
    params.tokenOut = candidate.tokenOut;
  }

  return {
    action: selectedAction,
    params,
    confidence: approved ? probabilityYes : 1 - probabilityYes,
    weakest: AI_QID.tradeDecision,
    answers,
    rationale: rationale.join(" · "),
    fetchedAt: context.receivedAt,
    snapshotFetchedAt: context.snapshotFetchedAt,
    requestedAt: context.requestedAt,
    model: context.model,
    candidateKind: context.candidateKind,
    candidateKey: context.candidateKey,
    candidate,
  };
}

/**
 * A live proposal must refer to a recent source snapshot, have arrived after
 * its request began, and have completed within the proxy's bounded timeout.
 * Missing metadata fails closed; old cached/dry-run proposals cannot trade.
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
