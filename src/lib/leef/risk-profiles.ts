import { DEFAULT_RISK, type BotRisk } from "./bot-engine";

/**
 * Higher-activity WAX micro-market profile.
 *
 * It increases opportunity cadence and execution tolerance while retaining
 * deterministic net-edge checks, a finite per-echo loss cap, a finite session
 * echo budget, a pool-share cap and the default account-level circuit breakers.
 */
export const WAX_MICRO_ACTIVE_RISK: BotRisk = {
  ...DEFAULT_RISK,
  maxImpactPct: 4,
  cooldownSec: 10,
  maxTradesHour: 60,
  slippage: 0.8,
  minConfidence: 55,
  minEdgePct: 0.2,
  maxEchoLossPct: 0.5,
  echoBudgetUsd: DEFAULT_RISK.echoBudgetUsd,
  volumeFlowGateMin: 0,
  minNetEdgePct: DEFAULT_RISK.minNetEdgePct,
  maxQuoteAgeSec: DEFAULT_RISK.maxQuoteAgeSec,
  maxHops: 4,
  maxPoolSharePct: 7.5,
};
