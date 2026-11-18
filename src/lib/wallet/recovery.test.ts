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

  it("recovers a split multi-hop Alcor buy and subtracts the separately paid base-token fee", () => {
    const buy = execution({
      amountIn: 52.68858121,
      sizeUsd: 5.268858121,
    });
    const transfers: TxTransfer[] = [
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "26.87117642 WAX", amount: 26.87117642, symbol: "WAX", memo: "swapexactin#12840" },
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "25.81740479 WAX", amount: 25.81740479, symbol: "WAX", memo: "swapexactin#12361,13266" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "570082.4901 LEEF", amount: 570082.4901, symbol: "LEEF", memo: "Swap tokenOut - Pool ID #12840" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "547759.9849 LEEF", amount: 547759.9849, symbol: "LEEF", memo: "Swap tokenOut - Pool ID #13266" },
      { contract: "leefmaincorp", from: account, to: "smart.ass", quantity: "10.8528 LEEF", amount: 10.8528, symbol: "LEEF", memo: "leef-trader platform fee (0.001%)" },
    ];
    const result = assessUnknownExecution(buy, transfers, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actualIn).toBeCloseTo(-52.68858121, 8);
    expect(result.actualOut).toBeCloseTo(1117831.6222, 4);
    expect(result.nextPosition?.amountLeef).toBeCloseTo(1117831.6222, 4);
    expect(result.nextPosition?.entryWax).toBeCloseTo(52.68858121, 8);
    expect(result.nextPosition?.entryCostUsd).toBeCloseTo(5.268858121, 8);
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

  it("requires both quote-token directions and both base-token legs for arbitrage recovery", () => {
    const arb = execution({ action: "arb", tokenIn: "WAX", tokenOut: "WAX", amountIn: 10 });
    const oneWay = [buyTransfers[0]!];
    expect(assessUnknownExecution(arb, oneWay, context)).toMatchObject({ ok: false });
    const twoWay = [
      ...oneWay,
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "10.10000000 WAX", amount: 10.1, symbol: "WAX", memo: "arb output" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "50.0000 LEEF", amount: 50, symbol: "LEEF", memo: "buy leg" },
      { contract: "leefmaincorp", from: account, to: "swap.alcor", quantity: "50.0000 LEEF", amount: 50, symbol: "LEEF", memo: "sell leg" },
    ];
    expect(assessUnknownExecution(arb, twoWay, context)).toMatchObject({ ok: true });
  });


  it("rejects an arbitrage whose gross quote-token debit differs from the saved input, even when net delta is positive", () => {
    const arb = execution({ action: "arb", tokenIn: "WAX", tokenOut: "WAX", amountIn: 10 });
    const transfers: TxTransfer[] = [
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "1.00000000 WAX", amount: 1, symbol: "WAX", memo: "buy leg" },
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "2.00000000 WAX", amount: 2, symbol: "WAX", memo: "sell leg" },
    ];
    expect(assessUnknownExecution(arb, transfers, context)).toMatchObject({ ok: false });
  });


  it("recovers a real multi-leg Alcor round-trip while excluding the separate platform fee from the swap debit", () => {
    const arb = execution({
      action: "arb",
      tokenIn: "WAX",
      tokenOut: "WAX",
      amountIn: 42.93192136,
      sizeUsd: 4.293192136,
      waxUsd: 0.1,
    });
    const transfers: TxTransfer[] = [
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "19.74868383 WAX", amount: 19.74868383, symbol: "WAX", memo: "swapexactin#217" },
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "19.31936461 WAX", amount: 19.31936461, symbol: "WAX", memo: "swapexactin#12840" },
      { contract: "eosio.token", from: account, to: "swap.alcor", quantity: "3.86387292 WAX", amount: 3.86387292, symbol: "WAX", memo: "swapexactin#12361,12467,11722" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "418010.3876 LEEF", amount: 418010.3876, symbol: "LEEF", memo: "Swap tokenOut - Pool ID #217" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "409418.1169 LEEF", amount: 409418.1169, symbol: "LEEF", memo: "Swap tokenOut - Pool ID #12840" },
      { contract: "leefmaincorp", from: account, to: "swap.alcor", quantity: "538570.5186 LEEF", amount: 538570.5186, symbol: "LEEF", memo: "sell leg" },
      { contract: "leefmaincorp", from: account, to: "swap.alcor", quantity: "344331.9709 LEEF", amount: 344331.9709, symbol: "LEEF", memo: "sell leg" },
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "16.17073519 WAX", amount: 16.17073519, symbol: "WAX", memo: "Swap tokenOut - Pool ID #217" },
      { contract: "eosio.token", from: "swap.alcor", to: account, quantity: "25.39766246 WAX", amount: 25.39766246, symbol: "WAX", memo: "Swap tokenOut - Pool ID #12840" },
      { contract: "leefmaincorp", from: "swap.alcor", to: account, quantity: "81961.0599 LEEF", amount: 81961.0599, symbol: "LEEF", memo: "Swap tokenOut - Pool ID #11722" },
      { contract: "eosio.token", from: account, to: "smart.ass", quantity: "0.00040868 WAX", amount: 0.00040868, symbol: "WAX", memo: "leef-trader platform fee (0.001%)" },
    ];
    const result = assessUnknownExecution(arb, transfers, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextPosition?.amountLeef).toBeCloseTo(26487.0749, 4);
    expect(result.nextPosition?.mode).toBe("live");
    expect(result.nextPosition?.entryCostUsd).toBeCloseTo(0.1250444321, 8);
    expect(result.recoveredPnlUsd).toBeCloseTo(-0.0113488069, 8);
    expect(result.actualOut).toBeCloseTo(-1.36393239, 8);
  });

  it("refuses entries without a stored live execution identity", () => {
    expect(
      assessUnknownExecution(execution({ status: "paper" }), buyTransfers, context),
    ).toMatchObject({ ok: false });
  });
});
