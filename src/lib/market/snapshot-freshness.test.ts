import { describe, expect, it } from "vitest";
import { measureSnapshotFreshness } from "./snapshot-freshness";

describe("measureSnapshotFreshness", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");

  it("uses the newest of the full market pull and on-chain spot patch", () => {
    const result = measureSnapshotFreshness({
      source: "live",
      fetchedAt: "2026-11-16T11:59:00.000Z",
      spotAt: "2026-11-16T11:59:56.000Z",
    }, 45_000, now);

    expect(result.fresh).toBe(true);
    expect(result.ageMs).toBe(4_000);
  });

  it("does not mark cached fallback or unavailable snapshots as fresh", () => {
    for (const source of ["fallback", "unavailable"] as const) {
      const result = measureSnapshotFreshness({
        source,
        fetchedAt: "2026-11-16T11:59:59.000Z",
      }, 45_000, now);
      expect(result.fresh).toBe(false);
      expect(result.ageMs).toBe(1_000);
    }
  });

  it("marks a live snapshot stale beyond the supplied cadence window", () => {
    const result = measureSnapshotFreshness({
      source: "live",
      fetchedAt: "2026-11-16T11:59:14.000Z",
    }, 45_000, now);
    expect(result.fresh).toBe(false);
    expect(result.ageMs).toBe(46_000);
  });

  it("rejects invalid and future timestamps rather than calling them live", () => {
    expect(measureSnapshotFreshness({
      source: "live",
      fetchedAt: "not-a-date",
    }, 45_000, now)).toMatchObject({ fresh: false, ageMs: null });

    expect(measureSnapshotFreshness({
      source: "live",
      fetchedAt: "2026-11-16T12:00:01.000Z",
    }, 45_000, now)).toMatchObject({ fresh: false, ageMs: -1_000 });
  });
});
