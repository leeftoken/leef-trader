import type { Position, BotStrategy } from "@/lib/leef/bot-engine";
import type { LeefSnapshot } from "@/lib/leef/types";
import type { JournalEntry } from "@/lib/leef/journal";
import { assetDelta, matchesExactDebit, type TxTransfer } from "./reconcile";
import { metaOf, type TokenMeta } from "./tokens";

type SnapshotTokens = Pick<LeefSnapshot, "pools" | "aux" | "universe">;

export type RecoveryContext = {
  account: string;
  base: string;
  quote: string;
  strategy: BotStrategy;
  position: Position | null;
  snapshot?: SnapshotTokens;
};

export type RecoveryAssessment =
  | {
      ok: true;
      action: "buy" | "sell" | "swap" | "arb";
      actualIn: number;
      actualOut: number;
      nextPosition: Position | null;
      note: string;
    }
  | { ok: false; reason: string };

function resolve(identifier: string | undefined, snapshot?: SnapshotTokens): TokenMeta | null {
  if (!identifier) return null;
  try {
    return metaOf(identifier, snapshot);
  } catch {
    return null;
  }
}

function sameToken(a: TokenMeta, b: TokenMeta): boolean {
  return a.symbol === b.symbol && a.contract.toLowerCase() === b.contract.toLowerCase();
}

function hasExternalTransfer(
  transfers: TxTransfer[],
  account: string,
  token: TokenMeta,
  direction: "out" | "in",
): boolean {
  return transfers.some((transfer) =>
    transfer.symbol === token.symbol &&
    transfer.contract.toLowerCase() === token.contract.toLowerCase() &&
    (direction === "out"
      ? transfer.from === account && transfer.to !== account
      : transfer.to === account && transfer.from !== account),
  );
}

function positionDeltaIsZero(
  transfers: TxTransfer[],
  account: string,
  base: TokenMeta,
): boolean {
  const delta = assetDelta(transfers, account, base.symbol, base.contract);
  return Math.abs(delta) <= 1 / 10 ** base.decimals + 1e-12;
}

/**
 * Build a conservative recovery plan from the exact execution journal row and
 * the transaction's parsed token transfers. This never uses router estimates
 * as fills. Only operations whose effects on the tracked bot position can be
 * reconstructed unambiguously are eligible.
 */
export function assessUnknownExecution(
  entry: JournalEntry,
  transfers: TxTransfer[],
  context: RecoveryContext,
): RecoveryAssessment {
  if (
    entry.kind !== "execution" ||
    entry.mode !== "live" ||
    entry.status !== "unknown" ||
    !entry.txid ||
    !Number.isFinite(entry.amountIn) ||
    (entry.amountIn ?? 0) <= 0
  ) {
    return { ok: false, reason: "No matching unresolved live execution record was found for this transaction." };
  }
  if (!context.account || !transfers.length) {
    return { ok: false, reason: "Wallet identity or parsed transfer evidence is missing." };
  }

  const input = resolve(entry.tokenIn, context.snapshot);
  const output = resolve(entry.tokenOut, context.snapshot);
  if (!input || !output) {
    return { ok: false, reason: "The journal token identity is missing or ambiguous. Resolve the token contract before recovering." };
  }

  const actualIn = assetDelta(transfers, context.account, input.symbol, input.contract);
  const actualOut = assetDelta(transfers, context.account, output.symbol, output.contract);
  const amountIn = entry.amountIn!;
  const base = resolve(context.base, context.snapshot);
  const quote = resolve(context.quote, context.snapshot);

  if (!base || !quote) {
    return { ok: false, reason: "The bot's configured base/quote token identity is missing or ambiguous." };
  }

  if (entry.action === "buy") {
    if (!sameToken(output, base) || !sameToken(input, quote)) {
      return { ok: false, reason: "This buy no longer matches the bot's configured base/quote pair." };
    }
    if (!matchesExactDebit(actualIn, amountIn, input.decimals) || actualOut <= 0) {
      return { ok: false, reason: "On-chain transfers do not prove the exact input debit and positive base-token receipt." };
    }
    if (context.position && context.position.mode !== "live") {
      return { ok: false, reason: "A paper position exists. The live fill cannot safely be merged into it." };
    }
    const addedCostUsd = entry.sizeUsd;
    if (!Number.isFinite(addedCostUsd) || (addedCostUsd ?? 0) <= 0) {
      return { ok: false, reason: "The saved entry has no reliable USD cost basis; position recovery would distort P&L." };
    }
    const previous = context.position;
    const totalAmount = (previous?.amountLeef ?? 0) + actualOut;
    const totalCostUsd = (previous?.entryCostUsd ?? 0) + addedCostUsd!;
    const totalQuoteSpent = (previous?.entryWax ?? 0) + amountIn;
    const entryUsd = totalCostUsd / Math.max(totalAmount, 1e-12);
    const markUsd = base.symbol === "LEEF" && (entry.leefUsd ?? 0) > 0
      ? entry.leefUsd!
      : entryUsd;
    const predEdgePct = entry.predEdgePct == null
      ? previous?.predEdgePct
      : previous
        ? ((previous.predEdgePct ?? entry.predEdgePct) * previous.entryWax +
            entry.predEdgePct * amountIn) / Math.max(totalQuoteSpent, 1e-12)
        : entry.predEdgePct;
    const nextPosition: Position = {
      amountLeef: totalAmount,
      entryUsd,
      entryCostUsd: totalCostUsd,
      entryWax: totalQuoteSpent,
      since: previous?.since ?? entry.ts,
      highUsd: Math.max(previous?.highUsd ?? 0, markUsd),
      mode: "live",
      predEdgePct,
      strategy: previous?.strategy ?? context.strategy,
    };
    return {
      ok: true,
      action: "buy",
      actualIn,
      actualOut,
      nextPosition,
      note: "Buy fill reconstructed from exact on-chain debit/credit and saved USD cost basis.",
    };
  }

  if (entry.action === "sell") {
    if (!sameToken(input, base) || !sameToken(output, quote)) {
      return { ok: false, reason: "This sell no longer matches the bot's configured base/quote pair." };
    }
    const position = context.position;
    const oneRawUnit = 1 / 10 ** input.decimals;
    if (
      !position ||
      position.mode !== "live" ||
      Math.abs(position.amountLeef - amountIn) > oneRawUnit + 1e-12
    ) {
      return { ok: false, reason: "The saved live position does not exactly match the full on-chain sell amount." };
    }
    if (!matchesExactDebit(actualIn, amountIn, input.decimals) || actualOut <= 0) {
      return { ok: false, reason: "On-chain transfers do not prove the full position debit and positive quote receipt." };
    }
    return {
      ok: true,
      action: "sell",
      actualIn,
      actualOut,
      nextPosition: null,
      note: "Full live position close reconstructed from exact on-chain debit/credit. Historical P&L is not fabricated.",
    };
  }

  if (entry.action === "swap") {
    if (sameToken(input, output)) {
      return { ok: false, reason: "The saved swap has identical input and output token identities." };
    }
    if (!matchesExactDebit(actualIn, amountIn, input.decimals) || actualOut <= 0) {
      return { ok: false, reason: "On-chain transfers do not prove the exact swap input debit and positive output." };
    }
    if (context.position && !positionDeltaIsZero(transfers, context.account, base)) {
      return { ok: false, reason: "This swap changed the token underlying the open bot position. Position accounting needs a dedicated partial-fill review." };
    }
    return {
      ok: true,
      action: "swap",
      actualIn,
      actualOut,
      nextPosition: context.position,
      note: "Swap transfers verified; the tracked base-token position is unchanged.",
    };
  }

  if (entry.action === "arb") {
    if (!sameToken(input, output)) {
      return { ok: false, reason: "The saved arbitrage record does not use one quote token on both legs." };
    }
    if (
      !hasExternalTransfer(transfers, context.account, input, "out") ||
      !hasExternalTransfer(transfers, context.account, input, "in")
    ) {
      return { ok: false, reason: "Both quote-token outflow and inflow are required to reconcile this arbitrage." };
    }
    if (context.position && !positionDeltaIsZero(transfers, context.account, base)) {
      return { ok: false, reason: "The arbitrage changed the token underlying the open bot position." };
    }
    return {
      ok: true,
      action: "arb",
      actualIn,
      actualOut,
      nextPosition: context.position,
      note: "Both arbitrage quote-token transfer directions are present; the tracked base-token position is unchanged.",
    };
  }

  return { ok: false, reason: "This execution type is not eligible for automatic recovery." };
}
