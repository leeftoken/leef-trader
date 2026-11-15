import { describe, expect, it } from "vitest";
import { useTerminal } from "./terminal";

describe("aiControl (Jev execution authority)", () => {
  it("defaults to off — zero Jev calls out of the box", () => {
    expect(useTerminal.getState().aiControl).toBe("off");
  });

  it("suggest applies without confirmation", () => {
    expect(useTerminal.getState().setAiControl("suggest")).toBe(true);
    expect(useTerminal.getState().aiControl).toBe("suggest");
    useTerminal.getState().setAiControl("off");
  });

  it("control is REFUSED without the explicit risk confirm", () => {
    expect(useTerminal.getState().setAiControl("control")).toBe(false);
    expect(useTerminal.getState().aiControl).not.toBe("control");
  });

  it("control applies only with confirmed: true, and can always be revoked", () => {
    expect(useTerminal.getState().setAiControl("control", true)).toBe(true);
    expect(useTerminal.getState().aiControl).toBe("control");
    // Re-confirming while already in control is a no-op success; leaving never needs it.
    expect(useTerminal.getState().setAiControl("control")).toBe(true);
    expect(useTerminal.getState().setAiControl("off")).toBe(true);
    expect(useTerminal.getState().aiControl).toBe("off");
  });

  it("proposal state is ephemeral and settable", () => {
    useTerminal.getState().setAiProposal(null);
    expect(useTerminal.getState().aiProposal).toBeNull();
  });

  it("a mode change clears any stale proposal; re-setting the same mode keeps it", () => {
    const proposal = { action: "buy" } as never;
    useTerminal.getState().setAiProposal(proposal);
    expect(useTerminal.getState().aiProposal).toBe(proposal);
    useTerminal.getState().setAiControl("suggest");
    expect(useTerminal.getState().aiProposal).toBeNull();
    useTerminal.getState().setAiProposal(proposal);
    useTerminal.getState().setAiControl("suggest"); // no change → untouched
    expect(useTerminal.getState().aiProposal).toBe(proposal);
    useTerminal.getState().setAiControl("off");
    expect(useTerminal.getState().aiProposal).toBeNull();
  });
});


describe("aiHelperControl (strategic second-key review)", () => {
  it("defaults to off and cannot be enabled while Jev is off", () => {
    const state = useTerminal.getState();
    expect(state.aiHelperControl).toBe("off");
    expect(state.setAiHelperControl("suggest")).toBe(false);
    expect(useTerminal.getState().aiHelperControl).toBe("off");
  });

  it("requires Jev CONTROL, AI helper enabled, and explicit confirmation for helper CONTROL", () => {
    const state = useTerminal.getState();
    state.setAiControl("control", true);
    expect(useTerminal.getState().setAiHelperControl("control")).toBe(false);
    expect(useTerminal.getState().setAiHelperControl("control", true)).toBe(true);
    expect(useTerminal.getState().aiHelperControl).toBe("control");

    useTerminal.getState().setAiEnabled(false);
    expect(useTerminal.getState().aiHelperControl).toBe("off");
    expect(useTerminal.getState().aiHelperReview).toBeNull();
    useTerminal.getState().setAiEnabled(true);
    useTerminal.getState().setAiControl("off");
  });

  it("downgrades helper CONTROL when Jev leaves CONTROL and disables it when Jev turns off", () => {
    const state = useTerminal.getState();
    state.setAiControl("control", true);
    state.setAiHelperControl("control", true);

    expect(useTerminal.getState().setAiControl("suggest")).toBe(true);
    expect(useTerminal.getState().aiHelperControl).toBe("suggest");
    expect(useTerminal.getState().aiHelperReview).toBeNull();

    useTerminal.getState().setAiHelperControl("control", true);
    expect(useTerminal.getState().aiHelperControl).toBe("control");
    useTerminal.getState().setAiControl("off");
    expect(useTerminal.getState().aiHelperControl).toBe("off");
    expect(useTerminal.getState().aiHelperReview).toBeNull();
  });

  it("keeps helper reviews ephemeral and clears them when helper mode changes", () => {
    const state = useTerminal.getState();
    state.setAiControl("control", true);
    state.setAiHelperControl("suggest");
    const review = {
      candidateId: "jev:sample",
      snapshotFetchedAt: "2026-11-15T11:59:00.000Z",
      decision: "approve",
      confidence: 0.9,
      riskFlags: [],
      reason: "test",
      reviewedAt: Date.now(),
      model: "test",
    } as const;
    useTerminal.getState().setAiHelperReview(review);
    expect(useTerminal.getState().aiHelperReview).toBe(review);
    useTerminal.getState().setAiHelperControl("off");
    expect(useTerminal.getState().aiHelperReview).toBeNull();
    useTerminal.getState().setAiControl("off");
  });
});
