import { describe, expect, it } from "vitest";
import { assetDelta, hyperionTxVerdict, matchesExactDebit, parseHyperionTransfers } from "./reconcile";
import { quorumTxStatus, waxResourceBlock } from "./chain";

const ACCOUNT = "trader.leef";

/** A realistic Hyperion get_transaction body for WAX→LEEF via swap.alcor. */
const SWAP_TX = {
  trx_id: "aa11",
  executed: true,
  block_num: 287_364_200,
  actions: [
    {
      act: {
        account: "eosio.token",
        name: "transfer",
        data: {
          from: ACCOUNT,
          to: "swap.alcor",
          quantity: "10.00000000 WAX",
          memo: "swapexactin#1159#trader.leef#240000.0000 LEEF@leefmaincorp#0",
        },
      },
    },
    {
      act: {
        account: "leefmaincorp",
        name: "transfer",
        data: {
          from: "swap.alcor",
          to: ACCOUNT,
          quantity: "241234.5678 LEEF",
          memo: "swap fill",
        },
      },
    },
    {
      // Non-transfer action — must be ignored.
      act: { account: "swap.alcor", name: "logswap", data: { pool: 1159 } },
    },
    {
      // A transfer between foreign accounts in the same tx (notifications /
      // inline noise) — must not affect OUR deltas.
      act: {
        account: "eosio.token",
        name: "transfer",
        data: { from: "market.maker", to: "swap.alcor", quantity: "3.00000000 WAX", memo: "" },
      },
    },
  ],
};

describe("parseHyperionTransfers", () => {
  it("extracts token transfers from an indexed transaction", () => {
    const parsed = parseHyperionTransfers(SWAP_TX);
    expect(parsed).not.toBeNull();
    expect(parsed!.executed).toBe(true);
    expect(parsed!.transfers).toHaveLength(3);
    expect(parsed!.transfers[0]).toMatchObject({
      contract: "eosio.token",
      from: ACCOUNT,
      to: "swap.alcor",
      amount: 10,
      symbol: "WAX",
    });
  });

  it("returns null for not-yet-indexed or malformed responses", () => {
    expect(parseHyperionTransfers(null)).toBeNull();
    expect(parseHyperionTransfers({})).toBeNull();
    expect(parseHyperionTransfers({ actions: [] })).toBeNull();
    expect(parseHyperionTransfers({ trx_id: "x", error: "not found" })).toBeNull();
    expect(parseHyperionTransfers("garbage")).toBeNull();
  });

  it("marks failed transactions", () => {
    const parsed = parseHyperionTransfers({ ...SWAP_TX, executed: false });
    expect(parsed!.executed).toBe(false);
  });
});

describe("assetDelta", () => {
  const transfers = parseHyperionTransfers(SWAP_TX)!.transfers;

  it("computes net deltas from the account's perspective", () => {
    expect(assetDelta(transfers, ACCOUNT, "WAX", "eosio.token")).toBeCloseTo(-10, 8);
    expect(assetDelta(transfers, ACCOUNT, "LEEF", "leefmaincorp")).toBeCloseTo(241234.5678, 4);
  });

  it("ignores other accounts' transfers", () => {
    // The foreign 3 WAX transfer must not leak into our delta.
    expect(assetDelta(transfers, ACCOUNT, "WAX")).toBeCloseTo(-10, 8);
  });

  it("reconciles the observed WAX arbitrage round-trip including the platform fee", () => {
    const account = "skgaw.wam";
    const arbTransfers = [
      {
        contract: "eosio.token", from: account, to: "swap.alcor",
        quantity: "1.70445894 WAX", amount: 1.70445894, symbol: "WAX", memo: "swap",
      },
      {
        contract: "eosio.token", from: "swap.alcor", to: account,
        quantity: "1.65448942 WAX", amount: 1.65448942, symbol: "WAX", memo: "swap output",
      },
      {
        contract: "eosio.token", from: account, to: "smart.ass",
        quantity: "0.00001623 WAX", amount: 0.00001623, symbol: "WAX", memo: "LEEF Trader platform fee",
      },
    ];
    expect(assetDelta(arbTransfers, account, "WAX", "eosio.token")).toBeCloseTo(-0.04998575, 10);
  });

  it("scopes by contract when given one (spoofed-symbol safety)", () => {
    const spoofed = [
      ...transfers,
      {
        contract: "fake.leef",
        from: "swap.alcor",
        to: ACCOUNT,
        quantity: "9999.0000 LEEF",
        amount: 9999,
        symbol: "LEEF",
        memo: "",
      },
    ];
    expect(assetDelta(spoofed, ACCOUNT, "LEEF", "leefmaincorp")).toBeCloseTo(241234.5678, 4);
    expect(assetDelta(spoofed, ACCOUNT, "LEEF")).toBeCloseTo(241234.5678 + 9999, 4);
  });
});

describe("quorumTxStatus (M2 — failed verdicts need ≥2 agreeing endpoints)", () => {
  it("a single endpoint saying failed stays UNKNOWN — one lying RPC can't unlock capital", () => {
    expect(quorumTxStatus(["hard_fail"])).toBe("unknown");
    expect(quorumTxStatus(["soft_fail", ""])).toBe("unknown");
    expect(quorumTxStatus(["hard_fail", "unrecognized"])).toBe("unknown");
  });

  it("two endpoints agreeing on failed → failed", () => {
    expect(quorumTxStatus(["hard_fail", "hard_fail"])).toBe("hard_fail");
    expect(quorumTxStatus(["hard_fail", "soft_fail"])).toBe("hard_fail");
    expect(quorumTxStatus(["soft_fail", "failed"])).toBe("soft_fail");
    expect(quorumTxStatus(["soft_fail", "soft_fail", ""])).toBe("soft_fail");
  });

  it("executed stays single-source (chain truth)", () => {
    expect(quorumTxStatus(["executed"])).toBe("executed");
    expect(quorumTxStatus(["", "executed"])).toBe("executed");
  });

  it("conflicting executed/failed answers stay UNKNOWN", () => {
    expect(quorumTxStatus(["executed", "hard_fail"])).toBe("unknown");
    expect(quorumTxStatus(["soft_fail", "executed", "hard_fail"])).toBe("unknown");
  });

  it("no recognized status → unknown", () => {
    expect(quorumTxStatus([])).toBe("unknown");
    expect(quorumTxStatus(["", "expired"])).toBe("unknown");
  });
});

describe("hyperionTxVerdict (M2 — failed verdicts need ≥2 agreeing indexers)", () => {
  const failed = { executed: false, transfers: [] };
  const good = { executed: true, transfers: [] };

  it("a single indexer reporting failed returns null (keep polling — stays UNKNOWN)", () => {
    expect(hyperionTxVerdict("t", [failed])).toBeNull();
    expect(hyperionTxVerdict("t", [failed, null, null])).toBeNull();
  });

  it("two indexers agreeing on failed → failed", () => {
    const v = hyperionTxVerdict("t", [failed, failed]);
    expect(v).toMatchObject({ status: "failed", txid: "t" });
    expect(hyperionTxVerdict("t", [failed, null, failed])).toMatchObject({ status: "failed" });
  });

  it("does not call an executed transaction settled until transfers are parsed", () => {
    expect(hyperionTxVerdict("t", [good])).toBeNull();
    expect(hyperionTxVerdict("t", [failed, good])).toBeNull();
    const withTransfers = {
      executed: true,
      transfers: parseHyperionTransfers(SWAP_TX)!.transfers,
    };
    expect(hyperionTxVerdict("t", [withTransfers])).toMatchObject({ status: "confirmed" });
  });

  it("nothing parsed → null", () => {
    expect(hyperionTxVerdict("t", [null, null])).toBeNull();
    expect(hyperionTxVerdict("t", [])).toBeNull();
  });
});

describe("waxResourceBlock", () => {
  it("passes a healthy account", () => {
    expect(waxResourceBlock(0.4, 0.5, 0.6)).toBeNull();
    expect(waxResourceBlock(null, null, null)).toBeNull(); // unknown = chain decides
  });

  it("blocks on exhausted CPU / NET / RAM", () => {
    expect(waxResourceBlock(0.96, null, null)).toMatch(/CPU/);
    expect(waxResourceBlock(null, 0.99, null)).toMatch(/NET/);
    expect(waxResourceBlock(null, null, 0.99)).toMatch(/RAM/);
  });

  it("does not block near-but-under thresholds", () => {
    expect(waxResourceBlock(0.95, 0.98, 0.98)).toBeNull();
  });
});

describe("matchesExactDebit", () => {
  it("accepts the requested full debit within one raw token unit", () => {
    expect(matchesExactDebit(-10, 10, 8)).toBe(true);
    expect(matchesExactDebit(-9.99999999, 10, 8)).toBe(true);
  });

  it("rejects partial fills and wrong-direction transfers", () => {
    expect(matchesExactDebit(-9.999, 10, 8)).toBe(false);
    expect(matchesExactDebit(10, 10, 8)).toBe(false);
    expect(matchesExactDebit(0, 10, 8)).toBe(false);
  });

  it("rejects invalid decimal metadata or amounts", () => {
    expect(matchesExactDebit(-10, 10, 19)).toBe(false);
    expect(matchesExactDebit(-10, 10, -1)).toBe(false);
    expect(matchesExactDebit(-10, 0, 8)).toBe(false);
    expect(matchesExactDebit(Number.NaN, 10, 8)).toBe(false);
  });
});


describe("Hyperion notification de-duplication", () => {
  const duplicateNotification = {
    creator_action_ordinal: 77,
    act: {
      account: "eosio.token",
      name: "transfer",
      data: { from: ACCOUNT, to: "swap.alcor", quantity: "3.39026300 WAX", memo: "swap" },
    },
  };

  it("preserves separate root transfers with creator ordinal zero and removes their notification copies", () => {
    const rootOne = {
      action_ordinal: 1,
      creator_action_ordinal: 0,
      act: {
        account: "eosio.token",
        name: "transfer",
        data: { from: ACCOUNT, to: "swap.alcor", quantity: "26.87117642 WAX", memo: "route one" },
      },
    };
    const rootTwo = {
      action_ordinal: 2,
      creator_action_ordinal: 0,
      act: {
        account: "eosio.token",
        name: "transfer",
        data: { from: ACCOUNT, to: "swap.alcor", quantity: "25.81740479 WAX", memo: "route two" },
      },
    };
    const notificationOne = {
      action_ordinal: 5,
      creator_action_ordinal: 1,
      act: rootOne.act,
    };
    const notificationTwo = {
      action_ordinal: 11,
      creator_action_ordinal: 2,
      act: rootTwo.act,
    };
    const parsed = parseHyperionTransfers({
      executed: true,
      actions: [notificationOne, notificationTwo, rootTwo, rootOne],
    });
    expect(parsed?.transfers).toHaveLength(2);
    expect(assetDelta(parsed!.transfers, ACCOUNT, "WAX", "eosio.token")).toBeCloseTo(-52.68858121, 8);
  });

  it("collapses notification documents sharing a creator_action_ordinal", () => {
    const parsed = parseHyperionTransfers({
      executed: true,
      actions: [duplicateNotification, { ...duplicateNotification }],
    });
    expect(parsed?.transfers).toHaveLength(1);
    expect(parsed?.transfers[0]?.quantity).toBe("3.39026300 WAX");
  });

  it("preserves genuinely distinct identical transfers with different creator ordinals", () => {
    const parsed = parseHyperionTransfers({
      executed: true,
      actions: [
        duplicateNotification,
        { ...duplicateNotification, creator_action_ordinal: 78 },
      ],
    });
    expect(parsed?.transfers).toHaveLength(2);
  });

  it("does not content-dedupe identical transfers when the provider omits ordinals", () => {
    const withoutOrdinal = { act: duplicateNotification.act };
    const parsed = parseHyperionTransfers({
      executed: true,
      actions: [withoutOrdinal, { ...withoutOrdinal }],
    });
    expect(parsed?.transfers).toHaveLength(2);
  });
});
