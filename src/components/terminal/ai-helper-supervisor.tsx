import { useEffect } from "react";
import { aiTask } from "@/lib/leef/ai-analyst";
import {
  buildAiHelperReviewPayload,
  helperReviewOfResult,
  isAiProposalFresh,
} from "@/lib/leef/ai-helper-control";
import { journal } from "@/lib/leef/journal";
import { useTerminal } from "@/store/terminal";

/**
 * UI-layer strategic supervisor. It is mounted by TerminalApp so helper
 * reviews continue regardless of which desk is visible. The trading loop
 * only publishes a typed Jev proposal and bounded context; this component
 * owns the general AI client call and writes back a parsed, candidate-bound
 * review. It has no wallet or signing imports.
 */
const inFlight = new Set<string>();

export function AiHelperSupervisor() {
  const proposal = useTerminal((s) => s.aiProposal);
  const context = useTerminal((s) => s.aiHelperContext);
  const helperMode = useTerminal((s) => s.aiHelperControl);
  const aiEnabled = useTerminal((s) => s.aiEnabled);
  const gatewayUrl = useTerminal((s) => s.aiGatewayUrl);

  useEffect(() => {
    if (
      helperMode === "off" ||
      !aiEnabled ||
      !proposal ||
      proposal.action !== "buy" ||
      !context ||
      proposal.engineCandidateId === "advisory-dry-run" ||
      !isAiProposalFresh(proposal)
    ) return;

    const proposalId = proposal.proposalId;
    if (inFlight.has(proposalId)) return;
    inFlight.add(proposalId);

    void (async () => {
      try {
        const payload = buildAiHelperReviewPayload(
          proposal,
          context.market,
          context.deterministic,
        );
        const result = await aiTask("opportunity_explanation", payload, {
          url: gatewayUrl,
          timeoutMs: 25_000,
        });
        const review = helperReviewOfResult(result, proposal, Date.now());
        const current = useTerminal.getState();

        // The answer is usable only while the exact proposal is still current
        // and the helper is still enabled. A late response can never approve a
        // replacement candidate or resurrect a disabled control mode.
        if (
          current.aiProposal?.proposalId !== proposalId ||
          current.aiHelperControl === "off" ||
          !current.aiEnabled ||
          current.aiGatewayUrl !== gatewayUrl ||
          current.aiGatewayUrl !== gatewayUrl
        ) return;

        current.setAiHelperReview(review);
        journal({
          kind: "ai",
          reason: review
            ? `AI helper ${review.decision} Jev BUY · confidence ${review.confidence.toFixed(2)} · ${review.reason.slice(0, 160)}`
            : "AI helper review unusable · no candidate-bound approval",
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        const current = useTerminal.getState();
        if (
          current.aiProposal?.proposalId !== proposalId ||
          current.aiHelperControl === "off" ||
          !current.aiEnabled
        ) return;
        current.setAiHelperReview(null);
        const reason = err instanceof Error ? err.message.slice(0, 160) : "helper unavailable";
        journal({ kind: "ai", reason: `AI helper review unavailable · ${reason}` });
      } finally {
        inFlight.delete(proposalId);
      }
    })();
  }, [proposal, context, helperMode, aiEnabled, gatewayUrl]);

  return null;
}
