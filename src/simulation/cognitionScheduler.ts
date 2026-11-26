import { isHighStakesEncounter } from './autonomy';
import { canAgentsConverse, type StepTriggers } from './engine';
import { formatSimTime } from './memory';
import type { WorldState } from './types';

export type SchedulerJobKind =
  | 'morning_plan'
  | 'decision'
  | 'reaction'
  | 'step_detail'
  | 'conversation'
  | 'reflection'
  | 'consolidation'
  | 'replan'
  | 'interview'
  | 'whisper';

export type BudgetPreset = 'thrifty' | 'balanced' | 'research';

export interface SchedulerConfig {
  preset: BudgetPreset;
  maxConcurrent: number;
  maxCallsPerMinute: number;
  maxCallsPerSimDay: number | null;
  maxCallsPerAgentPerSimDay: number;
  timeDilation: boolean;
}

export const SCHEDULER_PRESETS: Record<
  BudgetPreset,
  Omit<SchedulerConfig, 'preset' | 'timeDilation'>
> = {
  thrifty: {
    maxConcurrent: 2,
    maxCallsPerMinute: 12,
    maxCallsPerSimDay: 150,
    maxCallsPerAgentPerSimDay: 30,
  },
  balanced: {
    maxConcurrent: 3,
    maxCallsPerMinute: 20,
    maxCallsPerSimDay: 480,
    maxCallsPerAgentPerSimDay: 44,
  },
  research: {
    maxConcurrent: 4,
    maxCallsPerMinute: 30,
    maxCallsPerSimDay: 600,
    maxCallsPerAgentPerSimDay: 30,
  },
};

export function buildSchedulerConfig(
  preset: BudgetPreset = 'balanced',
  overrides: Partial<SchedulerConfig> = {},
): SchedulerConfig {
  return {
    preset,
    ...SCHEDULER_PRESETS[preset],
    timeDilation: true,
    ...overrides,
  };
}

export interface CognitionJob {
  id: string;
  kind: SchedulerJobKind;
  agentIds: string[];
  expectedCalls: number;
  enqueuedAtMs: number;
  enqueuedAtSim: number;
  attempts: number;
  isUserAction?: boolean;
  isMorningPlan?: boolean;
  question?: string;
  thought?: string;
  startReason?: string;
  observation?: string;
  partnerId?: string;
  blockId?: string;
  blockActivity?: string;
  blockKind?: string;
  blockDuration?: number;
  forkReason?: string;
  compressed?: boolean;
  privateGroup?: boolean;
}

export interface JobFailureRecord {
  id: string;
  kind: SchedulerJobKind;
  agentIds: string[];
  error: string;
  atSimMin: number;
  atMs: number;
  attempts: number;
}

export interface FailureBackoffState {
  attempts: number;
  nextRetryAtMs: number;
  lastError: string;
}

export interface SchedulerState {
  config: SchedulerConfig;
  nextJobSeq: number;
  queue: CognitionJob[];
  inFlight: CognitionJob[];
  callTimestampsMs: number[];
  currentSimDay: number;
  callsToday: number;
  callsByAgentToday: Record<string, number>;
  reflectionsToday: Record<string, number>;
  reactionsToday: Record<string, number>;
  decisionsToday?: Record<string, number>;
  lastReflectionSimByAgent: Record<string, number>;
  consolidatedNightByAgent: Record<string, number>;
  failedMorningPlanDayByAgent: Record<string, number>;
  failuresByKey: Record<string, FailureBackoffState>;
  pausedUntilByKind: Partial<Record<SchedulerJobKind, number>>;
  recentFailures: JobFailureRecord[];
  lastSuccessMs?: number;
  totalCallsCompleted: number;
}

export function createSchedulerState(
  config: SchedulerConfig = buildSchedulerConfig('balanced'),
  initialSimDay = 1,
): SchedulerState {
  return {
    config,
    nextJobSeq: 1,
    queue: [],
    inFlight: [],
    callTimestampsMs: [],
    currentSimDay: initialSimDay,
    callsToday: 0,
    callsByAgentToday: {},
    reflectionsToday: {},
    reactionsToday: {},
    decisionsToday: {},
    lastReflectionSimByAgent: {},
    consolidatedNightByAgent: {},
    failedMorningPlanDayByAgent: {},
    failuresByKey: {},
    pausedUntilByKind: {},
    recentFailures: [],
    lastSuccessMs: undefined,
    totalCallsCompleted: 0,
  };
}

export function updateSchedulerConfig(
  state: SchedulerState,
  config: SchedulerConfig,
): SchedulerState {
  return {
    ...state,
    config,
  };
}

function failureKey(kind: SchedulerJobKind, agentIds: string[]): string {
  return `${kind}:${agentIds[0] ?? 'global'}`;
}

function sameJobTarget(a: CognitionJob, kind: SchedulerJobKind, agentIds: string[]): boolean {
  if (a.kind !== kind) return false;
  if (a.agentIds.length !== agentIds.length) return false;
  if (kind === 'conversation' && a.agentIds.length >= 2 && agentIds.length >= 2) {
    const setA = new Set(a.agentIds);
    return agentIds.every((id) => setA.has(id));
  }
  return a.agentIds.every((id, idx) => id === agentIds[idx]);
}

export function syncSchedulerDay(state: SchedulerState, simMinutes: number): SchedulerState {
  const { day } = formatSimTime(simMinutes);
  if (day === state.currentSimDay) return state;
  return {
    ...state,
    currentSimDay: day,
    callsToday: 0,
    callsByAgentToday: {},
    reflectionsToday: {},
    reactionsToday: {},
    decisionsToday: {},
    failuresByKey: {},
  };
}

export function enqueueJob(
  state: SchedulerState,
  params: {
    kind: SchedulerJobKind;
    agentIds: string[];
    expectedCalls: number;
    nowMs: number;
    simMinutes: number;
    isUserAction?: boolean;
    isMorningPlan?: boolean;
    question?: string;
    thought?: string;
    startReason?: string;
    observation?: string;
    partnerId?: string;
    blockId?: string;
    blockActivity?: string;
    blockKind?: string;
    blockDuration?: number;
    forkReason?: string;
    compressed?: boolean;
    privateGroup?: boolean;
  },
): SchedulerState {
  // User actions are never silently dropped—even if background jobs exist
  if (!params.isUserAction) {
    const existsQueued = state.queue.some((j) =>
      sameJobTarget(j, params.kind, params.agentIds),
    );
    const existsInFlight = state.inFlight.some((j) =>
      sameJobTarget(j, params.kind, params.agentIds),
    );
    if (existsQueued || existsInFlight) {
      return state;
    }
  }

  const job: CognitionJob = {
    id: `job_${params.kind}_${state.nextJobSeq}`,
    kind: params.kind,
    agentIds: [...params.agentIds],
    expectedCalls: params.expectedCalls,
    enqueuedAtMs: params.nowMs,
    enqueuedAtSim: params.simMinutes,
    attempts: 0,
    isUserAction: params.isUserAction,
    isMorningPlan: params.isMorningPlan,
    question: params.question,
    thought: params.thought,
    startReason: params.startReason,
    observation: params.observation,
    partnerId: params.partnerId,
    blockId: params.blockId,
    blockActivity: params.blockActivity,
    blockKind: params.blockKind,
    blockDuration: params.blockDuration,
    forkReason: params.forkReason,
    compressed: params.compressed,
    privateGroup: params.privateGroup,
  };

  return {
    ...state,
    nextJobSeq: state.nextJobSeq + 1,
    queue: [...state.queue, job],
  };
}

export function enqueueTriggers(
  prevState: SchedulerState,
  world: WorldState,
  triggers: StepTriggers,
  nowMs: number,
): SchedulerState {
  let state = syncSchedulerDay(prevState, world.simMinutes);
  const timeInfo = formatSimTime(world.simMinutes);
  const tierByAgent = new Map(world.agents.map((a) => [a.id, a.tier ?? 'focal']));
  const isFocal = (agentId: string) => (tierByAgent.get(agentId) ?? 'focal') === 'focal';
  const isAmbient = (agentId: string) => (tierByAgent.get(agentId) ?? 'focal') === 'ambient';

  // 1. Morning plans (from 05:00 sim on Day 2+; focal residents only so 100-agent societies stay bounded)
  if (!world.ablations?.noPlanning && timeInfo.day >= 2 && timeInfo.hour24 >= 5) {
    for (const agentId of triggers.morningPlanAgentIds) {
      if (!isFocal(agentId)) continue;
      if (state.failedMorningPlanDayByAgent[agentId] === timeInfo.day) continue;
      state = enqueueJob(state, {
        kind: 'morning_plan',
        agentIds: [agentId],
        expectedCalls: 1,
        nowMs,
        simMinutes: world.simMinutes,
        isMorningPlan: true,
      });
    }
  }

  // 2. Overnight sleep consolidation for all focal residents (22:30 .. 03:00 window)
  const inSleepWindow =
    (timeInfo.hour24 === 22 && timeInfo.minute >= 30) ||
    timeInfo.hour24 >= 23 ||
    timeInfo.hour24 < 3;
  if (inSleepWindow) {
    const nightKey = timeInfo.hour24 < 3 ? Math.max(1, timeInfo.day - 1) : timeInfo.day;
    for (const agent of world.agents) {
      if ((agent.tier ?? 'focal') !== 'focal') continue;
      if ((state.consolidatedNightByAgent[agent.id] ?? 0) < nightKey) {
        state = enqueueJob(state, {
          kind: 'consolidation',
          agentIds: [agent.id],
          expectedCalls: 1,
          nowMs,
          simMinutes: world.simMinutes,
        });
      }
    }
  }

  // 3. Reaction triggers on observation imp >= 6 (capped <= 4 per focal resident per sim day)
  if (!world.ablations?.noPlanning) {
    for (const rt of triggers.reactionTriggers ?? []) {
      if (!isFocal(rt.agentId)) continue;
      const reactCount = state.reactionsToday[rt.agentId] ?? 0;
      if (reactCount >= 4) continue;
      state = enqueueJob(state, {
        kind: 'reaction',
        agentIds: [rt.agentId],
        expectedCalls: 1,
        nowMs,
        simMinutes: world.simMinutes,
        observation: rt.observation,
        partnerId: rt.partnerId,
      });
    }
  }

  // 3b. Autonomous BDI Strategic Decision Forks (focal residents; urgent shocks/elections >= 0.85 up to 95% budget, routine opportunities up to 80%, capped <= 3/agent/day)
  const decisionDayCap = state.config.maxCallsPerSimDay ?? 9999;
  const allowRoutineForks =
    Boolean(world.compressedConversations) || state.callsToday < decisionDayCap * 0.8;
  const allowUrgentForks =
    Boolean(world.compressedConversations) || state.callsToday < decisionDayCap * 0.95;
  if (!world.ablations?.noPlanning && allowUrgentForks) {
    for (const dt of (triggers.decisionTriggers ?? []).slice(0, 2)) {
      if (!isFocal(dt.agentId)) continue;
      if (dt.urgency < 0.85 && !allowRoutineForks) continue;
      const decCount = state.decisionsToday?.[dt.agentId] ?? 0;
      if (decCount >= 3) continue;
      state = enqueueJob(state, {
        kind: 'decision',
        agentIds: [dt.agentId],
        expectedCalls: 1,
        nowMs,
        simMinutes: world.simMinutes,
        forkReason: dt.forkReason,
      });
    }
  }

  // 4. Conversations from engine salience gate triggers (2..4 participants; requires >= 1 focal and 0 ambient)
  const useCompressed = Boolean(world.compressedConversations);
  const convDayCap = state.config.maxCallsPerSimDay ?? 9999;
  for (const pair of triggers.conversationPairs) {
    const [aId, bId] = pair;
    const groupKey = `${aId}:${bId}`;
    const rawParticipants = triggers.groupParticipantsByPair?.[groupKey] ?? [aId, bId];
    const participants = rawParticipants.filter((id) => !isAmbient(id));
    if (participants.length < 2 || !participants.some(isFocal)) continue;
    const startReason = triggers.conversationReasons?.[groupKey];
    const isGroup = participants.length > 2;
    const highStakesDyad =
      !isGroup &&
      state.callsToday < convDayCap * 0.7 &&
      isHighStakesEncounter(world, aId, bId, startReason);
    const highStakesGroup =
      isGroup &&
      state.callsToday < convDayCap * 0.65 &&
      participants.some((p1, idx) =>
        participants.slice(idx + 1).some((p2) => isHighStakesEncounter(world, p1, p2, startReason)),
      );
    const compressThis = (useCompressed && !highStakesDyad) || (isGroup && !highStakesGroup);
    state = enqueueJob(state, {
      kind: 'conversation',
      agentIds: participants,
      expectedCalls: highStakesGroup
        ? Math.min(6, participants.length + 2)
        : compressThis
          ? 1
          : 4,
      nowMs,
      simMinutes: world.simMinutes,
      startReason,
      compressed: compressThis,
      ...(highStakesGroup ? { privateGroup: true } : {}),
    });
  }

  // 5. Reflections (2-call synthesis; focal residents only; throttled: < 3 today, >= 120 sim-min since last reflection)
  if (!world.ablations?.noReflection) {
    for (const agentId of triggers.reflectionAgentIds) {
      if (!isFocal(agentId)) continue;
      const countToday = state.reflectionsToday[agentId] ?? 0;
      const lastSim = state.lastReflectionSimByAgent[agentId] ?? -999;
      if (countToday >= 3 || world.simMinutes - lastSim < 120) continue;
      state = enqueueJob(state, {
        kind: 'reflection',
        agentIds: [agentId],
        expectedCalls: 2,
        nowMs,
        simMinutes: world.simMinutes,
      });
    }
  }

  // 6. Optional cheap Step Detail on demand (only when daily budget headroom is ample)
  const dayCap = state.config.maxCallsPerSimDay ?? 9999;
  const stepDetailQueued = state.queue.filter((j) => j.kind === 'step_detail').length;
  if (
    !world.ablations?.noPlanning &&
    state.callsToday < dayCap * 0.55 &&
    stepDetailQueued < 2 &&
    state.config.preset === 'research'
  ) {
    for (const sr of (triggers.stepDetailRequests ?? []).slice(0, 1)) {
      if (!isFocal(sr.agentId)) continue;
      state = enqueueJob(state, {
        kind: 'step_detail',
        agentIds: [sr.agentId],
        expectedCalls: 1,
        nowMs,
        simMinutes: world.simMinutes,
        blockId: sr.blockId,
        blockActivity: sr.activity,
        blockKind: sr.kind,
        blockDuration: sr.durationMinutes,
      });
    }
  }

  return state;
}

export function getBasePriority(job: CognitionJob): number {
  if (job.isUserAction) return 95;
  switch (job.kind) {
    case 'morning_plan':
      return 100;
    case 'replan':
    case 'interview':
    case 'whisper':
      return 95;
    case 'reaction':
      return 80;
    case 'consolidation':
      return 70;
    case 'decision':
      return 66;
    case 'conversation':
      return 60;
    case 'step_detail':
      return 50;
    case 'reflection':
      return 40;
  }
}

export function computeEffectivePriority(
  job: CognitionJob,
  state: SchedulerState,
  simMinutes: number,
): number {
  const base = getBasePriority(job);
  const waitedSim = Math.max(0, simMinutes - job.enqueuedAtSim);
  const maxAgentCallsUsed = job.agentIds.reduce(
    (max, id) => Math.max(max, state.callsByAgentToday[id] ?? 0),
    0,
  );
  const fairnessPenalty = job.isUserAction ? 0 : maxAgentCallsUsed * 10;
  return base + waitedSim - fairnessPenalty;
}

function isConversationStillValid(job: CognitionJob, world: WorldState): boolean {
  if (job.kind !== 'conversation' || job.isUserAction) return true;
  const t = formatSimTime(world.simMinutes);
  if (t.minuteOfDay < 390 || t.minuteOfDay >= 1380) return false;
  if (job.agentIds.length < 2) return false;
  const a = world.agents.find((ag) => ag.id === job.agentIds[0]);
  const b = world.agents.find((ag) => ag.id === job.agentIds[1]);
  if (!a || !b) return false;
  if (!canAgentsConverse(world, a, b)) return false;
  const lastTalk = Math.max(a.lastConversedAt[b.id] ?? -999, b.lastConversedAt[a.id] ?? -999);
  if (world.simMinutes - lastTalk < 45) return false;
  return true;
}

function getRecentCallsInWindow(callTimestampsMs: number[], nowMs: number): number[] {
  const cutoff = nowMs - 60_000;
  return callTimestampsMs.filter((ts) => ts > cutoff);
}

/**
 * Dequeues up to remaining capacity of eligible jobs respecting:
 * - maxConcurrent
 * - no resident in two in-flight jobs simultaneously
 * - maxCallsPerMinute sliding window
 * - maxCallsPerSimDay & 30 calls/resident/day cap
 * - per-kind 429 pause & per-(kind, agent) backoff timers
 * - drops stale conversation pairs cleanly
 */
export function dispatchEligibleJobs(
  prevState: SchedulerState,
  world: WorldState,
  nowMs: number,
): { jobsToStart: CognitionJob[]; state: SchedulerState } {
  let state = syncSchedulerDay(prevState, world.simMinutes);
  const recentTimestamps = getRecentCallsInWindow(state.callTimestampsMs, nowMs);
  state = { ...state, callTimestampsMs: recentTimestamps };

  const inFlightAgentIds = new Set<string>(state.inFlight.flatMap((j) => j.agentIds));
  const keptQueue: CognitionJob[] = [];
  const candidates: Array<{ job: CognitionJob; priority: number }> = [];

  for (const job of state.queue) {
    // Drop expired auto-triggers that no longer apply
    if (job.kind === 'conversation' && !isConversationStillValid(job, world)) {
      continue;
    }
    if (job.kind === 'reaction' && !job.isUserAction) {
      const countToday = state.reactionsToday[job.agentIds[0]] ?? 0;
      if (countToday >= 4) continue;
    }
    if (job.kind === 'decision' && !job.isUserAction) {
      if (world.simMinutes - job.enqueuedAtSim > 60) continue;
      const countToday = state.decisionsToday?.[job.agentIds[0]] ?? 0;
      if (countToday >= 3) continue;
    }
    if (job.kind === 'reflection' && !job.isUserAction) {
      const ag = world.agents.find((a) => a.id === job.agentIds[0]);
      const countToday = state.reflectionsToday[job.agentIds[0]] ?? 0;
      const lastSim = state.lastReflectionSimByAgent[job.agentIds[0]] ?? -999;
      if (
        !ag ||
        ag.importanceAccumulator < world.reflectionThreshold ||
        countToday >= 3 ||
        world.simMinutes - lastSim < 120
      ) {
        continue;
      }
    }
    if (job.kind === 'morning_plan' && !job.isUserAction) {
      const ag = world.agents.find((a) => a.id === job.agentIds[0]);
      const timeInfo = formatSimTime(world.simMinutes);
      if (
        !ag ||
        (ag.lastReplannedDay ?? 1) >= timeInfo.day ||
        state.failedMorningPlanDayByAgent[ag.id] === timeInfo.day
      ) {
        continue;
      }
    }

    keptQueue.push(job);
    candidates.push({
      job,
      priority: computeEffectivePriority(job, state, world.simMinutes),
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);

  const jobsToStart: CognitionJob[] = [];
  const startedIds = new Set<string>();
  let nextInFlight = [...state.inFlight];
  let nextCallTimestamps = [...recentTimestamps];
  let nextCallsToday = state.callsToday;
  const nextCallsByAgent = { ...state.callsByAgentToday };
  const nextConsolidatedNight = { ...state.consolidatedNightByAgent };
  const timeInfo = formatSimTime(world.simMinutes);
  const nightKey = timeInfo.hour24 < 3 ? Math.max(1, timeInfo.day - 1) : timeInfo.day;

  let minEligibleConvCalls = Infinity;
  for (const { job } of candidates) {
    if (job.kind !== 'conversation' || job.isUserAction) continue;
    const pauseUntil = state.pausedUntilByKind[job.kind];
    if (pauseUntil && nowMs < pauseUntil) continue;
    const backoff = state.failuresByKey[failureKey(job.kind, job.agentIds)];
    if (backoff && nowMs < backoff.nextRetryAtMs) continue;
    if (job.agentIds.some((id) => inFlightAgentIds.has(id))) continue;
    const agentCap = Math.max(1, state.config.maxCallsPerAgentPerSimDay - 2);
    if (job.agentIds.some((id) => (nextCallsByAgent[id] ?? 0) + job.expectedCalls > agentCap)) {
      continue;
    }
    if (
      state.config.maxCallsPerSimDay !== null &&
      (nextCallsToday + job.expectedCalls > state.config.maxCallsPerSimDay ||
        (state.config.maxCallsPerSimDay >= 20 &&
          nextCallsToday + job.expectedCalls > Math.floor(state.config.maxCallsPerSimDay * 0.78)))
    ) {
      continue;
    }
    minEligibleConvCalls = Math.min(minEligibleConvCalls, job.expectedCalls);
  }
  const hasEligibleQueuedConversation = minEligibleConvCalls < Infinity;
  let waitingForRpmForMultiCall = false;

  for (const { job } of candidates) {
    if (nextInFlight.length >= state.config.maxConcurrent) break;

    const pauseUntil = state.pausedUntilByKind[job.kind];
    if (!job.isUserAction && pauseUntil && nowMs < pauseUntil) continue;

    const backoff = state.failuresByKey[failureKey(job.kind, job.agentIds)];
    if (!job.isUserAction && backoff && nowMs < backoff.nextRetryAtMs) continue;

    if (job.agentIds.some((id) => inFlightAgentIds.has(id))) continue;

    // Hard per-resident per-sim-day cap for background cognition
    // (reserve 2 calls/day for mandatory morning_plan + nightly consolidation)
    const agentDayCap =
      job.kind === 'morning_plan' || job.kind === 'consolidation'
        ? state.config.maxCallsPerAgentPerSimDay
        : Math.max(1, state.config.maxCallsPerAgentPerSimDay - 2);
    if (
      !job.isUserAction &&
      job.agentIds.some(
        (id) => (nextCallsByAgent[id] ?? 0) + job.expectedCalls > agentDayCap,
      )
    ) {
      continue;
    }

    // Per-sim-day budget (reserve ~22% of daily cap for BDI decisions, reflections, morning plans & consolidations)
    if (!job.isUserAction && state.config.maxCallsPerSimDay !== null) {
      if (nextCallsToday + job.expectedCalls > state.config.maxCallsPerSimDay) {
        continue;
      }
      if (
        job.kind === 'conversation' &&
        state.config.maxCallsPerSimDay >= 20 &&
        nextCallsToday + job.expectedCalls > Math.floor(state.config.maxCallsPerSimDay * 0.78)
      ) {
        continue;
      }
    }

    // Reserve concurrent + RPM headroom for eligible conversations so higher-priority 1-call jobs cannot starve them
    if (
      hasEligibleQueuedConversation &&
      !job.isUserAction &&
      job.kind !== 'morning_plan' &&
      job.kind !== 'consolidation' &&
      job.kind !== 'conversation'
    ) {
      if (
        nextInFlight.length >= Math.max(1, state.config.maxConcurrent - 1) &&
        !nextInFlight.some((j) => j.kind === 'conversation')
      ) {
        continue;
      }
      if (nextCallTimestamps.length + minEligibleConvCalls > state.config.maxCallsPerMinute) {
        continue;
      }
    }

    // Prevent single-call background jobs from perpetually consuming RPM headroom needed by a queued multi-call job
    if (
      waitingForRpmForMultiCall &&
      !job.isUserAction &&
      job.kind !== 'morning_plan' &&
      job.kind !== 'consolidation'
    ) {
      continue;
    }

    // Per-minute rate limit
    if (nextCallTimestamps.length + job.expectedCalls > state.config.maxCallsPerMinute) {
      if (!job.isUserAction && job.expectedCalls > 1) {
        waitingForRpmForMultiCall = true;
      }
      continue;
    }

    jobsToStart.push(job);
    startedIds.add(job.id);
    nextInFlight.push(job);
    for (const id of job.agentIds) {
      inFlightAgentIds.add(id);
      nextCallsByAgent[id] = (nextCallsByAgent[id] ?? 0) + job.expectedCalls;
    }
    for (let k = 0; k < job.expectedCalls; k++) {
      nextCallTimestamps.push(nowMs);
    }
    nextCallsToday += job.expectedCalls;

    if (job.kind === 'consolidation') {
      for (const id of job.agentIds) {
        nextConsolidatedNight[id] = Math.max(nextConsolidatedNight[id] ?? 0, nightKey);
      }
    }
  }

  return {
    jobsToStart,
    state: {
      ...state,
      queue: keptQueue.filter((j) => !startedIds.has(j.id)),
      inFlight: nextInFlight,
      callTimestampsMs: nextCallTimestamps,
      callsToday: nextCallsToday,
      callsByAgentToday: nextCallsByAgent,
      consolidatedNightByAgent: nextConsolidatedNight,
    },
  };
}

export function markJobSucceeded(
  state: SchedulerState,
  job: CognitionJob,
  simMinutes: number,
  nowMs?: number,
): SchedulerState {
  const nextFailures = { ...state.failuresByKey };
  delete nextFailures[failureKey(job.kind, job.agentIds)];

  const nextReflectionsToday = { ...state.reflectionsToday };
  const nextLastReflection = { ...state.lastReflectionSimByAgent };
  const nextReactionsToday = { ...(state.reactionsToday ?? {}) };
  const nextDecisionsToday = { ...(state.decisionsToday ?? {}) };
  if (job.kind === 'reflection') {
    for (const id of job.agentIds) {
      nextReflectionsToday[id] = (nextReflectionsToday[id] ?? 0) + 1;
      nextLastReflection[id] = simMinutes;
    }
  } else if (job.kind === 'reaction') {
    for (const id of job.agentIds) {
      nextReactionsToday[id] = (nextReactionsToday[id] ?? 0) + 1;
    }
  } else if (job.kind === 'decision') {
    for (const id of job.agentIds) {
      nextDecisionsToday[id] = (nextDecisionsToday[id] ?? 0) + 1;
    }
  }

  return {
    ...state,
    inFlight: state.inFlight.filter((j) => j.id !== job.id),
    failuresByKey: nextFailures,
    reflectionsToday: nextReflectionsToday,
    reactionsToday: nextReactionsToday,
    decisionsToday: nextDecisionsToday,
    lastReflectionSimByAgent: nextLastReflection,
    lastSuccessMs: nowMs ?? state.lastSuccessMs,
    totalCallsCompleted: (state.totalCallsCompleted ?? 0) + job.expectedCalls,
  };
}

export function markJobFailed(
  state: SchedulerState,
  job: CognitionJob,
  nowMs: number,
  simMinutes: number,
  errorMsg: string,
  options: { isRateLimit?: boolean; retryAfterMs?: number } = {},
): {
  state: SchedulerState;
  shouldApplyFallbackPlan: boolean;
  shouldHalveReflectionAccumulator: boolean;
} {
  const key = failureKey(job.kind, job.agentIds);
  const prevAttempts = state.failuresByKey[key]?.attempts ?? 0;
  const attempts = prevAttempts + 1;
  const backoffDelayMs = Math.min(300_000, 15_000 * Math.pow(2, attempts - 1));
  const nextRetryAtMs = options.isRateLimit
    ? nowMs + (options.retryAfterMs ?? 25_000)
    : nowMs + backoffDelayMs;

  const { day } = formatSimTime(simMinutes);
  const shouldApplyFallbackPlan = job.kind === 'morning_plan' && attempts >= 3;
  const shouldHalveReflectionAccumulator = job.kind === 'reflection' && attempts >= 3;

  const nextFailures = { ...state.failuresByKey };
  if (shouldApplyFallbackPlan || shouldHalveReflectionAccumulator) {
    delete nextFailures[key];
  } else {
    nextFailures[key] = {
      attempts,
      nextRetryAtMs,
      lastError: errorMsg,
    };
  }

  const nextFailedMorningPlanDay = { ...state.failedMorningPlanDayByAgent };
  if (shouldApplyFallbackPlan && job.agentIds[0]) {
    nextFailedMorningPlanDay[job.agentIds[0]] = day;
  }

  const nextPausedUntil = { ...state.pausedUntilByKind };
  if (options.isRateLimit) {
    const pauseUntilMs = nowMs + (options.retryAfterMs ?? 25_000);
    const backgroundKinds: SchedulerJobKind[] = [
      'morning_plan',
      'replan',
      'conversation',
      'reflection',
      'reaction',
      'decision',
      'step_detail',
      'consolidation',
    ];
    for (const kind of backgroundKinds) {
      nextPausedUntil[kind] = Math.max(nextPausedUntil[kind] ?? 0, pauseUntilMs);
    }
    nextPausedUntil[job.kind] = Math.max(nextPausedUntil[job.kind] ?? 0, pauseUntilMs);
  }

  const record: JobFailureRecord = {
    id: `fail_${job.id}_${attempts}`,
    kind: job.kind,
    agentIds: job.agentIds,
    error: errorMsg,
    atSimMin: simMinutes,
    atMs: nowMs,
    attempts,
  };

  return {
    state: {
      ...state,
      inFlight: state.inFlight.filter((j) => j.id !== job.id),
      failuresByKey: nextFailures,
      failedMorningPlanDayByAgent: nextFailedMorningPlanDay,
      pausedUntilByKind: nextPausedUntil,
      recentFailures: [record, ...state.recentFailures].slice(0, 12),
    },
    shouldApplyFallbackPlan,
    shouldHalveReflectionAccumulator,
  };
}

/**
 * Counts due work (urgent morning plans + active/in-range conversations) and slows
 * simulated time cleanly when free lanes cannot cover it:
 * rate = clamp(freeLanes / dueJobs, 0.1, 1).
 */
export function computeTimeDilationRate(
  world: WorldState,
  state: SchedulerState,
  nowMs?: number,
): number {
  if (!state.config.timeDilation) return 1;

  const timeInfo = formatSimTime(world.simMinutes);
  const recentCalls =
    nowMs !== undefined
      ? getRecentCallsInWindow(state.callTimestampsMs, nowMs).length
      : state.callTimestampsMs.length;
  const rpmFree = Math.max(0, state.config.maxCallsPerMinute - recentCalls);
  const rawFreeLanes = Math.max(0, state.config.maxConcurrent - state.inFlight.length);

  let dueJobs = 0;
  let minQueuedConvCalls = Infinity;

  // Conversations in progress + urgent morning plans + queued valid conversations
  for (const job of state.inFlight) {
    if (job.kind === 'conversation' || job.kind === 'morning_plan') {
      dueJobs += 1;
    }
  }
  for (const job of state.queue) {
    if (job.kind === 'conversation' && isConversationStillValid(job, world)) {
      dueJobs += 1;
      minQueuedConvCalls = Math.min(minQueuedConvCalls, job.expectedCalls);
    } else if (job.kind === 'morning_plan') {
      const ag = world.agents.find((a) => a.id === job.agentIds[0]);
      if (ag) {
        const sorted = ag.dailySchedule
          .filter((b) => b.day === timeInfo.day)
          .sort((a, b) => a.startMinute - b.startMinute);
        const firstStart = sorted[0]?.startMinute ?? 480;
        if (timeInfo.minuteOfDay >= firstStart - 60) {
          dueJobs += 1;
        }
      }
    }
  }

  const canStartDue = rpmFree >= (minQueuedConvCalls < Infinity ? minQueuedConvCalls : 1);
  const freeLanes = canStartDue ? rawFreeLanes : 0;

  if (dueJobs === 0) return 1;
  if (dueJobs > freeLanes) {
    return Math.max(0.1, Math.min(1, freeLanes / dueJobs));
  }
  // Gently ease simulated clock while multi-turn conversations or morning plans are running
  if (state.inFlight.some((j) => j.kind === 'conversation' || j.kind === 'morning_plan')) {
    return Math.max(0.1, Math.min(1, 1 / (dueJobs + 1)));
  }
  return 1;
}
