import { afterEach, describe, expect, it } from "vitest";
import {
  TRADE_CYCLE_STORAGE_KEY,
  abortSigning,
  beginSigning,
  confirmInterruptedSigningNoBroadcast,
  liveCapitalBlocked,
  markBroadcast,
  markConfirmed,
  markFailed,
  markUnknown,
  pendingTxid,
  restoreTradeCycleLock,
  tradePhase,
  unknownBlockReason,
} from "./trade-cycle";

afterEach(() => {
  markFailed();
  if (typeof localStorage !== "undefined") localStorage.removeItem(TRADE_CYCLE_STORAGE_KEY);
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

  it("releases only a txid-less interrupted lock after explicit wallet-history review", () => {
    expect(beginSigning()).toBe(true);
    expect(restoreTradeCycleLock()).toBe("blocked");

    expect(confirmInterruptedSigningNoBroadcast()).toBe(true);
    expect(tradePhase()).toBe("idle");
    expect(liveCapitalBlocked()).toBe(false);
    expect(localStorage.getItem(TRADE_CYCLE_STORAGE_KEY)).toBeNull();
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

  it("clears persisted lock only after an explicit confirmed or failed outcome", () => {
    expect(beginSigning()).toBe(true);
    markBroadcast("b".repeat(64));
    markConfirmed();
    expect(localStorage.getItem(TRADE_CYCLE_STORAGE_KEY)).toBeNull();
    expect(liveCapitalBlocked()).toBe(false);
  });
});
