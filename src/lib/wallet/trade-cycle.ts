/**
 * Live-trade state machine.
 *
 * SIGNING  — exclusive; only one signer in flight.
 * BROADCASTED / RECONCILING — market scans may continue; no new live trade
 *   that could spend the same capital.
 * UNKNOWN  — NEVER submit another live trade. Poll until capital is known.
 * FAILED / CONFIRMED — unlock.
 *
 * Paper mode never takes the capital lock.
 */
export type TradePhase =
  | "idle"
  | "preparing"
  | "quoted"
  | "signing"
  | "broadcasted"
  | "reconciling"
  | "confirmed"
  | "failed"
  | "unknown"
  | "blocked";

export type CycleTimings = {
  snapshotFetchMs: number;
  poolRefreshMs: number;
  tradeHistoryMs: number;
  venueDiscoveryMs: number;
  queueWaitMs: number;
  networkMs: number;
  parseMs: number;
  priceOracleMs: number;
  routeSearchMs: number;
  sizeOptimizationMs: number;
  netEdgeMs: number;
  quoteMs: number;
  /** Exact venue-quote re-verification (growth firewall) before sign. */
  quoteVerifyMs: number;
  riskMs: number;
  policyMs: number;
  signMs: number;
  broadcastMs: number;
  confirmationMs: number;
  totalTradeCycleMs: number;
  candidateCount: number;
  routeCount: number;
  quoteCount: number;
  rejectedCandidates: number;
};

export const emptyTimings = (): CycleTimings => ({
  snapshotFetchMs: 0,
  poolRefreshMs: 0,
  tradeHistoryMs: 0,
  venueDiscoveryMs: 0,
  queueWaitMs: 0,
  networkMs: 0,
  parseMs: 0,
  priceOracleMs: 0,
  routeSearchMs: 0,
  sizeOptimizationMs: 0,
  netEdgeMs: 0,
  quoteMs: 0,
  quoteVerifyMs: 0,
  riskMs: 0,
  policyMs: 0,
  signMs: 0,
  broadcastMs: 0,
  confirmationMs: 0,
  totalTradeCycleMs: 0,
  candidateCount: 0,
  routeCount: 0,
  quoteCount: 0,
  rejectedCandidates: 0,
});

type Lock = {
  phase: TradePhase;
  txid?: string;
  since: number;
};

export const TRADE_CYCLE_STORAGE_KEY = "leef-live-capital-lock-v1";

function readSavedLock(): Lock {
  try {
    if (typeof localStorage === "undefined") return { phase: "idle", since: 0 };
    const raw = localStorage.getItem(TRADE_CYCLE_STORAGE_KEY);
    if (!raw) return { phase: "idle", since: 0 };
    const saved = JSON.parse(raw) as Partial<Lock>;
    if (!Number.isFinite(saved.since) || typeof saved.since !== "number") {
      return { phase: "blocked", since: Date.now() };
    }
    if (typeof saved.txid === "string" && /^[a-f0-9]{64}$/i.test(saved.txid)) {
      return { phase: "unknown", txid: saved.txid, since: saved.since };
    }
    // A reload during signing may have happened after broadcast but before
    // the wallet returned its txid. Block new capital use until reviewed.
    return { phase: "blocked", since: saved.since };
  } catch {
    return { phase: "blocked", since: Date.now() };
  }
}

function persistLock(next: Lock): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (next.phase === "idle" || next.phase === "failed") {
      localStorage.removeItem(TRADE_CYCLE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(TRADE_CYCLE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
    // The in-memory lock still protects this tab.
  }
}

let lock: Lock = readSavedLock();
let lastTimings: CycleTimings = emptyTimings();

export function lastCycleTimings(): CycleTimings {
  return lastTimings;
}

export function recordCycleTimings(t: CycleTimings): void {
  lastTimings = t;
}

export function tradePhase(): TradePhase {
  return lock.phase;
}

export function pendingTxid(): string | undefined {
  return lock.txid;
}

/** True when a new LIVE transaction must not be submitted. */
export function liveCapitalBlocked(): boolean {
  return (
    lock.phase === "signing" ||
    lock.phase === "broadcasted" ||
    lock.phase === "reconciling" ||
    lock.phase === "unknown" ||
    lock.phase === "blocked"
  );
}

export function beginSigning(): boolean {
  if (liveCapitalBlocked()) return false;
  lock = { phase: "signing", since: Date.now() };
  persistLock(lock);
  return true;
}

export function markBroadcast(txid: string): void {
  lock = { phase: "broadcasted", txid, since: Date.now() };
  persistLock(lock);
}

export function markReconciling(txid: string): void {
  lock = { phase: "reconciling", txid, since: Date.now() };
  persistLock(lock);
}

export function markConfirmed(): void {
  lock = { phase: "idle", since: Date.now() };
  persistLock(lock);
}

export function markFailed(): void {
  lock = { phase: "idle", since: Date.now() };
  persistLock(lock);
}

/** Capital may have moved. Do not retry. Keep the txid. */
export function markUnknown(txid: string): void {
  lock = { phase: "unknown", txid, since: Date.now() };
  persistLock(lock);
}

export function abortSigning(): void {
  if (lock.phase === "signing") {
    lock = { phase: "idle", since: Date.now() };
    persistLock(lock);
  }
}

export function unknownBlockReason(): string | null {
  if (lock.phase === "blocked" && !lock.txid) {
    return "A prior signing attempt was interrupted by reload — inspect wallet activity before submitting another trade";
  }
  if (lock.phase !== "unknown" || !lock.txid) return null;
  return `Previous tx ${lock.txid.slice(0, 10)}… is unresolved — not submitting another trade until settlement is reconciled`;
}

/** Refresh the in-memory guard from browser storage (also useful after app mount). */
export function restoreTradeCycleLock(): TradePhase {
  lock = readSavedLock();
  return lock.phase;
}
