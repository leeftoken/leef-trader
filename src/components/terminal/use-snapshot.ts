import { useEffect, useMemo, useState } from "react";
import { unavailableSnapshot } from "@/lib/leef/fallback";
import { rankPools } from "@/lib/leef/rank";
import { loadSeedSnapshot } from "@/lib/leef/seed";
import { loadLocalSnapshot, saveLocalSnapshot } from "@/lib/leef/local-snapshot";
import type { LeefSnapshot } from "@/lib/leef/types";
import { marketEngine } from "@/lib/market/market-engine";
import { clampSyncSec, DEFAULT_SYNC_SEC, useTerminal } from "@/store/terminal";
import { useMarketEngineSelector } from "@/hooks/useMarketEngine";
import type { EngineState } from "@/lib/market/market-engine";

const selectSnapshot = (state: EngineState) => state.snapshot;
const selectFetching = (state: EngineState) => state.fetching;
const selectLastFetchAt = (state: EngineState) => state.lastFetchAt;

const placeholder = unavailableSnapshot(
  "Loading the live Alcor LEEF book…",
  "2026-01-01T00:00:00.000Z",
);

/**
 * Terminal view of the MarketEngine's snapshot. The engine (not React Query,
 * not a component effect) owns the fetch cadence — this hook only subscribes,
 * so prices, routes, balances and strategy state keep updating without any
 * page refresh and regardless of what the component tree does.
 */
export function useSnapshot() {
  const liveSnapshot = useMarketEngineSelector(selectSnapshot);
  const isFetching = useMarketEngineSelector(selectFetching);
  const lastFetchAt = useMarketEngineSelector(selectLastFetchAt);
  const syncSec = useTerminal((s) => clampSyncSec(s.syncSec ?? DEFAULT_SYNC_SEC));

  // Instant first paint, freshest source wins: the local backup of the last
  // live book (survives reloads, written below) beats the build-time seed
  // whenever it is newer. Both are paint-only — the engine's first live pull
  // replaces them, and the staleness gate keeps trading impossible until then.
  const [seed, setSeed] = useState<LeefSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([loadLocalSnapshot(), loadSeedSnapshot()]).then(([local, buildSeed]) => {
      if (!live) return;
      const candidates = [local, buildSeed].filter((s): s is LeefSnapshot => s != null);
      const freshest = candidates.sort(
        (a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt),
      )[0];
      if (freshest) setSeed(freshest);
    });
    return () => {
      live = false;
    };
  }, []);

  // Local backup writer: keep the last live book on disk for instant reloads.
  useEffect(() => {
    if (liveSnapshot) saveLocalSnapshot(liveSnapshot);
  }, [liveSnapshot]);

  const snap = liveSnapshot ?? seed ?? placeholder;
  const ranked = useMemo(() => rankPools(snap.pools, snap), [snap]);
  return {
    snap,
    ranked,
    syncSec,
    isFetching,
    dataUpdatedAt: lastFetchAt,
    refetch: () => {
      void marketEngine.forceRefresh();
    },
  };
}
