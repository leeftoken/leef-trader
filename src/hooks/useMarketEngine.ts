import { useCallback, useSyncExternalStore } from "react";
import { marketEngine, type EngineState } from "@/lib/market/market-engine";

/**
 * React window onto the persistent MarketEngine. The engine owns every
 * market/bot/balance loop; components subscribe and re-render on engine
 * version bumps — mounting/unmounting UI never stops the trading engine.
 */
export function useMarketEngine(): EngineState {
  return useSyncExternalStore(marketEngine.subscribe, marketEngine.getState, marketEngine.getState);
}


/**
 * Subscribe to one stable slice of market state. Heartbeat/provider commits
 * should not rerender the whole terminal when the selected field is unchanged.
 * Keep selector functions module-stable at call sites.
 */
export function useMarketEngineSelector<T>(
  selector: (state: EngineState) => T,
): T {
  const getSnapshot = useCallback(
    () => selector(marketEngine.getState()),
    [selector],
  );
  return useSyncExternalStore(marketEngine.subscribe, getSnapshot, getSnapshot);
}
