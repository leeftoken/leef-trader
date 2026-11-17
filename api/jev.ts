/**
 * POST /api/jev — first-party proxy to the shared LEEF Signer Jev gateway.
 *
 * The Signer Worker owns the TypeSafe key, model and provider configuration.
 * Trader, TG account runners and the Signer UI all use the same /api/judge
 * contract; the browser never receives provider credentials.
 */
import { guard } from "./_guard.js";

declare const process: { env: Record<string, string | undefined> };

const GATEWAY_URL =
  process.env.LEEF_JEV_GATEWAY_URL ||
  process.env.TYPESAFE_BACKUP_URL ||
  "https://leef-trader-ai.leef-trader.workers.dev/api/judge";
const GATEWAY_TIMEOUT_MS = 20_000;
const MAX_QUESTIONS = 32;
const MAX_BODY_BYTES = 65_536;
const QUESTION_TYPES = new Set(["noul", "choice", "score"]);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function questionsOk(raw: unknown): raw is Record<string, { type: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) return false;
  return entries.every(
    ([qid, q]) =>
      qid.length > 0 &&
      qid.length <= 64 &&
      !!q &&
      typeof q === "object" &&
      !Array.isArray(q) &&
      typeof (q as { type?: unknown }).type === "string" &&
      QUESTION_TYPES.has((q as { type: string }).type),
  );
}

function answersOk(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value as Record<string, unknown>).every(
      (answer) => !!answer && typeof answer === "object" &&
        !Array.isArray(answer) &&
        typeof (answer as { type?: unknown }).type === "string",
    );
}

export async function POST(request: Request): Promise<Response> {
  // Keep the app route protected from retry storms; the shared Worker also
  // applies its own per-IP limit. Do not require a browser-distributed secret.
  const blocked = guard(request, { route: "jev", limit: 60 });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ available: false, code: "INVALID_JSON", error: "Request body must be valid JSON" }, 400);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(body ?? null);
  } catch {
    return json({ available: false, code: "INVALID_REQUEST", error: "Request body must be JSON-serializable" }, 400);
  }
  if (serialized.length > MAX_BODY_BYTES) {
    return json({ available: false, code: "BODY_TOO_LARGE", error: "Request body exceeds 64KB" }, 413);
  }

  const b = body as { state?: unknown; questions?: unknown };
  if (!b || typeof b !== "object" || !b.state || typeof b.state !== "object" || Array.isArray(b.state)) {
    return json({ available: false, code: "INVALID_STATE", error: "Expected { state: object, questions: {...} }" }, 400);
  }
  if (!questionsOk(b.questions)) {
    return json({
      available: false,
      code: "INVALID_QUESTIONS",
      error: "Expected 1-" + MAX_QUESTIONS + " named noul, choice, or score questions",
    }, 400);
  }

  let upstream: Response;
  try {
    // The Worker fixes jev-latest from its private manifest. Do not send a
    // client-controlled model or any Authorization/API-key header.
    upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ state: b.state, questions: b.questions }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return json({
      available: false,
      code: timeout ? "GATEWAY_TIMEOUT" : "GATEWAY_UNREACHABLE",
      error: timeout ? "LEEF Signer Jev gateway timed out" : "LEEF Signer Jev gateway could not be reached",
    }, timeout ? 504 : 502);
  }

  const data = await upstream.json().catch(() => null) as
    | {
        model?: unknown;
        answers?: unknown;
        usage?: unknown;
        error?: { code?: unknown; message?: unknown };
      }
    | null;

  if (!upstream.ok) {
    const errorCode = typeof data?.error?.code === "string" ? data.error.code : "JEV_GATEWAY_ERROR";
    const errorMessage = typeof data?.error?.message === "string"
      ? data.error.message
      : "LEEF Signer Jev gateway returned HTTP " + upstream.status;
    return json({
      available: false,
      code: errorCode,
      error: errorMessage,
    }, upstream.status);
  }

  if (!data || !answersOk(data.answers)) {
    return json({
      available: false,
      code: "INVALID_GATEWAY_RESPONSE",
      error: "LEEF Signer returned a malformed or incomplete Jev answer payload",
    }, 502);
  }

  return json({
    model: typeof data.model === "string" ? data.model : "jev-latest",
    answers: data.answers,
    provider: "leef-signer",
    ...(data.usage && typeof data.usage === "object" ? { usage: data.usage } : {}),
  });
}
