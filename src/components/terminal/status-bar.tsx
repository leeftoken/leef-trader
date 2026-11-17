import { marketStats } from "@/lib/leef/analytics";
import { fmtLeefLot, fmtNum, fmtUsd } from "@/lib/leef/format";
import { headline } from "@/lib/leef/rank";
import { type LeefSnapshot, type RankedPool } from "@/lib/leef/types";
import { measureSnapshotFreshness } from "@/lib/market/snapshot-freshness";
import type { LiveTickState } from "./use-live-tick";
import { useMarketEngineSelector } from "@/hooks/useMarketEngine";
import type { EngineState } from "@/lib/market/market-engine";
import { cn } from "@/lib/utils";
import { relTime, useNow } from "./use-now";
import { VersionBanner } from "./version-banner";
import { clampSyncSec, DEFAULT_SYNC_SEC, useTerminal } from "@/store/terminal";
import { useAiControl } from "./ai-control";
import { liveCapitalBlocked, pendingTxid, tradePhase, unknownBlockReason } from "@/lib/wallet/trade-cycle";
import { Button } from "@/components/ui/button";

const selectHeadBlock = (state: EngineState) => state.headBlock;
const selectHeadBlockAt = (state: EngineState) => state.headBlockAt;
const selectBestRpcUrl = (state: EngineState) => state.rpc[0]?.url ?? null;
const selectBestRpcLatency = (state: EngineState) => state.rpc[0]?.latencyMs ?? null;
const selectSignerMode = (state: EngineState) => state.signer.mode;
const selectSignerReady = (state: EngineState) => state.signer.ready;
const selectSignerAuthType = (state: EngineState) => state.signer.authType;
const selectAutoTradeBot = (state: EngineState) => state.autoTrade.bot;
const selectAutoTradePhase = (state: EngineState) => state.autoTrade.phase;

export function StatusBar({
  snap,
  ranked,
  tick,
}: {
  snap: LeefSnapshot;
  ranked: RankedPool[];
  tick: LiveTickState;
}) {
  // Live infra pulse (head block age etc.) between engine commits.
  const now = useNow();
  const headBlock = useMarketEngineSelector(selectHeadBlock);
  const headBlockAt = useMarketEngineSelector(selectHeadBlockAt);
  const bestRpcUrl = useMarketEngineSelector(selectBestRpcUrl);
  const bestRpcLatency = useMarketEngineSelector(selectBestRpcLatency);
  const signerMode = useMarketEngineSelector(selectSignerMode);
  const signerReady = useMarketEngineSelector(selectSignerReady);
  const signerAuthType = useMarketEngineSelector(selectSignerAuthType);
  const autoTradeBot = useMarketEngineSelector(selectAutoTradeBot);
  const autoTradePhase = useMarketEngineSelector(selectAutoTradePhase);
  const setTab = useTerminal((s) => s.setTab);
  const syncSec = useTerminal((s) => s.syncSec);
  const aiEnabled = useTerminal((s) => s.aiEnabled);
  const learningMode = useTerminal((s) => s.learningMode);
  const { mode: jevMode } = useAiControl();
  const capitalBlocked = liveCapitalBlocked();
  const capitalPhase = tradePhase();
  const unresolvedTxid = pendingTxid();
  const capitalReason = unknownBlockReason();
  const h = headline(ranked);
  const stats = marketStats(snap);
  const synced = relTime(snap.fetchedAt, now);
  const freshnessWindowMs = (clampSyncSec(syncSec ?? DEFAULT_SYNC_SEC) + 15) * 1_000;
  const freshness = measureSnapshotFreshness(snap, freshnessWindowMs, now);
  const rawSnapshotAgeSec = freshness.ageMs == null ? Number.NaN : freshness.ageMs / 1_000;
  const snapshotAgeSec = Math.max(0, rawSnapshotAgeSec);
  const snapshotFresh = freshness.fresh;
  const marketDataState =
    snap.source === "unavailable"
      ? "NO DATA"
      : snap.source !== "live"
        ? "FALLBACK"
        : snapshotFresh
          ? "LIVE"
          : "STALE";
  const marketDataTone =
    marketDataState === "LIVE" ? "text-leef" : "text-warn";
  const blockAgeSec =
    headBlockAt > 0 ? Math.max(0, (now - headBlockAt) / 1000) : null;
  const blockFresh = blockAgeSec != null && blockAgeSec < 5;
  const bestRpc = (bestRpcUrl ? { url: bestRpcUrl, latencyMs: bestRpcLatency } : null);
  const spotAgeMs = snap.spotAt ? now - Date.parse(snap.spotAt) : null;
  const spotFresh = spotAgeMs != null && Number.isFinite(spotAgeMs) && spotAgeMs >= 0 && spotAgeMs < 30_000;
  const route = tick.bestRoute;
  const conversion = route && route.amountIn > 0 ? route.amountOut / route.amountIn : 0;

  return (
    <div className="border-b border-border/70 bg-surface/50">
      <VersionBanner />
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn("font-semibold tracking-wide", marketDataTone)}
            title={`Market source: ${snap.source}; freshest snapshot age: ${Number.isFinite(snapshotAgeSec) ? snapshotAgeSec.toFixed(1) + "s" : "unknown"}; trading freshness window: ${Math.round(freshnessWindowMs / 1_000)}s`}
          >
            {marketDataState}
            {Number.isFinite(snapshotAgeSec) && <span className="ml-1 font-normal text-muted-foreground">{snapshotAgeSec.toFixed(0)}s</span>}
          </span>
          <span>
            TVL{" "}
            <strong className="font-mono tabular-nums text-fg">
              ${fmtNum(stats.tvlUsd, { digits: 0 })}
            </strong>
          </span>
          <span className="text-border">·</span>
          <span>
            24h{" "}
            <strong className="font-mono tabular-nums text-fg">
              ${fmtNum(stats.volume24Usd, { digits: 0 })}
            </strong>
          </span>
          <span className="text-border">·</span>
          <span>
            Locked{" "}
            <strong className="font-mono tabular-nums text-fg">
              {fmtNum(stats.leefLocked, { compact: true })} LEEF
            </strong>
          </span>
          <span className="text-border">·</span>
          <span className="font-mono tabular-nums">
            1 LEEF <strong className="text-fg">{fmtUsd(snap.leefUsd)}</strong>
          </span>
          <span className="font-mono tabular-nums">
            10M <strong className="text-wax">{fmtLeefLot(snap.waxPerLeef, 4)} WAX</strong>
          </span>
          <span className="font-mono tabular-nums">
            WAX <strong className="text-fg">${fmtNum(snap.waxUsd, { digits: 5 })}</strong>
          </span>
          {route && (
            <span className="hidden font-mono tabular-nums text-accent xl:inline">
              {route.tokenIn}→{route.tokenOut} · 1 = {fmtNum(conversion, { compact: true, digits: 5 })}
            </span>
          )}
          {h.bestBuy && (
            <>
              <span className="hidden text-border sm:inline">·</span>
              <span className="hidden sm:inline">
                Swap to{" "}
                <strong className="font-mono tabular-nums text-fg">
                  #{h.bestBuy.id} {h.bestBuy.pair.symbol}
                </strong>
              </span>
            </>
          )}
          {h.arb && (
            <>
              <span className="hidden text-border lg:inline">·</span>
              <span className="hidden text-warn lg:inline">
                Spread {fmtNum(h.arb.spreadPct * 100, { digits: 1 })}% · #{h.arb.cheap.id} vs #
                {h.arb.rich.id}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="font-mono tabular-nums"
            title={`Head block · best RPC ${bestRpc ? bestRpc.url : "—"} (${bestRpc ? `${Math.round(bestRpc.latencyMs ?? 0)}ms` : "—"})`}
          >
            <span className={blockFresh ? "text-leef" : "text-warn"}>●</span> WAX{" "}
            {blockAgeSec != null ? (
              <span className={cn(blockFresh ? "text-fg" : "text-warn")}>
                #{fmtNum(headBlock, { digits: 0 })} · {blockAgeSec.toFixed(1)}s
              </span>
            ) : (
              <span className="text-warn">connecting…</span>
            )}
          </span>
          {spotFresh && spotAgeMs != null && (
            <span className="hidden font-mono tabular-nums text-accent md:inline">
              ◆ chain spot {(spotAgeMs / 1000).toFixed(0)}s
            </span>
          )}
          <span
            className="font-mono"
            title={
              signerMode === "live"
                ? `Signer ready (${signerAuthType ?? "wallet"}) — market updates never re-import it`
                : "Paper mode — no signer"
            }
          >
            <span className={signerReady ? "text-leef" : "text-subtle"}>●</span>{" "}
            {signerMode === "live" ? "signer" : "paper"}
          </span>
          <span className="font-mono" title={`Auto trade ${autoTradeBot ? "active" : "off"} · phase ${autoTradePhase}`}>
            <span className={autoTradeBot ? "text-leef" : "text-subtle"}>●</span>{" "}
            {engine.autoTrade.bot ? "auto" : "idle"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            aria-label="Open AI and Jev settings"
            onClick={() => setTab("ai")}
          >
            <span className={aiEnabled ? "text-leef" : "text-subtle"}>●</span>
            Helper {aiEnabled ? "ON" : "OFF"}
            {aiEnabled && <span className="text-subtle">· {learningMode === "controlled" ? "learning" : "suggest"}</span>}
            <span className="text-border">/</span>
            <span className={jevMode === "off" ? "text-subtle" : jevMode === "control" ? "text-warn" : "text-leef"}>●</span>
            Jev {jevMode.toUpperCase()}
          </Button>
          {capitalBlocked && (
            <span
              className="font-mono text-warn"
              title={capitalReason ?? "Unresolved WAX transaction"}
            >
              ● {capitalPhase === "blocked" ? "signing interrupted" : "settlement pending"}
              {unresolvedTxid ? " · " + unresolvedTxid.slice(0, 8) + "…" : ""}
            </span>
          )}
          <span className="font-mono tabular-nums">
            Synced <span className="text-fg">{synced}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
