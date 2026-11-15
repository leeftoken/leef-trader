# Dual AI control — Jev + strategic helper

## Authority model

The trading engine remains the source of executable decisions and the final authority. The deterministic engine first creates an eligible BUY candidate. Jev supplies a structured, fast approve-or-HOLD judgement for that exact candidate. The larger AI helper supplies a separate strategic review of that exact Jev proposal. Neither model can sign, submit transactions, change permissions, select wallet keys, set risk limits, or bypass execution checks.

There are two independent persisted controls:

- **Jev CONTROL** enables Jev polling and allows a fresh, sufficiently confident proposal to enter the existing deterministic execution path.
- **AI helper CONTROL** is an additional approval gate for risk-increasing Jev proposals. It can be enabled only while Jev CONTROL and the AI helper master switch are on, and requires a separate explicit confirmation.

AI helper modes are OFF, SUGGEST, and CONTROL:
- OFF: no helper review is requested.
- SUGGEST: reviews are generated and shown/journaled but do not affect execution.
- CONTROL: a risk-increasing proposal requires both Jev and helper approval.

## Dual CONTROL decision policy

For a deterministic engine BUY candidate in combined CONTROL, all of the following must be true:

1. Jev returns a valid typed proposal and its weakest relevant judgment meets the existing 0.75 confidence floor.
2. The proposal is bound to a valid source snapshot and is neither stale nor future-dated.
3. The AI helper returns a valid `control_review` object whose `candidate_id` exactly matches the Jev proposal ID.
4. The helper review references the same snapshot timestamp, is no older than 45 seconds, and its source market snapshot is no older than 90 seconds.
5. The helper decision is exactly `approve`, its confidence is at least 0.82, and `risk_flags` is empty.
6. The unchanged deterministic execution gauntlet independently permits the transaction.

A missing response, timeout, malformed schema, candidate mismatch, stale/future timestamp, abstention, veto, low confidence, or any risk flag blocks new exposure. It does not silently fall back to Jev-only execution while helper CONTROL is selected.

Protective engine exits and Jev SELL/REDUCE_RISK actions are not subject to the helper approval gate. The helper cannot delay or veto risk-reducing exits. The standard sell, stop, sizing, route, portfolio, resource, policy, simulation, signing, and reconciliation protections remain in force.

The engine's existing HOLD path remains conservative: Jev cannot manufacture an entry when the deterministic engine has already returned a HOLD or STOP. Jev also cannot replace a SELL, STOP, ARB, or SWAP decision. The AI control seam only runs on deterministic BUY candidates that pass the engine's earlier eligibility checks.

## Gateway contract — release gate

Jev is only asked to choose BUY or HOLD for a deterministic engine BUY candidate; it cannot choose exits, swaps, token pairs, routes, or new amounts. It may only reduce the candidate's proposed amount. The app sends the helper an `opportunity_explanation` task whose data includes a `control_review_request` and explicit response schema. The app accepts only:

```json
{
  "control_review": {
    "candidate_id": "exact Jev proposal ID",
    "decision": "approve",
    "confidence": 0.9,
    "risk_flags": [],
    "reason": "Concise evidence-based reason"
  }
}
```

This frontend contract is deliberately strict. The deployed AI gateway's actual task prompt and response behavior have not been verified in this change. Before enabling dual CONTROL in production, test the deployed gateway with an approved, vetoed, abstaining, malformed, and candidate-mismatched response. A gateway that returns its existing generic opportunity-explanation format will be rejected, and entries will remain paused. Do not weaken the parser to make an incompatible response pass; update and verify the gateway contract in its source repository first.

## Calibration and rollout

The 0.75 Jev and 0.82 helper thresholds are implementation gates, not statistically calibrated probabilities. Keep the feature in SUGGEST/paper mode while collecting paired decision records. Compare recommendations and approvals against realized fills, net PnL after costs, slippage, drawdown, false entries, missed opportunities, and performance by regime. Promote only after the helper's response contract is verified and out-of-sample evidence supports the combined policy.

No wallet authority, key handling, signing logic, deployed contract, or live staking code is changed by this feature.
