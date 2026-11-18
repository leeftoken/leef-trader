import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SEC, useTerminal } from "./terminal";

describe("WAX book sync cadence", () => {
  it("uses a 10-second default for micro-market polling", () => {
    expect(DEFAULT_SYNC_SEC).toBe(10);
    expect(useTerminal.getState().syncSec).toBe(10);
  });

  it("migrates only the old default 30-second cadence and strips persisted Jev authority", () => {
    const migrate = useTerminal.persist.getOptions().migrate!;
    const upgraded = migrate({ syncSec: 30, aiControl: "control" }, 3) as {
      syncSec?: number;
      aiControl?: string;
    };
    expect(upgraded.syncSec).toBe(10);
    expect(upgraded.aiControl).toBeUndefined();
  });

  it("preserves a user's custom polling cadence", () => {
    const migrate = useTerminal.persist.getOptions().migrate!;
    const upgraded = migrate({ syncSec: 20 }, 3) as { syncSec?: number };
    expect(upgraded.syncSec).toBe(20);
  });
});
