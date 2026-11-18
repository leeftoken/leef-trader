import { afterEach, describe, expect, it } from "vitest";
import {
  TRADE_CYCLE_STORAGE_KEY,
  abortSigning,
  beginSigning,
  canConfirmInterruptedSigningNoBroadcast,
  confirmInterruptedSigningNoBroadcast,
  liveCapitalBlocked,
  markBroadcast,
  markConfirmed,
  markFailed,
  markInterruptedSigning,
  markUnknown,
  markTradeStateApplied,
  pendingTxid,
  restoreTradeCycleLock,
  tradeAccount,
  tradeIntent,
  tradePhase,
  tradeStartedAt,
  unknownBlockReason,
} from "./trade-cycle";

afterEach(() => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(TRADE_CYCLE_STORAGE_KEY);
  restoreTradeCycleLock();
});

describe("live capital lock", () => {
  it("blocks a second signing attempt until the first settles", () => {
    expect(beginSigning()).toBe(true);
    expect(liveCapitalBlocked()).toBe(true);
    expect(beginSigning()).toBe(false);
    abortSigning();
    expect(liveCapitalBlocked()).toBe(false);
  });

  it("persists a broadcast transaction as unresolved across a reload", () => {
    expect(beginSigning()).toBe(true);
    markBroadcast("a".repeat(64));
    expect(restoreTradeCycleLock()).toBe("unknown");
    expect(tradePhase()).toBe("unknown");
    expect(pendingTxid()).toBe("a".repeat(64));
    expect(liveCapitalBlocked()).toBe(true);
    expect(unknownBlockReason()).toContain("unresolved");
  });

  it("persists an interrupted signing attempt as blocked when no txid exists", () => {
    expect(beginSigning()).toBe(true);
    expect(restoreTradeCycleLock()).toBe("blocked");
    expect(liveCapitalBlocked()).toBe(true);
    expect(unknownBlockReason()).toContain("interrupted");
  });


  it("persists an ambiguous wallet outcome with its original account and start time", () => {
    expect(beginSigning("leefuser")).toBe(true);
    const startedAt = tradeStartedAt();

    markInterruptedSigning();

    expect(tradePhase()).toBe("blocked");
    expect(tradeAccount()).toBe("leefuser");
    expect(tradeStartedAt()).toBe(startedAt);
    expect(canConfirmInterruptedSigningNoBroadcast("leefuser")).toBe(true);
  });

  it("releases only a txid-less interrupted lock after explicit wallet-history review", () => {
    expect(beginSigning("leefuser")).toBe(true);
    expect(restoreTradeCycleLock()).toBe("blocked");
    expect(tradeAccount()).toBe("leefuser");

    expect(confirmInterruptedSigningNoBroadcast("leefuser")).toBe(true);
    expect(tradePhase()).toBe("idle");
    expect(liveCapitalBlocked()).toBe(false);
    expect(localStorage.getItem(TRADE_CYCLE_STORAGE_KEY)).toBeNull();
  });


  it("requires the same wallet account before releasing an interrupted lock", () => {
    expect(beginSigning("leefuser")).toBe(true);
    expect(restoreTradeCycleLock()).toBe("blocked");

    expect(canConfirmInterruptedSigningNoBroadcast("anotheruser")).toBe(false);
    expect(confirmInterruptedSigningNoBroadcast("anotheruser")).toBe(false);
    expect(liveCapitalBlocked()).toBe(true);
    expect(canConfirmInterruptedSigningNoBroadcast("leefuser")).toBe(true);
  });

  it("cannot clear an unresolved transaction that already has a txid", () => {
    expect(beginSigning()).toBe(true);
    markUnknown("c".repeat(64));

    expect(confirmInterruptedSigningNoBroadcast()).toBe(false);
    expect(tradePhase()).toBe("unknown");
    expect(pendingTxid()).toBe("c".repeat(64));
    expect(liveCapitalBlocked()).toBe(true);
  });

  it("cannot clear an active signing lock before it is restored as interrupted", () => {
    expect(beginSigning()).toBe(true);

    expect(confirmInterruptedSigningNoBroadcast()).toBe(false);
    expect(tradePhase()).toBe("signing");
    expect(liveCapitalBlocked()).toBe(true);
  });


  it("does not create a bot capital lock for a wallet action outside a bot signing cycle", () => {
    markBroadcast("d".repeat(64));
    markUnknown("e".repeat(64));

    expect(tradePhase()).toBe("idle");
    expect(pendingTxid()).toBeUndefined();
    expect(liveCapitalBlocked()).toBe(false);
  });


  it("persists the original trade intent with a broadcast transaction for reload recovery", () => {
    const intent = {
      action: "buy" as const,
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 2,
      expectedOut: 1200,
      sizeUsd: 0.04,
      strategy: "auto",
      base: "LEEF",
      quote: "WAX",
      predEdgePct: 0.8,
      leefUsd: 0.000033,
      waxUsd: 0.02,
      poolIds: [1159],
      hops: 1,
      venues: ["alcor"],
    };
    expect(beginSigning("leefuser", intent)).toBe(true);
    markBroadcast("7".repeat(64));

    expect(restoreTradeCycleLock()).toBe("unknown");
    expect(tradeAccount()).toBe("leefuser");
    expect(tradeIntent()).toEqual(intent);
  });


  it("preserves recovery intent when an interrupted external wallet prompt has no txid", () => {
    const intent = {
      action: "buy" as const,
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 2,
      expectedOut: 1200,
      sizeUsd: 0.04,
      strategy: "auto",
      base: "LEEF",
      quote: "WAX",
      leefUsd: 0.000033,
      waxUsd: 0.02,
    };
    expect(beginSigning("leefuser", intent)).toBe(true);
    markInterruptedSigning();

    expect(restoreTradeCycleLock()).toBe("blocked");
    expect(tradeAccount()).toBe("leefuser");
    expect(tradeIntent()).toEqual(intent);
  });

  it("refuses to begin bot signing when supplied recovery intent is invalid", () => {
    expect(beginSigning("leefuser", {
      action: "buy",
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: Number.NaN,
      expectedOut: 1200,
      sizeUsd: 0.04,
      strategy: "auto",
      base: "LEEF",
      quote: "WAX",
      leefUsd: 0.000033,
      waxUsd: 0.02,
    })).toBe(false);
    expect(tradePhase()).toBe("idle");
    expect(liveCapitalBlocked()).toBe(false);
  });


  it("persists whether the bot state already includes a confirmed fill", () => {
    const intent = {
      action: "buy" as const,
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 2,
      expectedOut: 1200,
      sizeUsd: 0.04,
      strategy: "auto",
      base: "LEEF",
      quote: "WAX",
      leefUsd: 0.000033,
      waxUsd: 0.02,
    };
    expect(beginSigning("leefuser", intent)).toBe(true);
    markBroadcast("8".repeat(64));

    expect(markTradeStateApplied("f".repeat(64))).toBe(false);
    expect(tradeIntent()?.stateApplied).toBeUndefined();

    expect(markTradeStateApplied("8".repeat(64))).toBe(true);
    expect(tradeIntent()?.stateApplied).toBe(true);
    expect(restoreTradeCycleLock()).toBe("unknown");
    expect(tradeIntent()?.stateApplied).toBe(true);
  });

  it("keeps a bot-owned broadcast timeout locked with its original account", () => {
    expect(beginSigning("leefuser")).toBe(true);
    markUnknown("f".repeat(64));

    expect(tradePhase()).toBe("unknown");
    expect(tradeAccount()).toBe("leefuser");
    expect(pendingTxid()).toBe("f".repeat(64));
    expect(liveCapitalBlocked()).toBe(true);
  });

  it("allows the bot loop to keep the same transaction unresolved after broadcast", () => {
    expect(beginSigning("leefuser")).toBe(true);
    markBroadcast("9".repeat(64));
    markUnknown("9".repeat(64));

    expect(tradePhase()).toBe("unknown");
    expect(tradeAccount()).toBe("leefuser");
    expect(pendingTxid()).toBe("9".repeat(64));
    expect(liveCapitalBlocked()).toBe(true);
  });


  it("does not let a late result for another txid release the active capital lock", () => {
    expect(beginSigning("leefuser")).toBe(true);
    markBroadcast("1".repeat(64));

    markConfirmed("2".repeat(64));
    expect(tradePhase()).toBe("broadcasted");
    expect(pendingTxid()).toBe("1".repeat(64));
    expect(liveCapitalBlocked()).toBe(true);

    markFailed("2".repeat(64));
    expect(tradePhase()).toBe("broadcasted");
    expect(liveCapitalBlocked()).toBe(true);
  });

  it("releases only the matching transaction after a verified failed outcome", () => {
    expect(beginSigning("leefuser")).toBe(true);
    markBroadcast("3".repeat(64));

    markFailed("3".repeat(64));
    expect(tradePhase()).toBe("idle");
    expect(liveCapitalBlocked()).toBe(false);
    expect(localStorage.getItem(TRADE_CYCLE_STORAGE_KEY)).toBeNull();
  });

  it("does not allow user acknowledgement to clear corrupt persisted lock data", () => {
    localStorage.setItem(
      TRADE_CYCLE_STORAGE_KEY,
      JSON.stringify({ phase: "blocked", since: 123, blockedCause: "corrupt-storage" }),
    );

    expect(restoreTradeCycleLock()).toBe("blocked");
    expect(confirmInterruptedSigningNoBroadcast()).toBe(false);
    expect(liveCapitalBlocked()).toBe(true);
  });

  it("clears persisted lock only after an explicit confirmed or failed outcome", () => {
    expect(beginSigning()).toBe(true);
    markBroadcast("b".repeat(64));
    markConfirmed("b".repeat(64));
    expect(localStorage.getItem(TRADE_CYCLE_STORAGE_KEY)).toBeNull();
    expect(liveCapitalBlocked()).toBe(false);
  });
});
