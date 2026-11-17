import { describe, expect, it } from "vitest";
import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  it("expires entries at their TTL instead of retaining stale keys", () => {
    const cache = new TtlCache<string, number>(4, 100);
    cache.set("old", 1, 1_000);

    expect(cache.get("old", 1_099)).toBe(1);
    expect(cache.get("old", 1_100)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("keeps a hard capacity bound and evicts the least recently used key", () => {
    const cache = new TtlCache<string, number>(2, 1_000);
    cache.set("a", 1, 1_000);
    cache.set("b", 2, 1_000);
    expect(cache.get("a", 1_001)).toBe(1); // a becomes most recently used
    cache.set("c", 3, 1_002);

    expect(cache.size).toBe(2);
    expect(cache.get("a", 1_003)).toBe(1);
    expect(cache.get("b", 1_003)).toBeUndefined();
    expect(cache.get("c", 1_003)).toBe(3);
  });

  it("prunes expired entries on writes even when they are never read again", () => {
    const cache = new TtlCache<string, number>(3, 50);
    cache.set("old-a", 1, 1_000);
    cache.set("old-b", 2, 1_001);
    cache.set("fresh", 3, 1_040);

    cache.set("new", 4, 1_060);

    expect(cache.size).toBe(2);
    expect(cache.get("old-a", 1_060)).toBeUndefined();
    expect(cache.get("old-b", 1_060)).toBeUndefined();
  });
});
