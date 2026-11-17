import { afterEach, describe, expect, it, vi } from "vitest";
import { askJev, askJevDetailed } from "./jev-client";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("askJev (browser → /api/jev only)", () => {
  it("POSTs { state, questions } to our serverless route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: { action: { type: "choice", choice: "hold", confidence: 0.9 } },
        }),
        { status: 200 },
      ),
    );
    const res = await askJev({ market: 1 }, { action: { type: "choice", instructions: "?", criteria: { hold: "h" } } });
    expect(res).not.toBeNull();
    expect(res!.model).toBe("jev-latest");
    expect(res!.answers.action?.choice).toBe("hold");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/jev");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("returns null on HTTP failure — callers never see a throw", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));
    await expect(askJev({}, { q: { type: "noul", instructions: "?" } })).resolves.toBeNull();
  });

  it("returns null on network errors", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(askJev({}, { q: { type: "noul", instructions: "?" } })).resolves.toBeNull();
  });

  it("returns null on malformed answer payloads", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ model: "jev-latest", answers: { q: { nope: 1 } } }), { status: 200 }),
    );
    await expect(askJev({}, { q: { type: "noul", instructions: "?" } })).resolves.toBeNull();
  });
});

describe("askJevDetailed diagnostics", () => {
  it("preserves safe failure code and message for CONTROL", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          available: false,
          code: "PRIMARY_TIMEOUT",
          error: "Primary TypeSafe timed out; backup was unavailable",
        }),
        { status: 502 },
      ),
    );
    const result = await askJevDetailed({ market: 1 }, {
      action: { type: "choice", instructions: "?", criteria: { hold: "h" } },
    });
    expect(result).toMatchObject({
      ok: false,
      code: "PRIMARY_TIMEOUT",
      message: "Primary TypeSafe timed out; backup was unavailable",
      status: 502,
    });
  });

  it("returns the provider selected by the server proxy on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-latest",
          provider: "cloudflare",
          answers: { action: { type: "choice", choice: "hold", confidence: 0.9 } },
        }),
        { status: 200 },
      ),
    );
    const result = await askJevDetailed({ market: 1 }, {
      action: { type: "choice", instructions: "?", criteria: { hold: "h" } },
    });
    expect(result).toMatchObject({ ok: true, provider: "cloudflare", model: "jev-latest" });
  });
});
