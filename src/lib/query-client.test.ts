import { describe, expect, it } from "vitest";
import { APP_QUERY_GC_TIME_MS, createAppQueryClient } from "./query-client";

describe("app query cache retention", () => {
  it("uses finite garbage collection for inactive queries", () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions().queries?.gcTime).toBe(APP_QUERY_GC_TIME_MS);
    expect(APP_QUERY_GC_TIME_MS).toBe(5 * 60_000);
    client.clear();
  });
});
