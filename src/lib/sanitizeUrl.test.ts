import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "./sanitizeUrl";

describe("sanitizeUrl", () => {
  it("accepts https URLs and returns a canonical href", () => {
    expect(sanitizeUrl("https://example.com/pic.png")).toBe("https://example.com/pic.png");
  });

  it("rejects javascript, data, http, and relative values", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeUrl("data:text/html,hi")).toBeUndefined();
    expect(sanitizeUrl("http://insecure.example/pic.png")).toBeUndefined();
    expect(sanitizeUrl("/relative.png")).toBeUndefined();
    expect(sanitizeUrl("")).toBeUndefined();
    expect(sanitizeUrl(undefined)).toBeUndefined();
    expect(sanitizeUrl("not a url")).toBeUndefined();
  });
});
