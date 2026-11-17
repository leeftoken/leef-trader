import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { marketEngine } from "@/lib/market/market-engine";
import { useMarketEngineSelector } from "./useMarketEngine";

describe("useMarketEngineSelector", () => {
  it("does not rerender when an unrelated engine field changes", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useMarketEngineSelector((state) => state.headBlock);
    });
    const initialRenders = renders;

    act(() => {
      marketEngine.reloadEndpoints();
    });

    expect(result.current).toBe(marketEngine.getState().headBlock);
    expect(renders).toBe(initialRenders);
  });
});
