import { describe, expect, it } from "vitest";
import { metaOf, tokenCatalog } from "./tokens";

const emptySnapshot = {
  pools: [],
  aux: [],
  universe: [],
} as never;

describe("tokenCatalog contract identity", () => {
  it("requires an explicit contract when a ticker has multiple issuers", () => {
    expect(() => metaOf("USDT", emptySnapshot)).toThrow(/ambiguous/);
    expect(metaOf("USDT@usdt.alcor", emptySnapshot).contract).toBe("usdt.alcor");
    expect(metaOf("USDT@wrap.alcor", emptySnapshot).contract).toBe("wrap.alcor");
  });

  it("does not invent precision for malformed or unknown token metadata", () => {
    const snapshot = {
      pools: [],
      aux: [],
      universe: [
        {
          symbol: "BAD",
          contract: "bad.token",
          decimals: 22,
        },
      ],
    } as never;
    const catalog = tokenCatalog(snapshot);
    expect(catalog.some((token) => token.symbol === "BAD")).toBe(false);
  });

  it("keeps canonical WAX precision even if a snapshot reports stale precision", () => {
    const snapshot = {
      pools: [],
      aux: [],
      universe: [
        { symbol: "WAX", contract: "eosio.token", decimals: 4 },
      ],
    } as never;
    expect(metaOf("WAX@eosio.token", snapshot)).toMatchObject({
      symbol: "WAX",
      contract: "eosio.token",
      decimals: 8,
    });
  });

  it("retains venue-provided precision for discovered token contracts", () => {
    const snapshot = {
      pools: [],
      aux: [],
      universe: [
        {
          symbol: "SIX",
          contract: "six.token",
          decimals: 6,
        },
      ],
    } as never;
    expect(metaOf("SIX@six.token", snapshot)).toMatchObject({
      symbol: "SIX",
      contract: "six.token",
      decimals: 6,
      alcorId: "six-six.token",
    });
  });
});
