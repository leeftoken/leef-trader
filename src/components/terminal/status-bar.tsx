import { marketStats } from "@/lib/leef/analytics";
import { fmtLeefLot, fmtNum, fmtUsd } from "@/lib/leef/format";
import { headline } from "@/lib/leef/rank";
import { snapFreshAtMs, type LeefSnapshot, type RankedPool } from "@/lib/leef/types";
import type { LiveTickState } from "./use-live-tick";
import { useMarketEngine } from "@/hooks/useMarketEngine";
import { cn } from "@/lib/utils";
import { relTime, useNow } from "./use-now";
import { VersionBanner } from "./version-banner";
import { useTerminal } from "@/store/terminal";
import { useAiControl } from "./ai-control";
import { liveCapitalBlocked, pendingTxid, tradePhase, unknownBlockReason } from "@/lib/wallet/trade-cycle";
import { Button } from "@/components/ui/button";

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
  const engine = useMarketEngine();
  const setTab = useTerminal((s) => s.setTab);
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
  const rawSnapshotAgeSec = (now - snapFreshAtMs(snap)) / 1000;
  const snapshotAgeSec = Math.max(0, rawSnapshotAgeSec);
  const snapshotFresh =
    Number.isFinite(rawSnapshotAgeSec) && rawSnapshotAgeSec >= 0 && rawSnapshotAgeSec <= 45;
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
    engine.headBlockAt > 0 ? Math.max(0, (now - engine.headBlockAt) / 1000) : null;
  const blockFresh = blockAgeSec != null && blockAgeSec < 5;
  const bestRpc = engine.rpc[0];
  const spotAgeMs = engine.snapshot?.spotAt ? now - Date.parse(engine.snapshot.spotAt) : null;
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
            title={`Market source: ${snap.source}; freshest snapshot age: ${Number.isFinite(snapshotAgeSec) ? snapshotAgeSec.toFixed(1) + "s" : "unknown"}; bot quote freshness limit: 45s`}
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
                #{fmtNum(engine.headBlock, { digits: 0 })} · {blockAgeSec.toFixed(1)}s
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
              engine.signer.mode === "live"
                ? `Signer ready (${engine.signer.authType ?? "wallet"}) — market updates never re-import it`
                : "Paper mode — no signer"
            }
          >
            <span className={engine.signer.ready ? "text-leef" : "text-subtle"}>●</span>{" "}
            {engine.signer.mode === "live" ? "signer" : "paper"}
          </span>
          <span className="font-mono" title={`Auto trade ${engine.autoTrade.bot ? "active" : "off"} · phase ${engine.autoTrade.phase}`}>
            <span className={engine.autoTrade.bot ? "text-leef" : "text-subtle"}>●</span>{" "}
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
