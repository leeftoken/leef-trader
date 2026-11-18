# Jev + AI Helper control model

This document describes the intended production semantics for the two AI controls in Leef Trader. They are complementary controls, not two independent trade executors.

## Authority model

1. **Deterministic trading engine** creates and sizes candidate opportunities, calculates route economics, and owns protective exits.
2. **Jev / TypeSafe System One** judges an existing eligible buy, swap, or atomic arbitrage candidate. It can accept or reject the candidate; for buy/swap it may choose a bounded size bucket, while atomic arbitrage is accepted or rejected at its engine-defined size. It cannot create a trade from HOLD, choose another token pair, choose a route, resize an arb, or sign.
3. **AI Helper** performs slower strategic evidence review. In CONTROLLED LEARNING it can propose bounded learning artifacts; the deterministic Learning Governor decides whether they survive shadow evaluation and promotion.
4. **Execution gauntlet** remains the only transaction authority: fresh execution state, size and edge checks, route verification, portfolio governor, resource preflight, policy, simulation, signing and reconciliation.

## What “both in control” means

| Control | Role | Frequency | If unavailable |
|---|---|---|---|
| Jev = CONTROL | Accept/reject the exact deterministic buy/swap/arb candidate | A request starts for that candidate and the execution gate awaits that same response | The candidate is paused; the failure is surfaced in the decision log, with the configured TypeSafe backup path tried when the primary is unavailable |
| AI Helper = CONTROLLED LEARNING | Review trade and Jev evidence; propose bounded learning changes | Configured trade cadence, with a minimum five-minute review gap | Existing deterministic strategy and already-promoted learning continue; no new AI learning proposal is applied |

The AI Helper is **not** a second per-trade approver. Making it approve every trade would add latency and another model failure point without improving the deterministic execution guarantees. Its value is in analysing accumulated outcomes and improving bounded strategy parameters over time.

## Jev candidate contract

The application sends Jev:
- Market regime, realized volatility, pool disagreement, danger score and quote age
- Position size, entry mark, unrealized PnL, session results and configured risk limits
- The deterministic candidate's token pair and contract identities, input amount, USD notional, expected output/net edge, impact, pool liquidity, pool IDs and hop count
- For atomic arbitrage, the quote-token identity, volume/spread intent, exact round-trip input and return, both pool IDs and the atomic route identity
- A source snapshot timestamp, versioned candidate fingerprint, request time and returned model identifier

Jev can return only the action allowed for the supplied candidate:
- hold — reject the candidate
- buy — accept the already-generated buy candidate
- swap — accept the already-generated swap candidate
- arb — accept the already-generated atomic quote→base→quote round-trip

For buy and swap, Jev may choose a quarter, half or full size bucket. This is a cap on the engine candidate, not an instruction to increase it. If the selected size is below the deterministic minimum trade, the candidate is rejected. Atomic arb has no size bucket: Jev cannot resize it, change either pool, alter its route or change its token pair.

Jev does not choose sell/stop actions. Protective sells and stops are engine-owned and bypass the Jev seam. Candidate types not explicitly supported by the Jev schema remain deterministic.

A proposal is unusable if its source snapshot is missing, future-dated or too old; the response is delayed; the confidence/Noul values are outside 0–1; or the strategy, candidate kind, token contracts, arb intent where applicable, exact input amount, USD notional, expected output, expected net edge, price impact, pool liquidity, pool path, hop count or route signature no longer match. The candidate fingerprint is versioned and includes all of those execution-relevant fields; route signatures alone are not sufficient because they are amount-independent.

For a Noul answer, TypeSafe returns P(yes) directly and does not return a separate confidence value. The bot therefore gates the Noul probabilities directly: `riskStress` must be on the safe side (≤ 0.5) and `riskExecute` on the coherent/fresh side (≥ 0.5). Choice confidence is used as returned by TypeSafe; proposal confidence is the action Choice confidence only. The size bucket is a bounded sizing preference, not an authorization signal, so uncertainty about quarter/half/full sizing cannot veto an otherwise valid action. The 75% action-confidence floor is a software threshold, **not proof of 75% real-world accuracy**. Calibration must be measured from outcomes.

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

Jev CONTROL is session-only: it is not persisted, and a full browser reload returns it to OFF. Any previously persisted CONTROL setting is reset to OFF by the v3 store migration. The AI Helper learning mode may remain configured across reloads because it only submits bounded proposals to the deterministic governor.

Never interpret the two AI controls as permission to bypass deterministic limits or to change live wallet authority. Production deployment and key/permission changes are separate release decisions.