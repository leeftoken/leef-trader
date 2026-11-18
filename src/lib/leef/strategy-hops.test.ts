import { describe, expect, it } from "vitest";
import { hopsForStrategy } from "./bot-engine";

describe("strategy hop budgets", () => {
  it("allows the WAX volume strategy to search up to three pool hops", () => {
    expect(hopsForStrategy("volume", 4, 1)).toBe(3);
    expect(hopsForStrategy("volume", 2, 1)).toBe(2);
  });

  it("keeps atomic spread arbitrage capped at two pools", () => {
    expect(hopsForStrategy("spread", 4, 1)).toBe(2);
  });
});
