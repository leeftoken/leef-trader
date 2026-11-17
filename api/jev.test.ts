import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./jev.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const input = {
  state: { task: "candidate_review", candidate: { kind: "volume_arb", poolIds: [217, 218] } },
  questions: {
    action: {
      type: "choice",
      instructions: "Accept or reject only this deterministic candidate.",
      criteria: { hold: "Reject", arb: "Accept this exact round-trip" },
    },
  },
};

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
});

describe("POST /api/jev shared gateway proxy", () => {
  it("uses the Signer /api/judge gateway even when a legacy Vercel TypeSafe key exists", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "legacy-vercel-secret");
    vi.stubEnv("LEEF_JEV_GATEWAY_URL", "https://leef-trader-ai.leef-trader.workers.dev/api/judge");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: { action: { type: "choice", choice: "arb", confidence: 0.94 } },
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(new Request("https://leef-trader.vercel.app/api/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.21" },
      body: JSON.stringify(input),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "jev-latest", provider: "leef-signer" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://leef-trader-ai.leef-trader.workers.dev/api/judge");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
    expect(new Headers((init as RequestInit).headers).has("authorization")).toBe(false);
  });

  it("maps the Signer gateway's structured error response without inventing an answer", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "PROVIDER_TIMEOUT",
            message: "TypeSafe timed out",
            requestId: "test-request",
          },
        }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      ),
    );
    const response = await POST(new Request("https://leef-trader.vercel.app/api/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.22" },
      body: JSON.stringify(input),
    }));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      available: false,
      code: "PROVIDER_TIMEOUT",
      error: "TypeSafe timed out",
    });
  });
});
