import { journal, journalAll } from "@/lib/leef/journal";
import type { BotTradeIntent } from "@/lib/wallet/trade-cycle";

export type UnknownExecutionJournalOptions = {
  /**
   * The manual recovery screen still needs to verify the transaction transfers
   * and complete the evidence row, even when the bot position was already
   * persisted before the reload.
   */
  deferStateAppliedSettlement?: boolean;
};

/**
 * Ensure exactly one durable live execution row exists for a transaction.
 * A missing row may be reconstructed only from the persisted, non-secret
 * trade intent. Duplicate rows, invalid txids and missing intent fail closed.
 */
export async function ensureUnknownExecutionJournal(
  txid: string,
  intent: BotTradeIntent | undefined,
  options: UnknownExecutionJournalOptions = {},
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(txid)) return false;

  const desiredStatus =
    intent?.stateApplied && !options.deferStateAppliedSettlement ? "confirmed" : "unknown";
  const matches = (await journalAll()).filter(
    (entry) => entry.kind === "execution" && entry.mode === "live" && entry.txid === txid,
  );
  if (matches.length === 1) {
    const status = matches[0]?.status;
    return status === desiredStatus || (!!intent?.stateApplied && status === "confirmed");
  }
  if (matches.length !== 0 || !intent) return false;

  journal({
    kind: "execution",
    action: intent.action,
    strategy: intent.strategy,
    mode: "live",
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn,
    expectedOut: intent.expectedOut,
    txid,
    status: desiredStatus,
    sizeUsd: intent.sizeUsd,
    predEdgePct: intent.predEdgePct,
    poolIds: intent.poolIds,
    hops: intent.hops,
    venues: intent.venues,
    leefUsd: intent.leefUsd,
    waxUsd: intent.waxUsd,
    reason: intent.stateApplied
      ? options.deferStateAppliedSettlement
        ? "Restored unresolved execution metadata for transfer settlement; bot state was already persisted before reload"
        : "Restored confirmed execution metadata; bot position/statistics were already persisted before reload"
      : "Restored unresolved execution metadata from the persisted bot signing intent after reload",
  });

  const restored = (await journalAll()).filter(
    (entry) => entry.kind === "execution" && entry.mode === "live" && entry.txid === txid,
  );
  return restored.length === 1 && restored[0]?.status === desiredStatus;
}
