/**
 * Jev (TypeSafe System One) browser client. Talks ONLY to our own serverless
 * route (/api/jev) — the TypeSafe key lives server-side and the browser never
 * reaches the upstream API directly. Every failure returns null; callers treat
 * null as "advisory unavailable" and never throw into the trading loop.
 */

export type JevQuestion =
  | { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export interface JevAnswers {
  [qid: string]: {
    type: string;
    noul?: number;
    choice?: string;
    confidence?: number | null;
    probabilities?: Record<string, number>;
    score?: number;
    legend?: Record<string, unknown>;
  };
}

const ROUTE = "/api/jev";
const TIMEOUT_MS = 27_000; // Vercel primary + Cloudflare fallback have bounded server-side timeouts.

function answersOk(raw: unknown): raw is JevAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  for (const a of Object.values(raw as Record<string, unknown>)) {
    if (!a || typeof a !== "object" || typeof (a as { type?: unknown }).type !== "string") {
      return false;
    }
  }
  return true;
}

export type JevCallResult =
  | { ok: true; answers: JevAnswers; model: string; provider?: string }
  | { ok: false; code: string; message: string; status?: number };

/**
 * POST { state, questions } to our server proxy. Preserve safe failure classes
 * so CONTROL can explain why it paused rather than collapsing every error to
 * an indistinguishable null.
 */
export async function askJevDetailed(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevCallResult> {
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as
      | { answers?: unknown; model?: unknown; provider?: unknown; available?: unknown; code?: unknown; error?: unknown }
      | null;
    if (!res.ok || data?.available === false) {
      const status = res.status;
      const code = typeof data?.code === "string"
        ? data.code
        : status === 401 || status === 403
          ? "AUTH_REJECTED"
          : status === 429
            ? "RATE_LIMITED"
            : status === 503
              ? "NOT_CONFIGURED"
              : status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "HTTP_ERROR";
      const message = typeof data?.error === "string"
        ? data.error
        : status === 429
          ? "Jev provider rate limit reached"
          : status === 503
            ? "Jev service is not configured"
            : `Jev proxy returned HTTP ${status}`;
      return { ok: false, code, message, status };
    }
    if (!answersOk(data?.answers)) {
      return { ok: false, code: "INVALID_RESPONSE", message: "Jev returned a malformed or incomplete answer payload" };
    }
    return {
      ok: true,
      answers: data.answers,
      model: typeof data.model === "string" ? data.model : "jev-latest",
      ...(typeof data.provider === "string" ? { provider: data.provider } : {}),
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      ok: false,
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      message: timedOut ? "Jev request exceeded the client timeout" : "Jev proxy could not be reached",
    };
  }
}

/** Compatibility wrapper for non-blocking SUGGEST consumers. */
export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<{ answers: JevAnswers; model: string } | null> {
  const result = await askJevDetailed(state, questions);
  return result.ok ? { answers: result.answers, model: result.model } : null;
}
