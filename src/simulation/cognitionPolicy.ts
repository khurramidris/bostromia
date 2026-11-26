import type { StepTriggers } from './engine';
import { formatSimTime } from './memory';
import type { WorldState } from './types';

export type BaselineJobKind = 'consolidation' | 'morning_plan' | 'reflection' | 'conversation';

export interface BaselineAutoJob {
  kind: BaselineJobKind;
  agentIds: string[];
  expectedCalls: number;
}

export interface CognitionPolicyState {
  lastStartMs: number;
  inFlight: boolean;
  lastConsolidatedDay: number;
}

export function createCognitionPolicyState(initialMs = 0): CognitionPolicyState {
  return {
    lastStartMs: initialMs,
    inFlight: false,
    lastConsolidatedDay: 0,
  };
}

/**
 * Phase 0 extracted baseline picker reproducing the original single-lane 14s rule:
 * 1. Only one job in flight.
 * 2. Minimum 14,000 ms between job starts.
 * 3. Order: consolidation (>= 22:30 for selectedAgentId) > morning_plan > reflection > conversation.
 */
export function pickAutoJob(
  world: WorldState,
  triggers: StepTriggers,
  policyState: CognitionPolicyState,
  nowMs: number,
  selectedAgentId: string,
): { job: BaselineAutoJob | null; policyState: CognitionPolicyState } {
  if (policyState.inFlight || nowMs - policyState.lastStartMs <= 14000) {
    return { job: null, policyState };
  }

  const timeInfo = formatSimTime(world.simMinutes);

  if (
    timeInfo.hour24 >= 22 &&
    timeInfo.minute >= 30 &&
    policyState.lastConsolidatedDay < timeInfo.day
  ) {
    return {
      job: {
        kind: 'consolidation',
        agentIds: [selectedAgentId],
        expectedCalls: 1,
      },
      policyState: {
        ...policyState,
        lastStartMs: nowMs,
        lastConsolidatedDay: timeInfo.day,
      },
    };
  }

  if (triggers.morningPlanAgentIds.length > 0) {
    return {
      job: {
        kind: 'morning_plan',
        agentIds: [triggers.morningPlanAgentIds[0]],
        expectedCalls: 1,
      },
      policyState: {
        ...policyState,
        lastStartMs: nowMs,
      },
    };
  }

  if (triggers.reflectionAgentIds.length > 0) {
    return {
      job: {
        kind: 'reflection',
        agentIds: [triggers.reflectionAgentIds[0]],
        expectedCalls: 1,
      },
      policyState: {
        ...policyState,
        lastStartMs: nowMs,
      },
    };
  }

  if (triggers.conversationPairs.length > 0) {
    const [aId, bId] = triggers.conversationPairs[0];
    return {
      job: {
        kind: 'conversation',
        agentIds: [aId, bId],
        expectedCalls: 3,
      },
      policyState: {
        ...policyState,
        lastStartMs: nowMs,
      },
    };
  }

  return { job: null, policyState };
}
