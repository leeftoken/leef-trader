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
      recoveredPnlUsd?: number;
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

function externalTransferAmount(
  transfers: TxTransfer[],
  account: string,
  token: TokenMeta,
  direction: "out" | "in",
  counterparty?: string,
): number {
  return transfers.reduce((total, transfer) => {
    if (
      transfer.symbol !== token.symbol ||
      transfer.contract.toLowerCase() !== token.contract.toLowerCase()
    ) return total;
    const matches = direction === "out"
      ? transfer.from === account && (counterparty ? transfer.to === counterparty : transfer.to !== account)
      : transfer.to === account && (counterparty ? transfer.from === counterparty : transfer.from !== account);
    return matches ? total + transfer.amount : total;
  }, 0);
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
        ? ((previous.predEdgePct ?? entry.predEdgePct) * (previous.entryWax ?? 0) +
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

    // Alcor atomic arb may contain several exact-in transfers per side when
    // the route is split across pools. Match the journal's quoteIn against
    // only account<->swap.alcor transfers; the separate smart.ass platform
    // fee is a real wallet debit but is not part of the swap input.
    const grossQuoteSent = externalTransferAmount(
      transfers, context.account, input, "out", "swap.alcor",
    );
    const grossQuoteReceived = externalTransferAmount(
      transfers, context.account, input, "in", "swap.alcor",
    );
    if (
      !matchesExactDebit(-grossQuoteSent, amountIn, input.decimals) ||
      grossQuoteReceived <= 0
    ) {
      return { ok: false, reason: "Alcor swap legs do not prove the saved gross quote input and a positive quote-token receipt." };
    }

    const grossBaseBought = externalTransferAmount(
      transfers, context.account, base, "in", "swap.alcor",
    );
    const grossBaseSold = externalTransferAmount(
      transfers, context.account, base, "out", "swap.alcor",
    );
    if (!(grossBaseBought > 0) || !(grossBaseSold > 0)) {
      return { ok: false, reason: "The transaction does not contain both the base-token buy and sell legs expected for an atomic arbitrage." };
    }

    if (context.position && context.position.mode !== "live") {
      return { ok: false, reason: "A paper position exists. A live arbitrage residual cannot safely be merged into it." };
    }

    // Split routes can legitimately leave a residual base-token inventory.
    // Reconstruct it from gross base bought/sold and allocate the original
    // quote cost pro-rata. Never use router estimates as fills.
    const baseDelta = grossBaseBought - grossBaseSold;
    const rawUnit = 1 / 10 ** base.decimals;
    const quoteUsd = Number.isFinite(entry.sizeUsd) && (entry.sizeUsd ?? 0) > 0
      ? entry.sizeUsd! / amountIn
      : Number.isFinite(entry.waxUsd) && (entry.waxUsd ?? 0) > 0
        ? entry.waxUsd!
        : null;
    const feeAmount = transfers.reduce((sum, transfer) => {
      const isPlatformFee =
        transfer.from === context.account &&
        transfer.to !== "swap.alcor" &&
        transfer.symbol === input.symbol &&
        transfer.contract.toLowerCase() === input.contract.toLowerCase() &&
        /leef-trader platform fee/i.test(transfer.memo);
      return sum + (isPlatformFee ? transfer.amount : 0);
    }, 0);

    const previous = context.position;
    const buyCostUsd = quoteUsd == null ? null : grossQuoteSent * quoteUsd;
    const feeCostUsd = quoteUsd == null ? null : feeAmount * quoteUsd;
    let nextPosition: Position | null;
    let realizedCostUsd: number | null;

    if (baseDelta > rawUnit) {
      const residualQuote = grossQuoteSent * (baseDelta / grossBaseBought);
      const residualCostUsd = (buyCostUsd ?? 0) * (baseDelta / grossBaseBought);
      const totalAmount = (previous?.amountLeef ?? 0) + baseDelta;
      const totalCostUsd = (previous?.entryCostUsd ?? 0) + residualCostUsd;
      const totalQuote = (previous?.entryWax ?? 0) + residualQuote;
      const entryUsd = totalCostUsd / Math.max(totalAmount, 1e-12);
      const markUsd = entry.leefUsd != null && entry.leefUsd > 0 ? entry.leefUsd : entryUsd;
      nextPosition = {
        amountLeef: totalAmount,
        entryUsd,
        entryCostUsd: totalCostUsd,
        entryWax: totalQuote,
        since: previous?.since ?? entry.ts,
        highUsd: Math.max(previous?.highUsd ?? 0, markUsd),
        mode: "live",
        predEdgePct: previous?.predEdgePct ?? entry.predEdgePct,
        strategy: previous?.strategy ?? context.strategy,
      };
      realizedCostUsd = buyCostUsd == null
        ? null
        : buyCostUsd - residualCostUsd;
    } else if (baseDelta < -rawUnit) {
      const soldFromExisting = -baseDelta;
      if (!previous || previous.mode !== "live" || previous.amountLeef + rawUnit < soldFromExisting) {
        return { ok: false, reason: "The arbitrage consumed more base tokens than it bought, but the saved live position cannot cover the difference." };
      }
      const existingCostSold = previous.entryCostUsd * (soldFromExisting / previous.amountLeef);
      const remainingAmount = Math.max(0, previous.amountLeef - soldFromExisting);
      const remainingCost = Math.max(0, previous.entryCostUsd - existingCostSold);
      const remainingQuote = previous.entryWax * (remainingAmount / previous.amountLeef);
      nextPosition = remainingAmount <= rawUnit
        ? null
        : {
            ...previous,
            amountLeef: remainingAmount,
            entryCostUsd: remainingCost,
            entryWax: remainingQuote,
            entryUsd: remainingCost / remainingAmount,
          };
      realizedCostUsd = buyCostUsd == null ? null : buyCostUsd + existingCostSold;
    } else {
      nextPosition = previous;
      realizedCostUsd = buyCostUsd;
    }

    const recoveredPnlUsd =
      quoteUsd != null && realizedCostUsd != null
        ? grossQuoteReceived * quoteUsd - realizedCostUsd - (feeCostUsd ?? 0)
        : undefined;
    return {
      ok: true,
      action: "arb",
      actualIn,
      actualOut,
      recoveredPnlUsd: Number.isFinite(recoveredPnlUsd) ? recoveredPnlUsd : undefined,
      nextPosition,
      note: baseDelta > rawUnit
        ? "Split Alcor arbitrage legs reconciled; residual base inventory and proportional cost basis were restored from actual transfers."
        : baseDelta < -rawUnit
          ? "Split Alcor arbitrage legs reconciled; existing base inventory was reduced by the verified net debit."
          : "Split Alcor arbitrage legs reconciled; the base-token position is unchanged.",
    };
  }

  return { ok: false, reason: "This execution type is not eligible for automatic recovery." };
}
