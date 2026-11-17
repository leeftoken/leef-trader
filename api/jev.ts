/**
 * POST /api/jev — primary Vercel TypeSafe proxy with a Cloudflare Worker
 * backup. Provider secrets remain server-side; no provider key or request
 * payload is logged or returned to the browser.
 *
 * Body: { state: object, questions: { <qid>: typed question } }
 * Reply: { model, answers, provider } or a safe, typed availability error.
 */
import { guard } from "./_guard.js";

declare const process: { env: Record<string, string | undefined> };

const PRIMARY_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const BACKUP_ENDPOINT =
  process.env.TYPESAFE_BACKUP_URL ||
  "https://leef-trader-ai.leef-trader.workers.dev/api/judge";
const MODEL = "jev-latest";
const PRIMARY_TIMEOUT_MS = 12_000;
const BACKUP_TIMEOUT_MS = 12_000;
const MAX_QUESTIONS = 64;
const MAX_BODY_BYTES = 65_536;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const QUESTION_TYPES = new Set(["noul", "choice", "score"]);

function questionsOk(raw: unknown): raw is Record<string, { type: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) return false;
  return entries.every(
    ([qid, q]) =>
      qid.length > 0 &&
      qid.length <= 128 &&
      !!q &&
      typeof q === "object" &&
      typeof (q as { type?: unknown }).type === "string" &&
      QUESTION_TYPES.has((q as { type: string }).type),
  );
}

type ProviderResult =
  | { ok: true; model: string; answers: Record<string, unknown> }
  | { ok: false; code: string; message: string; status: number };

function validAnswers(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(
      (answer) => !!answer && typeof answer === "object" &&
        typeof (answer as { type?: unknown }).type === "string",
    );
}

function safeUpstreamMessage(status: number, label: string): string {
  if (status === 401 || status === 403) return `${label} credential was rejected`;
  if (status === 429) return `${label} rate limit reached`;
  if (status === 402) return `${label} credit balance is exhausted`;
  if (status >= 500) return `${label} is temporarily unavailable`;
  return `${label} rejected the request (HTTP ${status})`;
}

async function callPrimary(
  key: string,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<ProviderResult> {
  try {
    const res = await fetch(PRIMARY_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
    });
    if (res.status === 422) {
      return { ok: false, code: "UPSTREAM_VALIDATION", message: "TypeSafe rejected the request schema", status: 422 };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const code = res.status === 401 || res.status === 403
        ? "AUTH_REJECTED"
        : res.status === 429
          ? "RATE_LIMITED"
          : "PRIMARY_UNAVAILABLE";
      return { ok: false, code, message: safeUpstreamMessage(res.status, "Primary TypeSafe"), status: res.status };
    }
    const data = await res.json().catch(() => null) as { model?: unknown; answers?: unknown } | null;
    if (!data || !validAnswers(data.answers)) {
      return { ok: false, code: "INVALID_PRIMARY_RESPONSE", message: "Primary TypeSafe returned an invalid answer payload", status: 502 };
    }
    return {
      ok: true,
      model: typeof data.model === "string" ? data.model : MODEL,
      answers: data.answers,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return {
      ok: false,
      code: timeout ? "PRIMARY_TIMEOUT" : "PRIMARY_NETWORK_ERROR",
      message: timeout ? "Primary TypeSafe timed out" : "Primary TypeSafe could not be reached",
      status: timeout ? 504 : 502,
    };
  }
}

async function callCloudflareBackup(
  state: unknown,
  questions: Record<string, unknown>,
): Promise<ProviderResult> {
  try {
    // The Worker fixes the model in its own manifest. Never send a model
    // field to /api/judge; its TYPESAFE_API_KEY remains inside Cloudflare.
    const res = await fetch(BACKUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(BACKUP_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null) as
      | { model?: unknown; answers?: unknown; error?: { code?: unknown; message?: unknown } }
      | null;
    if (!res.ok) {
      const code = typeof data?.error?.code === "string" ? data.error.code : "CLOUDFLARE_UNAVAILABLE";
      const message = typeof data?.error?.message === "string"
        ? `Cloudflare Jev backup: ${data.error.message}`
        : safeUpstreamMessage(res.status, "Cloudflare Jev backup");
      return { ok: false, code, message, status: res.status };
    }
    if (!data || !validAnswers(data.answers)) {
      return { ok: false, code: "INVALID_BACKUP_RESPONSE", message: "Cloudflare Jev backup returned an invalid answer payload", status: 502 };
    }
    return {
      ok: true,
      model: typeof data.model === "string" ? data.model : MODEL,
      answers: data.answers,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return {
      ok: false,
      code: timeout ? "BACKUP_TIMEOUT" : "BACKUP_NETWORK_ERROR",
      message: timeout ? "Cloudflare Jev backup timed out" : "Cloudflare Jev backup could not be reached",
      status: timeout ? 504 : 502,
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  // Rate limit before body parsing or upstream quota spend. Optional bearer
  // auth remains server-controlled by TRADER_API_TOKEN in _guard.ts.
  const blocked = guard(request, { route: "jev" });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ available: false, code: "INVALID_JSON", error: "Request body must be valid JSON" }, 400);
  }
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    return json({ available: false, code: "BODY_TOO_LARGE", error: "Request body exceeds 64KB" }, 413);
  }
  const b = body as { state?: unknown; questions?: unknown };
  if (!b || typeof b !== "object" || !b.state || typeof b.state !== "object" || Array.isArray(b.state)) {
    return json({ available: false, code: "INVALID_STATE", error: "Expected { state: object, questions: {...} }" }, 400);
  }
  if (!questionsOk(b.questions)) {
    return json({ available: false, code: "INVALID_QUESTIONS", error: `Expected 1-${MAX_QUESTIONS} typed questions keyed by qid` }, 400);
  }

  const primaryKey = process.env.TYPESAFE_API_KEY;
  const primary = primaryKey
    ? await callPrimary(primaryKey, b.state, b.questions)
    : {
        ok: false as const,
        code: "PRIMARY_KEY_MISSING",
        message: "Primary TypeSafe key is not configured in Vercel Production",
        status: 503,
      };

  if (primary.ok) {
    return json({ model: primary.model, answers: primary.answers, provider: "vercel" });
  }

  const backup = await callCloudflareBackup(b.state, b.questions);
  if (backup.ok) {
    return json({ model: backup.model, answers: backup.answers, provider: "cloudflare" });
  }

  // Safe diagnostics only: provider summaries, never keys, upstream bodies,
  // market payloads or wallet balances.
  return json({
    available: false,
    code: backup.code,
    error: `Primary ${primary.code}: ${primary.message}; backup ${backup.code}: ${backup.message}`,
  }, 502);
}
