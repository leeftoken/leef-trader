/**
 * Shared capital-movement coordinator.
 *
 * Bot, manual swaps, rebalancer and LP management must acquire the same lock.
 * This module owns lifecycle transitions and reconciliation; no subsystem may
 * mark a broadcast as a fill before chain confirmation.
 */
import {
  abortSigning,
  beginSigning,
  liveCapitalBlocked,
  markBroadcast,
  markConfirmed,
  markFailed,
  markReconciling,
  markUnknown,
  pendingTxid,
  unknownBlockReason,
} from "./trade-cycle";
import { reconcileTransfersLater, waitForTransaction, type ReconcileResult } from "./reconcile";

export type CapitalOwner = "bot" | "manual" | "rebalancer" | "liquidity";

export type CoordinatedResult<T> = {
  value: T;
  txid: string;
  reconciliation: ReconcileResult;
};

export class CapitalBusyError extends Error {
  constructor(readonly owner: CapitalOwner, message: string) {
    super(message);
    this.name = "CapitalBusyError";
  }
}

export function capitalAvailable(): boolean {
  return !liveCapitalBlocked();
}

/**
 * Run exactly one capital-moving submission and reconcile it. `submit` must
 * perform fresh quote/policy/sign/broadcast and return its txid. This function
 * never retries a transaction. UNKNOWN keeps the global lock.
 */
export async function coordinateCapitalMovement<T extends { txid: string }>(opts: {
  owner: CapitalOwner;
  account?: string;
  submit: () => Promise<T>;
  confirmation?: { budgetMs?: number; attempts?: number; delayMs?: number };
  /** Return false to veto a successful transfer settlement (e.g. exact deltas mismatch). */
  onSettled?: (result: ReconcileResult) => boolean | void | Promise<boolean | void>;
}): Promise<CoordinatedResult<T>> {
  if (!beginSigning(opts.account)) {
    throw new CapitalBusyError(
      opts.owner,
      unknownBlockReason() ?? "Another trade is signing, broadcasting, or reconciling",
    );
  }
  let broadcasted = false;
  try {
    const value = await opts.submit();
    const txid = value.txid;
    broadcasted = true;
    markBroadcast(txid);
    markReconciling(txid);
    const reconciliation = await waitForTransaction(txid, {
      budgetMs: opts.confirmation?.budgetMs ?? 2_500,
      attempts: opts.confirmation?.attempts ?? 5,
      delayMs: opts.confirmation?.delayMs ?? 300,
    });
    if (reconciliation.status === "confirmed") {
      const accepted = await opts.onSettled?.(reconciliation);
      if (accepted === false) markUnknown(txid);
      else markConfirmed(txid);
    } else if (reconciliation.status === "failed") {
      await opts.onSettled?.(reconciliation);
      markFailed(txid);
    } else {
      markUnknown(txid);
      await opts.onSettled?.(reconciliation);
      // Read-only background reconciliation. Inclusion alone is not a fill:
      // retry history reads while this tx owns the capital lock, and release
      // only after transfer actions are parsed or two indexers prove failure.
      void (async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (pendingTxid() !== txid) return;
          const later = await reconcileTransfersLater(txid);
          if (later.status === "failed") {
            await opts.onSettled?.(later);
            markFailed(txid);
            return;
          }
          if (later.status === "confirmed" && later.transfers.length > 0) {
            const accepted = await opts.onSettled?.(later);
            if (accepted === false) markUnknown(txid);
            else markConfirmed(txid);
            return;
          }
          markUnknown(txid);
        }
        // Still unresolved. Keep the lock; never retry an ambiguous broadcast.
      })();
    }
    return { value, txid, reconciliation };
  } catch (err) {
    // sign.ts marks ambiguous broadcast timeout UNKNOWN itself. Never unlock
    // it here. Pre-broadcast/policy/rejection failures may safely release.
    if (!broadcasted && !unknownBlockReason()) abortSigning();
    throw err;
  }
}
