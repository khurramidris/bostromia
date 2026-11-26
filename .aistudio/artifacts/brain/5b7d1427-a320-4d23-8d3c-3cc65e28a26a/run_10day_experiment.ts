// Live 10-Day Smallville Experiment Runner (Real Server LLM Calls)
// Shim browser globals (localStorage + relative /api fetch) before importing app services.
const memStorage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() {
    return memStorage.size;
  },
  clear() {
    memStorage.clear();
  },
  getItem(key: string) {
    return memStorage.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(memStorage.keys())[index] ?? null;
  },
  removeItem(key: string) {
    memStorage.delete(key);
  },
  setItem(key: string, value: string) {
    memStorage.set(key, String(value));
  },
};

const BASE_URL = process.env.SMALLVILLE_URL || 'http://127.0.0.1:3000';
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    return origFetch(`${BASE_URL}${input}`, init);
  }
  return origFetch(input, init);
}) as typeof fetch;

import fs from 'fs';
import {
  buildSchedulerConfig,
  createSchedulerState,
  dispatchEligibleJobs,
  enqueueTriggers,
  markJobFailed,
  markJobSucceeded,
  type CognitionJob,
} from '../../../../src/simulation/cognitionScheduler';
import {
  applyAutonomousDecision,
  applyBlockSubSteps,
  applyConsolidationResult,
  applyConversationResult,
  applyFailedReflectionFallback,
  applyFallbackPlan,
  applyGroupSceneResult,
  applyPlanResult,
  applyReactionResult,
  applyReflectionResult,
  clearAgentThinkingState,
  createInitialWorldState,
  startAgentConversationLock,
  stepWorldState,
} from '../../../../src/simulation/engine';
import { formatSimTime } from '../../../../src/simulation/memory';
import { computeDiversitySnapshot } from '../../../../src/simulation/diversityMetrics';
import { validateWorld } from '../../../../src/simulation/validateWorld';
import type { ScheduleBlockKind, WorldState } from '../../../../src/simulation/types';
import {
  ApiRequestError,
  checkServerHealth,
  fetchServerMetrics,
  requestAutonomousDecision,
  requestConversation,
  requestGroupScene,
  requestPlanUpdate,
  requestReaction,
  requestReflection,
  requestSleepConsolidation,
  requestStepDetail,
} from '../../../../src/services/smallvilleApi';

const TARGET_DAYS = Number(process.env.EXP_DAYS || 10);
const CHUNK_DAYS = Number(process.env.EXP_CHUNK_DAYS || TARGET_DAYS);
const MAX_CONCURRENT = Number(process.env.EXP_CONCURRENT || 12);
const MAX_CALLS_PER_SIM_DAY = Number(process.env.EXP_CALLS_PER_DAY || 140);
const MAX_CALLS_PER_MIN = Number(process.env.EXP_RPM || 220);
const USE_COMPRESSED_SCENES = process.env.EXP_COMPRESSED !== 'false';
const ARTIFACT_DIR = '.aistudio/artifacts/brain/5b7d1427-a320-4d23-8d3c-3cc65e28a26a';
const OUTPUT_PATH = process.env.EXP_OUT || `${ARTIFACT_DIR}/exp10_results.json`;
const CHECKPOINT_PATH = process.env.EXP_CKPT || `${ARTIFACT_DIR}/exp10_checkpoint.json`;
const FRESH_RUN = process.env.EXP_FRESH === 'true';

interface DecisionLogEntry {
  day: number;
  time: string;
  agentId: string;
  agentName: string;
  forkReason?: string;
  action: string;
  rationale: string;
  details: Record<string, unknown>;
}

interface ReactionLogEntry {
  day: number;
  time: string;
  agentId: string;
  observation: string;
  react: boolean;
  reason: string;
  newActivity?: string;
}

interface DaySummary {
  day: number;
  wallSecondsElapsed: number;
  jobsCompletedByKind: Record<string, number>;
  jobsFailedByKind: Record<string, number>;
  conversationsToday: number;
  groupScenesToday: number;
  decisionsToday: number;
  activeDecisionsToday: number;
  reactionsToday: number;
  reactionsTriggeredChangeToday: number;
  reflectionsToday: number;
  morningPlansToday: number;
  fallbackPlansToday: number;
  consolidationsToday: number;
  residentsHomeAt0300: number | null;
  diversity: ReturnType<typeof computeDiversitySnapshot>;
  gdp: number;
  townTreasury: number;
  transactionsTotal: number;
  avgWallet: number;
  minWallet: number;
  maxWallet: number;
  activeLoans: number;
  repaidLoans: number;
  defaultedLoans: number;
  activeVentures: number;
  noticesCount: number;
  proposalsCount: number;
  enactedPoliciesCount: number;
  petitionsCount: number;
  electionStatus: string;
  electionVotesCast: number;
  partyAwarenessPct: number;
  mayorAwarenessPct: number;
  emergentMemesCount: number;
  validationIssues: number;
  healthProvider: string;
  healthModel: string;
  failoverActive: boolean;
}

async function run() {
  const startWallMs = Date.now();
  const initHealth = await checkServerHealth();
  console.log(
    `[EXP10] Starting ${TARGET_DAYS}-day live experiment against ${BASE_URL}`,
  );
  console.log(
    `[EXP10] Server provider=${initHealth.provider} model=${initHealth.model} failover=${(initHealth as { failoverActive?: boolean }).failoverActive ?? false} compressed=${USE_COMPRESSED_SCENES} concurrent=${MAX_CONCURRENT} dayCap=${MAX_CALLS_PER_SIM_DAY} rpm=${MAX_CALLS_PER_MIN}`,
  );

  let world: WorldState = {
    ...createInitialWorldState('default'),
    compressedConversations: USE_COMPRESSED_SCENES,
  };

  let startSimMinutes = world.simMinutes;
  let priorWallSeconds = 0;

  let initialImp8 = world.agents.flatMap((ag) =>
    ag.memories
      .filter((m) => m.importance >= 8)
      .map((m) => ({
        agentId: ag.id,
        memoryId: m.id,
        description: m.description,
      })),
  );

  let schedulerState = createSchedulerState(
    buildSchedulerConfig('balanced', {
      maxConcurrent: MAX_CONCURRENT,
      maxCallsPerMinute: MAX_CALLS_PER_MIN,
      maxCallsPerSimDay: MAX_CALLS_PER_SIM_DAY,
      maxCallsPerAgentPerSimDay: 34,
    }),
    formatSimTime(startSimMinutes).day,
  );

  let decisionLog: DecisionLogEntry[] = [];
  let reactionLog: ReactionLogEntry[] = [];
  let daySummaries: DaySummary[] = [];
  let recentErrors: Array<{ day: number; time: string; kind: string; error: string }> = [];
  let currentTrackedDay = formatSimTime(world.simMinutes).day;
  const totalJobsOk: Record<string, number> = {};
  const totalJobsFail: Record<string, number> = {};
  const home0300ByDay = new Map<number, number>();

  if (!FRESH_RUN && fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const ckpt = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
      world = { ...ckpt.world, compressedConversations: USE_COMPRESSED_SCENES };
      startSimMinutes = ckpt.startSimMinutes;
      priorWallSeconds = ckpt.wallSecondsTotal ?? 0;
      initialImp8 = ckpt.initialImp8 ?? initialImp8;
      decisionLog = ckpt.decisionLog ?? [];
      reactionLog = ckpt.reactionLog ?? [];
      daySummaries = ckpt.daySummaries ?? [];
      recentErrors = ckpt.recentErrors ?? [];
      currentTrackedDay = ckpt.nextTrackedDay ?? daySummaries.length + 1;
      Object.assign(totalJobsOk, ckpt.totalJobsOk ?? {});
      Object.assign(totalJobsFail, ckpt.totalJobsFail ?? {});
      for (const [k, v] of Object.entries(ckpt.home0300ByDay ?? {})) {
        home0300ByDay.set(Number(k), Number(v));
      }
      schedulerState = createSchedulerState(
        buildSchedulerConfig('balanced', {
          maxConcurrent: MAX_CONCURRENT,
          maxCallsPerMinute: MAX_CALLS_PER_MIN,
          maxCallsPerSimDay: MAX_CALLS_PER_SIM_DAY,
          maxCallsPerAgentPerSimDay: 34,
        }),
        formatSimTime(world.simMinutes).day,
      );
      console.log(
        `[EXP10] Resumed from checkpoint at ${formatSimTime(world.simMinutes).fullLabel} (${daySummaries.length} completed days, priorWall=${priorWallSeconds}s)`,
      );
    } catch (e) {
      console.warn('[EXP10] Failed to load checkpoint, starting fresh:', e);
    }
  }

  const targetEndSimMinutes = startSimMinutes + TARGET_DAYS * 1440;
  const completedDaysBeforeRun = daySummaries.length;
  const chunkEndDay = Math.min(TARGET_DAYS, completedDaysBeforeRun + CHUNK_DAYS);
  const chunkEndSimMinutes = startSimMinutes + chunkEndDay * 1440;
  const inFlightPromises = new Map<string, Promise<void>>();

  // Per-day counters
  let dayJobsOk: Record<string, number> = {};
  let dayJobsFail: Record<string, number> = {};
  let dayConvs = 0;
  let dayGroupScenes = 0;
  let dayDecisions = 0;
  let dayActiveDecisions = 0;
  let dayReactions = 0;
  let dayReactionsChanged = 0;
  let dayReflections = 0;
  let dayMorningPlans = 0;
  let dayFallbackPlans = 0;
  let dayConsolidations = 0;
  let lastMinuteChecked = Math.floor(world.simMinutes);

  function resetDayCounters() {
    dayJobsOk = {};
    dayJobsFail = {};
    dayConvs = 0;
    dayGroupScenes = 0;
    dayDecisions = 0;
    dayActiveDecisions = 0;
    dayReactions = 0;
    dayReactionsChanged = 0;
    dayReflections = 0;
    dayMorningPlans = 0;
    dayFallbackPlans = 0;
    dayConsolidations = 0;
  }

  async function recordDaySummary(finishedDay: number) {
    const health = await checkServerHealth().catch(() => initHealth);
    const wallets = world.agents.map((a) => a.wallet ?? 0);
    const avgWallet = wallets.reduce((s, v) => s + v, 0) / Math.max(1, wallets.length);
    const loans = world.loans ?? [];
    const memes = world.memes ?? [];
    const partyMeme = memes.find((m) => m.id === 'meme_valentine_party');
    const mayorMeme = memes.find((m) => m.id === 'meme_mayor_race');
    const totalAgents = Math.max(1, world.agents.length);
    const partyPct = partyMeme
      ? Number(((Object.keys(partyMeme.knownBy).length / totalAgents) * 100).toFixed(1))
      : 0;
    const mayorPct = mayorMeme
      ? Number(((Object.keys(mayorMeme.knownBy).length / totalAgents) * 100).toFixed(1))
      : 0;
    const emergentMemesCount = memes.filter((m) => !m.id.startsWith('meme_')).length;

    const summary: DaySummary = {
      day: finishedDay,
      wallSecondsElapsed: Math.round((Date.now() - startWallMs) / 1000),
      jobsCompletedByKind: { ...dayJobsOk },
      jobsFailedByKind: { ...dayJobsFail },
      conversationsToday: dayConvs,
      groupScenesToday: dayGroupScenes,
      decisionsToday: dayDecisions,
      activeDecisionsToday: dayActiveDecisions,
      reactionsToday: dayReactions,
      reactionsTriggeredChangeToday: dayReactionsChanged,
      reflectionsToday: dayReflections,
      morningPlansToday: dayMorningPlans,
      fallbackPlansToday: dayFallbackPlans,
      consolidationsToday: dayConsolidations,
      residentsHomeAt0300: home0300ByDay.get(finishedDay + 1) ?? home0300ByDay.get(finishedDay) ?? null,
      diversity: computeDiversitySnapshot(world),
      gdp: Math.round(world.stats.totalTradeVolume ?? 0),
      townTreasury: Math.round(world.townTreasury ?? 0),
      transactionsTotal: world.stats.economicTransactions ?? (world.transactions ?? []).length,
      avgWallet: Number(avgWallet.toFixed(1)),
      minWallet: Math.round(Math.min(...wallets)),
      maxWallet: Math.round(Math.max(...wallets)),
      activeLoans: loans.filter((l) => l.status === 'active').length,
      repaidLoans: loans.filter((l) => l.status === 'repaid').length,
      defaultedLoans: loans.filter((l) => l.status === 'defaulted').length,
      activeVentures: (world.ventures ?? []).filter((v) => v.active).length,
      noticesCount: (world.notices ?? []).length,
      proposalsCount: (world.proposals ?? []).length,
      enactedPoliciesCount: (world.proposals ?? []).filter((p) => p.status === 'passed').length,
      petitionsCount: (world.petitions ?? []).length,
      electionStatus: world.election?.status ?? 'none',
      electionVotesCast: world.election?.votersCast.length ?? 0,
      partyAwarenessPct: partyPct,
      mayorAwarenessPct: mayorPct,
      emergentMemesCount,
      validationIssues: validateWorld(world).length,
      healthProvider: health.provider ?? 'unknown',
      healthModel: health.model,
      failoverActive: Boolean((health as { failoverActive?: boolean }).failoverActive),
    };

    daySummaries.push(summary);
    console.log(
      `[DAY ${finishedDay} DONE @ ${summary.wallSecondsElapsed}s] ` +
        `convs=${summary.conversationsToday}(grp=${summary.groupScenesToday}) ` +
        `plans=${summary.morningPlansToday}(fb=${summary.fallbackPlansToday}) ` +
        `dec=${summary.activeDecisionsToday}/${summary.decisionsToday} ` +
        `react=${summary.reactionsTriggeredChangeToday}/${summary.reactionsToday} ` +
        `refl=${summary.reflectionsToday} consol=${summary.consolidationsToday} ` +
        `lex=${summary.diversity.lexicalDiversity} trustPol=${summary.diversity.trustPolarization} ` +
        `moodSD=${summary.diversity.moodStdDev} refRate=${summary.diversity.refusalDisagreementRate} ` +
        `collapse=${summary.diversity.collapseRiskLevel} ` +
        `tx=${summary.transactionsTotal} loans=${summary.activeLoans}a/${summary.repaidLoans}r/${summary.defaultedLoans}d ` +
        `ventures=${summary.activeVentures} props=${summary.proposalsCount}(enacted=${summary.enactedPoliciesCount}) ` +
        `elec=${summary.electionStatus}(${summary.electionVotesCast}v) ` +
        `validErr=${summary.validationIssues} model=${summary.healthModel}`,
    );

    await writeCheckpoint(false);
    resetDayCounters();
  }

  async function writeCheckpoint(isFinal: boolean) {
    const serverMetrics = await fetchServerMetrics().catch(() => null);
    const serverHealth = await checkServerHealth().catch(() => null);

    // Build rich qualitative & quantitative report
    const decisionsByAction: Record<string, number> = {};
    for (const d of decisionLog) {
      decisionsByAction[d.action] = (decisionsByAction[d.action] ?? 0) + 1;
    }

    const seedImp8Survived = initialImp8.map((item) => {
      const ag = world.agents.find((a) => a.id === item.agentId);
      const inMem = Boolean(ag?.memories.some((m) => m.id === item.memoryId));
      const cited = Boolean(
        ag?.memories.some(
          (m) =>
            (m.type === 'consolidated' || m.type === 'reflection') &&
            m.evidenceIds?.includes(item.memoryId),
        ),
      );
      return { ...item, survived: inMem || cited };
    });

    // Sample conversations across early, mid, late days
    const allConvs = [...world.conversations].reverse(); // chronological
    const pickSampleConvs = () => {
      if (allConvs.length <= 12) return allConvs;
      const early = allConvs.slice(0, 4);
      const midStart = Math.floor(allConvs.length / 2) - 2;
      const mid = allConvs.slice(midStart, midStart + 4);
      const late = allConvs.slice(-5);
      return [...early, ...mid, ...late];
    };

    const sampleConversations = pickSampleConvs().map((c) => ({
      id: c.id,
      time: formatSimTime(c.simMinutes ?? 0).fullLabel,
      participants: c.participantNames ?? c.participantIds ?? [],
      location: c.locationName,
      reason: c.reason,
      summary: c.summary,
      endedBy: c.endedBy,
      isGroup: Boolean(c.isGroup),
      turns: (c.turns ?? []).map((t) => ({
        speaker: t.speakerName,
        text: t.text,
        privateThought: t.privateThought,
      })),
    }));

    // Sample reflections & consolidated insights
    const sampleReflections = world.agents.flatMap((ag) =>
      ag.memories
        .filter((m) => m.type === 'reflection')
        .slice(0, 3)
        .map((m) => ({
          agent: ag.name,
          time: formatSimTime(m.createdAt).fullLabel,
          importance: m.importance,
          description: m.description,
          evidenceCount: m.evidenceIds?.length ?? 0,
        })),
    );

    const sampleConsolidations = world.agents.flatMap((ag) =>
      ag.memories
        .filter((m) => m.type === 'consolidated')
        .slice(0, 2)
        .map((m) => ({
          agent: ag.name,
          time: formatSimTime(m.createdAt).fullLabel,
          importance: m.importance,
          description: m.description,
        })),
    );

    // Agent trajectory summaries
    const agentSummaries = world.agents.map((ag) => {
      const edges = Object.entries(ag.socialGraph);
      const avgTrust =
        edges.length > 0
          ? Number((edges.reduce((s, [, e]) => s + e.trust, 0) / edges.length).toFixed(1))
          : 0;
      const minTrustEdge = edges.sort((a, b) => a[1].trust - b[1].trust)[0];
      const maxTrustEdge = edges.sort((a, b) => b[1].trust - a[1].trust)[0];
      return {
        id: ag.id,
        name: ag.name,
        occupation: ag.occupation,
        wallet: Math.round(ag.wallet ?? 0),
        reputation: Math.round(ag.reputation ?? 50),
        housingStatus: ag.housingStatus,
        careerTier: ag.careerTier,
        mood: ag.mood,
        drives: ag.drives,
        memoriesTotal: ag.memories.length,
        reflectionsCount: ag.memories.filter((m) => m.type === 'reflection').length,
        consolidatedCount: ag.memories.filter((m) => m.type === 'consolidated').length,
        activeBeliefs: (ag.beliefs ?? [])
          .filter((b) => !b.invalidatedAtSimMin && !b.supersededById)
          .slice(0, 5),
        projects: (ag.projects ?? []).map((p) => ({
          title: p.title,
          progress: Math.round(p.progress),
          status: p.status,
        })),
        avgTrust,
        lowestTrust: minTrustEdge ? { target: minTrustEdge[0], trust: minTrustEdge[1].trust } : null,
        highestTrust: maxTrustEdge ? { target: maxTrustEdge[0], trust: maxTrustEdge[1].trust } : null,
        latestPlanSummary: ag.currently,
      };
    });

    const wallSecondsTotal = priorWallSeconds + Math.round((Date.now() - startWallMs) / 1000);

    const report = {
      completed: isFinal,
      generatedAt: new Date().toISOString(),
      wallSecondsTotal,
      targetDays: TARGET_DAYS,
      simDaysElapsed: Number(((world.simMinutes - startSimMinutes) / 1440).toFixed(2)),
      simTimeEnd: formatSimTime(world.simMinutes).fullLabel,
      serverHealth,
      serverMetrics,
      totalJobsOk,
      totalJobsFail,
      recentErrors: recentErrors.slice(-30),
      daySummaries,
      finalDiversity: computeDiversitySnapshot(world),
      worldStats: world.stats,
      validationIssues: validateWorld(world),
      seedImp8SurvivalRate: Number(
        (
          (seedImp8Survived.filter((s) => s.survived).length /
            Math.max(1, seedImp8Survived.length)) *
          100
        ).toFixed(1),
      ),
      decisionsByAction,
      sampleDecisions: decisionLog.slice(-40),
      reactionsTotal: reactionLog.length,
      reactionsChangedCount: reactionLog.filter((r) => r.react).length,
      sampleReactions: reactionLog.slice(-20),
      conversationsTotal: world.conversations.length,
      sampleConversations,
      sampleReflections: sampleReflections.slice(0, 35),
      sampleConsolidations: sampleConsolidations.slice(0, 25),
      memes: (world.memes ?? []).map((m) => ({
        id: m.id,
        topic: m.topic,
        knownByCount: Object.keys(m.knownBy).length,
        originAgentId: m.originAgentId,
      })),
      notices: (world.notices ?? []).map((n) => ({
        day: formatSimTime(n.createdAt ?? 0).day,
        author: n.authorName,
        category: n.category,
        title: n.title,
        body: n.body,
        readersCount: (n.readByAgentIds ?? []).length,
      })),
      proposals: (world.proposals ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        proposer: p.proposerName,
        status: p.status,
        cost: p.cost,
        votesFor: (p.votesFor ?? []).length,
        votesAgainst: (p.votesAgainst ?? []).length,
      })),
      petitions: world.petitions ?? [],
      loans: world.loans ?? [],
      ventures: world.ventures ?? [],
      election: world.election,
      leadership: world.leadership,
      clubs: world.clubs,
      businesses: world.businesses,
      recentEvents: (world.chronicle ?? []).slice(0, 60),
      agentSummaries,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');

    const compactWorld = {
      ...world,
      agents: world.agents.map((ag) => ({
        ...ag,
        memories: ag.memories.map(({ embedding: _e, ...rest }) => rest),
      })),
    };
    const ckpt = {
      world: compactWorld,
      startSimMinutes,
      wallSecondsTotal,
      initialImp8,
      decisionLog,
      reactionLog,
      daySummaries,
      recentErrors,
      nextTrackedDay: daySummaries.length + 1,
      totalJobsOk,
      totalJobsFail,
      home0300ByDay: Object.fromEntries(home0300ByDay.entries()),
    };
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(ckpt), 'utf8');
  }

  function launchJob(job: CognitionJob, startedAtSim: number) {
    const p = (async () => {
      try {
        if (job.kind === 'conversation') {
          const snap = world;
          const timeInfo = formatSimTime(snap.simMinutes);
          const useGroupScene =
            job.agentIds.length > 2 ||
            Boolean(job.compressed) ||
            Boolean(snap.compressedConversations && !job.isUserAction);

          if (useGroupScene) {
            const res = await requestGroupScene(
              snap,
              job.agentIds,
              timeInfo.fullLabel,
              job.startReason,
            );
            const stampSim = startedAtSim + res.turns.length * 1.5;
            world = applyGroupSceneResult(world, {
              participantIds: res.participantIds,
              turns: res.turns,
              summaryByAgent: res.summaryByAgent,
              emotionalShiftByAgent: res.emotionalShiftByAgent,
              tomUpdates: res.tomUpdates,
              beliefUpdatesByAgent: res.beliefUpdatesByAgent,
              bilateralDeal: res.bilateralDeal,
              gossipUpdates: res.gossipUpdates,
              memeIdsDiscussed: res.memeIdsDiscussed,
              newNews: res.newNews,
              sharedAgreement: res.sharedAgreement,
              reason: res.reason ?? job.startReason,
              stampSimMinutes: stampSim,
            });
            dayConvs += 1;
            if (res.participantIds.length > 2) dayGroupScenes += 1;
          } else {
            const [agentAId, agentBId] = job.agentIds;
            const agentA = snap.agents.find((a) => a.id === agentAId);
            const agentB = snap.agents.find((a) => a.id === agentBId);
            if (!agentA || !agentB) throw new Error('Participant not found');
            const res = await requestConversation(
              snap,
              agentA,
              agentB,
              timeInfo.fullLabel,
              job.startReason,
            );
            const stampSim = startedAtSim + res.turns.length * 1.5;
            world = applyConversationResult(world, {
              agentAId,
              agentBId,
              turns: res.turns,
              summaryA: res.summaryA,
              summaryB: res.summaryB,
              importance: res.importance,
              importanceA: res.importanceA,
              importanceB: res.importanceB,
              stampSimMinutes: stampSim,
              reason: res.reason ?? job.startReason,
              endedBy: res.endedBy,
              planUpdateA: res.planUpdateA || undefined,
              planUpdateB: res.planUpdateB || undefined,
              sharedAgreement: res.sharedAgreement,
              commitmentA: res.commitmentA,
              commitmentB: res.commitmentB,
              memeIdsDiscussedA: res.memeIdsDiscussedA,
              memeIdsDiscussedB: res.memeIdsDiscussedB,
              newNewsA: res.newNewsA,
              newNewsB: res.newNewsB,
              gossipUpdates: [
                ...(res.gossipUpdatesA ?? []),
                ...(res.gossipUpdatesB ?? []),
              ],
              accessedMemoryIdsA: res.accessedMemoryIdsA,
              accessedMemoryIdsB: res.accessedMemoryIdsB,
              emotionalShiftA: res.emotionalShiftA,
              emotionalShiftB: res.emotionalShiftB,
              tomUpdateA: res.tomUpdateA,
              tomUpdateB: res.tomUpdateB,
              beliefUpdatesA: res.beliefUpdatesA,
              beliefUpdatesB: res.beliefUpdatesB,
              bilateralDeal: res.bilateralDeal,
            });
            dayConvs += 1;
          }
        } else if (job.kind === 'decision') {
          const agentId = job.agentIds[0];
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          const tInfo = formatSimTime(snap.simMinutes);
          const res = await requestAutonomousDecision(snap, agent, tInfo.fullLabel, job.forkReason);
          world = applyAutonomousDecision(world, agentId, res.decision);
          dayDecisions += 1;
          if (res.decision.action !== 'rest' && res.decision.action !== 'work_shift') {
            dayActiveDecisions += 1;
          }
          decisionLog.push({
            day: tInfo.day,
            time: tInfo.timeLabel,
            agentId,
            agentName: agent.name,
            forkReason: job.forkReason,
            action: res.decision.action,
            rationale: res.decision.reason,
            details: {
              activity: res.decision.activity,
              locationId: res.decision.locationId,
              noticeTitle: res.decision.noticeTitle,
              proposalId: res.decision.proposalId,
              voteSupport: res.decision.voteSupport,
              loanAmount: res.decision.loanAmount,
              transferAmount: res.decision.transferAmount,
              targetAgentId: res.decision.targetAgentId,
              ventureName: res.decision.ventureName,
              petitionTitle: res.decision.petitionTitle,
              candidateId: res.decision.candidateId,
              newGoal: res.decision.newGoal,
            },
          });
        } else if (job.kind === 'reflection') {
          const agentId = job.agentIds[0];
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          const res = await requestReflection(snap, agent, formatSimTime(snap.simMinutes).fullLabel);
          world = applyReflectionResult(world, agentId, res.reflections, res.accessedMemoryIds);
          dayReflections += 1;
        } else if (job.kind === 'reaction') {
          const agentId = job.agentIds[0];
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          const tInfo = formatSimTime(snap.simMinutes);
          const partner = job.partnerId
            ? snap.agents.find((a) => a.id === job.partnerId)
            : undefined;
          const res = await requestReaction(
            snap,
            agent,
            job.observation ?? 'Notable event nearby.',
            tInfo.fullLabel,
            partner,
          );
          world = applyReactionResult(world, agentId, res);
          dayReactions += 1;
          if (res.react) dayReactionsChanged += 1;
          reactionLog.push({
            day: tInfo.day,
            time: tInfo.timeLabel,
            agentId,
            observation: job.observation ?? '',
            react: res.react,
            reason: res.reason,
            newActivity: res.newActivity,
          });
        } else if (job.kind === 'step_detail') {
          const agentId = job.agentIds[0];
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          if (job.blockId && job.blockActivity) {
            const res = await requestStepDetail(
              snap,
              agent,
              {
                activity: job.blockActivity,
                kind: (job.blockKind as ScheduleBlockKind) ?? 'work',
                durationMinutes: job.blockDuration ?? 60,
              },
              formatSimTime(snap.simMinutes).fullLabel,
            );
            world = applyBlockSubSteps(world, agentId, job.blockId, res.subSteps);
          } else {
            world = clearAgentThinkingState(world, [agentId], false);
          }
        } else if (job.kind === 'consolidation') {
          const agentId = job.agentIds[0];
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          const res = await requestSleepConsolidation(
            snap,
            agent,
            formatSimTime(snap.simMinutes).fullLabel,
          );
          world = applyConsolidationResult(world, agentId, {
            consolidatedInsights: res.consolidatedInsights,
            prunedMemoryIds: res.prunedMemoryIds,
            socialUpdates: res.socialUpdates,
          });
          dayConsolidations += 1;
        } else if (job.kind === 'morning_plan' || job.kind === 'replan') {
          const agentId = job.agentIds[0];
          const isMorning = job.kind === 'morning_plan' || Boolean(job.isMorningPlan);
          const snap = world;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found');
          const timeInfo = formatSimTime(snap.simMinutes);
          const res = await requestPlanUpdate(
            snap,
            agent,
            timeInfo.fullLabel,
            timeInfo.minuteOfDay,
            isMorning,
          );
          world = applyPlanResult(world, agentId, res, {
            isMorningPlan: isMorning,
            accessedMemoryIds: res.accessedMemoryIds,
          });
          if (isMorning) dayMorningPlans += 1;
        }

        schedulerState = markJobSucceeded(schedulerState, job, world.simMinutes, Date.now());
        dayJobsOk[job.kind] = (dayJobsOk[job.kind] ?? 0) + 1;
        totalJobsOk[job.kind] = (totalJobsOk[job.kind] ?? 0) + 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isApiErr = err instanceof ApiRequestError;
        const isRateLimit =
          (isApiErr && err.status === 429) ||
          msg.includes('429') ||
          msg.toLowerCase().includes('rate limit');
        const tInfo = formatSimTime(world.simMinutes);

        dayJobsFail[job.kind] = (dayJobsFail[job.kind] ?? 0) + 1;
        totalJobsFail[job.kind] = (totalJobsFail[job.kind] ?? 0) + 1;
        recentErrors.push({
          day: tInfo.day,
          time: tInfo.timeLabel,
          kind: job.kind,
          error: msg,
        });
        console.warn(`[EXP10 WARN D${tInfo.day} ${tInfo.timeLabel}] ${job.kind} failed: ${msg}`);

        const outcome = markJobFailed(schedulerState, job, Date.now(), world.simMinutes, msg, {
          isRateLimit,
          retryAfterMs: isApiErr && err.retryAfterSec ? err.retryAfterSec * 1000 : undefined,
        });
        schedulerState = outcome.state;
        if (outcome.shouldApplyFallbackPlan && job.agentIds[0]) {
          world = applyFallbackPlan(world, job.agentIds[0]);
          dayFallbackPlans += 1;
        } else if (outcome.shouldHalveReflectionAccumulator && job.agentIds[0]) {
          world = applyFailedReflectionFallback(world, job.agentIds[0]);
        } else {
          world = clearAgentThinkingState(world, job.agentIds, job.kind === 'conversation');
        }
      } finally {
        inFlightPromises.delete(job.id);
      }
    })();

    inFlightPromises.set(job.id, p);
  }

  // Main simulation loop (bounded by chunkEndSimMinutes for clean resumable chunks)
  while (world.simMinutes < chunkEndSimMinutes) {
    // 1. Step simulation by 1.0 sim-minute (or 0.5 during busy hours)
    const stepSize = inFlightPromises.size > 0 ? 0.5 : 1.0;
    const { nextState, triggers } = stepWorldState(world, stepSize);
    world = nextState;

    // Track 03:00 home occupancy
    const curMinFloor = Math.floor(world.simMinutes);
    if (curMinFloor > lastMinuteChecked) {
      for (let m = lastMinuteChecked + 1; m <= curMinFloor; m++) {
        const info = formatSimTime(m);
        if (info.minuteOfDay === 180 && info.day >= 2) {
          const homeCount = world.agents.filter(
            (a) => a.currentLocationId === a.homeLocationId,
          ).length;
          home0300ByDay.set(info.day, homeCount);
        }
      }
      lastMinuteChecked = curMinFloor;
    }

    // 2. Enqueue triggers & dispatch eligible jobs
    const nowMs = Date.now();
    schedulerState = enqueueTriggers(schedulerState, world, triggers, nowMs);
    const dispatched = dispatchEligibleJobs(schedulerState, world, nowMs);
    schedulerState = dispatched.state;

    if (dispatched.jobsToStart.length > 0) {
      const startedAtSim = world.simMinutes;
      for (const job of dispatched.jobsToStart) {
        if (job.kind === 'conversation' && job.agentIds.length >= 2) {
          world = startAgentConversationLock(
            world,
            job.agentIds[0],
            job.agentIds[1],
            job.agentIds.slice(2),
          );
        } else {
          const idSet = new Set(job.agentIds);
          world = {
            ...world,
            agents: world.agents.map((a) =>
              idSet.has(a.id) ? { ...a, isThinking: true } : a,
            ),
          };
        }
        launchJob(job, startedAtSim);
      }
    }

    // 3. Synchronize smoothly with real LLM latency so sim time never outruns morning plans, conversations, or consolidations
    const hasUrgentQueued = schedulerState.queue.some(
      (j) => j.kind === 'morning_plan' || j.kind === 'consolidation' || j.kind === 'conversation',
    );
    const hasCriticalInFlight = schedulerState.inFlight.some(
      (j) => j.kind === 'morning_plan' || j.kind === 'consolidation',
    );

    if (inFlightPromises.size >= MAX_CONCURRENT || (hasCriticalInFlight && inFlightPromises.size >= 4)) {
      await Promise.race(inFlightPromises.values());
    } else if (inFlightPromises.size > 0 && hasUrgentQueued) {
      await Promise.race([
        ...inFlightPromises.values(),
        new Promise((r) => setTimeout(r, 120)),
      ]);
    } else if (inFlightPromises.size === 0 && hasUrgentQueued && schedulerState.callTimestampsMs.length >= MAX_CALLS_PER_MIN - 2) {
      await new Promise((r) => setTimeout(r, 400));
    } else if (inFlightPromises.size > 0) {
      await new Promise((r) => setTimeout(r, 40));
    }

    // 4. Detect sim-day rollover (at 07:00 AM next day -> 1 full 24h day elapsed)
    const elapsedDays = Math.floor((world.simMinutes - startSimMinutes) / 1440);
    if (elapsedDays >= currentTrackedDay && currentTrackedDay <= chunkEndDay) {
      if (inFlightPromises.size > 0) {
        await Promise.allSettled(inFlightPromises.values());
      }
      await recordDaySummary(currentTrackedDay);
      currentTrackedDay += 1;
    }
  }

  // Drain any remaining in-flight jobs at chunk/run boundary
  if (inFlightPromises.size > 0) {
    await Promise.allSettled(inFlightPromises.values());
  }
  if (daySummaries.length < chunkEndDay) {
    await recordDaySummary(chunkEndDay);
  }

  const isFullyDone = world.simMinutes >= targetEndSimMinutes || daySummaries.length >= TARGET_DAYS;
  await writeCheckpoint(isFullyDone);
  console.log(
    isFullyDone
      ? `[EXP10] COMPLETE (${TARGET_DAYS}/${TARGET_DAYS} days)! Saved full report to ${OUTPUT_PATH}`
      : `[EXP10] CHUNK DONE (${daySummaries.length}/${TARGET_DAYS} days checkpointed to ${CHECKPOINT_PATH})`,
  );
}

run().catch((err) => {
  console.error('[EXP10] FATAL ERROR:', err);
  process.exit(1);
});
