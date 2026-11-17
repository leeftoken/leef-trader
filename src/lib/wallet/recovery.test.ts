import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/lib/leef/journal";
import type { Position } from "@/lib/leef/bot-engine";
import type { TxTransfer } from "./reconcile";
import { assessUnknownExecution } from "./recovery";

const account = "trader.leef";
const position: Position = {
  amountLeef: 100,
  entryUsd: 0.01,
  entryCostUsd: 1,
  entryWax: 10,
  since: 1_700_000_000_000,
  highUsd: 0.012,
  mode: "live",
  strategy: "auto",
};
const context = {
  account,
  base: "LEEF",
  quote: "WAX",
  strategy: "auto" as const,
  position: null as Position | null,
};

function execution(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    ts: 1_700_000_000_000,
    kind: "execution",
    mode: "live",
    action: "buy",
    tokenIn: "WAX",
    tokenOut: "LEEF",
    amountIn: 10,
    sizeUsd: 0.5,
    txid: "a".repeat(64),
    status: "unknown",
    ...overrides,
  };
}

const buyTransfers: TxTransfer[] = [
  { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "10.00000000 WAX", amount: 10, symbol: "WAX", memo: "swap" },
  { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "50.0000 LEEF", amount: 50, symbol: "LEEF", memo: "fill" },
];

describe("assessUnknownExecution", () => {
  it("reconstructs a buy using actual token transfers and the saved cost basis", () => {
    const result = assessUnknownExecution(execution({}), buyTransfers, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("buy");
    expect(result.actualOut).toBe(50);
    expect(result.nextPosition).toMatchObject({
      amountLeef: 50,
      entryCostUsd: 0.5,
      entryWax: 10,
      mode: "live",
    });
  });

  it("does not recover a buy with a partial or mismatched input debit", () => {
    const result = assessUnknownExecution(
      execution({}),
      [{ ...buyTransfers[0]!, amount: 9.5, quantity: "9.50000000 WAX" }, buyTransfers[1]!],
      context,
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("closes a sell only when the saved live position exactly matches the chain debit", () => {
    const sell = execution({
      action: "sell",
      tokenIn: "LEEF",
      tokenOut: "WAX",
      amountIn: 100,
      sizeUsd: undefined,
    });
    const transfers: TxTransfer[] = [
      { contract: "leefmaincorp", from: account, to: "swap.alcor", quantity: "100.0000 LEEF", amount: 100, symbol: "LEEF", memo: "sell" },
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "15.00000000 WAX", amount: 15, symbol: "WAX", memo: "fill" },
    ];
    const result = assessUnknownExecution(sell, transfers, { ...context, position });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nextPosition).toBeNull();
  });

  it("keeps a sell locked when the tracked position is not the full amount debited", () => {
    const sell = execution({ action: "sell", tokenIn: "LEEF", tokenOut: "WAX", amountIn: 100, sizeUsd: undefined });
    const result = assessUnknownExecution(sell, buyTransfers, { ...context, position });
    expect(result).toMatchObject({ ok: false });
  });

  it("recovers an unrelated swap without changing an open LEEF position", () => {
    const swap = execution({
      action: "swap",
      tokenIn: "WAX",
      tokenOut: "USDT@usdt.alcor",
      amountIn: 10,
    });
    const transfers: TxTransfer[] = [
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "10.00000000 WAX", amount: 10, symbol: "WAX", memo: "swap" },
      { contract: "usdt.alcor", from: "swap.alcor", to: account, quantity: "5.0000 USDT", amount: 5, symbol: "USDT", memo: "fill" },
    ];
    const result = assessUnknownExecution(swap, transfers, { ...context, position });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nextPosition).toEqual(position);
  });

  it("does not recover a swap that changed the tracked position token", () => {
    const swap = execution({ action: "swap", tokenIn: "WAX", tokenOut: "LEEF", amountIn: 10 });
    const result = assessUnknownExecution(swap, buyTransfers, { ...context, position });
    expect(result).toMatchObject({ ok: false });
  });

  it("requires both quote-token transfer directions for arbitrage recovery", () => {
    const arb = execution({ action: "arb", tokenIn: "WAX", tokenOut: "WAX", amountIn: 10 });
    const oneWay = [buyTransfers[0]!];
    expect(assessUnknownExecution(arb, oneWay, context)).toMatchObject({ ok: false });
    const twoWay = [
      ...oneWay,
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "10.10000000 WAX", amount: 10.1, symbol: "WAX", memo: "arb output" },
    ];
    expect(assessUnknownExecution(arb, twoWay, context)).toMatchObject({ ok: true });
  });

  it("refuses entries without a stored live execution identity", () => {
    expect(
      assessUnknownExecution(execution({ status: "paper" }), buyTransfers, context),
    ).toMatchObject({ ok: false });
  });
});
