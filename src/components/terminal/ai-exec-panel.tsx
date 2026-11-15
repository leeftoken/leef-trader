import { useState } from "react";
import { Bot, FlaskConical, ShieldAlert, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AI_EXEC_CONFIDENCE_MIN,
  aiSummaryOf,
  buildAiQuestions,
  parseAiProposal,
  type AiProposal,
  type AiSnapshotSummary,
} from "@/lib/leef/ai-executor";
import { askJev } from "@/lib/leef/jev-client";
import { AI_HELPER_REVIEW_CONFIDENCE_MIN } from "@/lib/leef/ai-helper-control";
import { journal } from "@/lib/leef/journal";
import { toast } from "@/hooks/useToast";
import { fmtNum } from "@/lib/leef/format";
import type { LeefSnapshot } from "@/lib/leef/types";
import { useBot } from "@/store/bot";
import { useTerminal } from "@/store/terminal";
import { useWallet } from "@/store/wallet";
import { cn } from "@/lib/utils";
import { useAiControl, type AiControlMode } from "./ai-control";
import { relTime, useNow } from "./use-now";

/* ------------------------------------------------------------------ */
/* Dry-run log (session-local, journaled)                               */
/* ------------------------------------------------------------------ */

type DryRun =
  | { at: number; status: "proposal"; proposal: AiProposal }
  | { at: number; status: "unavailable"; reason: string }
  | { at: number; status: "rejected"; reason: string };

/** Module-level: timestamps and journaling stay out of render scope. */
async function runJevDryRun(summary: AiSnapshotSummary): Promise<DryRun> {
  const at = Date.now();
  let questions: ReturnType<typeof buildAiQuestions>;
  try {
    questions = buildAiQuestions(summary);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "question build failed";
    journal({ kind: "ai", reason: `jev dry-run: ${reason}` });
    return { at, status: "unavailable", reason };
  }
  const res = await askJev(summary, questions);
  if (!res) {
    journal({ kind: "ai", reason: "jev dry-run: advisory unavailable (null response)" });
    return { at, status: "unavailable", reason: "Jev returned no answer (advisory unavailable)" };
  }
  const proposal = parseAiProposal(res.answers, {
    snapshotFetchedAt: summary.fetchedAt,
    candidatesIn: summary.candidatesIn,
    candidatesOut: summary.candidatesOut,
    model: res.model,
    receivedAt: Date.now(),
  });
  if (!proposal) {
    journal({ kind: "ai", reason: "jev dry-run: answer unusable, no proposal" });
    return { at, status: "rejected", reason: "Jev answer did not yield a usable proposal" };
  }
  journal({
    kind: "ai",
    reason: `jev dry-run: ${proposal.action} · confidence ${proposal.confidence.toFixed(2)} · weakest ${proposal.weakest}`,
  });
  return { at, status: "proposal", proposal };
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

/**
 * Derive a Swap-desk prefill from a proposal plus live bot/wallet state.
 * Proposals carry no amountIn (and buy/sell carry no token params), so the
 * amounts come from the same state the control seam would use. Returns null
 * when a coherent prefill can't be derived — the caller hides the button.
 */
function swapPrefill(
  p: AiProposal,
): { tokenIn: string; tokenOut: string; amountIn: string } | null {
  const b = useBot.getState();
  const quote = b.quote || "WAX";
  const base = b.base || "LEEF";
  const balances = useWallet.getState().balances();
  const sizePct = Math.min(100, Math.max(1, Number(p.params.sizePct ?? "100"))) / 100;
  if (p.action === "buy") {
    const amount = (balances[quote] ?? 0) * sizePct;
    return amount > 0 ? { tokenIn: quote, tokenOut: base, amountIn: String(amount) } : null;
  }
  if (p.action === "sell" || p.action === "reduce_risk") {
    // Full tracked position — AI exits are always full (no partial-exit
    // accounting), so the desk prefill matches what CONTROL would trade.
    const amount = b.position?.amountLeef ?? 0;
    return amount > 0 ? { tokenIn: base, tokenOut: quote, amountIn: String(amount) } : null;
  }
  if (p.action === "swap") {
    const tokenIn = p.params.tokenIn;
    const tokenOut = p.params.tokenOut;
    if (!tokenIn || !tokenOut || tokenIn === tokenOut) return null;
    const amountIn = Number(p.params.amountIn) > 0
      ? Number(p.params.amountIn)
      : (balances[tokenIn] ?? 0) * sizePct; // same derivation the seam uses
    return amountIn > 0 ? { tokenIn, tokenOut, amountIn: String(amountIn) } : null;
  }
  return null;
}

const MODE_COPY: Record<AiControlMode, string> = {
  off: "Zero Jev calls leave this browser.",
  suggest: "Jev proposals are advisory — you apply them by hand.",
  control: `Jev may execute proposals at confidence ≥ ${AI_EXEC_CONFIDENCE_MIN} — through every risk gate.`,
};

export function AiExecPanel({ snap }: { snap: LeefSnapshot }) {
  const { mode, persisted, setMode } = useAiControl();
  const helperMode = useTerminal((s) => s.aiHelperControl);
  const setHelperMode = useTerminal((s) => s.setAiHelperControl);
  const helperReview = useTerminal((s) => s.aiHelperReview);
  const helperEnabled = useTerminal((s) => s.aiEnabled);
  const setTab = useTerminal((s) => s.setTab);
  const setSwap = useTerminal((s) => s.setSwap);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [helperConfirmOpen, setHelperConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<DryRun[]>([]);
  const now = useNow(5000);

  // Latest engine-produced proposal — the bot loop writes it to the
  // terminal store (ephemeral, cleared on mode change).
  const engineProposal = useTerminal((s) => s.aiProposal);

  function selectMode(m: AiControlMode) {
    if (m === "control" && mode !== "control") {
      setConfirmOpen(true); // explicit risk confirm — never set directly
      return;
    }
    setMode(m);
  }

  async function dryRun() {
    if (busy || mode === "off") return;
    setBusy(true);
    try {
      const run = await runJevDryRun(
        aiSummaryOf(snap, useBot.getState(), useWallet.getState().balances()),
      );
      setRuns((prev) => [run, ...prev].slice(0, 20));
    } finally {
      setBusy(false);
    }
  }

  function applyProposal(p: AiProposal) {
    // One-click apply routes to the same manual trade path as any human
    // swap — the Swap desk owns execution and its gates.
    const prefill = swapPrefill(p);
    if (!prefill) return;
    setSwap(prefill);
    setTab("quotes");
  }

  const latest = runs[0]?.status === "proposal" ? runs[0].proposal : null;
  const latestPrefill = latest ? swapPrefill(latest) : null;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-wax/10 p-2 text-wax">
            <Bot className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI trade control</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Jev (TypeSafe System One) proposes a trade; deterministic code retains final
              authority. CONTROL requires Jev confidence ≥ {AI_EXEC_CONFIDENCE_MIN}. When the
              strategic helper is also in CONTROL, it must separately approve each buy/swap.
              Every trade still passes the existing freshness, sizing, quote, governor, resource,
              policy and simulation gates before anything is signed.
            </p>
          </div>
        </div>
        <div
          className="flex rounded-lg border border-border"
          role="radiogroup"
          aria-label="AI trade control mode"
        >
          {(
            [
              ["off", "OFF"],
              ["suggest", "SUGGEST"],
              ["control", "CONTROL"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => selectMode(m)}
              className={cn(
                "px-2.5 py-1.5 text-xs transition-colors",
                mode === m
                  ? m === "control"
                    ? "bg-warn/15 text-warn"
                    : "bg-accent/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-bg p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Strategic AI helper control</h3>
            <p className="text-xs text-muted-foreground mt-1">
              In CONTROL, the helper is a second-key reviewer for Jev buy/swap proposals.
              It can veto or abstain, but cannot invent trades, size positions, choose routes,
              sign, or block protective exits.
            </p>
          </div>
          <div className="flex rounded-lg border border-border" role="radiogroup" aria-label="Strategic AI helper control mode">
            {([
              ["off", "OFF"],
              ["suggest", "SUGGEST"],
              ["control", "CONTROL"],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={helperMode === m}
                disabled={m !== "off" && (!helperEnabled || mode === "off")}
                onClick={() => selectHelperMode(m)}
                className={cn(
                  "px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  helperMode === m
                    ? m === "control"
                      ? "bg-warn/15 text-warn"
                      : "bg-accent/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className={cn(helperMode === "control" && "border-warn/40 text-warn")}>
            HELPER {helperMode.toUpperCase()}
          </Badge>
          {helperMode === "off"
            ? "No strategic helper review is requested for Jev proposals."
            : helperMode === "suggest"
              ? "Reviews are visible but do not affect execution."
              : "Dual CONTROL: fresh Jev confidence and fresh helper approval are both required for new exposure."}
          {!helperEnabled && <span>· Turn on the AI helper in the AI desk first.</span>}
          {mode === "off" && <span>· Enable Jev SUGGEST or CONTROL first.</span>}
        </div>
        {mode !== "off" && helperMode !== "off" && (
          <div className="mt-3 rounded-md border border-border/70 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Latest helper review</span>
              {helperReview ? (
                <Badge
                  variant="outline"
                  className={cn(
                    helperReview.decision === "approve" && helperReview.confidence >= AI_HELPER_REVIEW_CONFIDENCE_MIN && helperReview.riskFlags.length === 0
                      ? "border-leef/40 text-leef"
                      : "border-warn/40 text-warn",
                  )}
                >
                  {helperReview.decision.toUpperCase()} · {fmtNum(helperReview.confidence, { digits: 2 })}
                </Badge>
              ) : (
                <Badge variant="outline">Pending / unavailable</Badge>
              )}
            </div>
            <p className="mt-1 text-muted-foreground">
              {helperReview
                ? helperReview.reason
                : helperMode === "control"
                  ? "No candidate-bound approval yet. Risk-increasing entries remain paused."
                  : "No strategic review has arrived yet."}
            </p>
            {helperReview?.riskFlags.length ? (
              <p className="mt-1 text-warn">Risk flags: {helperReview.riskFlags.join(", ")}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge
          variant="outline"
          className={cn(
            mode === "off" && "border-border text-subtle",
            mode === "suggest" && "border-accent/40 text-accent",
            mode === "control" && "border-warn/40 text-warn",
          )}
        >
          {mode.toUpperCase()}
        </Badge>
        <span>{MODE_COPY[mode]}</span>
        {!persisted && (
          <span className="font-mono text-[11px] text-subtle">
            · session-only (persisted store flag lands with the core update)
          </span>
        )}
      </div>

      {mode !== "off" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Proposal card */}
          <div className="rounded-lg border border-border bg-bg p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-wax" />
                Jev proposal
              </h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void dryRun()}
                disabled={busy}
              >
                <FlaskConical className="size-4" />
                {busy ? "Running…" : "Run dry-run"}
              </Button>
            </div>

            {engineProposal ? (
              <ProposalView proposal={engineProposal} origin="engine" now={now} />
            ) : latest ? (
              <ProposalView proposal={latest} origin="dry-run" now={now} />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No proposal yet. A dry-run asks Jev once, shows the typed answers, and
                touches nothing — execution stays behind CONTROL and the confidence gate.
              </p>
            )}

            {latest && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    latest.confidence >= AI_EXEC_CONFIDENCE_MIN
                      ? "border-leef/40 text-leef"
                      : "border-warn/40 text-warn",
                  )}
                >
                  {latest.confidence >= AI_EXEC_CONFIDENCE_MIN
                    ? `would execute in CONTROL (≥ ${AI_EXEC_CONFIDENCE_MIN})`
                    : `below gate — advisory only (< ${AI_EXEC_CONFIDENCE_MIN})`}
                </Badge>
                {mode === "suggest" && latestPrefill && (
                  <Button variant="outline" size="sm" onClick={() => applyProposal(latest)}>
                    Apply via Swap desk
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Dry-run log */}
          <div className="rounded-lg border border-border bg-bg p-4">
            <h3 className="text-sm font-medium">Dry-run log</h3>
            {runs.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No dry-runs this session. Every run is also written to the evidence journal.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs">
                {runs.map((r, i) => (
                  <li
                    key={`${r.at}-${i}`}
                    className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="min-w-0">
                      {r.status === "proposal" ? (
                        <>
                          <Badge variant={r.proposal.confidence >= AI_EXEC_CONFIDENCE_MIN ? "leef" : "warn"}>
                            {r.proposal.action}
                          </Badge>{" "}
                          <span className="font-mono tabular-nums text-muted-foreground">
                            conf {fmtNum(r.proposal.confidence, { digits: 2 })} · weakest{" "}
                            {r.proposal.weakest}
                          </span>
                        </>
                      ) : r.status === "unavailable" ? (
                        <span className="text-warn">unavailable — {r.reason}</span>
                      ) : (
                        <span className="text-muted-foreground">no usable proposal — {r.reason}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-subtle">{relTime(r.at, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={helperConfirmOpen} onOpenChange={setHelperConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-warn" />
              Enable strategic AI helper CONTROL?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  The helper will independently review each Jev buy/swap proposal. In combined
                  CONTROL, both models must return fresh, candidate-matched approvals.
                </p>
                <p>
                  The helper may veto or abstain. It cannot create or change a trade, set
                  amounts, choose routes, sign, or submit transactions. Missing, malformed,
                  low-confidence, stale, or risk-flagged reviews pause new entries. Protective
                  exits and the deterministic execution gates remain in force.
                </p>
                <p>
                  The helper receives the proposal, compact market data, wallet balance
                  amounts, strategy, position context and risk settings through the configured
                  AI gateway. No wallet keys, signing material, memos or signed transactions
                  are sent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                const ok = setHelperMode("control", true);
                if (!ok) {
                  e.preventDefault();
                  toast({
                    title: "Helper CONTROL refused",
                    description: "Enable Jev CONTROL and the AI helper before enabling dual CONTROL.",
                  });
                  return;
                }
                setHelperConfirmOpen(false);
              }}
            >
              I understand — enable helper CONTROL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Explicit risk confirm for Jev CONTROL — no accidental enable. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-warn" />
              Enable AI CONTROL?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  In CONTROL, Jev proposals scoring confidence ≥ {AI_EXEC_CONFIDENCE_MIN}{" "}
                  become trade candidates <span className="font-medium">with real funds</span>.
                </p>
                <p>
                  Every AI trade passes the same gates as the deterministic bot: book
                  freshness, USD bounds, learned size ceiling, exact-quote verify, portfolio
                  governor, CPU/NET/RAM preflight, policy firewall and pre-sign simulation.
                  Below the confidence threshold the proposal is logged and ignored.
                </p>
                <p>
                  CONTROL sends a compact market summary to TypeSafe Jev via this
                  app&apos;s <span className="font-mono">/api/jev</span> proxy:
                  wallet balances, open position size/USD, strategy, and top pool
                  stats. No keys, memos, or signed transactions are included. The
                  same payload is sent in SUGGEST; OFF makes zero Jev calls.
                </p>
                <p className="text-warn">
                  You can switch back to SUGGEST or OFF at any time — OFF stops all Jev
                  calls immediately.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // The store only grants CONTROL with an explicit confirm —
                // and can still refuse. Never close the dialog on a refusal.
                const ok = setMode("control", true);
                if (!ok) {
                  e.preventDefault();
                  toast({
                    title: "CONTROL refused",
                    description:
                      "The terminal store refused to enable AI control — the mode stays unchanged.",
                  });
                  return;
                }
                setConfirmOpen(false);
              }}
            >
              I understand — enable CONTROL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ProposalView({
  proposal,
  origin,
  now,
}: {
  proposal: AiProposal;
  origin: "engine" | "dry-run";
  now: number;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" className="uppercase">
          {proposal.action}
        </Badge>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          confidence {fmtNum(proposal.confidence, { digits: 2 })} · weakest: {proposal.weakest}
        </span>
        <span className="ml-auto font-mono text-[11px] text-subtle">
          {origin} · {relTime(proposal.fetchedAt, now)}
        </span>
      </div>
      {proposal.rationale && (
        <p className="text-sm text-muted-foreground">{proposal.rationale}</p>
      )}
      {Object.keys(proposal.params).length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
          {Object.entries(proposal.params).map(([k, v]) => (
            <span key={k}>
              {k}=<span className="text-foreground">{v}</span>
            </span>
          ))}
        </div>
      )}
      <details className="rounded-md border border-border bg-surface px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Jev answers (JSON)
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(proposal.answers, null, 2)}
        </pre>
      </details>
    </div>
  );
}
