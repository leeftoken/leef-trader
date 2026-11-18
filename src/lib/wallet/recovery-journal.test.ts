import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotTradeIntent } from "@/lib/wallet/trade-cycle";

const store = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/leef/journal", () => ({
  journal: (entry: object) => {
    store.rows.push({ ...(entry as Record<string, unknown>), ts: 123 });
  },
  journalAll: async () => store.rows.map((row) => ({ ...row })),
}));

import { ensureUnknownExecutionJournal } from "./recovery-journal";

const txid = "a".repeat(64);
const intent: BotTradeIntent = {
  action: "buy",
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

beforeEach(() => {
  store.rows.length = 0;
});

describe("ensureUnknownExecutionJournal", () => {
  it("restores a missing live execution row from the persisted trade intent", async () => {
    expect(await ensureUnknownExecutionJournal(txid, intent)).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      kind: "execution",
      mode: "live",
      action: "buy",
      tokenIn: "WAX",
      tokenOut: "LEEF",
      amountIn: 2,
      txid,
      status: "unknown",
    });
  });

  it("preserves a previously applied position and lets manual recovery settle the restored row", async () => {
    const applied = { ...intent, stateApplied: true };
    expect(await ensureUnknownExecutionJournal(txid, applied, { deferStateAppliedSettlement: true })).toBe(true);
    expect(store.rows[0]?.status).toBe("unknown");
  });

  it("restores a confirmed row when the bot state was already persisted for automatic reload recovery", async () => {
    expect(await ensureUnknownExecutionJournal(txid, { ...intent, stateApplied: true })).toBe(true);
    expect(store.rows[0]?.status).toBe("confirmed");
  });

  it("accepts one existing unresolved row without requiring a persisted intent", async () => {
    store.rows.push({ kind: "execution", mode: "live", txid, status: "unknown" });
    expect(await ensureUnknownExecutionJournal(txid, undefined)).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("fails closed when the transaction has duplicate execution rows", async () => {
    store.rows.push(
      { kind: "execution", mode: "live", txid, status: "unknown" },
      { kind: "execution", mode: "live", txid, status: "unknown" },
    );
    expect(await ensureUnknownExecutionJournal(txid, intent)).toBe(false);
    expect(store.rows).toHaveLength(2);
  });

  it("does not fabricate an execution row when the persisted trade intent is missing", async () => {
    expect(await ensureUnknownExecutionJournal(txid, undefined)).toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it("rejects malformed transaction identifiers", async () => {
    expect(await ensureUnknownExecutionJournal("not-a-txid", intent)).toBe(false);
    expect(store.rows).toHaveLength(0);
  });
});
