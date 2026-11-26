import { AlertCircle, Box, KeyRound, Megaphone, Moon, RotateCcw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentInspector } from './components/AgentInspector';
import { AgentRosterStrip } from './components/AgentRosterStrip';
import { ArchitectureView } from './components/ArchitectureView';
import { BuildingYieldCard } from './components/BuildingYieldCard';
import { ChronicleView } from './components/ChronicleView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { ExperimentsView } from './components/ExperimentsView';
import { SmallvilleIsoCanvas } from './components/SmallvilleIsoCanvas';
import { SmallvilleMapCanvas } from './components/SmallvilleMapCanvas';
import { SocietyView } from './components/SocietyView';
import { TownAtlasPanel } from './components/TownAtlasPanel';
import { TownHeader, type WorkspaceView } from './components/TownHeader';
import {
  ApiRequestError,
  checkServerHealth,
  deleteServerWorld,
  fetchServerMetrics,
  fetchServerWorldWithStatus,
  requestArbitrateOpenAction,
  requestAutonomousDecision,
  requestConversation,
  requestEmbeddings,
  requestGroupScene,
  requestInterview,
  requestInterviewJudge,
  requestPlanUpdate,
  requestReaction,
  requestReflection,
  requestSleepConsolidation,
  requestStepDetail,
  requestWhisper,
  saveServerWorld,
  saveServerWorldWithStatus,
  type ServerHealthPayload,
} from './services/smallvilleApi';
import {
  clearCachedEmbeddings,
  formatMemoryEmbedText,
  formatQueryEmbedText,
  hashEmbeddingText,
  loadAllCachedEmbeddings,
  saveCachedEmbeddings,
} from './services/vectorStore';
import {
  clearWorldSnapshots,
  exportWorldJson,
  getAppAccessToken,
  importWorldJson,
  loadWorldFromIndexedDb,
  loadWorldSyncFallback,
  migrateWorldState,
  saveWorldSnapshot,
  setAppAccessToken,
  stripEmbeddingsForSave,
} from './services/worldStore';
import {
  buildSchedulerConfig,
  computeTimeDilationRate,
  createSchedulerState,
  dispatchEligibleJobs,
  enqueueJob,
  enqueueTriggers,
  markJobFailed,
  markJobSucceeded,
  updateSchedulerConfig,
  type CognitionJob,
  type SchedulerConfig,
  type SchedulerState,
} from './simulation/cognitionScheduler';
import {
  applyAutonomousDecision,
  applyBlockSubSteps,
  applyBroadcast,
  applyConsolidationResult,
  applyConversationResult,
  applyFailedReflectionFallback,
  applyFallbackPlan,
  applyGroupSceneResult,
  applyInterviewResult,
  applyPlanResult,
  applyReactionResult,
  applyReflectionResult,
  applyWhisperResult,
  clearAgentThinkingState,
  createInitialWorldState,
  startAgentConversationLock,
  stepWorldState,
} from './simulation/engine';
import { makeIdAllocator } from './simulation/ids';
import { signCitizenPetition } from './simulation/contractsAndLife';
import { finalizeTownElection, openTownElection } from './simulation/institutions';
import { formatSimTime } from './simulation/memory';
import { scaleWorldPopulation, setAgentCognitionTier } from './simulation/scaleGenerator';
import { createCivicProposal, postPublicNotice } from './simulation/socialFabric';
import { computeBuildingYieldCard, type MapLensId } from './simulation/spatialAnalytics';
import {
  DEFAULT_ABLATIONS,
  type AblationSettings,
  type AgentTier,
  type NoticeCategory,
  type ScenarioId,
  type ScheduleBlockKind,
  type TownModifierKey,
  type WorldState,
} from './simulation/types';
import { getCalendarInfo } from './simulation/worldEconomy';
import {
  createSmallvilleStore,
  useSmallvilleSelector,
  type SmallvilleStore,
} from './store/smallvilleStore';

function loadInitialWorldWithNotice(): { world: WorldState; notice: string | null } {
  const { world, notice } = loadWorldSyncFallback();
  if (world) {
    return { world, notice: notice ?? null };
  }
  // Default to true asymmetric two-mind conversations (separate prompts & private thoughts); 1-call scene mode remains toggleable
  return {
    world: { ...createInitialWorldState(), compressedConversations: false },
    notice: notice ?? null,
  };
}

function shallowEqualObj<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

declare global {
  interface Window {
    __SMALLVILLE_STORE__?: SmallvilleStore;
  }
}

export default function App() {
  const storeRef = useRef<{ store: SmallvilleStore; notice: string | null } | null>(null);
  if (!storeRef.current) {
    const initial = loadInitialWorldWithNotice();
    const initialScheduler = createSchedulerState(
      buildSchedulerConfig('balanced'),
      initial.world.day,
    );
    storeRef.current = {
      store: createSmallvilleStore(initial.world, initialScheduler, { tickThrottleMs: 260 }),
      notice: initial.notice,
    };
  }
  const store = storeRef.current.store;
  const worldRef = store.worldRef;
  const schedulerRef = useRef<SchedulerState>(store.getSnapshot().scheduler);

  const [activeView, setActiveView] = useState<WorkspaceView>('town');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('isabella');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [activeLens, setActiveLens] = useState<MapLensId>('normal');
  const [atlasOpen, setAtlasOpen] = useState<boolean>(false);
  const [lensMemeId, setLensMemeId] = useState<string | undefined>(undefined);
  const [lensProposalId, setLensProposalId] = useState<string | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState<{
    seq: number;
    agentId?: string;
    locationId?: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [autoCognition, setAutoCognition] = useState<boolean>(true);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [llmInfo, setLlmInfo] = useState<ServerHealthPayload | undefined>(undefined);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleFocusAgentOnMap = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setSelectedLocationId(null);
    setFocusRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, agentId }));
  }, []);

  const handleFocusLocationOnMap = useCallback((locationId: string) => {
    setAtlasOpen(false);
    setSelectedLocationId(locationId);
    setFocusRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, locationId }));
  }, []);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(storeRef.current.notice);
  const [announcementText, setAnnouncementText] = useState<string>('');
  const [showAnnouncementForm, setShowAnnouncementForm] = useState<boolean>(false);
  const [mapViewMode, setMapViewMode] = useState<'iso3d' | 'top2d'>('iso3d');

  const [accessTokenRequired, setAccessTokenRequired] = useState<boolean>(false);
  const [accessTokenInput, setAccessTokenInput] = useState<string>(() => getAppAccessToken() ?? '');

  const vecCacheRef = useRef<Map<string, number[]>>(new Map());
  const userJobResolversRef = useRef(
    new Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
      }
    >(),
  );

  // Track React UI commit rate during continuous ticks & expose store for programmatic inspection
  useEffect(() => {
    window.__SMALLVILLE_STORE__ = store;
    return () => {
      if (window.__SMALLVILLE_STORE__ === store) {
        delete window.__SMALLVILLE_STORE__;
      }
    };
  }, [store]);

  useEffect(() => {
    store.recordUiCommit();
  });

  const commitWorld = useCallback(
    (next: WorldState, immediate = true) => {
      store.setWorld(next, { immediate });
    },
    [store],
  );

  const syncScheduler = useCallback(
    (next: SchedulerState) => {
      schedulerRef.current = next;
      store.setScheduler(next);
    },
    [store],
  );

  const refreshServerHealth = useCallback(() => {
    return checkServerHealth()
      .then((res) => {
        setAccessTokenRequired(false);
        setLlmConfigured(res.llmConfigured);
        setLlmInfo(res);
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.requiresAccessToken) {
          setAccessTokenRequired(true);
          setApiError('Server requires an access token (x-app-token). Enter it above to connect.');
        }
        setLlmConfigured(false);
      });
  }, []);

  // Poll /api/metrics every 8s when connected so Architecture & CognitionPanel stay live
  useEffect(() => {
    if (!llmConfigured) return;
    let cancelled = false;
    const poll = () => {
      fetchServerMetrics()
        .then((metrics) => {
          if (!cancelled) {
            store.setServerMetrics(metrics);
          }
        })
        .catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [llmConfigured, store]);

  // Hydrate browser IndexedDB world snapshot + dense vector cache (no server overwrite on startup)
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [idbLoaded, vecMap] = await Promise.all([
          loadWorldFromIndexedDb(),
          loadAllCachedEmbeddings(),
        ]);
        if (cancelled) return;

        let base = worldRef.current;
        if (idbLoaded.world && idbLoaded.world.simMinutes >= base.simMinutes) {
          base = idbLoaded.world;
        }
        if (idbLoaded.notice) {
          setMigrationNotice(idbLoaded.notice);
        }

        if (vecMap.size > 0) {
          vecCacheRef.current = vecMap;
          const hydratedAgents = await Promise.all(
            base.agents.map(async (ag) => ({
              ...ag,
              memories: await Promise.all(
                ag.memories.map(async (m) => {
                  if (m.embedding && m.embedding.length > 0) return m;
                  const h = await hashEmbeddingText(formatMemoryEmbedText(m.description));
                  const cached = vecMap.get(h);
                  return cached ? { ...m, embedding: cached } : m;
                }),
              ),
            })),
          );
          if (cancelled) return;
          base = { ...base, agents: hydratedAgents };
        }

        if (base !== worldRef.current) {
          commitWorld(base, true);
        }
      } catch {
        // Fallback already initialized synchronously
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [commitWorld, worldRef]);

  // Periodic background persistence to IndexedDB (+ server if ENABLE_SERVER_SAVES=true)
  useEffect(() => {
    const saveTimer = setInterval(() => {
      const snap = worldRef.current;
      saveWorldSnapshot(snap).catch(() => undefined);
      if (llmInfo?.serverSavesEnabled) {
        saveServerWorld(snap).catch(() => undefined);
      }
    }, 10_000);
    return () => clearInterval(saveTimer);
  }, [llmInfo?.serverSavesEnabled, worldRef]);

  useEffect(() => {
    refreshServerHealth();
  }, [refreshServerHealth]);

  const executeJob = useCallback(
    async (job: CognitionJob, startedAtSim: number) => {
      const resolver = userJobResolversRef.current.get(job.id);
      const clearResolver = () => {
        userJobResolversRef.current.delete(job.id);
      };

      try {
        let userResult: unknown = undefined;

        if (job.kind === 'conversation') {
          const snap = worldRef.current;
          const timeInfo = formatSimTime(snap.simMinutes);
          const useGroupScene =
            job.agentIds.length > 2 ||
            (job.compressed !== false &&
              (Boolean(job.compressed) || Boolean(snap.compressedConversations && !job.isUserAction)));

          if (useGroupScene) {
            const res = await requestGroupScene(
              snap,
              job.agentIds,
              timeInfo.fullLabel,
              job.startReason,
              Boolean(job.privateGroup),
            );
            const stampSim = startedAtSim + res.turns.length * 1.5;
            const updated = applyGroupSceneResult(worldRef.current, {
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
            commitWorld(updated, true);
          } else {
            const [agentAId, agentBId] = job.agentIds;
            const agentA = snap.agents.find((a) => a.id === agentAId);
            const agentB = snap.agents.find((a) => a.id === agentBId);
            if (!agentA || !agentB) {
              throw new Error('Conversation participant not found.');
            }
            const res = await requestConversation(
              snap,
              agentA,
              agentB,
              timeInfo.fullLabel,
              job.startReason,
            );
            const stampSim = startedAtSim + res.turns.length * 1.5;
            const updated = applyConversationResult(worldRef.current, {
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
            commitWorld(updated, true);
          }
        } else if (job.kind === 'decision') {
          const agentId = job.agentIds[0];
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const res = await requestAutonomousDecision(
            snap,
            agent,
            formatSimTime(snap.simMinutes).fullLabel,
            job.forkReason,
          );
          let decision = res.decision;
          if (decision.action === 'open_action' && decision.openIntent && (!decision.openOps || decision.openOps.length === 0)) {
            try {
              const arb = await requestArbitrateOpenAction(
                snap,
                agent,
                decision.openIntent,
                formatSimTime(snap.simMinutes).fullLabel,
              );
              if (arb.ops && arb.ops.length > 0) {
                decision = { ...decision, openOps: arb.ops };
              }
            } catch {
              // Offline conservation compiler in applyAutonomousDecision handles fallback seamlessly
            }
          }
          commitWorld(
            applyAutonomousDecision(worldRef.current, agentId, decision, {
              deferUntilArrival: true,
            }),
            true,
          );
        } else if (job.kind === 'reflection') {
          const agentId = job.agentIds[0];
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const res = await requestReflection(snap, agent, formatSimTime(snap.simMinutes).fullLabel);
          commitWorld(
            applyReflectionResult(
              worldRef.current,
              agentId,
              res.reflections,
              res.accessedMemoryIds,
            ),
            true,
          );
        } else if (job.kind === 'reaction') {
          const agentId = job.agentIds[0];
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const partner = job.partnerId
            ? snap.agents.find((a) => a.id === job.partnerId)
            : undefined;
          const res = await requestReaction(
            snap,
            agent,
            job.observation ?? 'Notable event nearby.',
            formatSimTime(snap.simMinutes).fullLabel,
            partner,
          );
          commitWorld(applyReactionResult(worldRef.current, agentId, res), true);
        } else if (job.kind === 'step_detail') {
          const agentId = job.agentIds[0];
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
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
            commitWorld(
              applyBlockSubSteps(worldRef.current, agentId, job.blockId, res.subSteps),
              true,
            );
          } else {
            commitWorld(clearAgentThinkingState(worldRef.current, [agentId], false), true);
          }
        } else if (job.kind === 'consolidation') {
          const agentId = job.agentIds[0];
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const res = await requestSleepConsolidation(
            snap,
            agent,
            formatSimTime(snap.simMinutes).fullLabel,
          );
          commitWorld(
            applyConsolidationResult(worldRef.current, agentId, {
              consolidatedInsights: res.consolidatedInsights,
              prunedMemoryIds: res.prunedMemoryIds,
              socialUpdates: res.socialUpdates,
            }),
            true,
          );
        } else if (job.kind === 'morning_plan' || job.kind === 'replan') {
          const agentId = job.agentIds[0];
          const isMorning = job.kind === 'morning_plan' || Boolean(job.isMorningPlan);
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const timeInfo = formatSimTime(snap.simMinutes);
          const res = await requestPlanUpdate(
            snap,
            agent,
            timeInfo.fullLabel,
            timeInfo.minuteOfDay,
            isMorning,
          );
          commitWorld(
            applyPlanResult(worldRef.current, agentId, res, {
              isMorningPlan: isMorning,
              accessedMemoryIds: res.accessedMemoryIds,
            }),
            true,
          );
        } else if (job.kind === 'interview') {
          const agentId = job.agentIds[0];
          const question = job.question ?? '';
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const res = await requestInterview(
            snap,
            agent,
            question,
            formatSimTime(snap.simMinutes).fullLabel,
          );
          commitWorld(
            applyInterviewResult(worldRef.current, agentId, question, res, res.accessedMemoryIds),
            true,
          );
          userResult = { answer: res.answer, citedMemoryIds: res.citedMemoryIds };
        } else if (job.kind === 'whisper') {
          const agentId = job.agentIds[0];
          const thought = job.thought ?? '';
          const snap = worldRef.current;
          const agent = snap.agents.find((a) => a.id === agentId);
          if (!agent) throw new Error('Resident not found.');
          const res = await requestWhisper(
            snap,
            agent,
            thought,
            formatSimTime(snap.simMinutes).fullLabel,
          );
          commitWorld(
            applyWhisperResult(worldRef.current, agentId, thought, res, res.accessedMemoryIds),
            true,
          );
        }

        const nowMs = Date.now();
        syncScheduler(markJobSucceeded(schedulerRef.current, job, worldRef.current.simMinutes, nowMs));
        if (job.isUserAction) {
          store.clearActionStatus(`${job.kind}:${job.agentIds[0] ?? ''}`);
        }
        if (resolver) {
          resolver.resolve(userResult);
          clearResolver();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'LLM job failed.';
        const isApiErr = err instanceof ApiRequestError;

        if (isApiErr && err.requiresAccessToken) {
          setAccessTokenRequired(true);
        }

        const isProviderDailyQuota =
          isApiErr && err.code === 'PROVIDER_DAILY_QUOTA_EXHAUSTED';
        const isDailyCap =
          (isApiErr && err.code === 'DAILY_BUDGET_REACHED') || isProviderDailyQuota;
        const isRateLimit =
          !isDailyCap &&
          ((isApiErr && err.status === 429) ||
            msg.includes('429') ||
            msg.toLowerCase().includes('rate limit'));

        if (isDailyCap) {
          setAutoCognition(false);
          setApiError(
            isProviderDailyQuota
              ? `${msg} — Auto-LLM paused until provider quota resets.`
              : 'Daily budget reached — Auto-LLM paused for safety.',
          );
        } else {
          setApiError(msg);
        }

        const nowMs = Date.now();
        const outcome = markJobFailed(
          schedulerRef.current,
          job,
          nowMs,
          worldRef.current.simMinutes,
          msg,
          {
            isRateLimit,
            retryAfterMs:
              isApiErr && err.retryAfterSec ? err.retryAfterSec * 1000 : undefined,
          },
        );
        syncScheduler(outcome.state);
        if (job.isUserAction) {
          store.setActionFailed(`${job.kind}:${job.agentIds[0] ?? ''}`, msg, nowMs);
        }

        if (outcome.shouldApplyFallbackPlan && job.agentIds[0]) {
          commitWorld(applyFallbackPlan(worldRef.current, job.agentIds[0]), true);
        } else if (outcome.shouldHalveReflectionAccumulator && job.agentIds[0]) {
          commitWorld(applyFailedReflectionFallback(worldRef.current, job.agentIds[0]), true);
        } else {
          commitWorld(
            clearAgentThinkingState(
              worldRef.current,
              job.agentIds,
              job.kind === 'conversation',
            ),
            true,
          );
        }

        if (resolver) {
          resolver.reject(err);
          clearResolver();
        }
      }
    },
    [commitWorld, store, syncScheduler, worldRef],
  );

  const dispatchAndRunJobs = useCallback(
    (nowMs = Date.now()) => {
      const dispatched = dispatchEligibleJobs(schedulerRef.current, worldRef.current, nowMs);
      syncScheduler(dispatched.state);
      if (dispatched.jobsToStart.length === 0) return;

      let nextWorld = worldRef.current;
      const startedAtSim = nextWorld.simMinutes;
      for (const job of dispatched.jobsToStart) {
        if (job.kind === 'conversation' && job.agentIds.length >= 2) {
          nextWorld = startAgentConversationLock(
            nextWorld,
            job.agentIds[0],
            job.agentIds[1],
            job.agentIds.slice(2),
          );
        } else {
          const idSet = new Set(job.agentIds);
          nextWorld = {
            ...nextWorld,
            agents: nextWorld.agents.map((a) =>
              idSet.has(a.id) ? { ...a, isThinking: true } : a,
            ),
          };
        }
      }
      commitWorld(nextWorld, true);

      for (const job of dispatched.jobsToStart) {
        executeJob(job, startedAtSim);
      }
    },
    [commitWorld, executeJob, syncScheduler, worldRef],
  );

  const enqueueUserJob = useCallback(
    <T,>(params: {
      kind: CognitionJob['kind'];
      agentIds: string[];
      expectedCalls: number;
      isMorningPlan?: boolean;
      question?: string;
      thought?: string;
    }): Promise<T> => {
      setApiError(null);
      store.clearActionStatus(`${params.kind}:${params.agentIds[0] ?? ''}`);
      const prevSeq = schedulerRef.current.nextJobSeq;
      const jobId = `job_${params.kind}_${prevSeq}`;

      const promise = new Promise<T>((resolve, reject) => {
        userJobResolversRef.current.set(jobId, {
          resolve: resolve as (v: unknown) => void,
          reject,
        });
      });

      const updated = enqueueJob(schedulerRef.current, {
        ...params,
        nowMs: Date.now(),
        simMinutes: worldRef.current.simMinutes,
        isUserAction: true,
      });
      syncScheduler(updated);
      dispatchAndRunJobs(Date.now());
      return promise;
    },
    [dispatchAndRunJobs, store, syncScheduler, worldRef],
  );

  const handleResetScenario = useCallback(
    (scenarioId: ScenarioId = 'default', ablations: AblationSettings = DEFAULT_ABLATIONS) => {
      clearWorldSnapshots().catch(() => undefined);
      if (llmInfo?.serverSavesEnabled) {
        deleteServerWorld().catch(() => undefined);
      }
      clearCachedEmbeddings().catch(() => undefined);
      userJobResolversRef.current.clear();
      const fresh = {
        ...createInitialWorldState(scenarioId, ablations),
        compressedConversations: false,
      };
      syncScheduler(createSchedulerState(schedulerRef.current.config, fresh.day));
      commitWorld(fresh, true);
      setSelectedLocationId(null);
      setApiError(null);
      setMigrationNotice(
        scenarioId === 'paper_valentine'
          ? 'Loaded Paper Benchmark Scenario: Isabella preparing Valentine’s Day party at Hobbs Cafe & Sam considering mayoral run.'
          : null,
      );
    },
    [commitWorld, llmInfo?.serverSavesEnabled, syncScheduler],
  );

  const handleResetTown = useCallback(() => {
    handleResetScenario(worldRef.current.scenarioId ?? 'default', worldRef.current.ablations);
  }, [handleResetScenario, worldRef]);

  const handleToggleAblation = useCallback(
    (key: keyof AblationSettings, enabled: boolean) => {
      const curr = worldRef.current;
      const nextAblations: AblationSettings = {
        ...DEFAULT_ABLATIONS,
        ...(curr.ablations ?? {}),
        [key]: enabled,
      };
      commitWorld({ ...curr, ablations: nextAblations }, true);
    },
    [commitWorld, worldRef],
  );

  const handleConversation = useCallback(
    async (agentAId: string, agentBId: string) => {
      try {
        await enqueueUserJob<void>({
          kind: 'conversation',
          agentIds: [agentAId, agentBId],
          expectedCalls: 4,
        });
      } catch {
        // Error state tracked cleanly via actionStates + apiError banner
      }
    },
    [enqueueUserJob],
  );

  const handleReflection = useCallback(
    async (agentId: string) => {
      try {
        await enqueueUserJob<void>({
          kind: 'reflection',
          agentIds: [agentId],
          expectedCalls: 2,
        });
      } catch {
        // Handled via actionStates + apiError
      }
    },
    [enqueueUserJob],
  );

  const handleConsolidation = useCallback(
    async (agentId: string) => {
      try {
        await enqueueUserJob<void>({
          kind: 'consolidation',
          agentIds: [agentId],
          expectedCalls: 1,
        });
      } catch {
        // Handled via actionStates + apiError
      }
    },
    [enqueueUserJob],
  );

  const handleReplan = useCallback(
    async (agentId: string, isMorningPlan = false) => {
      try {
        await enqueueUserJob<void>({
          kind: 'replan',
          agentIds: [agentId],
          expectedCalls: 1,
          isMorningPlan,
        });
      } catch {
        // Handled via actionStates + apiError
      }
    },
    [enqueueUserJob],
  );

  const handleInterview = useCallback(
    async (agentId: string, question: string) => {
      try {
        return await enqueueUserJob<{ answer: string; citedMemoryIds: string[] }>({
          kind: 'interview',
          agentIds: [agentId],
          expectedCalls: 1,
          question,
        });
      } catch {
        return null;
      }
    },
    [enqueueUserJob],
  );

  const handleJudgeInterview = useCallback(
    async (
      agentId: string,
      question: string,
      answer: string,
      targetWorld?: WorldState,
    ): Promise<{ score: number; rationale: string } | null> => {
      const worldForJudge = targetWorld ?? worldRef.current;
      const agent = worldForJudge.agents.find((a) => a.id === agentId);
      if (!agent) return null;
      try {
        return await requestInterviewJudge(
          worldForJudge,
          agent,
          question,
          answer,
          formatSimTime(worldForJudge.simMinutes).fullLabel,
        );
      } catch (err) {
        setApiError(err instanceof Error ? err.message : 'Interview judging failed.');
        return null;
      }
    },
    [worldRef],
  );

  const handleWhisper = useCallback(
    async (agentId: string, thought: string) => {
      try {
        await enqueueUserJob<void>({
          kind: 'whisper',
          agentIds: [agentId],
          expectedCalls: 1,
          thought,
        });
      } catch {
        // Handled via actionStates + apiError
      }
    },
    [enqueueUserJob],
  );

  const handleSemanticSearch = useCallback(
    async (agentId: string, query: string): Promise<number[] | null> => {
      const world = worldRef.current;
      const agent = world.agents.find((a) => a.id === agentId);
      if (!agent) return null;

      setApiError(null);
      try {
        const unembedded = agent.memories
          .filter((m) => !m.embedding || m.embedding.length === 0)
          .slice(0, 20);
        const prefixedQuery = formatQueryEmbedText(query);
        const prefixedMemories = unembedded.map((m) => formatMemoryEmbedText(m.description));
        const vectors = await requestEmbeddings([prefixedQuery, ...prefixedMemories]);
        const queryVec = vectors[0] ?? [];

        if (unembedded.length > 0 && vectors.length > 1) {
          const idToVec = new Map<string, number[]>();
          const toCache: Array<{ hash: string; vector: number[] }> = [];
          await Promise.all(
            unembedded.map(async (m, idx) => {
              const vec = vectors[idx + 1];
              if (vec?.length) {
                idToVec.set(m.id, vec);
                const hash = await hashEmbeddingText(prefixedMemories[idx]);
                vecCacheRef.current.set(hash, vec);
                toCache.push({ hash, vector: vec });
              }
            }),
          );
          saveCachedEmbeddings(toCache).catch(() => undefined);
          commitWorld(
            {
              ...worldRef.current,
              agents: worldRef.current.agents.map((a) =>
                a.id === agentId
                  ? {
                      ...a,
                      memories: a.memories.map((m) =>
                        idToVec.has(m.id) ? { ...m, embedding: idToVec.get(m.id) } : m,
                      ),
                    }
                  : a,
              ),
            },
            true,
          );
        }
        return queryVec;
      } catch (err) {
        setApiError(
          err instanceof Error ? err.message : 'Failed to compute semantic embeddings.',
        );
        return null;
      }
    },
    [commitWorld, worldRef],
  );

  // Main simulation tick loop (canvas reads worldRef @ 60fps; React listeners throttled <= 4Hz)
  useEffect(() => {
    if (!isPlaying) {
      store.setDilationRate(1);
      return;
    }

    const TICK_MS = 100;
    const interval = setInterval(() => {
      const nowMs = Date.now();
      const curDilation = computeTimeDilationRate(worldRef.current, schedulerRef.current, nowMs);
      store.setDilationRate(curDilation);

      const deltaSimMin = (TICK_MS / 650) * speed * curDilation;
      const { nextState, triggers } = stepWorldState(worldRef.current, deltaSimMin);
      store.setWorld(nextState, { immediate: false, nowMs });

      // Zero-quota local BM25-IDF + Entity Boost retrieval is active automatically;
      // manual "Embed Query" in AgentInspector still invokes /api/agent/embed on demand without background 429 noise.

      if (autoCognition && llmConfigured) {
        const enqueued = enqueueTriggers(schedulerRef.current, worldRef.current, triggers, nowMs);
        if (enqueued !== schedulerRef.current) {
          syncScheduler(enqueued);
        }
        dispatchAndRunJobs(nowMs);
      } else if (schedulerRef.current.queue.length > 0 && llmConfigured) {
        dispatchAndRunJobs(nowMs);
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [
    isPlaying,
    speed,
    autoCognition,
    llmConfigured,
    dispatchAndRunJobs,
    store,
    syncScheduler,
    worldRef,
  ]);

  const handleStepForward = () => {
    let curr = worldRef.current;
    for (let i = 0; i < 3; i++) {
      curr = stepWorldState(curr, 5).nextState;
    }
    commitWorld(curr, true);
  };

  const handleJumpToTime = (hour: number, minute: number, label: string) => {
    const curr = worldRef.current;
    const alloc = makeIdAllocator(curr.idSeq ?? 1);
    const dayBase = Math.floor(curr.simMinutes / 1440) * 1440;
    let targetMin = dayBase + hour * 60 + minute;
    if (targetMin <= curr.simMinutes) {
      targetMin += 1440;
    }
    const jumped = { ...curr, idSeq: alloc.seq(), simMinutes: targetMin };
    const { nextState } = stepWorldState(jumped, 0.5);
    const jumpAlloc = makeIdAllocator(nextState.idSeq ?? 1);
    const jumpEvent = {
      id: jumpAlloc.next('chr_jump'),
      simMinutes: targetMin,
      type: 'world_event' as const,
      title: label,
      detail: `Residents transitioned to their ${formatSimTime(targetMin).timeLabel} schedules across Smallville.`,
      agentIds: [],
      locationName: 'Smallville',
    };
    commitWorld(
      {
        ...nextState,
        idSeq: jumpAlloc.seq(),
        chronicle: [jumpEvent, ...nextState.chronicle].slice(0, 80),
      },
      true,
    );
  };

  const handleBroadcastEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const text = announcementText.trim();
    if (!text) return;
    commitWorld(applyBroadcast(worldRef.current, text), true);
    setAnnouncementText('');
    setShowAnnouncementForm(false);
  };

  const handleUpdateSchedulerConfig = useCallback(
    (nextConfig: SchedulerConfig) => {
      syncScheduler(updateSchedulerConfig(schedulerRef.current, nextConfig));
    },
    [syncScheduler],
  );

  const handleExportWorld = useCallback(() => {
    const { filename, content } = exportWorldJson(worldRef.current);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [worldRef]);

  const handleImportWorldFile = useCallback(
    (jsonText: string) => {
      const { world, notice } = importWorldJson(jsonText);
      if (!world) {
        setApiError(notice ?? 'Could not import town snapshot.');
        return;
      }
      userJobResolversRef.current.clear();
      syncScheduler(createSchedulerState(schedulerRef.current.config, world.day));
      commitWorld(world, true);
      saveWorldSnapshot(world).catch(() => undefined);
      setSelectedLocationId(null);
      setApiError(null);
      setMigrationNotice(notice ?? 'Imported saved Smallville world.');
    },
    [commitWorld, syncScheduler],
  );

  const handleSaveAccessToken = (e: React.FormEvent) => {
    e.preventDefault();
    setAppAccessToken(accessTokenInput);
    setApiError(null);
    refreshServerHealth();
  };

  // Selective store subscriptions (keeps continuous 1x ticks <= 4 Hz UI commits cleanly)
  const worldSnapshot = useSmallvilleSelector(store, (s) => s.world);
  const schedulerSnapshot = useSmallvilleSelector(store, (s) => s.scheduler);
  const dilationRate = useSmallvilleSelector(store, (s) => s.dilationRate);
  const actionStates = useSmallvilleSelector(store, (s) => s.actionStates);
  const serverMetrics = useSmallvilleSelector(store, (s) => s.serverMetrics);
  const tokenPrices = useSmallvilleSelector(store, (s) => s.tokenPrices);

  const handlePostNotice = useCallback(
    (params: { title: string; body: string; category: NoticeCategory; locationId?: string }) => {
      const curr = worldRef.current;
      const alloc = makeIdAllocator(curr.idSeq ?? 1);
      const next = postPublicNotice(
        curr,
        {
          authorId: 'citizen_observer',
          authorName: 'Town Gazette',
          category: params.category,
          title: params.title,
          body: params.body,
          locationId: params.locationId,
        },
        alloc.next,
      );
      commitWorld({ ...next, idSeq: alloc.seq() }, true);
    },
    [commitWorld, worldRef],
  );

  const handleCreateProposal = useCallback(
    (params: { title: string; description: string; cost: number; effectKey: TownModifierKey }) => {
      const curr = worldRef.current;
      const alloc = makeIdAllocator(curr.idSeq ?? 1);
      const next = createCivicProposal(
        curr,
        {
          proposerId: 'citizen_observer',
          proposerName: 'Community Member',
          title: params.title,
          description: params.description,
          cost: params.cost,
          effectKey: params.effectKey,
        },
        alloc.next,
      );
      commitWorld({ ...next, idSeq: alloc.seq() }, true);
    },
    [commitWorld, worldRef],
  );

  const handleToggleCompressedScenes = useCallback(
    (enabled: boolean) => {
      commitWorld({ ...worldRef.current, compressedConversations: enabled }, true);
    },
    [commitWorld, worldRef],
  );

  const handleScalePopulation = useCallback(
    (targetCount: number) => {
      const next = scaleWorldPopulation(worldRef.current, targetCount);
      commitWorld(next, true);
      saveWorldSnapshot(next).catch(() => undefined);
    },
    [commitWorld, worldRef],
  );

  const handleSetAgentTier = useCallback(
    (agentId: string, tier: AgentTier) => {
      const next = setAgentCognitionTier(worldRef.current, agentId, tier);
      commitWorld(next, true);
    },
    [commitWorld, worldRef],
  );

  const handleOpenElection = useCallback(() => {
    const curr = worldRef.current;
    const alloc = makeIdAllocator(curr.idSeq ?? 1);
    const next = openTownElection(curr, alloc.next);
    commitWorld({ ...next, idSeq: alloc.seq() }, true);
  }, [commitWorld, worldRef]);

  const handleFinalizeElection = useCallback(() => {
    const curr = worldRef.current;
    const alloc = makeIdAllocator(curr.idSeq ?? 1);
    const next = finalizeTownElection(curr, alloc.next, true);
    commitWorld({ ...next, idSeq: alloc.seq() }, true);
  }, [commitWorld, worldRef]);

  const handleSponsorPetition = useCallback(
    (petitionId: string) => {
      const curr = worldRef.current;
      const pet = (curr.petitions ?? []).find(
        (p) => p.id === petitionId && p.status === 'gathering',
      );
      if (!pet) return;
      const candidate = curr.agents.find((a) => !pet.signerIds.includes(a.id));
      if (!candidate) return;
      const alloc = makeIdAllocator(curr.idSeq ?? 1);
      const res = signCitizenPetition(curr, candidate.id, petitionId, alloc.next, false);
      commitWorld({ ...res.world, idSeq: alloc.seq() }, true);
    },
    [commitWorld, worldRef],
  );

  const handleSaveServerSnapshot = useCallback(async () => {
    const compact = stripEmbeddingsForSave(worldRef.current);
    const res = await saveServerWorldWithStatus(compact);
    return res.message;
  }, [worldRef]);

  const handleLoadServerSnapshot = useCallback(async () => {
    const res = await fetchServerWorldWithStatus();
    if (!res.world) return res.message;
    const migrated = migrateWorldState(res.world);
    if (!migrated.world) return migrated.notice ?? 'Server snapshot could not be migrated.';
    commitWorld(migrated.world, true);
    saveWorldSnapshot(migrated.world).catch(() => undefined);
    return migrated.notice ?? res.message;
  }, [commitWorld]);

  const headerSlice = useSmallvilleSelector(
    store,
    (s) => {
      const t = formatSimTime(s.world.simMinutes);
      const cal = getCalendarInfo(s.world.simMinutes);
      return {
        worldName: s.world.worldName ?? 'Smallville',
        weekdayShort: cal.weekdayShort,
        timeLabel: t.timeLabel,
        day: t.day,
        dilationRate: s.dilationRate,
      };
    },
    shallowEqualObj,
  );

  const selectedAgent = useMemo(
    () => worldSnapshot.agents.find((a) => a.id === selectedAgentId) ?? worldSnapshot.agents[0],
    [worldSnapshot.agents, selectedAgentId],
  );

  const selectedBuildingYield = useMemo(
    () =>
      selectedLocationId
        ? computeBuildingYieldCard(worldSnapshot, selectedLocationId)
        : null,
    [worldSnapshot, selectedLocationId],
  );

  const latestChronicle = worldSnapshot.chronicle[0];
  const isLlmBusy = schedulerSnapshot.inFlight.length > 0;
  const consolidationStatus = actionStates[`consolidation:${selectedAgent.id}`]?.status;

  return (
    <div
      data-state={isPlaying ? 'playing' : 'paused'}
      className="flex min-h-screen flex-col bg-[#F6F4EE] text-[#1D2420] lg:h-screen lg:overflow-hidden"
    >
      <TownHeader
        activeView={activeView}
        onSelectView={setActiveView}
        worldName={headerSlice.worldName}
        weekdayShort={headerSlice.weekdayShort}
        timeLabel={headerSlice.timeLabel}
        day={headerSlice.day}
        dilationRate={headerSlice.dilationRate}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        speed={speed}
        onSelectSpeed={setSpeed}
        onStepForward={handleStepForward}
      />

      {accessTokenRequired && (
        <form
          onSubmit={handleSaveAccessToken}
          className="flex flex-wrap items-center gap-2 border-b border-[#D97706]/30 bg-[#FFFBEB] px-5 py-2 text-xs text-[#92400E]"
        >
          <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">Server access token required:</span>
          <input
            type="password"
            value={accessTokenInput}
            onChange={(e) => setAccessTokenInput(e.target.value)}
            placeholder="Paste APP_ACCESS_TOKEN"
            className="rounded border border-[#D97706]/40 bg-white px-2.5 py-1 text-xs text-[#1D2420]"
          />
          <button
            type="submit"
            className="rounded bg-[#92400E] px-3 py-1 text-xs font-medium text-white hover:bg-[#78350F]"
          >
            Save &amp; Connect
          </button>
        </form>
      )}

      {migrationNotice && (
        <div className="flex items-center justify-between gap-3 border-b border-[#2D6A4F]/20 bg-[#EAF2ED] px-5 py-2 text-xs text-[#1B4332]">
          <span>{migrationNotice}</span>
          <button
            type="button"
            onClick={() => setMigrationNotice(null)}
            aria-label="Dismiss migration notice"
            className="rounded p-1 hover:bg-[#D7E6DC]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {apiError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[#DC2626]/30 bg-[#FEF2F2] px-5 py-2 text-xs text-[#991B1B]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{apiError}</span>
          </div>
          <button
            type="button"
            onClick={() => setApiError(null)}
            aria-label="Dismiss error"
            className="rounded p-1 hover:bg-[#FEE2E2]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {activeView === 'town' && (
        <main className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
          {/* Left Stage: Resident Strip + Interactive 2D Town Canvas + Bottom Scenario Bar */}
          <div className="flex flex-col lg:min-h-0 lg:min-w-0 lg:flex-1">
            <AgentRosterStrip
              agents={worldSnapshot.agents}
              locations={worldSnapshot.locations}
              selectedAgentId={selectedAgent.id}
              onSelectAgent={(id) => {
                setSelectedAgentId(id);
                setSelectedLocationId(null);
              }}
            />

            <div className="relative h-[44vh] min-h-[290px] w-full shrink-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
              {mapViewMode === 'iso3d' ? (
                <SmallvilleIsoCanvas
                  worldRef={worldRef}
                  selectedAgentId={selectedAgent.id}
                  onSelectAgent={(id) => {
                    setSelectedAgentId(id);
                    setSelectedLocationId(null);
                  }}
                  selectedLocationId={selectedLocationId}
                  onSelectLocation={(locId) => {
                    if (locId) setAtlasOpen(false);
                    setSelectedLocationId(locId);
                  }}
                  activeLens={activeLens}
                  lensMemeId={lensMemeId}
                  lensProposalId={lensProposalId}
                  onChangeLens={setActiveLens}
                  atlasOpen={atlasOpen}
                  onToggleAtlas={() =>
                    setAtlasOpen((v) => {
                      const next = !v;
                      if (next) setSelectedLocationId(null);
                      return next;
                    })
                  }
                  focusRequest={focusRequest}
                  onSwitchTo2D={() => setMapViewMode('top2d')}
                />
              ) : (
                <>
                  <SmallvilleMapCanvas
                    worldRef={worldRef}
                    selectedAgentId={selectedAgent.id}
                    onSelectAgent={(id) => {
                      setSelectedAgentId(id);
                      setSelectedLocationId(null);
                    }}
                    selectedLocationId={selectedLocationId}
                    onSelectLocation={setSelectedLocationId}
                  />
                  <button
                    type="button"
                    onClick={() => setMapViewMode('iso3d')}
                    title="Switch to 3D Isometric Diorama view"
                    className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5 rounded-lg border border-[#D5D0C3] bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#1D2420] shadow-md hover:bg-[#EFECE3] transition-colors whitespace-nowrap"
                  >
                    <Box className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                    <span>3D Isometric</span>
                  </button>
                </>
              )}

              {/* Civ-Style Building Yield Card Overlay */}
              {selectedBuildingYield && (
                <BuildingYieldCard
                  data={selectedBuildingYield}
                  onClose={() => setSelectedLocationId(null)}
                  onSelectAgent={handleFocusAgentOnMap}
                />
              )}

              {/* Spatial Town Atlas Drawer (18-Resident Pictograms, Advisors & Linked Explorer) */}
              {atlasOpen && (
                <TownAtlasPanel
                  world={worldSnapshot}
                  selectedAgentId={selectedAgent.id}
                  activeMemeId={lensMemeId}
                  activeProposalId={lensProposalId}
                  onChangeMemeId={setLensMemeId}
                  onChangeProposalId={setLensProposalId}
                  onFocusAgent={handleFocusAgentOnMap}
                  onFocusLocation={handleFocusLocationOnMap}
                  onActivateLens={setActiveLens}
                  onClose={() => setAtlasOpen(false)}
                />
              )}
            </div>

            {/* Bottom Town Controls & Latest Event Bar */}
            <div className="shrink-0 border-t border-[#E2DFD5] bg-[#FAF8F4] px-4 py-2.5">
              <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="shrink-0 font-mono text-[11px] text-[#5C645E] capitalize tabular-nums">
                    {worldSnapshot.weather ?? 'clear'} · {worldSnapshot.agents.length} Residents
                  </span>
                  {latestChronicle && (
                    <button
                      type="button"
                      onClick={() => setActiveView('chronicle')}
                      className="truncate text-left text-xs text-[#3C4640] hover:text-[#1D2420] min-w-0"
                    >
                      <span aria-hidden="true" className="mr-2 text-[#9BA29C]">
                        |
                      </span>
                      <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
                        {formatSimTime(latestChronicle.simMinutes).timeLabel}
                      </span>
                      <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                        ·
                      </span>
                      <span className="font-medium text-[#1D2420]">
                        {latestChronicle.title}
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                  <button
                    type="button"
                    onClick={() =>
                      handleJumpToTime(17, 0, 'Valentine’s Day Party Begins at Hobbs Cafe')
                    }
                    className="rounded border border-[#D5D0C3] bg-white px-2.5 py-1 text-xs font-medium text-[#2F3833] hover:bg-[#EFECE3] transition-colors whitespace-nowrap shrink-0"
                  >
                    Jump to 5:00 PM Party
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConsolidation(selectedAgent.id)}
                    className="flex items-center gap-1 rounded border border-[#D5D0C3] bg-white px-2.5 py-1 text-xs font-medium text-[#2F3833] hover:bg-[#EFECE3] transition-colors whitespace-nowrap shrink-0"
                  >
                    <Moon className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                    <span>
                      {consolidationStatus === 'queued'
                        ? 'Queued…'
                        : consolidationStatus === 'running'
                          ? 'Running…'
                          : 'Sleep Cycle'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAnnouncementForm((v) => !v)}
                    className="flex items-center gap-1 rounded border border-[#D5D0C3] bg-white px-2.5 py-1 text-xs font-medium text-[#2F3833] hover:bg-[#EFECE3] transition-colors whitespace-nowrap shrink-0"
                  >
                    <Megaphone className="h-3.5 w-3.5 text-[#B45309]" aria-hidden="true" />
                    <span>Announce</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={autoCognition}
                    onClick={() => setAutoCognition((v) => !v)}
                    className={`flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      autoCognition
                        ? 'border-[#2D6A4F] bg-[#EAF2ED] text-[#1B4332]'
                        : 'border-[#D5D0C3] bg-white text-[#5C645E]'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Auto-LLM {autoCognition ? 'On' : 'Off'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetTown}
                    aria-label="Reset Town"
                    title="Reset Smallville to Day 1 · 9:00 AM"
                    className="flex items-center gap-1 rounded border border-[#D5D0C3] bg-white px-2 py-1 text-xs font-medium text-[#5C645E] hover:bg-[#EFECE3] hover:text-[#1D2420] transition-colors whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              {showAnnouncementForm && (
                <form
                  onSubmit={handleBroadcastEvent}
                  className="mt-2.5 flex items-center gap-2 border-t border-[#E5E2D9] pt-2.5"
                >
                  <label htmlFor="town-announcement-input" className="sr-only">
                    Town bulletin announcement
                  </label>
                  <input
                    id="town-announcement-input"
                    type="text"
                    value={announcementText}
                    onChange={(e) => setAnnouncementText(e.target.value)}
                    placeholder="Broadcast news to every resident’s Memory Stream (e.g. Sam Moore announced his run for mayor!)"
                    className="flex-1 rounded-md border border-[#D5D0C3] bg-white px-3 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-[#B45309] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#92400E] transition-colors whitespace-nowrap shrink-0"
                  >
                    Post Bulletin
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Right Panel: Deep Agent Cognitive Inspector */}
          <div className="w-full shrink-0 border-t border-[#E2DFD5] lg:h-full lg:w-[420px] lg:border-t-0">
            <AgentInspector
              agent={selectedAgent}
              allAgents={worldSnapshot.agents}
              locations={worldSnapshot.locations}
              conversations={worldSnapshot.conversations}
              loans={worldSnapshot.loans}
              simMinutes={worldSnapshot.simMinutes}
              reflectionThreshold={worldSnapshot.reflectionThreshold}
              isBusy={isLlmBusy}
              actionStates={actionStates}
              onTriggerReflection={handleReflection}
              onTriggerConsolidation={handleConsolidation}
              onTriggerReplan={handleReplan}
              onTriggerConversation={handleConversation}
              onSemanticSearch={handleSemanticSearch}
              onInterviewAgent={handleInterview}
              onWhisperAgent={handleWhisper}
              onChangeTier={handleSetAgentTier}
            />
          </div>
        </main>
      )}

      {activeView === 'chronicle' && (
        <main className="min-h-0 flex-1 overflow-y-auto smallville-scroll">
          <ChronicleView
            chronicle={worldSnapshot.chronicle}
            conversations={worldSnapshot.conversations}
            agents={worldSnapshot.agents}
            onSelectAgentAndMap={(agentId) => {
              setSelectedAgentId(agentId);
              setActiveView('town');
            }}
          />
        </main>
      )}

      {activeView === 'society' && (
        <main className="min-h-0 flex-1 overflow-y-auto smallville-scroll">
          <SocietyView
            world={worldSnapshot}
            llmCallsToday={schedulerSnapshot.callsToday}
            onSelectAgentAndMap={(agentId) => {
              setSelectedAgentId(agentId);
              setActiveView('town');
            }}
            onPostNotice={handlePostNotice}
            onCreateProposal={handleCreateProposal}
            onToggleCompressedScenes={handleToggleCompressedScenes}
            onScalePopulation={handleScalePopulation}
            onOpenElection={handleOpenElection}
            onFinalizeElection={handleFinalizeElection}
            onSponsorPetition={handleSponsorPetition}
          />
        </main>
      )}

      {activeView === 'experiments' && (
        <main className="min-h-0 flex-1 overflow-y-auto smallville-scroll">
          <ExperimentsView
            world={worldSnapshot}
            llmConfigured={llmConfigured}
            onResetScenario={handleResetScenario}
            onToggleAblation={handleToggleAblation}
            onInterviewAgent={handleInterview}
            onJudgeInterview={handleJudgeInterview}
            onSelectAgentAndMap={(agentId) => {
              setSelectedAgentId(agentId);
              setActiveView('town');
            }}
          />
        </main>
      )}

      {activeView === 'architecture' && (
        <main className="min-h-0 flex-1 overflow-y-auto smallville-scroll">
          <ArchitectureView
            world={worldSnapshot}
            llmInfo={llmInfo}
            schedulerState={schedulerSnapshot}
            dilationRate={dilationRate}
            serverMetrics={serverMetrics}
            tokenPrices={tokenPrices}
            onChangeTokenPrices={store.setTokenPrices}
            onUpdateSchedulerConfig={handleUpdateSchedulerConfig}
            onExportWorld={handleExportWorld}
            onImportWorldFile={handleImportWorldFile}
          />
        </main>
      )}

      {activeView === 'diagnostics' && (
        <main className="min-h-0 flex-1 overflow-y-auto smallville-scroll">
          <DiagnosticsView
            world={worldSnapshot}
            serverSavesEnabled={Boolean(llmInfo?.serverSavesEnabled)}
            onSaveServerSnapshot={handleSaveServerSnapshot}
            onLoadServerSnapshot={handleLoadServerSnapshot}
          />
        </main>
      )}
    </div>
  );
}
