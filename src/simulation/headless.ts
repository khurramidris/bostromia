import {
  createCognitionPolicyState,
  pickAutoJob,
} from './cognitionPolicy';
import {
  buildSchedulerConfig,
  computeTimeDilationRate,
  createSchedulerState,
  dispatchEligibleJobs,
  enqueueJob,
  enqueueTriggers,
  markJobFailed,
  markJobSucceeded,
  type BudgetPreset,
  type CognitionJob,
} from './cognitionScheduler';
import {
  applyAutonomousDecision,
  applyBlockSubSteps,
  applyConsolidationResult,
  applyConversationResult,
  applyFailedReflectionFallback,
  applyFallbackPlan,
  applyPlanResult,
  applyReactionResult,
  applyReflectionResult,
  canAgentsConverse,
  clearAgentThinkingState,
  createInitialWorldState,
  startAgentConversationLock,
  stepWorldState,
} from './engine';
import { formatSimTime } from './memory';
import { createMockLlm } from './mockLlm';
import { PAPER_BENCHMARKS } from './paperExperiment';
import { computeDiversitySnapshot } from './diversityMetrics';
import {
  DEFAULT_ABLATIONS,
  type AblationSettings,
  type DiversitySnapshot,
  type ScenarioId,
  type WorldState,
} from './types';
import { validateWorld } from './validateWorld';

export type HeadlessMode = 'baseline' | 'scheduler' | 'llm_off';

export interface HeadlessOptions {
  days: number;
  speed: 1 | 2 | 5;
  latencyMs: number;
  failAgentIds?: string[];
  failKinds?: string[];
  failureRate?: number;
  seed?: number;
  mode?: HeadlessMode;
  preset?: BudgetPreset;
  selectedAgentId?: string;
  scenario?: ScenarioId;
  ablations?: Partial<AblationSettings>;
}

export interface HeadlessDayMetrics {
  day: number;
  conversations: number;
  avgTurnsPerConv: number;
  avgCallsPerConv: number;
  reflections: number;
  reactions: number;
  morningPlansCount: number;
  morningPlansWithMealsAndSleep: number;
  lastMorningPlanSimMin: number | null;
  lastMorningPlanTimeLabel: string | null;
  consolidations: number;
  uniqueConversationPairs: number;
  perceptionEvents: number;
  driveDetours: number;
  failedCalls: number;
  callsByKind: Record<string, number>;
  residentsAtHome0300: number | null;
}

export interface AwarenessTimelineSample {
  simMinutes: number;
  day: number;
  hour: number;
  label: string;
  partyAwarenessPct: number;
  mayorAwarenessPct: number;
  networkDensity: number;
  invitedCount: number;
  agreedCount: number;
  conversationsTotal: number;
}

export interface HeadlessResult {
  mode: HeadlessMode;
  preset: BudgetPreset;
  scenarioId: ScenarioId;
  ablations: AblationSettings;
  options: {
    days: number;
    speed: 1 | 2 | 5;
    latencyMs: number;
    failAgentIds: string[];
    seed: number;
  };
  perDay: HeadlessDayMetrics[];
  awarenessTimeline: AwarenessTimelineSample[];
  endOfRun: {
    totalSimMinutes: number;
    totalSimDays: number;
    memoriesPerResident: Record<string, number>;
    avgMemoriesPerResident: number;
    perceptionShare: number;
    observationsPerResidentPerDay: number;
    duplicateMemoryIds: number;
    seedImp8Survived: Array<{
      agentId: string;
      memoryId: string;
      description: string;
      survived: boolean;
    }>;
    allSeedImp8Survived: boolean;
    residentsHomeAt0300ByNight: Array<{ day: number; count: number; total: number }>;
    repeatedDetours: number;
    wallCrossingConversations: number;
    day2PartyBlockCount: number;
    pastAgreementsCount: number;
    validationIssuesCount: number;
    avgTurnsPerConv: number;
    avgCallsPerConv: number;
    maxCallsPerConv: number;
    estimatedSaveBytes: number;
    maxConcurrentObserved: number;
    maxCallsPerMinuteObserved: number;
    totalFailedCalls: number;
    reflectionsTotal: number;
    reflectionsPerResidentPerDay: number;
    morningPlansTotal: number;
    morningPlansWithMealsAndSleep: number;
    commitmentsLostToReplan: number;
    reactionsTotal: number;
    maxReactionsPerResidentPerDay: number;
    initialNetworkDensity: number;
    finalNetworkDensity: number;
    partySummary: {
      originCount: number;
      invitedCount: number;
      agreedCount: number;
      plannedAfterNewsCount: number;
      attendedRawCount: number;
      attendedDecisionCount: number;
      attendedRawIds: string[];
      attendedDecisionIds: string[];
    };
    paperComparison: {
      partyAwarenessPct: number;
      targetPartyAwarenessPct: number;
      mayorAwarenessPct: number;
      targetMayorAwarenessPct: number;
      networkDensityStart: number;
      targetDensityStart: number;
      networkDensityEnd: number;
      targetDensityEnd: number;
      attendedDecisionCount: number;
      targetAttendedCount: number;
    };
    llmCallsTotal: number;
    tokensEstimated: number;
    diversity: DiversitySnapshot;
    finalWorld: WorldState;
  };
}

interface PendingVirtualJob {
  kind: CognitionJob['kind'];
  agentIds: string[];
  expectedCalls: number;
  startedAtMs: number;
  finishAtMs: number;
  startedAtSim: number;
  startReason?: string;
  observation?: string;
  partnerId?: string;
  blockId?: string;
  blockActivity?: string;
  blockKind?: string;
  blockDuration?: number;
  forkReason?: string;
  schedulerJob?: CognitionJob;
}

const ALL_CALL_KINDS = [
  'morning_plan',
  'decision',
  'conversation',
  'reflection',
  'consolidation',
  'replan',
  'reaction',
  'step_detail',
  'interview',
  'whisper',
] as const;

function makeEmptyCallsRecord(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ALL_CALL_KINDS) out[k] = 0;
  return out;
}

function countDuplicateMemoryIds(world: WorldState): number {
  let duplicates = 0;
  for (const agent of world.agents) {
    const seen = new Set<string>();
    for (const mem of agent.memories) {
      if (seen.has(mem.id)) {
        duplicates += 1;
      }
      seen.add(mem.id);
    }
  }
  return duplicates;
}

function computeGraphDensity(agentCount: number, pairEdges: ReadonlySet<string>): number {
  if (agentCount < 2) return 0;
  const maxEdges = (agentCount * (agentCount - 1)) / 2;
  return Number((pairEdges.size / maxEdges).toFixed(3));
}

function sampleAwarenessSnapshot(
  world: WorldState,
  pairEdges: ReadonlySet<string>,
  conversationsTotal: number,
): AwarenessTimelineSample {
  const t = formatSimTime(world.simMinutes);
  const totalAgents = Math.max(1, world.agents.length);
  const partyMeme = (world.memes ?? []).find((m) => m.id === 'meme_valentine_party');
  const mayorMeme = (world.memes ?? []).find((m) => m.id === 'meme_mayor_race');
  const partyKnown = partyMeme ? Object.keys(partyMeme.knownBy).length : 0;
  const mayorKnown = mayorMeme ? Object.keys(mayorMeme.knownBy).length : 0;
  return {
    simMinutes: Math.round(world.simMinutes),
    day: t.day,
    hour: t.hour24,
    label: `D${t.day} ${String(t.hour24).padStart(2, '0')}:00`,
    partyAwarenessPct: Number(((partyKnown / totalAgents) * 100).toFixed(1)),
    mayorAwarenessPct: Number(((mayorKnown / totalAgents) * 100).toFixed(1)),
    networkDensity: computeGraphDensity(world.agents.length, pairEdges),
    invitedCount: world.partyStats?.invitedAgentIds.length ?? 0,
    agreedCount: world.partyStats?.agreedAgentIds.length ?? 0,
    conversationsTotal,
  };
}

export function runHeadless(rawOptions: HeadlessOptions): HeadlessResult {
  const days = Math.max(1, Math.min(14, Math.round(rawOptions.days || 4)));
  const speed = rawOptions.speed ?? 1;
  const latencyMs = Math.max(0, Math.round(rawOptions.latencyMs ?? 4000));
  const seed = rawOptions.seed ?? 42;
  const failAgentIds = rawOptions.failAgentIds ?? [];
  const mode: HeadlessMode = rawOptions.mode ?? 'scheduler';
  const preset: BudgetPreset = rawOptions.preset ?? 'balanced';
  const selectedAgentId = rawOptions.selectedAgentId ?? 'isabella';
  const scenarioId: ScenarioId = rawOptions.scenario ?? 'default';
  const ablations: AblationSettings = {
    ...DEFAULT_ABLATIONS,
    ...(rawOptions.ablations ?? {}),
  };

  let world = createInitialWorldState(scenarioId, ablations);
  const startSimMinutes = world.simMinutes;
  const startDay = formatSimTime(startSimMinutes).day;

  const initialImp8 = world.agents.flatMap((ag) =>
    ag.memories
      .filter((m) => m.importance >= 8)
      .map((m) => ({
        agentId: ag.id,
        memoryId: m.id,
        description: m.description,
      })),
  );

  // Cumulative undirected social network edges (seeded strong familiarity >= 45 + conversations)
  const cumulativeEdges = new Set<string>();
  for (const a of world.agents) {
    for (const [targetId, edge] of Object.entries(a.socialGraph)) {
      if (edge.familiarity >= 45) {
        const key = a.id < targetId ? `${a.id}:${targetId}` : `${targetId}:${a.id}`;
        cumulativeEdges.add(key);
      }
    }
  }
  const initialNetworkDensity = computeGraphDensity(world.agents.length, cumulativeEdges);

  const mockLlm = createMockLlm({
    seed,
    failAgentIds,
    failKinds: rawOptions.failKinds,
    failureRate: rawOptions.failureRate ?? 0,
  });

  const targetEndSimMinutes = startSimMinutes + days * 1440;
  const TICK_MS = 100;

  let nowMs = 0;
  let policyState = createCognitionPolicyState(0);
  let schedulerState = createSchedulerState(buildSchedulerConfig(preset), startDay);

  const inFlight: PendingVirtualJob[] = [];
  const slidingCallTimestamps: number[] = [];

  let maxConcurrentObserved = 0;
  let maxCallsPerMinuteObserved = 0;
  let wallCrossingConversations = 0;
  let day2PartyBlockCount = 0;
  let day2PartyChecked = false;
  let pastAgreementsCount = 0;
  let commitmentsLostToReplan = 0;

  let totalConvCount = 0;
  let totalConvTurns = 0;
  let totalConvCalls = 0;
  let maxCallsPerConv = 0;
  const turnsByDay = new Map<number, number>();
  const convCallsByDay = new Map<number, number>();
  const reactionsPerAgentDay = new Map<string, number>();

  const dayMap = new Map<number, HeadlessDayMetrics>();
  const uniquePairsByDay = new Map<number, Set<string>>();
  const detoursSeenByAgentDay = new Map<string, Set<number>>();
  let repeatedDetours = 0;
  const prevDriveInterruptIds = new Set<string>();

  const ensureDay = (day: number): HeadlessDayMetrics => {
    let entry = dayMap.get(day);
    if (!entry) {
      entry = {
        day,
        conversations: 0,
        avgTurnsPerConv: 0,
        avgCallsPerConv: 0,
        reflections: 0,
        reactions: 0,
        morningPlansCount: 0,
        morningPlansWithMealsAndSleep: 0,
        lastMorningPlanSimMin: null,
        lastMorningPlanTimeLabel: null,
        consolidations: 0,
        uniqueConversationPairs: 0,
        perceptionEvents: 0,
        driveDetours: 0,
        failedCalls: 0,
        callsByKind: makeEmptyCallsRecord(),
        residentsAtHome0300: null,
      };
      dayMap.set(day, entry);
    }
    return entry;
  };

  for (let d = 1; d <= days + 1; d++) {
    ensureDay(d);
  }

  let lastMinuteChecked = Math.floor(world.simMinutes);
  let lastHourSampled = Math.floor(world.simMinutes / 60);
  const awarenessTimeline: AwarenessTimelineSample[] = [
    sampleAwarenessSnapshot(world, cumulativeEdges, 0),
  ];

  function executeMockJob(job: PendingVirtualJob): void {
    const day = formatSimTime(world.simMinutes).day;
    const metrics = ensureDay(day);
    const kind = job.kind;

    try {
      if (kind === 'morning_plan' || kind === 'replan') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 1;
        const agentId = job.agentIds[0];
        const beforeFixedIds = new Set(
          (world.agents.find((a) => a.id === agentId)?.dailySchedule ?? [])
            .filter((b) => b.day === day && b.fixed && (kind === 'morning_plan' || b.startMinute + b.durationMinutes > formatSimTime(world.simMinutes).minuteOfDay))
            .map((b) => b.id),
        );

        const res = mockLlm.plan(world, agentId);
        world = applyPlanResult(world, agentId, res, {
          isMorningPlan: kind === 'morning_plan',
        });

        const updatedAg = world.agents.find((a) => a.id === agentId);
        if (updatedAg) {
          const afterIds = new Set(updatedAg.dailySchedule.map((b) => b.id));
          for (const fid of beforeFixedIds) {
            if (!afterIds.has(fid)) {
              commitmentsLostToReplan += 1;
            }
          }
          if (kind === 'morning_plan') {
            metrics.morningPlansCount += 1;
            metrics.lastMorningPlanSimMin = world.simMinutes;
            metrics.lastMorningPlanTimeLabel = formatSimTime(world.simMinutes).timeLabel;
            const dayBlocks = updatedAg.dailySchedule.filter((b) => b.day === day);
            const hasSleep = dayBlocks.some((b) => b.kind === 'sleep');
            const mealCount = dayBlocks.filter((b) => b.kind === 'meal').length;
            if (hasSleep && mealCount >= 2) {
              metrics.morningPlansWithMealsAndSleep += 1;
            }
          }
        }
      } else if (kind === 'reflection') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 2;
        const agentId = job.agentIds[0];
        const res = mockLlm.reflect(world, agentId);
        world = applyReflectionResult(world, agentId, res.reflections);
        metrics.reflections += 1;
      } else if (kind === 'reaction') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 1;
        const agentId = job.agentIds[0];
        const res = mockLlm.react(
          world,
          agentId,
          job.observation ?? 'Notable event nearby.',
          job.partnerId,
        );
        const prevToday = reactionsPerAgentDay.get(`${day}:${agentId}`) ?? 0;
        reactionsPerAgentDay.set(`${day}:${agentId}`, prevToday + 1);
        world = applyReactionResult(world, agentId, res);
        metrics.reactions += 1;
      } else if (kind === 'step_detail') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 1;
        const agentId = job.agentIds[0];
        if (job.blockId && job.blockActivity) {
          const res = mockLlm.stepDetail(world, agentId, {
            activity: job.blockActivity,
            kind: (job.blockKind as 'work') ?? 'work',
            durationMinutes: job.blockDuration ?? 60,
          });
          world = applyBlockSubSteps(world, agentId, job.blockId, res.subSteps);
        } else {
          world = clearAgentThinkingState(world, [agentId], false);
        }
      } else if (kind === 'decision') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 1;
        const agentId = job.agentIds[0];
        const res = mockLlm.decide(world, agentId, job.forkReason);
        world = applyAutonomousDecision(world, agentId, res, { deferUntilArrival: true });
      } else if (kind === 'consolidation') {
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + 1;
        const agentId = job.agentIds[0];
        const res = mockLlm.consolidate(world, agentId);
        world = applyConsolidationResult(world, agentId, res);
        metrics.consolidations += 1;
      } else if (kind === 'conversation') {
        const [aId, bId] = job.agentIds;
        const pairKey = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
        cumulativeEdges.add(pairKey);

        const res = mockLlm.converse(world, aId, bId, job.startReason);
        const actualCalls = res.turns.length + 2;
        metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + actualCalls;
        totalConvCount += 1;
        totalConvTurns += res.turns.length;
        totalConvCalls += actualCalls;
        if (actualCalls > maxCallsPerConv) maxCallsPerConv = actualCalls;
        turnsByDay.set(day, (turnsByDay.get(day) ?? 0) + res.turns.length);
        convCallsByDay.set(day, (convCallsByDay.get(day) ?? 0) + actualCalls);

        const stampSim =
          mode === 'scheduler'
            ? job.startedAtSim + res.turns.length * 1.5
            : world.simMinutes;
        const stampInfo = formatSimTime(stampSim);
        if (res.sharedAgreement) {
          const agDay =
            res.sharedAgreement.day === 'today'
              ? stampInfo.day
              : res.sharedAgreement.day === 'tomorrow'
                ? stampInfo.day + 1
                : Number(res.sharedAgreement.day);
          if (
            agDay < stampInfo.day ||
            (agDay === stampInfo.day && res.sharedAgreement.minuteOfDay <= stampInfo.minuteOfDay)
          ) {
            pastAgreementsCount += 1;
          }
        }
        world = applyConversationResult(world, {
          agentAId: aId,
          agentBId: bId,
          turns: res.turns,
          summaryA: res.summaryA,
          summaryB: res.summaryB,
          importance: res.importance,
          importanceA: res.importanceA,
          importanceB: res.importanceB,
          reason: res.reason,
          endedBy: res.endedBy,
          planUpdateA: res.planUpdateA,
          planUpdateB: res.planUpdateB,
          sharedAgreement: res.sharedAgreement,
          memeIdsDiscussedA: res.memeIdsDiscussedA,
          memeIdsDiscussedB: res.memeIdsDiscussedB,
          emotionalShiftA: res.emotionalShiftA,
          emotionalShiftB: res.emotionalShiftB,
          tomUpdateA: res.tomUpdateA,
          tomUpdateB: res.tomUpdateB,
          stampSimMinutes: stampSim,
        });
        metrics.conversations += 1;
      }

      if (mode === 'scheduler' && job.schedulerJob) {
        schedulerState = markJobSucceeded(schedulerState, job.schedulerJob, world.simMinutes);
      }
    } catch (err) {
      metrics.callsByKind[kind] = (metrics.callsByKind[kind] ?? 0) + job.expectedCalls;
      metrics.failedCalls += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (mode === 'scheduler' && job.schedulerJob) {
        const outcome = markJobFailed(
          schedulerState,
          job.schedulerJob,
          nowMs,
          world.simMinutes,
          errMsg,
        );
        schedulerState = outcome.state;
        if (outcome.shouldApplyFallbackPlan && job.agentIds[0]) {
          world = applyFallbackPlan(world, job.agentIds[0]);
          metrics.morningPlansCount += 1;
          metrics.morningPlansWithMealsAndSleep += 1;
          metrics.lastMorningPlanSimMin = world.simMinutes;
          metrics.lastMorningPlanTimeLabel = formatSimTime(world.simMinutes).timeLabel;
        } else if (outcome.shouldHalveReflectionAccumulator && job.agentIds[0]) {
          world = applyFailedReflectionFallback(world, job.agentIds[0]);
        } else {
          world = clearAgentThinkingState(world, job.agentIds, kind === 'conversation');
        }
      } else {
        world = clearAgentThinkingState(world, job.agentIds, kind === 'conversation');
      }
    }
  }

  let safetyTicks = 0;
  const maxTicks = days * 45_000;

  while (world.simMinutes < targetEndSimMinutes && safetyTicks < maxTicks) {
    safetyTicks += 1;
    nowMs += TICK_MS;

    // 1. Resolve completed virtual jobs
    if (mode !== 'llm_off') {
      for (let i = inFlight.length - 1; i >= 0; i--) {
        if (nowMs >= inFlight[i].finishAtMs) {
          const [done] = inFlight.splice(i, 1);
          if (mode === 'baseline') {
            policyState = { ...policyState, inFlight: false };
          }
          executeMockJob(done);
        }
      }
    }

    // 2. Step simulation world
    const prevPerceptions = world.stats.perceptionEvents;
    const dilation =
      mode === 'scheduler' ? computeTimeDilationRate(world, schedulerState, nowMs) : 1;
    const deltaSimMin = (TICK_MS / 650) * speed * dilation;
    const { nextState, triggers } = stepWorldState(world, deltaSimMin);
    world = nextState;

    const currentTime = formatSimTime(world.simMinutes);
    const dayEntry = ensureDay(currentTime.day);

    // Check Day 2 party schedule cleanup right after rollover
    if (!day2PartyChecked && currentTime.day === 2) {
      day2PartyChecked = true;
      for (const ag of world.agents) {
        if (scenarioId === 'paper_valentine' && ag.id === 'isabella') continue;
        for (const blk of ag.dailySchedule) {
          if (blk.day === 2 && /valentine/i.test(blk.activity)) {
            day2PartyBlockCount += 1;
          }
        }
      }
    }

    // Check wall-crossing or cross-zone encounter pairs
    for (const [aId, bId] of triggers.conversationPairs) {
      const a = world.agents.find((x) => x.id === aId);
      const b = world.agents.find((x) => x.id === bId);
      if (a && b && !canAgentsConverse(world, a, b)) {
        wallCrossingConversations += 1;
      }
    }

    // Perception diff
    const deltaPerc = Math.max(0, world.stats.perceptionEvents - prevPerceptions);
    dayEntry.perceptionEvents += deltaPerc;

    // Track drive detours & repeat detours across distinct days
    for (const ag of world.agents) {
      for (const blk of ag.dailySchedule) {
        if (blk.source === 'drive_interrupt' && !prevDriveInterruptIds.has(blk.id)) {
          prevDriveInterruptIds.add(blk.id);
          dayEntry.driveDetours += 1;
        }
        if (blk.source === 'drive_interrupt' && blk.id === ag.activeScheduleId) {
          const key = `${ag.id}:${blk.id}`;
          let daysSet = detoursSeenByAgentDay.get(key);
          if (!daysSet) {
            daysSet = new Set([currentTime.day]);
            detoursSeenByAgentDay.set(key, daysSet);
          } else if (!daysSet.has(currentTime.day)) {
            daysSet.add(currentTime.day);
            repeatedDetours += 1;
          }
        }
      }
    }

    // Unique conversation pairs triggered
    let pairSet = uniquePairsByDay.get(currentTime.day);
    if (!pairSet) {
      pairSet = new Set();
      uniquePairsByDay.set(currentTime.day, pairSet);
    }
    for (const [aId, bId] of triggers.conversationPairs) {
      const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
      pairSet.add(key);
    }
    dayEntry.uniqueConversationPairs = pairSet.size;

    // Check 03:00 home occupancy once per night when passing 03:00 (minuteOfDay === 180)
    const curMinFloor = Math.floor(world.simMinutes);
    if (curMinFloor > lastMinuteChecked) {
      for (let m = lastMinuteChecked + 1; m <= curMinFloor; m++) {
        const info = formatSimTime(m);
        if (info.minuteOfDay === 180 && info.day >= 2) {
          const homeCount = world.agents.filter(
            (a) => a.currentLocationId === a.homeLocationId,
          ).length;
          ensureDay(info.day).residentsAtHome0300 = homeCount;
        }
      }
      lastMinuteChecked = curMinFloor;
    }

    // Hourly sample for paper experiment timeline (awareness % & network density)
    const curHourFloor = Math.floor(world.simMinutes / 60);
    if (curHourFloor > lastHourSampled) {
      lastHourSampled = curHourFloor;
      awarenessTimeline.push(sampleAwarenessSnapshot(world, cumulativeEdges, totalConvCount));
    }

    // 3. Schedule LLM jobs
    if (mode === 'baseline') {
      const picked = pickAutoJob(
        world,
        triggers,
        { ...policyState, inFlight: inFlight.length > 0 },
        nowMs,
        selectedAgentId,
      );
      policyState = picked.policyState;
      if (picked.job) {
        policyState = { ...policyState, inFlight: true };
        const startedAtSim = world.simMinutes;
        const jobAgents = picked.job.agentIds;
        world = {
          ...world,
          agents: world.agents.map((a) =>
            jobAgents.includes(a.id) ? { ...a, isThinking: true } : a,
          ),
        };
        const virtualCalls = picked.job.expectedCalls;
        for (let k = 0; k < virtualCalls; k++) {
          slidingCallTimestamps.push(nowMs);
        }
        inFlight.push({
          kind: picked.job.kind,
          agentIds: jobAgents,
          expectedCalls: virtualCalls,
          startedAtMs: nowMs,
          finishAtMs: nowMs + latencyMs * virtualCalls,
          startedAtSim,
        });
      }
    } else if (mode === 'scheduler') {
      schedulerState = enqueueTriggers(schedulerState, world, triggers, nowMs);
      const dispatched = dispatchEligibleJobs(schedulerState, world, nowMs);
      schedulerState = dispatched.state;

      for (const job of dispatched.jobsToStart) {
        if (job.kind === 'conversation' && job.agentIds.length >= 2) {
          world = startAgentConversationLock(world, job.agentIds[0], job.agentIds[1], job.agentIds.slice(2));
        } else {
          const set = new Set(job.agentIds);
          world = {
            ...world,
            agents: world.agents.map((a) =>
              set.has(a.id) ? { ...a, isThinking: true } : a,
            ),
          };
        }
        for (let k = 0; k < job.expectedCalls; k++) {
          slidingCallTimestamps.push(nowMs);
        }
        inFlight.push({
          kind: job.kind,
          agentIds: job.agentIds,
          expectedCalls: job.expectedCalls,
          startedAtMs: nowMs,
          finishAtMs: nowMs + latencyMs * job.expectedCalls,
          startedAtSim: world.simMinutes,
          startReason: job.startReason,
          observation: job.observation,
          partnerId: job.partnerId,
          blockId: job.blockId,
          blockActivity: job.blockActivity,
          blockKind: job.blockKind,
          blockDuration: job.blockDuration,
          forkReason: job.forkReason,
          schedulerJob: job,
        });
      }
    }

    // Prune sliding call window and observe peak concurrency / RPM
    while (slidingCallTimestamps.length > 0 && slidingCallTimestamps[0] <= nowMs - 60_000) {
      slidingCallTimestamps.shift();
    }
    if (inFlight.length > maxConcurrentObserved) {
      maxConcurrentObserved = inFlight.length;
    }
    if (slidingCallTimestamps.length > maxCallsPerMinuteObserved) {
      maxCallsPerMinuteObserved = slidingCallTimestamps.length;
    }
  }

  // Final hourly sample if needed
  awarenessTimeline.push(sampleAwarenessSnapshot(world, cumulativeEdges, totalConvCount));

  const perDay: HeadlessDayMetrics[] = [];
  for (let d = 1; d <= days; d++) {
    const entry = ensureDay(d);
    const dayConvs = entry.conversations;
    entry.avgTurnsPerConv =
      dayConvs > 0 ? Number(((turnsByDay.get(d) ?? 0) / dayConvs).toFixed(2)) : 0;
    entry.avgCallsPerConv =
      dayConvs > 0 ? Number(((convCallsByDay.get(d) ?? 0) / dayConvs).toFixed(2)) : 0;
    perDay.push(entry);
  }

  const residentsHomeAt0300ByNight: Array<{ day: number; count: number; total: number }> = [];
  for (let d = 2; d <= days + 1; d++) {
    const entry = dayMap.get(d);
    if (entry && entry.residentsAtHome0300 !== null) {
      residentsHomeAt0300ByNight.push({
        day: d,
        count: entry.residentsAtHome0300,
        total: world.agents.length,
      });
    }
  }

  const memoriesPerResident: Record<string, number> = {};
  let totalMem = 0;
  let totalPercMem = 0;
  const currentMemIdsByAgent = new Map<string, Set<string>>();

  for (const ag of world.agents) {
    memoriesPerResident[ag.id] = ag.memories.length;
    totalMem += ag.memories.length;
    const set = new Set<string>();
    for (const m of ag.memories) {
      set.add(m.id);
      if (m.id.startsWith('perc_')) {
        totalPercMem += 1;
      }
    }
    currentMemIdsByAgent.set(ag.id, set);
  }

  const seedImp8Survived = initialImp8.map((item) => {
    const agent = world.agents.find((a) => a.id === item.agentId);
    const inMemory = currentMemIdsByAgent.get(item.agentId)?.has(item.memoryId) ?? false;
    const citedBySummary = Boolean(
      agent?.memories.some(
        (m) =>
          (m.type === 'consolidated' || m.type === 'reflection') &&
          m.evidenceIds?.includes(item.memoryId),
      ),
    );
    return {
      ...item,
      survived: inMemory || citedBySummary,
    };
  });

  const totalFailedCalls = perDay.reduce((sum, d) => sum + d.failedCalls, 0);
  const reflectionsTotal = perDay.reduce((sum, d) => sum + d.reflections, 0);
  const morningPlansTotal = perDay.reduce((sum, d) => sum + d.morningPlansCount, 0);
  const morningPlansWithMealsAndSleep = perDay.reduce(
    (sum, d) => sum + d.morningPlansWithMealsAndSleep,
    0,
  );
  const reactionsTotal = perDay.reduce((sum, d) => sum + d.reactions, 0);
  const maxReactionsPerResidentPerDay = Array.from(reactionsPerAgentDay.values()).reduce(
    (mx, c) => Math.max(mx, c),
    0,
  );
  const llmCallsTotal = perDay.reduce(
    (sum, d) => sum + Object.values(d.callsByKind).reduce((a, b) => a + b, 0),
    0,
  );
  const tokensEstimated = llmCallsTotal * 1250;

  const totalObsCount = world.agents.reduce(
    (sum, ag) => sum + ag.memories.filter((m) => m.type === 'observation').length,
    0,
  );
  const simDaysElapsed = Math.max(1, (world.simMinutes - startSimMinutes) / 1440);
  const validationIssuesCount = validateWorld(world).length;

  const partyMemeFinal = (world.memes ?? []).find((m) => m.id === 'meme_valentine_party');
  const mayorMemeFinal = (world.memes ?? []).find((m) => m.id === 'meme_mayor_race');
  const partyAwarenessPct = partyMemeFinal
    ? Number(
        ((Object.keys(partyMemeFinal.knownBy).length / Math.max(1, world.agents.length)) * 100).toFixed(1),
      )
    : 0;
  const mayorAwarenessPct = mayorMemeFinal
    ? Number(
        ((Object.keys(mayorMemeFinal.knownBy).length / Math.max(1, world.agents.length)) * 100).toFixed(1),
      )
    : 0;
  const finalNetworkDensity = computeGraphDensity(world.agents.length, cumulativeEdges);
  const partyStats = world.partyStats ?? {
    minutesAtCafeByAgent: {},
    invitedAgentIds: [],
    agreedAgentIds: [],
    plannedAfterNewsAgentIds: [],
    attendedRawIds: [],
    attendedDecisionIds: [],
  };

  const estimatedSaveBytes = JSON.stringify({
    ...world,
    agents: world.agents.map((ag) => ({
      ...ag,
      memories: ag.memories.map(({ embedding: _e, ...rest }) => rest),
    })),
  }).length;

  return {
    mode,
    preset,
    scenarioId,
    ablations,
    options: {
      days,
      speed,
      latencyMs,
      failAgentIds,
      seed,
    },
    perDay,
    awarenessTimeline,
    endOfRun: {
      totalSimMinutes: Math.round(world.simMinutes - startSimMinutes),
      totalSimDays: Number(simDaysElapsed.toFixed(2)),
      memoriesPerResident,
      avgMemoriesPerResident: Number((totalMem / Math.max(1, world.agents.length)).toFixed(1)),
      perceptionShare: totalMem > 0 ? Number((totalPercMem / totalMem).toFixed(3)) : 0,
      observationsPerResidentPerDay: Number(
        (totalObsCount / (Math.max(1, world.agents.length) * simDaysElapsed)).toFixed(2),
      ),
      duplicateMemoryIds: countDuplicateMemoryIds(world),
      seedImp8Survived,
      allSeedImp8Survived: seedImp8Survived.every((s) => s.survived),
      residentsHomeAt0300ByNight,
      repeatedDetours,
      wallCrossingConversations,
      day2PartyBlockCount,
      pastAgreementsCount,
      validationIssuesCount,
      avgTurnsPerConv:
        totalConvCount > 0 ? Number((totalConvTurns / totalConvCount).toFixed(2)) : 0,
      avgCallsPerConv:
        totalConvCount > 0 ? Number((totalConvCalls / totalConvCount).toFixed(2)) : 0,
      maxCallsPerConv,
      estimatedSaveBytes,
      maxConcurrentObserved,
      maxCallsPerMinuteObserved,
      totalFailedCalls,
      reflectionsTotal,
      reflectionsPerResidentPerDay: Number(
        (reflectionsTotal / (Math.max(1, world.agents.length) * simDaysElapsed)).toFixed(2),
      ),
      morningPlansTotal,
      morningPlansWithMealsAndSleep,
      commitmentsLostToReplan,
      reactionsTotal,
      maxReactionsPerResidentPerDay,
      initialNetworkDensity,
      finalNetworkDensity,
      partySummary: {
        originCount: 1,
        invitedCount: partyStats.invitedAgentIds.length,
        agreedCount: partyStats.agreedAgentIds.length,
        plannedAfterNewsCount: partyStats.plannedAfterNewsAgentIds.length,
        attendedRawCount: partyStats.attendedRawIds.length,
        attendedDecisionCount: partyStats.attendedDecisionIds.length,
        attendedRawIds: partyStats.attendedRawIds,
        attendedDecisionIds: partyStats.attendedDecisionIds,
      },
      paperComparison: {
        partyAwarenessPct,
        targetPartyAwarenessPct: PAPER_BENCHMARKS.valentinePartyAwarenessPct,
        mayorAwarenessPct,
        targetMayorAwarenessPct: PAPER_BENCHMARKS.mayorRaceAwarenessPct,
        networkDensityStart: initialNetworkDensity,
        targetDensityStart: PAPER_BENCHMARKS.networkDensityStart,
        networkDensityEnd: finalNetworkDensity,
        targetDensityEnd: PAPER_BENCHMARKS.networkDensityEnd,
        attendedDecisionCount: partyStats.attendedDecisionIds.length,
        targetAttendedCount: PAPER_BENCHMARKS.partyAttendedCount,
      },
      llmCallsTotal,
      tokensEstimated,
      diversity: computeDiversitySnapshot(world),
      finalWorld: world,
    },
  };
}

export { enqueueJob };
