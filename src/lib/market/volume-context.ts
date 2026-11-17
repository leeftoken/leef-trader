import { aggregateFlowRisk, type FlowRiskContext, type PoolFlowState } from "./swap-flow";

export type BotVolumeContext = {
  /** null means the flow tracker is disabled/unavailable; [] means enabled but no evidence. */
  flowStates: PoolFlowState[] | null;
  flow: FlowRiskContext | null;
  echoCostUsd: number;
};

/**
 * Keep the live evaluator and the desk's dry-run preview on the same volume
 * gates. Missing/corrupt session-cost data fails closed instead of silently
 * restoring the echo budget.
 */
export function buildBotVolumeContext(input: {
  flowStates: PoolFlowState[] | null;
  echoCostUsd: number;
  quoteWindowMs: number;
}): BotVolumeContext {
  return {
    flowStates: input.flowStates,
    flow: input.flowStates === null
      ? null
      : aggregateFlowRisk(input.flowStates, input.quoteWindowMs),
    echoCostUsd: Number.isFinite(input.echoCostUsd)
      ? input.echoCostUsd
      : Number.POSITIVE_INFINITY,
  };
}
