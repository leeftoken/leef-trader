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
  // Two 0.3% LP legs already cost about 0.6% before impact. A 0.5% cap
  // made the active volume profile structurally unable to complete ordinary
  // round trips. Allow a bounded 1.5% micro-market budget; the separate
  // session echo budget and account circuit breakers remain authoritative.
  maxEchoLossPct: 1.5,
  echoBudgetUsd: DEFAULT_RISK.echoBudgetUsd,
  volumeFlowGateMin: 0,
  minNetEdgePct: DEFAULT_RISK.minNetEdgePct,
  maxQuoteAgeSec: DEFAULT_RISK.maxQuoteAgeSec,
  maxHops: 4,
  maxPoolSharePct: 7.5,
};



/**
 * Higher-risk WAX preset for users who deliberately want more frequent
 * activity on thin books. The wider impact/slippage envelope is still
 * constrained by the exact router min-out, a finite per-echo loss ceiling,
 * a finite session echo budget, and the account-level session breakers.
 */
export const WAX_HIGH_ACTIVITY_RISK: BotRisk = {
  ...WAX_MICRO_ACTIVE_RISK,
  maxImpactPct: 5,
  cooldownSec: 10,
  maxTradesHour: 120,
  slippage: 1,
  minConfidence: 45,
  minEdgePct: 0.15,
  maxEchoLossPct: 1.75,
  echoBudgetUsd: 10,
  maxPoolSharePct: 10,
};

/**
 * Only upgrade the exact pre-WAX-micro product defaults. Any user who changed
 * a risk knob keeps their own profile; this is not a blanket risk reset.
 */
export function shouldUpgradeLegacyWaxDefaults(risk: Partial<BotRisk> | undefined): boolean {
  if (!risk) return false;
  const legacyDefaults: Partial<BotRisk> = {
    maxImpactPct: 3,
    cooldownSec: 30,
    maxTradesHour: 20,
    slippage: 0.6,
    minConfidence: 65,
    minEdgePct: 0.45,
    maxEchoLossPct: 1.5,
    volumeFlowGateMin: 0,
    echoBudgetUsd: 5,
    minNetEdgePct: 0,
    maxQuoteAgeSec: 45,
    maxHops: 4,
    maxPoolSharePct: 5,
  };
  return Object.entries(legacyDefaults).every(([key, value]) => risk[key as keyof BotRisk] === value);
}
