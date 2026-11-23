# Trading Engine

The decision pipeline, as implemented. Expensive work only happens for
opportunities that survive the cheap stages.

## The multi-stage pipeline

```
STAGE 1  cheap market filter      snap.source === "live", priced book,
                                  quote age ≤ maxQuoteAgeSec
STAGE 2  opportunity detection    strategy logic on the cached 30s series
                                  + cached pool book (no network)
STAGE 3  net edge + optimal size  NetEdgeEngine over the SAME cached book —
                                  constant-product math, no network calls
STAGE 4  risk validation          impact/position/hourly caps, cooldown,
                                  drawdown/goal stops
STAGE 5  resource preflight       WAX CPU/NET/RAM (live only)
STAGE 6  fresh exact quote        Alcor CLMM router — only now do we spend
                                  an API call (arb always; swaps at sign time)
STAGE 7  execution policy         transaction policy firewall
STAGE 8  sign + broadcast         session key or external wallet
STAGE 9  confirmation + reconcile Hyperion get_transaction → actual transfers
STAGE 10 journal + calibration    decision log, predicted-vs-realized edge
```

## The decision engine

`evaluateBot(input)` is **pure**: same input → same decision, no I/O. All
network/chain effects live in `use-bot-loop.ts`. That separation is what
makes the bot testable and the desk's dry-run preview possible.

Decision kinds: `buy` (sized entry with edge verdict), `sell` (exit),
`arb` (atomic plan), `hold` (do nothing — a successful outcome), `stop`
(session goal / drawdown reached).

## Desk preview parity

The desk's dry-run preview uses wall-clock quote freshness and the same
third-party flow states and persisted echo-cost budget as the live evaluator.
A previewed candidate is still subject to any later execution-only gates,
including Jev CONTROL approval, exact venue quotes, resource checks and the
shared live-capital recovery lock. A preview is not a promise that an order
will be submitted.

## Opportunity dedup

- The bot is single-flight: one trade in flight, then a cooldown
  (adaptive: 0.5× for atomic arbs/echoes, 2× for DCA, 1.5× after a loss,
  floor 15s).
- The rebalancer defers any leg that would **sell LEEF while the bot holds an
  open LEEF position** — same wallet, same market event, one actor at a time.

## Rebalancer

`src/lib/leef/rebalance.ts` — priority ladder (default:
bridged-USDC → WAX → LEEF). Dust sweep consolidates off-ladder tokens worth
≥ `minDustUsd` into the highest-priority routable ladder token; drift repair
moves value upward when a lower-rank token exceeds its geometric target share
by `driftPct`. Every leg is quoted by the Alcor router with an impact cap;
all legs execute as ONE atomic transaction. Scheduler: `intervalSec`
(default 600s).

## Failure modes (all fail closed)

Router down / unrouted → hold or error log, no trade. Stale book → hold.
Exhausted WAX resources → hold with reason. Policy violation → throw before
signing. Broadcast error → decision log + toast, no state change. Tx failed
on-chain (quorum, below) → treated as no-trade and the lock releases. Tx
status unknown → capital stays locked; the router estimate is never booked
as the fill. Wallet sync does not clear the lock or repair the position.
See [Live capital recovery](#live-capital-recovery).

## Live capital recovery

One live trade at a time. The guard is `src/lib/wallet/trade-cycle.ts`,
persisted at `localStorage` key `leef-live-capital-lock-v1`. Paper mode
never takes it.

| Phase | New live trade | How it ends |
|---|---|---|
| `signing` | blocked | abort if signing never started a broadcast; otherwise the signer advances it |
| `broadcasted` / `reconciling` | blocked | confirmed transfers or a quorum failure |
| `unknown` | blocked | same, after read-only history polling |
| `blocked` | blocked | operator confirm only when there is **no** txid and the cause is `interrupted-signing` |
| `confirmed` / `failed` / `idle` | allowed | lock removed from storage |

`signing`, `broadcasted`, `reconciling`, `unknown`, and `blocked` all make
`liveCapitalBlocked()` true. A second live submission is refused until the
exact txid is settled.

### What a timeout actually does

`sign.ts` hashes the packed transaction **before** `push_transaction`. On
`BroadcastTimeoutError` it calls `markUnknown(txid)` and throws
`TRANSACTION_UNKNOWN`. There is one submission. The retry policy
(`retry-policy.ts`) classifies `TRANSACTION_UNKNOWN` as `retry: "none"`.
Nothing re-signs or re-broadcasts.

The bot loop (`use-bot-loop.ts`, `retainUnknownBroadcast` / `pollUnknown`)
then:

1. Writes one live `execution` journal row with `status: "unknown"` and the
   code-generated candidate (not a chain guess).
2. Polls Hyperion with `reconcileTransfersLater` (10 tries, 900 ms apart,
   15 s budget). Inclusion without parsed transfers stays unknown.
3. If the txid is still pending, waits 15 s and polls again while this tab
   is open. The timer only reads history.

Any saved 64-hex txid reloads as phase `unknown`, including a broadcast
that had not finished reconciling. Automatic resume
(`resumeUnknownTradeRecovery`) runs only in that phase, so the same page's
in-flight `broadcasted` / `reconciling` path does not also insert a journal
row. Resume also requires live mode, `canSign()`, and the account stored on
the lock when one was saved. A missing journal row is restored from the
persisted non-secret intent (`recovery-journal.ts`). Chain activity alone
never creates that row. If a live execution row for the txid already
exists, restore leaves it alone.

### What is allowed to unlock

Settlement is `reconcile.ts` + `chain.ts`:

- **Executed** is single-source chain truth, but a fill is booked only when
  Hyperion also returns parsed transfers. Empty transfer lists stay unknown.
- **Failed** needs agreement from at least two RPC history endpoints
  (`quorumTxStatus`) or two Hyperion indexers (`hyperionTxVerdict`). One
  failed answer, or any executed/failed disagreement, stays unknown.
- RPC `hard_fail` / `soft_fail` from that quorum releases the lock and books
  no fill.
- Confirmed transfers go through `assessUnknownExecution`
  (`recovery.ts`). Amounts come from parsed account transfers and the saved
  cost basis. The router quote is never used as the fill.
- The position update and `recoveredTxids` marker are one store write.
  `stateApplied` on the intent, or a txid already in `recoveredTxids`,
  means a reload finishes the journal only — the fill is not applied twice.
- `settleUnknownExecution` then collapses equivalent journal rows onto one
  confirmed row. The lock clears only after that, via `markConfirmed` /
  `markFailed` for that exact txid.

If the position is already verified and the saved execution rows agree with
the chain output (`liveExecutionOutcomeMatchesChain`, within `1e-12`), a
failed IndexedDB write does not keep the engine locked. Conflicting rows
still fail closed.

`assessUnknownExecution` refuses the automatic path when it cannot
reconstruct the position unambiguously. Typical blocks: no unique live
`unknown` execution row, ambiguous token contract, buy/sell that no longer
matches the configured base/quote, debit that is not the saved `amountIn`,
a paper position in the way of a live fill, a sell that is not the full
saved live position, a swap that changes the open base inventory, or an arb
that is missing either Alcor base leg. Platform-fee transfers to
`smart.ass` are excluded from the arb's swap input. Anything that fails
stays locked; the bot reason quotes the assessment.

### After a verified settlement

`start()` sets `resumeAfterRecovery`. `stop()` clears it, and that choice
is what gets saved — `running` itself is not persisted, so a reload always
comes back stopped until settlement finishes. A strategy halt is separate
and still needs the desk's manual resume. When the lock releases,
`resumeAfterVerifiedSettlement` starts the previous session only if the
flag is set, there is no strategy halt, and capital is no longer blocked.
A save from before the flag existed falls back to resumable when the
capital lock still holds a trade intent.

### Operator checks

The bot desk shows **Live · recovery locked** while `liveCapitalBlocked()`
is true. Paper mode does not sign and does not clear the lock.

**A txid is on the card**

1. Reconnect the same WAX account. A lock saved with an account refuses
   inspection from a different one.
2. Leave the tab open in live mode with a signer available (session key
   re-imported, or an Anchor / WAX Cloud Wallet session). That is what
   starts the automatic poll. Session keys do not survive reload.
3. **Inspect & reconcile** does the same read immediately. It does not
   broadcast. Wait if the notice says indexing is incomplete.
4. If the notice says automatic recovery was blocked, do not delete the
   lock. The reason names the mismatch (pair, position, token contract,
   conflicting journal).

**No txid, and the card offers a confirmation**

The cause is `interrupted-signing`: a wallet prompt ended before a txid was
saved. Open the account on the WAX explorer from the interrupted time and
look for an unexpected transfer to `swap.alcor` or a prompt that is still
pending. **Confirm unlock** calls
`confirmInterruptedSigningNoBroadcast` only for that account, only with no
txid, and only for this cause. A txid lock cannot be clicked away.

**Malformed lock**

Unparseable storage, or a non-finite `since`, becomes
`blockedCause: "corrupt-storage"`. The desk will not self-clear it. Do not
delete `leef-live-capital-lock-v1` to force another trade — that key is the
guard against a second spend of capital whose first transaction may still
land.

## Latency

Every live close records sign→reconcile latency into the strategy's
calibration record (`latencyMsSum`). A full latency breakdown dashboard is
PLANNED; today the number is in the data, not yet in the UI.
