# Jev + AI Helper control model

This document describes the intended production semantics for the two AI controls in Leef Trader. They are complementary controls, not two independent trade executors.

## Authority model

1. **Deterministic trading engine** creates and sizes candidate opportunities, calculates route economics, and owns protective exits.
2. **Jev / TypeSafe System One** judges an existing eligible buy or swap candidate. It can accept or reject the candidate and choose a bounded size bucket. It cannot create a trade from HOLD, choose another token pair, choose a route, or sign.
3. **AI Helper** performs slower strategic evidence review. In CONTROLLED LEARNING it can propose bounded learning artifacts; the deterministic Learning Governor decides whether they survive shadow evaluation and promotion.
4. **Execution gauntlet** remains the only transaction authority: fresh execution state, size and edge checks, route verification, portfolio governor, resource preflight, policy, simulation, signing and reconciliation.

## What “both in control” means

| Control | Role | Frequency | If unavailable |
|---|---|---|---|
| Jev = CONTROL | Accept/reject the current deterministic buy/swap candidate | Background poll, nominal 45-second minimum interval | The eligible candidate is paused until a fresh matching judgement is available |
| AI Helper = CONTROLLED LEARNING | Review trade and Jev evidence; propose bounded learning changes | Configured trade cadence, with a minimum five-minute review gap | Existing deterministic strategy and already-promoted learning continue; no new AI learning proposal is applied |

The AI Helper is **not** a second per-trade approver. Making it approve every trade would add latency and another model failure point without improving the deterministic execution guarantees. Its value is in analysing accumulated outcomes and improving bounded strategy parameters over time.

## Jev candidate contract

The application sends Jev:
- Explicit execution mode (paper or live), bound into the candidate identity
- Market regime, realized volatility, pool disagreement, danger score and quote age
- Position size, entry mark, unrealized PnL, session results and configured risk limits
- The deterministic candidate's token pair and contract identities, input amount, expected output/edge, impact, pool path and hop count
- A source snapshot timestamp, candidate identity, request time and returned model identifier

Jev can return only:
- hold — reject the candidate
- buy — accept the already-generated buy candidate
- swap — accept the already-generated swap candidate

For buy and swap, Jev may choose a quarter, half or full size bucket. This is a cap on the already-sized engine candidate input amount, not a percentage of the entire wallet and never an instruction to increase it. If the selected size is below the deterministic minimum trade, the candidate is rejected.

Jev does not choose sell/stop actions. Protective sells and stops are engine-owned and bypass the Jev seam. Arbitrage and other unsupported candidate types remain deterministic.

A proposal is unusable if its source snapshot is missing, future-dated or too old; the response is delayed; the confidence/Noul values are outside 0–1; the strategy, paper/live mode, candidate kind, token contracts, input amount, expected output, edge, impact or route identity no longer match; an accepted approval is one-shot and cannot authorize another execution. or the weakest judgement is below the configured confidence floor. The 75% floor is a software threshold, **not proof of 75% real-world accuracy**. Calibration must be measured from outcomes.

## AI Helper learning contract

The Helper receives aggregate execution evidence, pool profiles and structured Jev proposal history. Jev confidence is model-reported and must not be treated as calibrated accuracy or profitability without a paired outcome record.

The Helper may propose only the bounded learning artifact types already supported by the Learning Governor:
- POOL_SLIPPAGE_PROFILE
- POOL_SIZE_MULTIPLIER

The Learning Governor validates proposals, shadow-tests them and controls promotion. The Helper cannot edit hard risk limits, wallet permissions, signing logic or transaction policy.

## Operating recommendation

1. Validate the configuration in paper mode and replay recorded market fixtures.
2. Run Jev in SUGGEST mode against live data and review its candidate judgements.
3. Enable Jev CONTROL only when the candidate, snapshot and confidence checks are behaving as expected.
4. Enable AI Helper CONTROLLED LEARNING after sufficient execution evidence exists.
5. Review the Jev evidence, promoted artifacts, realised slippage, net edge, drawdown and missed-opportunity counterfactuals regularly.

Never interpret the two AI controls as permission to bypass deterministic limits or to change live wallet authority. Production deployment and key/permission changes are separate release decisions.