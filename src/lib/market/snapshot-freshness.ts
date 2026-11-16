import { snapFreshAtMs, type LeefSnapshot } from "@/lib/leef/types";

export type SnapshotFreshness = {
  fresh: boolean;
  ageMs: number | null;
  maxAgeMs: number;
};

/**
 * One freshness rule for the trading engine and every UI surface.
 * Only live-source snapshots can be fresh; the on-chain spot patch counts
 * because snapFreshAtMs deliberately selects the newest verified book time.
 */
export function measureSnapshotFreshness(
  snap: Pick<LeefSnapshot, "source" | "fetchedAt" | "spotAt">,
  maxAgeMs: number,
  now = Date.now(),
): SnapshotFreshness {
  const at = snapFreshAtMs(snap);
  const ageMs = Number.isFinite(at) && at > 0 ? now - at : null;
  const fresh =
    snap.source === "live" &&
    ageMs !== null &&
    ageMs >= 0 &&
    ageMs <= Math.max(0, maxAgeMs) &&
    Number.isFinite(now);

  return { fresh, ageMs, maxAgeMs: Math.max(0, maxAgeMs) };
}
