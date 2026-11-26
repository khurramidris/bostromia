import {
  getAreaLabelAt,
  getLocationAt,
  hasLineOfSightOverTiles,
  MAP_HEIGHT,
  MAP_WIDTH,
  SMALLVILLE_LOCATIONS,
  SMALLVILLE_OBJECTS,
  buildSmallvilleTiles,
} from './mapData';
import { makeIdAllocator } from './ids';
import {
  COMMITMENT_MAX_MINUTE,
  COMMITMENT_MIN_MINUTE,
  generateRuleSubSteps,
  validateAndRepairPlanBlocks,
} from './llmJson';
import {
  compactMemories,
  containsWholeWordOrPhrase,
  createMemoryNode,
  extractKeywords,
  formatSimTime,
  markAccessed,
  REFLECTION_THRESHOLD,
  scoreImportance,
  shouldTriggerReflection,
} from './memory';
import { findNearestWalkableTile, findPath } from './pathfinding';
import {
  applyEmotionalAppraisal,
  buildSystem1Greeting,
  detectUrgentDrive,
  evaluateEncounterSalience,
  stepAgentDrives,
  stepMoodState,
  updateSocialEdge,
} from './psychology';
import {
  createScenarioAgents,
  createScenarioChronicle,
  createScenarioMemes,
  createSeedAgents,
} from './seedAgents';
import {
  applyBdiDecisionResult,
  detectBdiDecisionFork,
  executePendingBdiAction,
  type BdiDecisionTrigger,
} from './autonomy';
import {
  applyAmbientOverhearing,
  applyGossipUpdates,
  castCivicVote,
  createInitialNotices,
  createInitialProposals,
  scanNoticeBoardForAgent,
} from './socialFabric';
import {
  advanceAgentProject,
  applyDailyEconomicRollover,
  computeResidentReputation,
  createInitialBusinesses,
  DEFAULT_TOWN_MODIFIERS,
  executeConsumeItemAction,
  executePurchaseAction,
  executeWorkShiftTick,
  findNearestOpenFoodVenue,
  getCalendarInfo,
  hydrateAgentsEconomyAndProjects,
} from './worldEconomy';
import {
  applyDailyInstitutionalRollover,
  computeMacroSnapshot,
  createInitialClubs,
  createInitialElection,
  createInitialJobPostings,
  createInitialLeadership,
  hydrateInstitutionalFields,
  stepHealthAndClinic,
  stepSocialClubs,
  stepTownElection,
} from './institutions';
import { buildSpatialGrid } from './spatialIndex';
import {
  applyTrustGatedBeliefUpdate,
  attachAssociativeLinks,
  hydrateCognitiveDepth,
} from './cognitiveDepth';
import {
  applyDailyContractsAndLifeRollover,
  applyNegotiatedDeal,
  createInitialPetitions,
  hydrateHousingAndCareers,
  stepMicroVentures,
} from './contractsAndLife';
import { computeDiversitySnapshot } from './diversityMetrics';
import {
  applyDailyEpistemicAndCultureRollover,
  createInitialCulturalNorms,
} from './epistemicCulture';
import { hydrateWorldIntentStacks, syncAgentCommitments } from './intentStack';
import { applyDailyPowerAndInstitutionsRollover } from './powerAndInstitutions';
import { buildProceduralSchedule, getProceduralSocialHub } from './scaleGenerator';
import {
  DEFAULT_ABLATIONS,
  DEFAULT_MEMORY_CAP,
  WORLD_SCHEMA_VERSION,
  type AblationSettings,
  type AgentState,
  type BdiDecisionResult,
  type ChronicleEvent,
  type ConversationAgreement,
  type ConversationRecord,
  type ConversationTurn,
  type ExtractedBeliefUpdate,
  type GossipUpdate,
  type MemoryNode,
  type NegotiatedDeal,
  type PartyPresenceStats,
  type ScenarioId,
  type ScheduleBlock,
  type ScheduleBlockKind,
  type ScheduleCommitment,
  type TrackedMeme,
  type WeatherCondition,
  type WorldObject,
  type WorldState,
} from './types';

export const INITIAL_SIM_MINUTES = 9 * 60; // Day 1, 9:00 AM
export const CONVERSATION_COOLDOWN_SIM_MIN = 45;
export const CONVERSATION_RADIUS_TILES = 2.4;

export function getHomeBedObjectId(
  homeLocationId: string,
  objects: WorldObject[] = SMALLVILLE_OBJECTS,
): string | undefined {
  return objects.find((o) => o.locationId === homeLocationId && o.kind === 'bed')?.id;
}

export function computeWeatherForSimMinutes(simMinutes: number): WeatherCondition {
  const hourBlock = Math.floor(Math.max(0, simMinutes) / 180); // smooth 3-hour weather shifts
  const cycle = [
    'clear',
    'clear',
    'breeze',
    'clear',
    'drizzle',
    'breeze',
    'clear',
    'breeze',
  ] as const;
  return cycle[hourBlock % cycle.length];
}

export function createInitialPartyStats(): PartyPresenceStats {
  return {
    minutesAtCafeByAgent: {},
    invitedAgentIds: [],
    agreedAgentIds: [],
    plannedAfterNewsAgentIds: [],
    attendedRawIds: [],
    attendedDecisionIds: [],
  };
}

export function createInitialWorldState(
  scenarioId: ScenarioId = 'default',
  ablations: AblationSettings = DEFAULT_ABLATIONS,
): WorldState {
  const tiles = buildSmallvilleTiles();
  const rawAgents = createScenarioAgents(scenarioId, INITIAL_SIM_MINUTES);
  const businesses = createInitialBusinesses(SMALLVILLE_LOCATIONS, rawAgents);
  const econAgents = hydrateAgentsEconomyAndProjects(
    rawAgents,
    SMALLVILLE_LOCATIONS,
    businesses,
    INITIAL_SIM_MINUTES,
  );
  const clubs = createInitialClubs(econAgents);
  const instAgents = hydrateInstitutionalFields(econAgents, clubs);
  const initAlloc = makeIdAllocator(1);
  const deepAgents = hydrateCognitiveDepth(instAgents, INITIAL_SIM_MINUTES, initAlloc.next);
  const agents = hydrateWorldIntentStacks(
    hydrateHousingAndCareers(deepAgents, SMALLVILLE_LOCATIONS),
    INITIAL_SIM_MINUTES,
    initAlloc.next,
  );
  const leadership = createInitialLeadership(agents);
  const election = createInitialElection(agents, 7);
  const jobPostings = createInitialJobPostings(businesses, INITIAL_SIM_MINUTES);
  const chronicle = createScenarioChronicle(scenarioId, INITIAL_SIM_MINUTES);
  const memes = createScenarioMemes(scenarioId, INITIAL_SIM_MINUTES);
  const notices = createInitialNotices(SMALLVILLE_LOCATIONS, agents, INITIAL_SIM_MINUTES);
  const proposals = createInitialProposals(agents, INITIAL_SIM_MINUTES);
  const petitions = createInitialPetitions(agents, INITIAL_SIM_MINUTES);

  const base: WorldState = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    worldName: 'Smallville',
    scenarioId,
    ablations: { ...ablations },
    idSeq: initAlloc.seq(),
    simMinutes: INITIAL_SIM_MINUTES,
    day: 1,
    weather: computeWeatherForSimMinutes(INITIAL_SIM_MINUTES),
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    tiles,
    locations: SMALLVILLE_LOCATIONS,
    objects: SMALLVILLE_OBJECTS.map((o) => ({ ...o })),
    agents,
    businesses,
    transactions: [],
    notices,
    proposals,
    loans: [],
    petitions,
    ventures: [],
    letters: [],
    autonomyMode: 'intent_driven',
    serviceContracts: [],
    disputes: [],
    coalitions: [],
    boycotts: [],
    activeShocks: [],
    rumors: [],
    culturalNorms: createInitialCulturalNorms(1),
    diversityHistory: [],
    townTreasury: 380,
    townModifiers: { ...DEFAULT_TOWN_MODIFIERS },
    compressedConversations: false,
    jobPostings,
    clubs,
    election,
    leadership,
    macroHistory: [],
    scaleTarget: agents.length,
    conversations: [],
    chronicle,
    memes,
    stats: {
      system1Greetings: 0,
      driveInterrupts: 0,
      perceptionEvents: 0,
      socialCommitments: 0,
      llmCallsSaved: 0,
      llmCallsMade: 0,
      tokensUsed: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      economicTransactions: 0,
      totalTradeVolume: 0,
      noticesRead: 0,
      civicVotesCast: 0,
      overheardEvents: 0,
      gossipUpdatesApplied: 0,
      bdiDecisions: 0,
      compressedScenes: 0,
      jobsFilled: 0,
      clinicTreatments: 0,
      electionsCompleted: 0,
      clubGatherings: 0,
      loansIssued: 0,
      loansDefaulted: 0,
      petitionsEscalated: 0,
      venturesLaunched: 0,
      housingMoves: 0,
      careerPromotions: 0,
      beliefRevisions: 0,
      refusalsAndDisagreements: 0,
      serviceContractsCreated: 0,
      serviceContractsFulfilled: 0,
      serviceContractsBreached: 0,
      disputesFiled: 0,
      disputesResolved: 0,
      coalitionsFormed: 0,
      boycottsActive: 0,
      shocksTriggered: 0,
      rumorsSpread: 0,
      rumorsDebunked: 0,
      deceptionsAttempted: 0,
      deceptionsExposed: 0,
      normEndorsements: 0,
    },
    reflectionThreshold: REFLECTION_THRESHOLD,
    reactionsTodayByAgent: {},
    reactionDay: 1,
    lastReactionSimByAgent: {},
    partyStats: createInitialPartyStats(),
  };

  base.macroHistory = [computeMacroSnapshot(base)];
  base.diversityHistory = [computeDiversitySnapshot(base)];

  return stepWorldState(base, 0.05).nextState;
}

function makeSyntheticSleepBlock(
  day: number,
  startMinute: number,
  endMinute: number,
  homeLocationId: string,
  homeBedObjectId?: string,
): ScheduleBlock {
  return {
    id: `sleep_home_${day}_${startMinute}`,
    day,
    kind: 'sleep',
    startMinute,
    durationMinutes: Math.max(15, endMinute - startMinute),
    locationId: homeLocationId,
    objectId: homeBedObjectId,
    activity: 'Sleeping peacefully at home',
    emoji: '🛏️',
    source: 'seed',
  };
}

/**
 * Resolves the active block ONLY from blocks matching `day`.
 * Before a day's first block or after its last block ends (or if empty), returns
 * a synthetic `kind: 'sleep'` block at the resident's home bed.
 */
export function getActiveScheduleBlock(
  schedule: ScheduleBlock[],
  day: number,
  minuteOfDay: number,
  homeLocationId = 'lin_home',
  homeBedObjectId?: string,
): ScheduleBlock | undefined {
  const dayBlocks = schedule
    .filter((b) => b.day === day)
    .sort((a, b) => a.startMinute - b.startMinute);

  if (dayBlocks.length === 0) {
    return makeSyntheticSleepBlock(day, 0, 1440, homeLocationId, homeBedObjectId);
  }

  const earliestStart = dayBlocks[0].startMinute;
  const latestEnd = dayBlocks.reduce(
    (mx, b) => Math.max(mx, b.startMinute + b.durationMinutes),
    0,
  );

  if (minuteOfDay < earliestStart) {
    return makeSyntheticSleepBlock(day, 0, earliestStart, homeLocationId, homeBedObjectId);
  }

  if (minuteOfDay >= latestEnd) {
    return makeSyntheticSleepBlock(day, latestEnd, 1440, homeLocationId, homeBedObjectId);
  }

  const matching = dayBlocks.filter(
    (b) => minuteOfDay >= b.startMinute && minuteOfDay < b.startMinute + b.durationMinutes,
  );
  if (matching.length > 0) {
    const priority = (b: ScheduleBlock) =>
      b.source === 'drive_interrupt'
        ? 4
        : b.fixed || b.source === 'social_commitment'
          ? 3
          : b.source === 'llm_replan'
            ? 2
            : b.source === 'morning_plan'
              ? 1
              : 0;
    return [...matching].sort((a, b) => priority(b) - priority(a))[0];
  }

  for (let i = dayBlocks.length - 1; i >= 0; i--) {
    if (minuteOfDay >= dayBlocks[i].startMinute) return dayBlocks[i];
  }
  return dayBlocks[0];
}

/**
 * Inserts or overrides a ScheduleBlock ONLY on its matching `day` without
 * disturbing other days or dropping existing fixed commitments.
 */
export function patchScheduleWithBlock(
  schedule: ScheduleBlock[],
  incoming: ScheduleBlock,
): ScheduleBlock[] {
  const inEnd = incoming.startMinute + incoming.durationMinutes;
  let rejectedByFixed = false;
  const kept = schedule.filter((existing) => {
    if (existing.day !== incoming.day) return true;
    const exEnd = existing.startMinute + existing.durationMinutes;
    const overlaps = existing.startMinute < inEnd && exEnd > incoming.startMinute;
    if (!overlaps) return true;
    if (existing.fixed && !incoming.fixed && incoming.source !== 'drive_interrupt') {
      rejectedByFixed = true;
      return true;
    }
    if (incoming.source !== 'drive_interrupt' && existing.source === 'drive_interrupt') {
      return true;
    }
    return false;
  });

  const next = rejectedByFixed ? kept : [...kept, incoming];
  return next.sort((a, b) => a.day - b.day || a.startMinute - b.startMinute);
}

/**
 * Residents may converse only if within radius AND either in the same non-null zone
 * or both outdoors with clear tile line-of-sight (Bresenham, no wall tiles between).
 */
export function canAgentsConverse(
  context: { tiles: WorldState['tiles']; locations: WorldState['locations'] },
  a: Pick<AgentState, 'x' | 'y' | 'currentLocationId'>,
  b: Pick<AgentState, 'x' | 'y' | 'currentLocationId'>,
): boolean {
  if (a.currentLocationId !== b.currentLocationId) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (
    dx > CONVERSATION_RADIUS_TILES ||
    dx < -CONVERSATION_RADIUS_TILES ||
    dy > CONVERSATION_RADIUS_TILES ||
    dy < -CONVERSATION_RADIUS_TILES
  ) {
    return false;
  }
  if (dx * dx + dy * dy > CONVERSATION_RADIUS_TILES * CONVERSATION_RADIUS_TILES) {
    return false;
  }
  if (a.currentLocationId !== null) {
    return true;
  }
  return hasLineOfSightOverTiles(context.tiles, a.x, a.y, b.x, b.y);
}

function resolveSubStep(block: ScheduleBlock | undefined, minuteOfDay: number): string | undefined {
  if (!block?.subSteps || block.subSteps.length === 0) return undefined;
  const elapsed = Math.max(0, minuteOfDay - block.startMinute);
  const ratio = Math.min(0.999, elapsed / Math.max(1, block.durationMinutes));
  const idx = Math.floor(ratio * block.subSteps.length);
  return block.subSteps[idx];
}

function describeOccupiedObjectState(
  obj: WorldObject,
  agent: AgentState,
  block?: ScheduleBlock,
): string {
  const first = agent.name.split(' ')[0];
  switch (obj.kind) {
    case 'counter':
      return `${first} at the counter (${block?.activity ?? 'serving patrons'})`;
    case 'piano':
      return `${first} playing motifs on the upright piano`;
    case 'podium':
      return `${first} reviewing civic notices at the podium`;
    case 'easel':
      return `${first} sketching & painting at the easel`;
    case 'bar':
      return `${first} tending the mahogany bar`;
    case 'stove':
      return `${first} preparing warm food in the kitchen`;
    case 'oven':
      return `${first} pulling golden loaves from the brick hearth`;
    case 'workbench':
      return `${first} working tools steadily (${block?.activity ?? 'craftwork'})`;
    case 'garden':
      return `${first} tending raised garden beds and soil`;
    case 'archive':
      return `${first} cataloging volumes in the oak archive`;
    case 'medical':
      return `${first} consulting wellness notes in the clinic bay`;
    case 'bed':
      return `${first} resting peacefully`;
    default:
      return `in use by ${first}`;
  }
}

function describePersistentObjectNote(
  obj: WorldObject,
  agent: AgentState,
  block?: ScheduleBlock,
): string | undefined {
  const first = agent.name.split(' ')[0];
  switch (obj.kind) {
    case 'counter':
      return obj.locationId === 'hobbs_cafe'
        ? `Fresh espresso & pastries prepared by ${first}`
        : obj.locationId === 'oakridge_bakery'
          ? `Warm trays of croissants & honey tarts glazed by ${first}`
          : `Freshly arranged stock tended by ${first}`;
    case 'piano':
      return `Hand-annotated sheet music left open by ${first}`;
    case 'podium':
      return `${first}'s Town Hall remarks & flyers pinned at the podium`;
    case 'easel':
      return `Fresh paint & sketchbook studies left on the easel by ${first}`;
    case 'desk':
      return `Highlighted notes from "${block?.activity ?? 'study session'}" by ${first}`;
    case 'bar':
      return `Glasses polished & trivia cards set by ${first}`;
    case 'oven':
      return `Warm sourdough batches & flour dusting left by ${first}`;
    case 'workbench':
      return `Cedar shavings & freshly oiled tools set by ${first}`;
    case 'garden':
      return `Freshly watered heirloom beds tended by ${first}`;
    case 'archive':
      return `Ledger bookmarks & town chronology folders left by ${first}`;
    case 'medical':
      return `Prepared herbal tea & clinic checkup notes by ${first}`;
    default:
      return undefined;
  }
}

function resolveDayBlockCollision(
  seedBlock: ScheduleBlock,
  fixedToday: ScheduleBlock[],
): boolean {
  const sEnd = seedBlock.startMinute + seedBlock.durationMinutes;
  return fixedToday.some((f) => {
    const fEnd = f.startMinute + f.durationMinutes;
    return f.startMinute < sEnd && fEnd > seedBlock.startMinute;
  });
}

export interface ReactionTrigger {
  agentId: string;
  observation: string;
  partnerId?: string;
}

export interface StepDetailRequest {
  agentId: string;
  blockId: string;
  activity: string;
  kind: ScheduleBlockKind;
  durationMinutes: number;
}

export interface StepTriggers {
  conversationPairs: Array<[string, string]>;
  conversationReasons?: Record<string, string>;
  groupParticipantsByPair?: Record<string, string[]>;
  reflectionAgentIds: string[];
  morningPlanAgentIds: string[];
  reactionTriggers: ReactionTrigger[];
  stepDetailRequests: StepDetailRequest[];
  decisionTriggers?: BdiDecisionTrigger[];
}

/**
 * Pure simulation step:
 * 1. Advances clock, handles midnight day rollover, dated blocks, and queued speech bubbles.
 * 2. Walks A* paths & performs natural intra-location roaming.
 * 3. Updates homeostatic drives strictly by ScheduleBlock.kind + location, and PAD mood.
 * 4. Emits stay-based perception (updating in place for routine stays, separating salient arrivals/traces).
 * 5. Gates encounters with same-zone / outdoor Bresenham LoS + System-1/System-2 salience.
 */
export function stepWorldState(
  prevState: WorldState,
  deltaSimMinutes: number,
  walkTilesPerSimMinute = 2.4,
): { nextState: WorldState; triggers: StepTriggers } {
  const alloc = makeIdAllocator(prevState.idSeq ?? 1);
  const nextSimMinutes = prevState.simMinutes + deltaSimMinutes;
  const timeInfo = formatSimTime(nextSimMinutes);
  const isNewDay = timeInfo.day > prevState.day;
  const seedByAgentId = isNewDay
    ? new Map(
        createScenarioAgents(prevState.scenarioId ?? 'default', nextSimMinutes).map((s) => [
          s.id,
          s,
        ]),
      )
    : null;
  const reactionDay = prevState.reactionDay ?? prevState.day;
  const reactionsTodayByAgent =
    reactionDay !== timeInfo.day ? {} : { ...(prevState.reactionsTodayByAgent ?? {}) };
  const lastReactionSimByAgent = { ...(prevState.lastReactionSimByAgent ?? {}) };
  const reactionTriggers: ReactionTrigger[] = [];
  const stepDetailRequests: StepDetailRequest[] = [];

  const nextWeather = computeWeatherForSimMinutes(nextSimMinutes);
  const prevWeather = prevState.weather ?? computeWeatherForSimMinutes(prevState.simMinutes);
  const newChronicle: ChronicleEvent[] = [];
  if (nextWeather !== prevWeather) {
    newChronicle.push({
      id: alloc.next(`chr_wx_${Math.round(nextSimMinutes)}`),
      simMinutes: nextSimMinutes,
      type: 'world_event',
      title:
        nextWeather === 'drizzle'
          ? 'Light afternoon rain began over Smallville'
          : nextWeather === 'breeze'
            ? 'Crisp valley breeze swept across Main Street'
            : 'Clear skies returned over Willows Creek',
      detail:
        nextWeather === 'drizzle'
          ? 'Residents spending time outdoors feel cooler temperatures and tend to gather indoors.'
          : 'Comfortable walking weather across North Ridge, Main Street, and Southside Creek.',
      agentIds: [],
      locationName: 'Smallville Weather',
    });
  }
  const nextStats = {
    ...(prevState.stats ?? {
      system1Greetings: 0,
      driveInterrupts: 0,
      perceptionEvents: 0,
      socialCommitments: 0,
      llmCallsSaved: 0,
      llmCallsMade: 0,
      tokensUsed: 0,
    }),
  };

  const origObjectById = new Map<string, WorldObject>();
  const homeBedByLocation = new Map<string, string>();
  for (const obj of prevState.objects) {
    origObjectById.set(obj.id, obj);
    if (obj.kind === 'bed' && !homeBedByLocation.has(obj.locationId)) {
      homeBedByLocation.set(obj.locationId, obj.id);
    }
  }
  const mutatedObjects = new Map<string, WorldObject>();
  const getObjectRead = (id: string): WorldObject | undefined =>
    mutatedObjects.get(id) ?? origObjectById.get(id);
  const getObjectMut = (id: string): WorldObject | undefined => {
    let m = mutatedObjects.get(id);
    if (!m) {
      const orig = origObjectById.get(id);
      if (!orig) return undefined;
      m = { ...orig };
      mutatedObjects.set(id, m);
    }
    return m;
  };
  const prevAgentById = new Map(prevState.agents.map((a) => [a.id, a]));
  const locationById = new Map(prevState.locations.map((l) => [l.id, l]));
  const activeBlockByAgent = new Map<string, ScheduleBlock | undefined>();

  const nextAgents: AgentState[] = prevState.agents.map((agent) => {
    const updated: AgentState = { ...agent };

    // 1. Speech bubbles + sequenced multi-turn bubble queue
    if (updated.speechBubble && nextSimMinutes >= updated.speechBubble.expiresAtSimMin) {
      updated.speechBubble = undefined;
    }
    if (updated.speechBubbleQueue && updated.speechBubbleQueue.length > 0) {
      const remainingQueue = updated.speechBubbleQueue.filter(
        (q) => nextSimMinutes < q.expiresAtSimMin,
      );
      const dueIdx = remainingQueue.findIndex((q) => nextSimMinutes >= q.showAtSimMin);
      if (dueIdx >= 0) {
        const dueItem = remainingQueue[dueIdx];
        updated.speechBubble = {
          text: dueItem.text,
          speakerName: dueItem.speakerName,
          expiresAtSimMin: dueItem.expiresAtSimMin,
        };
        updated.speechBubbleQueue = remainingQueue.filter((_, idx) => idx !== dueIdx);
      } else {
        updated.speechBubbleQueue = remainingQueue;
      }
    }

    // 2. Midnight day rollover + expiring finished drive_interrupts
    if (isNewDay) {
      const priorWorkBlock = updated.dailySchedule.find((b) => b.kind === 'work');
      const futureOrToday = updated.dailySchedule.filter((b) => b.day >= timeInfo.day);
      const hasPlannedToday = futureOrToday.some(
        (b) => b.day === timeInfo.day && !b.fixed && b.source !== 'drive_interrupt',
      );
      if (!hasPlannedToday && seedByAgentId) {
        const seedAg = seedByAgentId.get(updated.id);
        const fixedToday = futureOrToday.filter((b) => b.day === timeInfo.day && b.fixed);
        let routineCopies: ScheduleBlock[];
        if (seedAg) {
          routineCopies = (seedAg.dailySchedule ?? [])
            .filter((b) => !b.oneOff)
            .filter((b) => !resolveDayBlockCollision(b, fixedToday))
            .map((b) => {
              const hiredElsewhere =
                b.kind === 'work' &&
                updated.employerLocationId &&
                updated.employerLocationId !== seedAg.employerLocationId;
              const targetLocId = hiredElsewhere ? updated.employerLocationId! : b.locationId;
              const workplaceObj = hiredElsewhere
                ? prevState.objects.find((o) => o.locationId === targetLocId && o.kind !== 'bed')?.id
                : b.objectId;
              return {
                ...b,
                id: alloc.next(`sched_${updated.id}`),
                day: timeInfo.day,
                locationId: targetLocId,
                objectId: workplaceObj,
                source: 'seed' as const,
              };
            });
        } else {
          const idMatch = /^citizen_(\d+)$/.exec(updated.id);
          const procIdx = idMatch
            ? Math.max(0, Number(idMatch[1]) - 1)
            : updated.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
          const workLocationId =
            updated.employerLocationId ??
            priorWorkBlock?.locationId ??
            updated.homeLocationId;
          const socialLocationId = getProceduralSocialHub(procIdx + 2);
          const procBlocks = buildProceduralSchedule({
            agentId: updated.id,
            day: timeInfo.day,
            homeLocationId: updated.homeLocationId,
            workLocationId,
            socialLocationId,
            occupation: updated.occupation,
            workEmoji: priorWorkBlock?.emoji ?? '💼',
            homeBedId: homeBedByLocation.get(updated.homeLocationId),
            shiftOffsetMin: procIdx * 11,
            allocId: alloc.next,
          });
          routineCopies = procBlocks.filter((b) => !resolveDayBlockCollision(b, fixedToday));
        }
        updated.dailySchedule = [...futureOrToday, ...routineCopies].sort(
          (a, b) => a.day - b.day || a.startMinute - b.startMinute,
        );
      } else {
        updated.dailySchedule = futureOrToday;
      }
      updated.activeScheduleId = undefined;
    }

    if (
      updated.dailySchedule.some(
        (b) =>
          b.source === 'drive_interrupt' &&
          (b.day < timeInfo.day ||
            (b.day === timeInfo.day && timeInfo.minuteOfDay >= b.startMinute + b.durationMinutes)),
      )
    ) {
      updated.dailySchedule = updated.dailySchedule.filter(
        (b) =>
          !(
            b.source === 'drive_interrupt' &&
            (b.day < timeInfo.day ||
              (b.day === timeInfo.day && timeInfo.minuteOfDay >= b.startMinute + b.durationMinutes))
          ),
      );
    }

    // Hold position and face conversation partner while conversation job is active
    if (updated.inConversationWith) {
      const partner = prevAgentById.get(updated.inConversationWith);
      if (partner) {
        const pdx = partner.x - updated.x;
        const pdy = partner.y - updated.y;
        if (Math.abs(pdx) >= Math.abs(pdy) && Math.abs(pdx) > 0.05) {
          updated.facing = pdx >= 0 ? 'right' : 'left';
        } else if (Math.abs(pdy) > 0.05) {
          updated.facing = pdy >= 0 ? 'down' : 'up';
        }
      }
      if (!updated.isThinking) {
        updated.inConversationWith = undefined;
        updated.conversationStartedAtSim = undefined;
      }
    }

    const homeBedId = homeBedByLocation.get(updated.homeLocationId);
    const preBlock = getActiveScheduleBlock(
      updated.dailySchedule,
      timeInfo.day,
      timeInfo.minuteOfDay,
      updated.homeLocationId,
      homeBedId,
    );
    const isSleepHours =
      preBlock?.kind === 'sleep' ||
      timeInfo.minuteOfDay < 360 ||
      timeInfo.minuteOfDay >= 1350;

    // Autonomous Closed-Loop Drive Interrupts (sleep-safe + dated oneOff blocks)
    const locForDrive = getLocationAt(prevState.locations, updated.x, updated.y);
    const cooldownOk = nextSimMinutes - (updated.lastDriveInterruptSimMin ?? -999) >= 95;
    if (!updated.isThinking && !updated.inConversationWith) {
      if (isSleepHours) {
        if (updated.drives.hunger < 45) {
          const nightKey =
            timeInfo.hour24 < 12 ? Math.max(1, timeInfo.day - 1) : timeInfo.day;
          if ((updated.lastBreakfastScheduledNightDay ?? 0) < nightKey) {
            const wakeDay = timeInfo.minuteOfDay < 390 ? timeInfo.day : timeInfo.day + 1;
            const breakfastBlock: ScheduleBlock = {
              id: alloc.next(`drive_bkfst_${updated.id}`),
              day: wakeDay,
              kind: 'meal',
              oneOff: true,
              startMinute: 390,
              durationMinutes: 40,
              locationId: updated.homeLocationId,
              activity: 'Having a nourishing morning breakfast at home',
              subSteps: ['Making tea & toast', 'Eating a calm breakfast'],
              emoji: '🥞',
              source: 'drive_interrupt',
            };
            updated.dailySchedule = patchScheduleWithBlock(
              updated.dailySchedule,
              breakfastBlock,
            );
            updated.lastBreakfastScheduledNightDay = nightKey;
          }
        }
      } else if (cooldownOk) {
        if (
          updated.drives.hunger < 22 &&
          locForDrive?.category !== 'cafe' &&
          locForDrive?.category !== 'pub' &&
          locForDrive?.id !== updated.homeLocationId
        ) {
          const foodVenue = findNearestOpenFoodVenue(prevState, updated);
          const mealBlock: ScheduleBlock = {
            id: alloc.next(`drive_eat_${updated.id}`),
            day: timeInfo.day,
            kind: 'meal',
            oneOff: true,
            startMinute: timeInfo.minuteOfDay,
            durationMinutes: 35,
            locationId: foodVenue.locationId,
            objectId: foodVenue.objectId,
            activity: foodVenue.isHome
              ? `Cooking a budget-friendly meal at ${foodVenue.locationName}`
              : `Buying a warm meal at ${foodVenue.locationName}`,
            subSteps: foodVenue.isHome
              ? ['Preparing pantry groceries', 'Eating a quiet meal at home']
              : ['Ordering food & coffee', 'Sitting down to refuel'],
            emoji: foodVenue.isHome ? '🍲' : '🥐',
            source: 'drive_interrupt',
          };
          updated.dailySchedule = patchScheduleWithBlock(updated.dailySchedule, mealBlock);
          updated.lastDriveInterruptSimMin = nextSimMinutes;
          updated.activeScheduleId = undefined;
          nextStats.driveInterrupts += 1;
          newChronicle.push({
            id: alloc.next(`chr_drive_${updated.id}`),
            simMinutes: nextSimMinutes,
            type: 'plan',
            title: `${updated.name.split(' ')[0]} detoured to ${foodVenue.locationName} for food`,
            detail: `Low hunger (${Math.round(updated.drives.hunger)}/100) triggered a spontaneous meal detour${foodVenue.isHome ? ' (home pantry)' : ` ($${foodVenue.price})`}.`,
            agentIds: [updated.id],
            locationName: foodVenue.locationName,
          });
        } else if (updated.drives.energy < 18 && locForDrive?.id !== updated.homeLocationId) {
          const homeLoc = prevState.locations.find((l) => l.id === updated.homeLocationId);
          const restBlock: ScheduleBlock = {
            id: alloc.next(`drive_rest_${updated.id}`),
            day: timeInfo.day,
            kind: 'rest',
            oneOff: true,
            startMinute: timeInfo.minuteOfDay,
            durationMinutes: 60,
            locationId: updated.homeLocationId,
            objectId: homeBedId,
            activity: `Heading back to ${homeLoc?.shortName ?? 'home'} to rest`,
            subSteps: ['Winding down quietly', 'Recharging energy'],
            emoji: '🛌',
            source: 'drive_interrupt',
          };
          updated.dailySchedule = patchScheduleWithBlock(updated.dailySchedule, restBlock);
          updated.lastDriveInterruptSimMin = nextSimMinutes;
          updated.activeScheduleId = undefined;
          nextStats.driveInterrupts += 1;
          newChronicle.push({
            id: alloc.next(`chr_rest_${updated.id}`),
            simMinutes: nextSimMinutes,
            type: 'plan',
            title: `${updated.name.split(' ')[0]} headed home to rest`,
            detail: `Low energy (${Math.round(updated.drives.energy)}/100) triggered a rest break.`,
            agentIds: [updated.id],
            locationName: homeLoc?.name ?? 'Home',
          });
        }
      }
    }

    const schedulePatched = updated.dailySchedule !== agent.dailySchedule;
    const activeBlock = schedulePatched
      ? getActiveScheduleBlock(
          updated.dailySchedule,
          timeInfo.day,
          timeInfo.minuteOfDay,
          updated.homeLocationId,
          homeBedId,
        )
      : preBlock;
    activeBlockByAgent.set(updated.id, activeBlock);

    if (
      activeBlock &&
      activeBlock.id !== updated.activeScheduleId &&
      !updated.isThinking &&
      !updated.inConversationWith
    ) {
      if (updated.currentObjectId && updated.currentObjectId !== activeBlock.objectId) {
        const prevRead = getObjectRead(updated.currentObjectId);
        if (prevRead && prevRead.occupiedByAgentId === updated.id) {
          const prevObj = getObjectMut(updated.currentObjectId);
          if (prevObj) {
            prevObj.occupiedByAgentId = undefined;
            prevObj.state = prevObj.defaultState;
            prevObj.lastUpdatedSimMin = nextSimMinutes;
          }
        }
      }

      const targetObj = activeBlock.objectId ? getObjectRead(activeBlock.objectId) : undefined;
      const targetLoc = locationById.get(activeBlock.locationId);

      const destRawX = targetObj ? targetObj.tileX : targetLoc ? targetLoc.doorX : updated.x;
      const destRawY = targetObj ? targetObj.tileY + 1 : targetLoc ? targetLoc.doorY : updated.y;
      const dest = findNearestWalkableTile(prevState.tiles, destRawX, destRawY);
      const path = findPath(
        prevState.tiles,
        Math.round(updated.x),
        Math.round(updated.y),
        dest.x,
        dest.y,
      );

      const fallbackSubSteps =
        !activeBlock.subSteps || activeBlock.subSteps.length === 0
          ? generateRuleSubSteps({
              activity: activeBlock.activity,
              kind: activeBlock.kind,
              durationMinutes: activeBlock.durationMinutes,
            })
          : undefined;
      if (!activeBlock.subSteps || activeBlock.subSteps.length === 0) {
        stepDetailRequests.push({
          agentId: updated.id,
          blockId: activeBlock.id,
          activity: activeBlock.activity,
          kind: activeBlock.kind,
          durationMinutes: activeBlock.durationMinutes,
        });
      }

      updated.activeScheduleId = activeBlock.id;
      updated.targetX = dest.x;
      updated.targetY = dest.y;
      updated.path = path;
      updated.currentObjectId = activeBlock.objectId;
      updated.actionEmoji = activeBlock.emoji;
      updated.currentSubStep =
        resolveSubStep(activeBlock, timeInfo.minuteOfDay) ?? fallbackSubSteps?.[0];
      updated.currentAction =
        path.length > 0 && !activeBlock.activity.startsWith('Heading to')
          ? `Heading to ${targetLoc?.name ?? 'town'} — ${activeBlock.activity}`
          : activeBlock.activity;
    } else if (activeBlock && updated.path.length === 0) {
      updated.currentSubStep =
        resolveSubStep(activeBlock, timeInfo.minuteOfDay) ?? updated.currentSubStep;
    }

    // Embodied Social Agency: expire socialTarget, track moving seek targets, and relocate when avoiding a rival
    if (updated.socialTarget && nextSimMinutes >= updated.socialTarget.expiresAtSimMin) {
      updated.socialTarget = undefined;
    }
    if (
      updated.socialTarget &&
      !isSleepHours &&
      !updated.isThinking &&
      !updated.inConversationWith
    ) {
      const st = updated.socialTarget;
      const peer = prevAgentById.get(st.targetAgentId);
      if (!peer) {
        updated.socialTarget = undefined;
      } else if (st.mode === 'seek') {
        const peerBlk = getActiveScheduleBlock(
          peer.dailySchedule,
          timeInfo.day,
          timeInfo.minuteOfDay,
          peer.homeLocationId,
          homeBedByLocation.get(peer.homeLocationId),
        );
        if (peerBlk?.kind === 'sleep' && peer.currentLocationId === peer.homeLocationId) {
          updated.socialTarget = undefined;
        } else if (
          Math.hypot(peer.x - updated.x, peer.y - updated.y) > 2.2 &&
          (updated.path.length === 0 || nextSimMinutes - (st.lastRetargetSimMin ?? -999) >= 3)
        ) {
          const dest = findNearestWalkableTile(
            prevState.tiles,
            Math.round(peer.x),
            Math.round(peer.y),
          );
          updated.targetX = dest.x;
          updated.targetY = dest.y;
          updated.path = findPath(
            prevState.tiles,
            Math.round(updated.x),
            Math.round(updated.y),
            dest.x,
            dest.y,
          );
          updated.socialTarget = { ...st, lastRetargetSimMin: nextSimMinutes };
          updated.currentAction = `Seeking out ${peer.name.split(' ')[0]} — ${st.reason}`;
        }
      } else if (st.mode === 'avoid') {
        const sameRoom =
          Boolean(updated.currentLocationId) && peer.currentLocationId === updated.currentLocationId;
        const tooClose = Math.hypot(peer.x - updated.x, peer.y - updated.y) <= 5.5;
        if (sameRoom && tooClose && updated.path.length === 0) {
          const altLocId =
            updated.homeLocationId !== updated.currentLocationId
              ? updated.homeLocationId
              : 'johnson_park';
          const altLoc = locationById.get(altLocId);
          if (altLoc) {
            const dest = findNearestWalkableTile(prevState.tiles, altLoc.doorX, altLoc.doorY);
            updated.targetX = dest.x;
            updated.targetY = dest.y;
            updated.path = findPath(
              prevState.tiles,
              Math.round(updated.x),
              Math.round(updated.y),
              dest.x,
              dest.y,
            );
            updated.currentAction = `Stepping away to ${altLoc.shortName}`;
          }
        }
      }
    }

    const wasMoving = updated.path.length > 0;
    const prevZoneIdBeforeMove = updated.currentLocationId;

    if (updated.path.length > 0 && !updated.isThinking && !updated.inConversationWith) {
      let remainingDist = deltaSimMinutes * walkTilesPerSimMinute;
      const pathCopy = [...updated.path];
      let curX = updated.x;
      let curY = updated.y;

      while (remainingDist > 0 && pathCopy.length > 0) {
        const nextWp = pathCopy[0];
        const dx = nextWp.x - curX;
        const dy = nextWp.y - curY;
        const dist = Math.hypot(dx, dy);

        if (Math.abs(dx) > Math.abs(dy)) {
          updated.facing = dx >= 0 ? 'right' : 'left';
        } else if (Math.abs(dy) > 0.01) {
          updated.facing = dy >= 0 ? 'down' : 'up';
        }

        if (dist <= remainingDist) {
          curX = nextWp.x;
          curY = nextWp.y;
          remainingDist -= dist;
          pathCopy.shift();
        } else {
          curX += (dx / dist) * remainingDist;
          curY += (dy / dist) * remainingDist;
          remainingDist = 0;
        }
      }

      updated.x = curX;
      updated.y = curY;
      updated.path = pathCopy;

      if (pathCopy.length === 0 && activeBlock) {
        updated.currentAction = activeBlock.activity;
        updated.currentSubStep = resolveSubStep(activeBlock, timeInfo.minuteOfDay);
        updated.nextRoamSimMin = nextSimMinutes + 4.0;

        if (activeBlock.objectId) {
          const obj = getObjectMut(activeBlock.objectId);
          if (obj) {
            obj.occupiedByAgentId = updated.id;
            obj.state = describeOccupiedObjectState(obj, updated, activeBlock);
            obj.persistentNote =
              describePersistentObjectNote(obj, updated, activeBlock) ?? obj.persistentNote;
            obj.lastActorName = updated.name.split(' ')[0];
            obj.lastUpdatedSimMin = nextSimMinutes;
          }
        }

        const arrivedLoc = getLocationAt(prevState.locations, curX, curY);
        if (arrivedLoc && arrivedLoc.id !== prevZoneIdBeforeMove && activeBlock.kind !== 'sleep') {
          const arrivalDesc = `${updated.name} arrived at ${arrivedLoc.name} to begin: ${activeBlock.activity}.`;
          const arrivalImp = scoreImportance({
            kind: 'arrival',
            description: arrivalDesc,
            recentMemories: updated.memories,
          });
          const obs = createMemoryNode({
            id: alloc.next(`mem_${updated.id}`),
            createdAt: nextSimMinutes,
            type: 'observation',
            description: arrivalDesc,
            importance: arrivalImp,
          });
          updated.memories = compactMemories(
            [obs, ...updated.memories],
            DEFAULT_MEMORY_CAP,
            nextSimMinutes,
            alloc.next,
          );
          updated.importanceAccumulator += obs.importance;
        }
      }
    } else if (!updated.isThinking && !updated.inConversationWith) {
      if (updated.currentObjectId) {
        const objRead = getObjectRead(updated.currentObjectId);
        if (
          objRead &&
          !objRead.occupiedByAgentId &&
          Math.hypot(objRead.tileX - updated.x, objRead.tileY - updated.y) <= 2.2
        ) {
          const obj = getObjectMut(updated.currentObjectId);
          if (obj) {
            obj.occupiedByAgentId = updated.id;
            obj.state = describeOccupiedObjectState(obj, updated, activeBlock);
            obj.persistentNote =
              describePersistentObjectNote(obj, updated, activeBlock) ?? obj.persistentNote;
            obj.lastActorName = updated.name.split(' ')[0];
            obj.lastUpdatedSimMin = nextSimMinutes;
          }
        }
      }

      const dueRoam = updated.nextRoamSimMin ?? nextSimMinutes + 2;
      if (updated.nextRoamSimMin === undefined) {
        updated.nextRoamSimMin = dueRoam;
      } else if (nextSimMinutes >= dueRoam && activeBlock?.kind !== 'sleep') {
        const loc = getLocationAt(prevState.locations, updated.x, updated.y);
        if (loc) {
          const seed =
            updated.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) +
            Math.floor(nextSimMinutes);
          const pad = loc.category === 'park' ? 1 : 2;
          const spanX = Math.max(1, loc.w - pad * 2);
          const spanY = Math.max(1, loc.h - pad * 2);
          const rx = loc.x + pad + (seed % spanX);
          const ry = loc.y + pad + ((seed * 7) % spanY);
          const dest = findNearestWalkableTile(prevState.tiles, rx, ry);
          if (Math.hypot(dest.x - updated.x, dest.y - updated.y) >= 1.2) {
            const roamPath = findPath(
              prevState.tiles,
              Math.round(updated.x),
              Math.round(updated.y),
              dest.x,
              dest.y,
            );
            if (roamPath.length > 0 && roamPath.length <= 12) {
              updated.path = roamPath;
              updated.targetX = dest.x;
              updated.targetY = dest.y;
            }
          }
        }
        updated.nextRoamSimMin = nextSimMinutes + 4.5;
      }
    }

    // Real zone tracking: null outdoors, building id indoors, plus human-readable area label
    const movedThisTick = updated.x !== agent.x || updated.y !== agent.y;
    const locNow = movedThisTick ? getLocationAt(prevState.locations, updated.x, updated.y) : locForDrive;
    updated.currentLocationId = locNow ? locNow.id : null;
    if (movedThisTick || !updated.currentAreaLabel) {
      updated.currentAreaLabel = locNow
        ? locNow.name
        : getAreaLabelAt(prevState.locations, updated.x, updated.y);
    }

    // Drives follow ScheduleBlock.kind strictly (zero keyword substrings)
    const isAtDestination = !wasMoving && updated.path.length === 0;
    const isResting =
      isAtDestination && (activeBlock?.kind === 'sleep' || activeBlock?.kind === 'rest');
    const isEatingMeal = isAtDestination && activeBlock?.kind === 'meal';
    const isAtHome = Boolean(locNow && locNow.id === updated.homeLocationId);

    const nextDrives = stepAgentDrives(
      updated.drives,
      {
        minuteOfDay: timeInfo.minuteOfDay,
        locationCategory: locNow?.category,
        weather: nextWeather,
        isMoving: updated.path.length > 0,
        isAtDestination,
        isResting,
        isEatingMeal,
        isAtHome,
      },
      deltaSimMinutes,
    );
    updated.drives = nextDrives;
    updated.mood = stepMoodState(
      updated.mood,
      updated.baselineMood,
      nextDrives,
      deltaSimMinutes,
    );

    const urgent = detectUrgentDrive(nextDrives);
    if (
      urgent &&
      !isSleepHours &&
      Math.floor(nextSimMinutes) > Math.floor(prevState.simMinutes)
    ) {
      const recentUrge = updated.memories.find(
        (m) => nextSimMinutes - m.createdAt < 90 && m.description.includes(urgent.drive),
      );
      if (!recentUrge && Math.floor(nextSimMinutes) % 30 === 0) {
        const urgeDesc = `${updated.name} noticed ${urgent.drive} dropping (${Math.round(urgent.level)}/100), ${urgent.urgeText}.`;
        const obs = createMemoryNode({
          id: alloc.next(`urge_${updated.id}`),
          createdAt: nextSimMinutes,
          type: 'observation',
          description: urgeDesc,
          importance: scoreImportance({
            kind: 'routine_perception',
            description: urgeDesc,
            recentMemories: updated.memories,
          }),
        });
        updated.memories = compactMemories(
          [obs, ...updated.memories],
          DEFAULT_MEMORY_CAP,
          nextSimMinutes,
          alloc.next,
        );
      }
    }

    return updated;
  });

  // Stay-based Room Perception (Phase 4): one observation per zone visit unless salient event happens
  const objectsList =
    mutatedObjects.size === 0
      ? prevState.objects
      : prevState.objects.map((o) => mutatedObjects.get(o.id) ?? o);
  const stationaryByLoc = new Map<string, AgentState[]>();
  for (const ag of nextAgents) {
    if (ag.currentLocationId && ag.path.length === 0) {
      const arr = stationaryByLoc.get(ag.currentLocationId);
      if (arr) arr.push(ag);
      else stationaryByLoc.set(ag.currentLocationId, [ag]);
    }
  }
  for (const arr of stationaryByLoc.values()) {
    if (arr.length > 1) arr.sort((a, b) => a.id.localeCompare(b.id));
  }
  const tracesByLoc = new Map<string, WorldObject[]>();
  for (const o of objectsList) {
    if (o.persistentNote) {
      const arr = tracesByLoc.get(o.locationId);
      if (arr) arr.push(o);
      else tracesByLoc.set(o.locationId, [o]);
    }
  }
  for (const arr of tracesByLoc.values()) {
    if (arr.length > 1) arr.sort((a, b) => a.id.localeCompare(b.id));
  }

  const agentsAfterPerception = nextAgents.map((ag) => {
    const loc = ag.currentLocationId ? locationById.get(ag.currentLocationId) : undefined;

    if (!loc) {
      return ag.activeStayObservation ? { ...ag, activeStayObservation: undefined } : ag;
    }
    if (ag.path.length > 0) {
      return ag.activeStayObservation && ag.activeStayObservation.zoneId !== loc.id
        ? { ...ag, activeStayObservation: undefined }
        : ag;
    }

    const activeBlk = activeBlockByAgent.get(ag.id);
    if (activeBlk?.kind === 'sleep') {
      return ag.activeStayObservation ? { ...ag, activeStayObservation: undefined } : ag;
    }

    const locPeers = stationaryByLoc.get(loc.id);
    const peersHere = locPeers ? locPeers.filter((other) => other.id !== ag.id) : [];
    const firstName = ag.name.split(' ')[0];
    const locTraces = tracesByLoc.get(loc.id);
    const roomTraces = locTraces ? locTraces.filter((o) => o.lastActorName !== firstName) : [];

    if (peersHere.length === 0 && roomTraces.length === 0) return ag;

    const signature = [
      peersHere.map((p) => `${p.id}:${p.currentAction}`).join(','),
      roomTraces.map((o) => `${o.id}:${o.persistentNote}`).join('|'),
    ].join('::');

    const prevSig = ag.lastPerceivedSignatureByZone?.[loc.id];
    const activeStay = ag.activeStayObservation;

    if (activeStay && activeStay.zoneId === loc.id && prevSig === signature) {
      return ag;
    }

    const peerSnippet =
      peersHere.length > 0
        ? peersHere
            .slice(0, 3)
            .map((p) => `${p.name.split(' ')[0]} (${p.currentAction.toLowerCase()})`)
            .join(', ')
        : '';
    const traceSnippet =
      roomTraces.length > 0
        ? `noticed ${roomTraces[0].name}: ${roomTraces[0].persistentNote}`
        : '';
    const desc = `At ${loc.name}, ${firstName} observed ${[peerSnippet, traceSnippet].filter(Boolean).join('; ')}.`;

    if (activeStay && activeStay.zoneId === loc.id) {

      const seenPeers = new Set(activeStay.peerIdsSeen);
      const seenTraces = new Set(activeStay.traceKeysSeen);
      const seenTraceObjIds = new Set(
        activeStay.traceKeysSeen.map((k) => k.split(':')[0]),
      );
      const newClosePeers = peersHere.filter((p) => {
        if (seenPeers.has(p.id)) return false;
        const edge = ag.socialGraph[p.id];
        return Boolean(edge && (edge.trust >= 70 || edge.affection >= 70));
      });
      const newTraces = roomTraces.filter(
        (o) =>
          !seenTraces.has(`${o.id}:${o.persistentNote ?? ''}`) &&
          !seenTraceObjIds.has(o.id) &&
          typeof o.lastUpdatedSimMin === 'number' &&
          nextSimMinutes - o.lastUpdatedSimMin <= 2,
      );

      if (newClosePeers.length > 0 || newTraces.length > 0) {
        const parts: string[] = [];
        if (newClosePeers.length > 0) {
          parts.push(
            `${newClosePeers.map((p) => `${p.name} (${p.currentAction.toLowerCase()})`).join(', ')} arrived`,
          );
        }
        if (newTraces.length > 0) {
          parts.push(`noticed ${newTraces[0].name}: ${newTraces[0].persistentNote}`);
        }
        const salientDesc = `At ${loc.name}, ${ag.name.split(' ')[0]} saw ${parts.join('; ')}.`;
        const salientImp = scoreImportance({
          kind: newClosePeers.length > 0 ? 'known_person' : 'routine_perception',
          description: salientDesc,
          recentMemories: ag.memories,
        });
        const obs = createMemoryNode({
          id: alloc.next(`perc_${ag.id}`),
          createdAt: nextSimMinutes,
          type: 'observation',
          source: 'perception',
          description: salientDesc,
          importance: salientImp,
        });
        if (
          obs.importance >= 6 &&
          !ag.isThinking &&
          !prevState.ablations?.noPlanning &&
          (reactionsTodayByAgent[ag.id] ?? 0) < 4 &&
          nextSimMinutes - (lastReactionSimByAgent[ag.id] ?? -999) >= 45
        ) {
          reactionTriggers.push({
            agentId: ag.id,
            observation: salientDesc,
            partnerId: newClosePeers[0]?.id,
          });
        }
        nextStats.perceptionEvents += 1;
        return {
          ...ag,
          activeStayObservation: {
            zoneId: loc.id,
            memoryId: activeStay.memoryId,
            peerIdsSeen: Array.from(new Set([...activeStay.peerIdsSeen, ...peersHere.map((p) => p.id)])),
            traceKeysSeen: Array.from(
              new Set([
                ...activeStay.traceKeysSeen,
                ...roomTraces.map((o) => `${o.id}:${o.persistentNote ?? ''}`),
              ]),
            ),
          },
          lastPerceivedSignatureByZone: {
            ...(ag.lastPerceivedSignatureByZone ?? {}),
            [loc.id]: signature,
          },
          memories: compactMemories(
            [obs, ...ag.memories],
            DEFAULT_MEMORY_CAP,
            nextSimMinutes,
            alloc.next,
          ),
          importanceAccumulator: ag.importanceAccumulator + obs.importance,
        };
      }

      // Routine mid-stay shift: update the active stay observation in place (no new node)
      let updatedStayNode = false;
      const updatedMemories = ag.memories.map((m) => {
        if (m.id !== activeStay.memoryId) return m;
        updatedStayNode = true;
        return {
          ...m,
          description: desc,
          keywords: extractKeywords(desc),
          lastAccessed: nextSimMinutes,
          embedding: undefined,
        };
      });

      if (updatedStayNode) {
        return {
          ...ag,
          activeStayObservation: {
            ...activeStay,
            peerIdsSeen: Array.from(
              new Set([...activeStay.peerIdsSeen, ...peersHere.map((p) => p.id)]),
            ),
            traceKeysSeen: Array.from(
              new Set([
                ...activeStay.traceKeysSeen,
                ...roomTraces.map((o) => `${o.id}:${o.persistentNote ?? ''}`),
              ]),
            ),
          },
          lastPerceivedSignatureByZone: {
            ...(ag.lastPerceivedSignatureByZone ?? {}),
            [loc.id]: signature,
          },
          memories: updatedMemories,
        };
      }
    }

    // Entering or starting a stay in `loc`
    if (prevSig === signature && activeStay?.zoneId === loc.id) return ag;

    const hasKnownPeer = peersHere.some((p) => Boolean(ag.socialGraph[p.id]));
    const dynImportance = scoreImportance({
      kind: hasKnownPeer ? 'known_person' : 'routine_perception',
      description: desc,
      recentMemories: ag.memories,
    });
    const obs = createMemoryNode({
      id: alloc.next(`perc_${ag.id}`),
      createdAt: nextSimMinutes,
      type: 'observation',
      source: 'perception',
      description: desc,
      importance: dynImportance,
    });
    if (
      obs.importance >= 6 &&
      !ag.isThinking &&
      !prevState.ablations?.noPlanning &&
      (reactionsTodayByAgent[ag.id] ?? 0) < 4 &&
      nextSimMinutes - (lastReactionSimByAgent[ag.id] ?? -999) >= 45
    ) {
      reactionTriggers.push({
        agentId: ag.id,
        observation: desc,
        partnerId: peersHere[0]?.id,
      });
    }
    nextStats.perceptionEvents += 1;

    return {
      ...ag,
      activeStayObservation: {
        zoneId: loc.id,
        memoryId: obs.id,
        peerIdsSeen: peersHere.map((p) => p.id),
        traceKeysSeen: roomTraces.map((o) => `${o.id}:${o.persistentNote ?? ''}`),
      },
      lastPerceivedSignatureByZone: {
        ...(ag.lastPerceivedSignatureByZone ?? {}),
        [loc.id]: signature,
      },
      memories: compactMemories(
        [obs, ...ag.memories],
        DEFAULT_MEMORY_CAP,
        nextSimMinutes,
        alloc.next,
      ),
      importanceAccumulator: ag.importanceAccumulator + obs.importance,
    };
  });

  // Dual-Process Encounter Detection using O(N) Spatial Hash Grid (scales cleanly to 100+ residents)
  const conversationPairs: Array<[string, string]> = [];
  const conversationReasons: Record<string, string> = {};
  const groupParticipantsByPair: Record<string, string[]> = {};
  const pairedThisStep = new Set<string>();
  const finalAgents = [...agentsAfterPerception];
  const worldCtx = { tiles: prevState.tiles, locations: prevState.locations };
  const spatialGrid = buildSpatialGrid(finalAgents, 4);

  // Quiet sleep hours (23:00..06:30) suppress spontaneous roommate encounters so residents rest
  // and daily LLM budgets are preserved for daytime life & BDI decisions.
  const isQuietSleepHours = timeInfo.minuteOfDay < 390 || timeInfo.minuteOfDay >= 1380;
  const isAgentSleepingNow = (ag: AgentState): boolean => {
    const blk = getActiveScheduleBlock(
      ag.dailySchedule,
      timeInfo.day,
      timeInfo.minuteOfDay,
      ag.homeLocationId,
      homeBedByLocation.get(ag.homeLocationId),
    );
    return blk?.kind === 'sleep';
  };

  for (let i = 0; i < finalAgents.length && !isQuietSleepHours; i++) {
    const a = finalAgents[i];
    if (a.isThinking || pairedThisStep.has(a.id) || isAgentSleepingNow(a)) continue;

    const nearby = spatialGrid.queryRadius(a.x, a.y, CONVERSATION_RADIUS_TILES);
    for (let n = 0; n < nearby.length; n++) {
      const { item: b, index: j } = nearby[n];
      if (j <= i) continue;
      if (b.isThinking || pairedThisStep.has(b.id) || isAgentSleepingNow(b)) continue;

      if (canAgentsConverse(worldCtx, a, b)) {
        const isAvoiding =
          (a.socialTarget?.mode === 'avoid' && a.socialTarget.targetAgentId === b.id) ||
          (b.socialTarget?.mode === 'avoid' && b.socialTarget.targetAgentId === a.id);
        if (isAvoiding) continue;

        const seekerA = a.socialTarget?.mode === 'seek' && a.socialTarget.targetAgentId === b.id;
        const seekerB = b.socialTarget?.mode === 'seek' && b.socialTarget.targetAgentId === a.id;
        const seekActive = seekerA || seekerB;
        const lastTalk = Math.max(a.lastConversedAt[b.id] ?? -999, b.lastConversedAt[a.id] ?? -999);
        if (seekActive && nextSimMinutes - lastTalk < 10) continue;

        const salience = evaluateEncounterSalience({
          agentA: a,
          agentB: b,
          memes: prevState.memes ?? [],
          simMinutes: nextSimMinutes,
          disableDualProcessGate: Boolean(prevState.ablations?.noSystem2Gate),
        });
        if (!seekActive && salience.reason === 'cooldown') continue;

        const tierA = a.tier ?? 'focal';
        const tierB = b.tier ?? 'focal';
        // Multi-Tier Scale Rule: System-2 LLM scenes require at least one 'focal' resident (or both non-ambient)
        const eligibleForSystem2 =
          (seekActive || salience.shouldUseSystem2) &&
          tierA !== 'ambient' &&
          tierB !== 'ambient' &&
          (tierA === 'focal' || tierB === 'focal');

        if (eligibleForSystem2) {
          conversationPairs.push([a.id, b.id]);
          const pairKey = `${a.id}:${b.id}`;
          conversationReasons[pairKey] = seekActive
            ? `Intentional visit: ${seekerA ? a.socialTarget!.reason : b.socialTarget!.reason}`
            : salience.reason;
          if (seekerA) {
            finalAgents[i] = { ...finalAgents[i], socialTarget: undefined };
          }
          if (seekerB) {
            finalAgents[j] = { ...finalAgents[j], socialTarget: undefined };
          }
          if (seekActive) {
            nextStats.socialSeeksCompleted = (nextStats.socialSeeksCompleted ?? 0) + 1;
          }
          pairedThisStep.add(a.id);
          pairedThisStep.add(b.id);

          // Group conversation discovery: invite nearby 3rd/4th stationary resident in same room
          if (
            prevState.compressedConversations &&
            a.currentLocationId &&
            a.currentLocationId === b.currentLocationId
          ) {
            const groupIds = [a.id, b.id];
            const groupNearby = spatialGrid.queryRadius(a.x, a.y, 4.5);
            for (let g = 0; g < groupNearby.length && groupIds.length < 4; g++) {
              const { item: c, index: k } = groupNearby[g];
              if (k <= j) continue;
              if (
                !c.isThinking &&
                !pairedThisStep.has(c.id) &&
                (c.tier ?? 'focal') !== 'ambient' &&
                c.currentLocationId === a.currentLocationId &&
                c.path.length === 0 &&
                nextSimMinutes - (c.lastConversedAt[a.id] ?? -999) >= 45
              ) {
                groupIds.push(c.id);
                pairedThisStep.add(c.id);
              }
            }
            if (groupIds.length > 2) {
              groupParticipantsByPair[pairKey] = groupIds;
            }
          }
          break;
        } else {
          // Fast zero-LLM System-1 greeting (also handles ambient/active scale interactions cleanly)
          finalAgents[i] = {
            ...a,
            drives: { ...a.drives, social: Math.min(100, a.drives.social + 3) },
            lastConversedAt: { ...a.lastConversedAt, [b.id]: nextSimMinutes },
            speechBubble: a.speechBubble ?? {
              text: buildSystem1Greeting(a.name, b.name, timeInfo.minuteOfDay, a.drives),
              speakerName: a.name.split(' ')[0],
              expiresAtSimMin: nextSimMinutes + 4.5,
            },
          };
          finalAgents[j] = {
            ...b,
            drives: { ...b.drives, social: Math.min(100, b.drives.social + 3) },
            lastConversedAt: { ...b.lastConversedAt, [a.id]: nextSimMinutes },
          };
          nextStats.system1Greetings += 1;
          nextStats.llmCallsSaved += 1;
          pairedThisStep.add(a.id);
          pairedThisStep.add(b.id);
          break;
        }
      }
    }
  }

  // Track Party presence & decision-grounded attendance during Day 2 17:00-19:00 (or Day 1 in default)
  const crossedWholeMinute = Math.floor(nextSimMinutes) > Math.floor(prevState.simMinutes);
  const targetPartyDay = (prevState.scenarioId ?? 'default') === 'paper_valentine' ? 2 : 1;
  const inPartyWindow =
    timeInfo.day === targetPartyDay &&
    timeInfo.minuteOfDay >= 1020 &&
    timeInfo.minuteOfDay < 1140;
  const prevParty = prevState.partyStats ?? createInitialPartyStats();
  let nextPartyStats = prevParty;

  if (crossedWholeMinute || inPartyWindow || !prevState.partyStats) {
    const partyMeme = (prevState.memes ?? []).find((m) => m.id === 'meme_valentine_party');
    const nextMinutesAtCafe = { ...prevParty.minutesAtCafeByAgent };
    const invitedSet = new Set(prevParty.invitedAgentIds);
    const agreedSet = new Set(prevParty.agreedAgentIds);
    const plannedAfterSet = new Set(prevParty.plannedAfterNewsAgentIds);

    for (const ag of finalAgents) {
      if (crossedWholeMinute || !prevState.partyStats) {
        const heardEntry = partyMeme?.knownBy[ag.id];
        if (heardEntry && ag.id !== 'isabella') {
          invitedSet.add(ag.id);
        }
        const hasPartyFixedBlock = ag.dailySchedule.some(
          (b) =>
            b.day === targetPartyDay &&
            b.locationId === 'hobbs_cafe' &&
            b.startMinute + b.durationMinutes > 1020 &&
            b.startMinute < 1140 &&
            (b.fixed || b.source === 'social_commitment'),
        );
        if (hasPartyFixedBlock && ag.id !== 'isabella') {
          agreedSet.add(ag.id);
        }
        const hasPostHearingPlan =
          Boolean(heardEntry) &&
          ag.dailySchedule.some(
            (b) =>
              b.day === targetPartyDay &&
              b.locationId === 'hobbs_cafe' &&
              b.startMinute + b.durationMinutes > 1020 &&
              b.startMinute < 1140 &&
              (b.source === 'morning_plan' || b.source === 'llm_replan') &&
              /valentine|party|hobbs/i.test(b.activity),
          );
        if (hasPostHearingPlan) {
          plannedAfterSet.add(ag.id);
        }
      }

      if (inPartyWindow && ag.currentLocationId === 'hobbs_cafe') {
        nextMinutesAtCafe[ag.id] = (nextMinutesAtCafe[ag.id] ?? 0) + deltaSimMinutes;
      }
    }

    const attendedRawIds = Object.entries(nextMinutesAtCafe)
      .filter(([, mins]) => mins >= 20)
      .map(([id]) => id);
    const attendedDecisionIds = attendedRawIds.filter(
      (id) => id === 'isabella' || agreedSet.has(id) || plannedAfterSet.has(id),
    );
    nextPartyStats = {
      minutesAtCafeByAgent: nextMinutesAtCafe,
      invitedAgentIds: Array.from(invitedSet),
      agreedAgentIds: Array.from(agreedSet),
      plannedAfterNewsAgentIds: Array.from(plannedAfterSet),
      attendedRawIds,
      attendedDecisionIds,
    };
  }

  // Assemble base nextWorld before running real economic, project, notice, and civic ticks
  let assembledWorld: WorldState = {
    ...prevState,
    schemaVersion: prevState.schemaVersion ?? WORLD_SCHEMA_VERSION,
    idSeq: alloc.seq(),
    simMinutes: nextSimMinutes,
    day: timeInfo.day,
    weather: nextWeather,
    objects: objectsList,
    agents: finalAgents,
    stats: nextStats,
    reactionsTodayByAgent,
    reactionDay: timeInfo.day,
    lastReactionSimByAgent,
    partyStats: nextPartyStats,
    chronicle:
      newChronicle.length > 0
        ? [...newChronicle, ...prevState.chronicle].slice(0, 140)
        : prevState.chronicle,
  };

  // Execute arrival-grounded pending BDI actions whenever an agent arrives at targetLocationId
  if (assembledWorld.agents.some((ag) => ag.dailySchedule.some((b) => b.pendingAction && !b.pendingAction.executed))) {
    const cal = getCalendarInfo(nextSimMinutes);
    for (const ag of assembledWorld.agents) {
      if (ag.path.length > 0 || !ag.currentLocationId) continue;
      if (!ag.dailySchedule.some((b) => b.pendingAction && !b.pendingAction.executed)) continue;
      const activeBlk = getActiveScheduleBlock(
        ag.dailySchedule,
        cal.day,
        cal.minuteOfDay,
        ag.homeLocationId,
        homeBedByLocation.get(ag.homeLocationId),
      );
      if (
        activeBlk?.pendingAction &&
        !activeBlk.pendingAction.executed &&
        ag.currentLocationId === activeBlk.pendingAction.targetLocationId
      ) {
        const res = executePendingBdiAction(
          assembledWorld,
          ag.id,
          activeBlk.pendingAction,
          alloc.next,
        );
        assembledWorld = {
          ...res.world,
          agents: res.world.agents.map((a) =>
            a.id === ag.id
              ? {
                  ...a,
                  dailySchedule: a.dailySchedule.map((b) =>
                    b.id === activeBlk.id && b.pendingAction
                      ? { ...b, pendingAction: { ...b.pendingAction, executed: true } }
                      : b,
                  ),
                }
              : a,
          ),
        };
      }
    }
  }

  // Deliver due private letters to awake recipients (adds episodic linked memory + chronicle)
  if (
    timeInfo.hour24 >= 7 &&
    timeInfo.hour24 < 22 &&
    assembledWorld.letters?.some((l) => !l.readAt && l.deliveredAt <= nextSimMinutes)
  ) {
    const deliveredChronicle: ChronicleEvent[] = [];
    const letterMemoriesByAgent = new Map<string, MemoryNode[]>();
    const nextLetters = assembledWorld.letters.map((l) => {
      if (l.readAt || l.deliveredAt > nextSimMinutes) return l;
      const recip = assembledWorld.agents.find((a) => a.id === l.toAgentId);
      if (!recip) return l;
      const mem = createMemoryNode({
        id: alloc.next(`mem_ltr_rx_${recip.id}`),
        createdAt: nextSimMinutes,
        type: 'observation',
        source: 'letter',
        description: `${recip.name} received a private letter from ${l.fromName} ("${l.subject}"): ${l.body}`,
        importance: 7,
      });
      const existing = letterMemoriesByAgent.get(recip.id) ?? [];
      existing.push(mem);
      letterMemoriesByAgent.set(recip.id, existing);
      deliveredChronicle.push({
        id: alloc.next('chr_ltr_rx'),
        simMinutes: nextSimMinutes,
        type: 'notice',
        title: `${recip.name.split(' ')[0]} read a private letter from ${l.fromName.split(' ')[0]}`,
        detail: `"${l.subject}"`,
        agentIds: [recip.id, l.fromAgentId],
        locationName: locationById.get(recip.currentLocationId ?? recip.homeLocationId)?.name,
      });
      return { ...l, readAt: nextSimMinutes };
    });

    if (letterMemoriesByAgent.size > 0) {
      assembledWorld = {
        ...assembledWorld,
        letters: nextLetters,
        agents: assembledWorld.agents.map((ag) => {
          const newMems = letterMemoriesByAgent.get(ag.id);
          if (!newMems || newMems.length === 0) return ag;
          let pool = ag.memories;
          for (const m of newMems) {
            const linked = attachAssociativeLinks(m, pool);
            pool = [linked.linkedNode, ...linked.updatedExisting];
          }
          return {
            ...ag,
            memories: compactMemories(pool, DEFAULT_MEMORY_CAP, nextSimMinutes, alloc.next),
            importanceAccumulator:
              ag.importanceAccumulator + newMems.reduce((s, m) => s + m.importance, 0),
          };
        }),
        chronicle: [...deliveredChronicle, ...assembledWorld.chronicle].slice(0, 140),
      };
    }
  }

  // Phase A+B+D Real World Causality: Daily economic & institutional rollover, shifts, purchases, notices, civic votes, health, elections, clubs
  const crossedFiveMinutes =
    Math.floor(nextSimMinutes / 5) > Math.floor(prevState.simMinutes / 5);
  if (isNewDay && assembledWorld.businesses) {
    assembledWorld = applyDailyEconomicRollover(assembledWorld, timeInfo.day, alloc.next);
    assembledWorld = applyDailyInstitutionalRollover(assembledWorld, alloc.next);
    assembledWorld = applyDailyContractsAndLifeRollover(assembledWorld, timeInfo.day, alloc.next);
    assembledWorld = applyDailyPowerAndInstitutionsRollover(assembledWorld, timeInfo.day, alloc.next);
    assembledWorld = applyDailyEpistemicAndCultureRollover(assembledWorld, timeInfo.day, alloc.next);
    const divSnap = computeDiversitySnapshot(assembledWorld);
    assembledWorld = {
      ...assembledWorld,
      diversityHistory: [...(assembledWorld.diversityHistory ?? []), divSnap].slice(-30),
    };
  }

  if (crossedFiveMinutes && assembledWorld.businesses) {
    const calendar = getCalendarInfo(nextSimMinutes);
    const curFiveMin = Math.floor(nextSimMinutes / 5) * 5;
    for (const ag of assembledWorld.agents) {
      if (ag.path.length > 0 || !ag.currentLocationId) continue;

      const activeBlk = getActiveScheduleBlock(
        ag.dailySchedule,
        calendar.day,
        calendar.minuteOfDay,
        ag.homeLocationId,
        homeBedByLocation.get(ag.homeLocationId),
      );

      // 1. Paid work shifts & real production every 45 sim-minutes while working
      if (
        activeBlk?.kind === 'work' &&
        nextSimMinutes - (ag.lastWorkTickSimMin ?? -999) >= 45
      ) {
        const shiftRes = executeWorkShiftTick(assembledWorld, ag.id, 0.75, alloc.next);
        assembledWorld = shiftRes.world;
        const activeProj = ag.projects?.find((p) => p.status === 'active');
        if (activeProj && activeProj.targetLocationId === ag.currentLocationId) {
          assembledWorld = advanceAgentProject(assembledWorld, ag.id, 6, alloc.next).world;
        }
      }

      // 2. Real retail purchase or home pantry consumption during meal blocks (checked every 30 sim-min)
      if (activeBlk?.kind === 'meal' && !activeBlk.pendingAction && curFiveMin % 30 === 0 && ag.drives.hunger < 82) {
        const bizHere = assembledWorld.businesses?.[ag.currentLocationId];
        if (bizHere && bizHere.ownerId !== ag.id) {
          const edibleKey = (Object.keys(bizHere.stock) as Array<keyof typeof bizHere.stock>).find(
            (k) => {
              const e = bizHere.stock[k];
              return e && e.quantity > 0 && (k === 'meal' || k === 'pastry' || k === 'coffee' || k === 'bread' || k === 'drink');
            },
          );
          if (edibleKey) {
            const buyRes = executePurchaseAction(
              assembledWorld,
              ag.id,
              ag.currentLocationId,
              edibleKey,
              true,
              alloc.next,
            );
            if (buyRes.ok) {
              assembledWorld = buyRes.world;
            }
          }
        } else if (ag.currentLocationId === ag.homeLocationId) {
          assembledWorld = executeConsumeItemAction(assembledWorld, ag.id).world;
        }
      }

      // 3. Asynchronous Notice Board reading at public hubs (throttled on 15-min boundary)
      if (curFiveMin % 15 === 0) {
        assembledWorld = scanNoticeBoardForAgent(assembledWorld, ag.id, alloc.next).world;
      }

      // 4. Ambient Civic Proposal Voting when visiting a civic hall (focal residents decide autonomously via LLM BDI forks)
      if (curFiveMin % 20 === 0 && (ag.tier ?? 'focal') === 'ambient') {
        const locHere = locationById.get(ag.currentLocationId);
        if (locHere?.category === 'civic') {
          const unvoted = (assembledWorld.proposals ?? []).find(
            (p) =>
              p.status === 'open' &&
              !p.votesFor.includes(ag.id) &&
              !p.votesAgainst.includes(ag.id),
          );
          if (unvoted) {
            assembledWorld = castCivicVote(assembledWorld, ag.id, unvoted.id, undefined, alloc.next).world;
          }
        }
      }
    }

    // 5. Phase D+G: Health drift, clinic care, election turnout & resident micro-venture sales (every 30 sim-min)
    if (curFiveMin % 30 === 0) {
      assembledWorld = stepHealthAndClinic(assembledWorld, alloc.next).world;
      assembledWorld = stepTownElection(assembledWorld, alloc.next);
      assembledWorld = stepMicroVentures(assembledWorld, alloc.next);
    }

    // 6. Phase D & Phase 1: Weekly Community Club Gatherings (every 60 sim-min) + Intent Stack commitment sync (every 15 sim-min)
    if (curFiveMin % 15 === 0) {
      assembledWorld = {
        ...assembledWorld,
        agents: assembledWorld.agents.map((ag) =>
          ag.intentStack ? syncAgentCommitments(ag, assembledWorld) : ag,
        ),
      };
    }
    if (curFiveMin % 60 === 0) {
      assembledWorld = stepSocialClubs(assembledWorld, alloc.next);
    }

    // Apply active streetLighting town modifier (gentle evening mood boost for residents out after 18:00)
    if (assembledWorld.townModifiers?.streetLighting && calendar.hour24 >= 18 && curFiveMin % 30 === 0) {
      assembledWorld = {
        ...assembledWorld,
        agents: assembledWorld.agents.map((a) =>
          a.currentLocationId === null || a.currentLocationId !== a.homeLocationId
            ? {
                ...a,
                mood: applyEmotionalAppraisal(a.mood, a.drives, 0.03, 0.01),
              }
            : a,
        ),
      };
    }
  }

  // Phase C: Detect BDI strategic decision forks (only for focal agents so scale stays bounded)
  const decisionTriggers: BdiDecisionTrigger[] = [];
  if (
    crossedFiveMinutes &&
    (Math.floor(nextSimMinutes / 5) * 5) % 20 === 0 &&
    !assembledWorld.ablations?.noPlanning
  ) {
    for (const ag of assembledWorld.agents) {
      if ((ag.tier ?? 'focal') !== 'focal') continue;
      const fork = detectBdiDecisionFork(assembledWorld, ag);
      if (fork) {
        decisionTriggers.push(fork);
      }
    }
    decisionTriggers.sort((a, b) => b.urgency - a.urgency);
  }

  const reflectionAgentIds = assembledWorld.ablations?.noReflection
    ? []
    : assembledWorld.agents
        .filter((a) => shouldTriggerReflection(a, assembledWorld.reflectionThreshold))
        .map((a) => a.id);

  const morningPlanAgentIds =
    !assembledWorld.ablations?.noPlanning && timeInfo.day >= 2 && timeInfo.hour24 >= 5
      ? assembledWorld.agents
          .filter((a) => !a.isThinking && (a.lastReplannedDay ?? 1) < timeInfo.day)
          .map((a) => a.id)
      : [];

  return {
    nextState: {
      ...assembledWorld,
      idSeq: alloc.seq(),
    },
    triggers: {
      conversationPairs,
      conversationReasons,
      groupParticipantsByPair:
        Object.keys(groupParticipantsByPair).length > 0 ? groupParticipantsByPair : undefined,
      reflectionAgentIds,
      morningPlanAgentIds,
      reactionTriggers,
      stepDetailRequests,
      decisionTriggers: decisionTriggers.slice(0, 3),
    },
  };
}

export interface EmotionalShift {
  deltaValence: number;
  deltaArousal: number;
}

export interface ToMUpdate {
  deltaTrust: number;
  deltaAffection: number;
  inferredGoal?: string;
}

function isNearDuplicateMeme(
  existing: TrackedMeme[],
  topic: string,
  keywords: string[],
): boolean {
  const newTokens = new Set([...extractKeywords(topic), ...keywords.map((k) => k.toLowerCase())]);
  if (newTokens.size === 0) return true;
  for (const m of existing) {
    const mTokens = new Set([...extractKeywords(m.topic), ...m.keywords.map((k) => k.toLowerCase())]);
    if (mTokens.size === 0) continue;
    let overlap = 0;
    for (const t of newTokens) {
      if (mTokens.has(t) || containsWholeWordOrPhrase(m.topic, t)) overlap += 1;
    }
    const union = new Set([...newTokens, ...mTokens]).size;
    if (union > 0 && overlap / union >= 0.5) return true;
  }
  return false;
}

export function startAgentConversationLock(
  state: WorldState,
  agentAId: string,
  agentBId: string,
  extraParticipantIds: string[] = [],
): WorldState {
  const simMin = state.simMinutes;
  const allIds = Array.from(new Set([agentAId, agentBId, ...extraParticipantIds]));
  const participants = allIds
    .map((id) => state.agents.find((a) => a.id === id))
    .filter((a): a is AgentState => Boolean(a));
  if (participants.length < 2) return state;

  const participantSet = new Set(participants.map((p) => p.id));

  return {
    ...state,
    agents: state.agents.map((ag) => {
      if (!participantSet.has(ag.id)) return ag;
      const partner = participants.find((p) => p.id !== ag.id) ?? participants[0];
      const dx = partner.x - ag.x;
      const dy = partner.y - ag.y;
      const nextFacing =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0
            ? 'right'
            : 'left'
          : dy >= 0
            ? 'down'
            : 'up';
      return {
        ...ag,
        isThinking: true,
        path: [],
        facing: nextFacing,
        inConversationWith: partner.id,
        conversationStartedAtSim: simMin,
      };
    }),
  };
}

export function clearAgentThinkingState(
  state: WorldState,
  agentIds: string[],
  stampCooldown = false,
): WorldState {
  const set = new Set(agentIds);
  const simMin = state.simMinutes;
  return {
    ...state,
    agents: state.agents.map((ag) => {
      if (!set.has(ag.id)) return ag;
      const otherId = agentIds.find((id) => id !== ag.id);
      return {
        ...ag,
        isThinking: false,
        inConversationWith: undefined,
        conversationStartedAtSim: undefined,
        lastConversedAt:
          stampCooldown && otherId
            ? { ...ag.lastConversedAt, [otherId]: simMin }
            : ag.lastConversedAt,
      };
    }),
  };
}

function resolveAgreementOrCommitmentDay(
  rawDay: number | 'today' | 'tomorrow' | undefined,
  currentDay: number,
  currentMinuteOfDay: number,
  targetMinuteOfDay: number,
): number | null {
  let day = currentDay;
  if (rawDay === 'today') {
    day = currentDay;
  } else if (rawDay === 'tomorrow') {
    day = currentDay + 1;
  } else if (typeof rawDay === 'number' && Number.isFinite(rawDay)) {
    day = Math.round(rawDay);
  }
  if (day < currentDay) return null;
  if (day === currentDay && targetMinuteOfDay <= currentMinuteOfDay) return null;
  if (targetMinuteOfDay < COMMITMENT_MIN_MINUTE || targetMinuteOfDay > COMMITMENT_MAX_MINUTE) {
    return null;
  }
  return day;
}

export function applyConversationResult(
  state: WorldState,
  params: {
    agentAId: string;
    agentBId: string;
    turns: ConversationTurn[];
    summaryA: string;
    summaryB: string;
    importance?: number;
    importanceA?: number;
    importanceB?: number;
    stampSimMinutes?: number;
    reason?: string;
    endedBy?: string;
    planUpdateA?: string;
    planUpdateB?: string;
    commitmentA?: ScheduleCommitment;
    commitmentB?: ScheduleCommitment;
    sharedAgreement?: {
      day: 'today' | 'tomorrow' | number;
      minuteOfDay: number;
      durationMinutes?: number;
      locationId: string;
      objectId?: string;
      activity: string;
      emoji?: string;
    };
    memeIdsDiscussedA?: string[];
    memeIdsDiscussedB?: string[];
    newNewsA?: Array<{ topic: string; keywords: string[] }>;
    newNewsB?: Array<{ topic: string; keywords: string[] }>;
    accessedMemoryIdsA?: string[];
    accessedMemoryIdsB?: string[];
    emotionalShiftA?: EmotionalShift;
    emotionalShiftB?: EmotionalShift;
    tomUpdateA?: ToMUpdate;
    tomUpdateB?: ToMUpdate;
    beliefUpdatesA?: ExtractedBeliefUpdate[];
    beliefUpdatesB?: ExtractedBeliefUpdate[];
    bilateralDeal?: NegotiatedDeal;
    gossipUpdates?: GossipUpdate[];
    compressed?: boolean;
  },
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const agentA = state.agents.find((a) => a.id === params.agentAId);
  const agentB = state.agents.find((a) => a.id === params.agentBId);
  if (!agentA || !agentB) return state;

  const simMin = params.stampSimMinutes ?? state.simMinutes;
  const nowInfo = formatSimTime(simMin);
  const validLocs = new Set(state.locations.map((l) => l.id));
  const validObjIds = new Set(state.objects.map((o) => o.id));
  const loc =
    (agentA.currentLocationId
      ? state.locations.find((l) => l.id === agentA.currentLocationId)
      : undefined) ?? state.locations[0];

  // Validate optional shared agreement (or explicit commitments) against Phase 3 window and future time
  let resolvedAgreement: ConversationAgreement | undefined;
  let sharedFixedBlockTemplate: Omit<ScheduleBlock, 'id'> | undefined;
  if (params.sharedAgreement && validLocs.has(params.sharedAgreement.locationId)) {
    const startMinute = Math.round(params.sharedAgreement.minuteOfDay);
    const resolvedDay = resolveAgreementOrCommitmentDay(
      params.sharedAgreement.day,
      nowInfo.day,
      nowInfo.minuteOfDay,
      startMinute,
    );
    if (resolvedDay !== null) {
      const durationMinutes = Math.max(
        30,
        Math.min(150, Math.round(params.sharedAgreement.durationMinutes ?? 60)),
      );
      const groundedObj =
        params.sharedAgreement.objectId && validObjIds.has(params.sharedAgreement.objectId)
          ? params.sharedAgreement.objectId
          : state.objects.find(
              (o) =>
                o.locationId === params.sharedAgreement!.locationId && o.kind !== 'bed',
            )?.id;
      const agreedLocName =
        state.locations.find((l) => l.id === params.sharedAgreement!.locationId)?.name ??
        params.sharedAgreement.locationId;
      resolvedAgreement = {
        day: resolvedDay,
        minuteOfDay: startMinute,
        locationId: params.sharedAgreement.locationId,
        locationName: agreedLocName,
        activity: params.sharedAgreement.activity,
      };
      sharedFixedBlockTemplate = {
        day: resolvedDay,
        kind: 'social',
        fixed: true,
        oneOff: true,
        startMinute,
        durationMinutes,
        locationId: params.sharedAgreement.locationId,
        objectId: groundedObj,
        activity: params.sharedAgreement.activity,
        emoji: params.sharedAgreement.emoji || '🤝',
        source: 'social_commitment',
      };
    }
  }

  let commitmentsAdded = 0;

  // Build staggered sequential speech bubbles across [convStart, convStart + turns.length * 1.5]
  const totalSpan = Math.max(1.5, params.turns.length * 1.5);
  const convStartSim = Math.max(0, simMin - totalSpan);
  const stepPerTurn = totalSpan / Math.max(1, params.turns.length);

  const accessedA = new Set(params.accessedMemoryIdsA ?? []);
  const accessedB = new Set(params.accessedMemoryIdsB ?? []);
  let beliefRevisionsDelta = 0;
  let disagreementsDelta = 0;

  const nextAgents = state.agents.map((ag) => {
    const isA = ag.id === agentA.id;
    const isB = ag.id === agentB.id;
    if (!isA && !isB) return ag;

    const partner = isA ? agentB : agentA;
    const summary = isA ? params.summaryA : params.summaryB;
    const planUpdate = isA ? params.planUpdateA : params.planUpdateB;
    const commitment = isA ? params.commitmentA : params.commitmentB;
    const shift = (isA ? params.emotionalShiftA : params.emotionalShiftB) ?? {
      deltaValence: 0.08,
      deltaArousal: 0.06,
    };
    const tomUpdate = isA ? params.tomUpdateA : params.tomUpdateB;
    const accessedSet = isA ? accessedA : accessedB;
    const rawImportance = isA
      ? (params.importanceA ?? params.importance ?? 6)
      : (params.importanceB ?? params.importance ?? 6);
    const calibratedImp = scoreImportance({
      kind: 'conversation',
      description: summary,
      recentMemories: ag.memories,
      participantRating: rawImportance,
    });

    const memoriesAfterAccess = ag.memories.map((m) =>
      accessedSet.has(m.id) ? { ...m, lastAccessed: Math.max(m.lastAccessed, simMin) } : m,
    );

    const obs = createMemoryNode({
      id: alloc.next(`conv_${ag.id}`),
      createdAt: simMin,
      type: 'observation',
      description: summary,
      importance: calibratedImp,
    });

    let nextSchedule = ag.dailySchedule;
    let pinnedFixedId: string | undefined;

    if (sharedFixedBlockTemplate) {
      const fixedId = alloc.next(`commit_${ag.id}`);
      pinnedFixedId = fixedId;
      commitmentsAdded += 1;
      nextSchedule = patchScheduleWithBlock(nextSchedule, {
        ...sharedFixedBlockTemplate,
        id: fixedId,
      });
    } else if (commitment && commitment.activity && validLocs.has(commitment.locationId)) {
      const startMinute = Math.round(commitment.minuteOfDay);
      const resolvedDay = resolveAgreementOrCommitmentDay(
        commitment.day,
        nowInfo.day,
        nowInfo.minuteOfDay,
        startMinute,
      );
      if (resolvedDay !== null) {
        const fixedId = alloc.next(`commit_${ag.id}`);
        pinnedFixedId = fixedId;
        commitmentsAdded += 1;
        const groundedObjId =
          commitment.objectId && validObjIds.has(commitment.objectId)
            ? commitment.objectId
            : state.objects.find(
                (o) => o.locationId === commitment.locationId && o.kind !== 'bed',
              )?.id;
        nextSchedule = patchScheduleWithBlock(nextSchedule, {
          id: fixedId,
          day: resolvedDay,
          kind: 'social',
          fixed: true,
          oneOff: true,
          startMinute,
          durationMinutes: Math.max(
            30,
            Math.min(150, Math.round(commitment.durationMinutes || 60)),
          ),
          locationId: commitment.locationId,
          objectId: groundedObjId,
          activity: commitment.activity,
          emoji: commitment.emoji || '🤝',
          source: 'social_commitment',
        });
      }
    }

    const extraMemories: MemoryNode[] = planUpdate
      ? [
          createMemoryNode({
            id: alloc.next(`plan_${ag.id}`),
            createdAt: simMin,
            type: 'plan',
            description: planUpdate,
            importance: Math.min(10, calibratedImp + 1),
            pinnedFixedBlockId: pinnedFixedId,
          }),
          obs,
        ]
      : resolvedAgreement
        ? [
            createMemoryNode({
              id: alloc.next(`plan_${ag.id}`),
              createdAt: simMin,
              type: 'plan',
              description: `Agreed to meet ${partner.name.split(' ')[0]} at ${resolvedAgreement.locationName} (Day ${resolvedAgreement.day}) for: ${resolvedAgreement.activity}.`,
              importance: Math.min(10, calibratedImp + 1),
              pinnedFixedBlockId: pinnedFixedId,
            }),
            obs,
          ]
        : [obs];

    const speakerQueue = params.turns
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.speakerId === ag.id)
      .map(({ t, idx }) => {
        const showAt = convStartSim + idx * stepPerTurn;
        return {
          text: t.text,
          speakerName: ag.name.split(' ')[0],
          showAtSimMin: showAt,
          expiresAtSimMin: Math.max(state.simMinutes, showAt) + Math.max(2.5, stepPerTurn + 2.5),
        };
      });

    const firstOwnBubble = speakerQueue[0];
    const remainingOwnQueue = speakerQueue.slice(1);

    const nextDrives = {
      ...ag.drives,
      social: Math.min(100, ag.drives.social + 14),
    };
    const nextMood = applyEmotionalAppraisal(
      ag.mood,
      nextDrives,
      shift.deltaValence,
      shift.deltaArousal,
    );
    const nextEdge = updateSocialEdge(ag.socialGraph[partner.id], {
      targetId: partner.id,
      roleLabel: ag.relationships[partner.id] ?? 'Smallville neighbor',
      deltaTrust: tomUpdate?.deltaTrust ?? 4,
      deltaAffection: tomUpdate?.deltaAffection ?? 5,
      deltaFamiliarity: 8,
      inferredGoal: tomUpdate?.inferredGoal,
      simMinutes: simMin,
    });

    // Phase F: Attach A-MEM associative links on new conversation memories & trust-gated belief revision
    let linkedExisting = memoriesAfterAccess;
    const linkedExtras: MemoryNode[] = [];
    for (const em of extraMemories) {
      const linkRes = attachAssociativeLinks(em, linkedExisting);
      linkedExtras.push(linkRes.linkedNode);
      linkedExisting = linkRes.updatedExisting;
    }

    let updatedAgent: AgentState = {
      ...ag,
      isThinking: false,
      inConversationWith: undefined,
      conversationStartedAtSim: undefined,
      currently: planUpdate || ag.currently,
      dailySchedule: nextSchedule,
      actionEmoji: '💬',
      drives: nextDrives,
      mood: nextMood,
      socialGraph: { ...ag.socialGraph, [partner.id]: nextEdge },
      speechBubble: firstOwnBubble
        ? {
            text: firstOwnBubble.text,
            speakerName: firstOwnBubble.speakerName,
            expiresAtSimMin: firstOwnBubble.expiresAtSimMin,
          }
        : ag.speechBubble,
      speechBubbleQueue: remainingOwnQueue.length > 0 ? remainingOwnQueue : undefined,
      memories: compactMemories(
        [...linkedExtras, ...linkedExisting],
        DEFAULT_MEMORY_CAP,
        simMin,
        alloc.next,
      ),
      importanceAccumulator: ag.importanceAccumulator + calibratedImp,
      lastConversedAt: { ...ag.lastConversedAt, [partner.id]: simMin },
    };

    const explicitBeliefs = isA ? params.beliefUpdatesA : params.beliefUpdatesB;
    if (explicitBeliefs && explicitBeliefs.length > 0) {
      for (const bu of explicitBeliefs) {
        // Use partner.id as speaker so stubbornness & trust gate external persuasion
        const speakerForGate = bu.subjectId === ag.id ? ag.id : partner.id;
        const bRes = applyTrustGatedBeliefUpdate(
          updatedAgent,
          speakerForGate,
          {
            subjectId: bu.subjectId,
            predicate: bu.predicate,
            claim: bu.claim,
            confidence: bu.confidence ?? 0.72,
            sourceMemoryId: linkedExtras[0]?.id,
          },
          simMin,
          alloc.next,
        );
        updatedAgent = bRes.agent;
        if (bRes.revised) {
          beliefRevisionsDelta += 1;
        } else if (!bRes.accepted) {
          disagreementsDelta += 1;
        }
      }
    } else if (tomUpdate && (tomUpdate.deltaTrust <= -4 || tomUpdate.deltaTrust >= 6)) {
      const claim =
        tomUpdate.deltaTrust <= -4
          ? `${partner.name} seemed unconvincing or at odds with my priorities (${tomUpdate.inferredGoal}).`
          : `${partner.name} proved dependable and aligned (${tomUpdate.inferredGoal}).`;
      const bRes = applyTrustGatedBeliefUpdate(
        updatedAgent,
        ag.id,
        {
          subjectId: partner.id,
          predicate: 'trustworthiness',
          claim,
          confidence: tomUpdate.deltaTrust <= -4 ? 0.78 : 0.8,
          sourceMemoryId: linkedExtras[0]?.id,
        },
        simMin,
        alloc.next,
      );
      updatedAgent = bRes.agent;
      if (bRes.revised) {
        beliefRevisionsDelta += 1;
      }
    }
    if ((tomUpdate && tomUpdate.deltaTrust < 0) || shift.deltaValence <= -0.08) {
      disagreementsDelta += 1;
    }

    return updatedAgent;
  });

  // Rumour propagation ONLY via validated memeIdsDiscussed (never raw substring matching)
  const validMemeIds = new Set((state.memes ?? []).map((m) => m.id));
  const discussedByA = new Set(
    (params.memeIdsDiscussedA ?? []).filter((id) => validMemeIds.has(id)),
  );
  const discussedByB = new Set(
    (params.memeIdsDiscussedB ?? []).filter((id) => validMemeIds.has(id)),
  );

  let nextMemes: TrackedMeme[] = (state.memes ?? []).map((meme) => {
    const aKnows = Boolean(meme.knownBy[agentA.id]);
    const bKnows = Boolean(meme.knownBy[agentB.id]);
    const aDiscussed = discussedByA.has(meme.id);
    const bDiscussed = discussedByB.has(meme.id);
    if (!aDiscussed && !bDiscussed) return meme;
    if (aKnows && bKnows) return meme;

    let senderId: string | null = null;
    let receiverId: string | null = null;
    if (aKnows && !bKnows && (aDiscussed || bDiscussed)) {
      senderId = agentA.id;
      receiverId = agentB.id;
    } else if (bKnows && !aKnows && (bDiscussed || aDiscussed)) {
      senderId = agentB.id;
      receiverId = agentA.id;
    }
    if (!senderId || !receiverId) return meme;

    const senderTurn = params.turns.find((t) => t.speakerId === senderId);
    const snippet = senderTurn?.text ?? meme.knownBy[senderId]?.snippet ?? meme.topic;
    return {
      ...meme,
      knownBy: {
        ...meme.knownBy,
        [receiverId]: {
          simMinutes: simMin,
          heardFromId: senderId,
          snippet,
        },
      },
    };
  });

  // Optional newNews arrays from either wrapup (skip near-duplicates)
  const addNewsList = (
    originId: string,
    listenerId: string,
    list: Array<{ topic: string; keywords: string[] }> | undefined,
  ) => {
    for (const item of list ?? []) {
      const topic = item.topic?.trim();
      if (!topic || topic.length < 6) continue;
      const keywords =
        item.keywords && item.keywords.length > 0
          ? item.keywords.slice(0, 6)
          : extractKeywords(topic).slice(0, 6);
      if (isNearDuplicateMeme(nextMemes, topic, keywords)) continue;
      nextMemes = [
        {
          id: alloc.next('meme_conv'),
          topic,
          keywords,
          originAgentId: originId,
          createdAt: simMin,
          knownBy: {
            [originId]: { simMinutes: simMin, heardFromId: originId, snippet: topic },
            [listenerId]: { simMinutes: simMin, heardFromId: originId, snippet: topic },
          },
        },
        ...nextMemes,
      ].slice(0, 20);
    }
  };
  addNewsList(agentA.id, agentB.id, params.newNewsA);
  addNewsList(agentB.id, agentA.id, params.newNewsB);

  const convRecord: ConversationRecord = {
    id: alloc.next(`dlg_${agentA.id}_${agentB.id}`),
    simMinutes: simMin,
    locationId: loc.id,
    locationName: loc.name,
    participantIds: [agentA.id, agentB.id],
    participantNames: [agentA.name, agentB.name],
    turns: params.turns,
    summary: params.summaryA,
    reason: params.reason,
    endedBy: params.endedBy,
    agreement: resolvedAgreement,
  };

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_conv_${agentA.id}`),
    simMinutes: simMin,
    type: 'conversation',
    title: `${agentA.name.split(' ')[0]} & ${agentB.name.split(' ')[0]} conversed`,
    detail: resolvedAgreement
      ? `${params.summaryA} Agreed: Day ${resolvedAgreement.day} at ${resolvedAgreement.locationName} (${resolvedAgreement.activity}).`
      : params.summaryA,
    agentIds: [agentA.id, agentB.id],
    locationName: loc.name,
  };

  const discussedAllIds = Array.from(new Set([...discussedByA, ...discussedByB]));

  let postWorld: WorldState = {
    ...state,
    idSeq: alloc.seq(),
    agents: nextAgents,
    memes: nextMemes,
    stats: {
      ...(state.stats ?? {
        system1Greetings: 0,
        driveInterrupts: 0,
        perceptionEvents: 0,
        socialCommitments: 0,
        llmCallsSaved: 0,
      }),
      socialCommitments: (state.stats?.socialCommitments ?? 0) + commitmentsAdded,
      compressedScenes: (state.stats?.compressedScenes ?? 0) + (params.compressed ? 1 : 0),
      beliefRevisions: (state.stats?.beliefRevisions ?? 0) + beliefRevisionsDelta,
      refusalsAndDisagreements: (state.stats?.refusalsAndDisagreements ?? 0) + disagreementsDelta,
      conversationsTotal: (state.stats?.conversationsTotal ?? 0) + 1,
    },
    conversations: state.conversations,
    chronicle: [chrEvent, ...state.chronicle].slice(0, 140),
  };

  // Phase B: Third-party gossip propagation & ambient room overhearing
  if (params.gossipUpdates && params.gossipUpdates.length > 0) {
    postWorld = applyGossipUpdates(postWorld, params.gossipUpdates, alloc.next).world;
  }

  // Execute any bilateral deal negotiated explicitly inside the dialogue (loan, transfer, petition support, or refusal)
  if (params.bilateralDeal) {
    postWorld = applyNegotiatedDeal(postWorld, params.bilateralDeal, alloc.next).world;
  }

  const sampleLine = params.turns[0]?.text ?? params.summaryA;
  const overhearRes = applyAmbientOverhearing(
    postWorld,
    {
      participantIds: [agentA.id, agentB.id],
      locationId: agentA.currentLocationId ?? 'outdoors',
      locationName: loc.name,
      summary: params.summaryA,
      sampleLine,
      discussedMemeIds: discussedAllIds,
    },
    alloc.next,
  );
  postWorld = overhearRes.world;

  const finalConvRecord: ConversationRecord = {
    ...convRecord,
    compressed: params.compressed,
    overheardByIds: overhearRes.overheardByIds.length > 0 ? overhearRes.overheardByIds : undefined,
    gossipUpdates: params.gossipUpdates && params.gossipUpdates.length > 0 ? params.gossipUpdates : undefined,
  };

  return {
    ...postWorld,
    idSeq: alloc.seq(),
    conversations: [finalConvRecord, ...postWorld.conversations].slice(0, 40),
  };
}

/**
 * Applies a 1-call compressed multi-party or dyadic scene (2..4 participants),
 * updating every participant's memory, mood, ToM edges, gossip, overhearing, and shared plans.
 */
export function applyGroupSceneResult(
  state: WorldState,
  params: {
    participantIds: string[];
    turns: ConversationTurn[];
    summaryByAgent: Record<string, { summary: string; importance: number; planUpdate?: string }>;
    emotionalShiftByAgent?: Record<string, EmotionalShift>;
    tomUpdates?: Array<{
      fromId: string;
      targetId: string;
      deltaTrust: number;
      deltaAffection: number;
      inferredGoal: string;
    }>;
    beliefUpdatesByAgent?: Record<string, ExtractedBeliefUpdate[]>;
    bilateralDeal?: NegotiatedDeal;
    gossipUpdates?: GossipUpdate[];
    memeIdsDiscussed?: string[];
    newNews?: Array<{ topic: string; keywords: string[] }>;
    sharedAgreement?: {
      day: 'today' | 'tomorrow' | number;
      minuteOfDay: number;
      durationMinutes?: number;
      locationId: string;
      objectId?: string;
      activity: string;
      emoji?: string;
    };
    reason?: string;
    stampSimMinutes?: number;
  },
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const participants = params.participantIds
    .map((id) => state.agents.find((a) => a.id === id))
    .filter((a): a is AgentState => Boolean(a));
  if (participants.length < 2) return state;

  const partSet = new Set(participants.map((p) => p.id));
  const simMin = params.stampSimMinutes ?? state.simMinutes;
  const nowInfo = formatSimTime(simMin);
  const anchor = participants[0];
  const loc =
    (anchor.currentLocationId
      ? state.locations.find((l) => l.id === anchor.currentLocationId)
      : undefined) ?? state.locations[0];

  const validLocs = new Set(state.locations.map((l) => l.id));
  const validObjIds = new Set(state.objects.map((o) => o.id));
  let resolvedAgreement: ConversationAgreement | undefined;
  let sharedFixedBlockTemplate: Omit<ScheduleBlock, 'id'> | undefined;

  if (params.sharedAgreement && validLocs.has(params.sharedAgreement.locationId)) {
    const startMinute = Math.round(params.sharedAgreement.minuteOfDay);
    const resolvedDay = resolveAgreementOrCommitmentDay(
      params.sharedAgreement.day,
      nowInfo.day,
      nowInfo.minuteOfDay,
      startMinute,
    );
    if (resolvedDay !== null) {
      const durationMinutes = Math.max(
        30,
        Math.min(150, Math.round(params.sharedAgreement.durationMinutes ?? 60)),
      );
      const groundedObj =
        params.sharedAgreement.objectId && validObjIds.has(params.sharedAgreement.objectId)
          ? params.sharedAgreement.objectId
          : state.objects.find(
              (o) => o.locationId === params.sharedAgreement!.locationId && o.kind !== 'bed',
            )?.id;
      const agreedLocName =
        state.locations.find((l) => l.id === params.sharedAgreement!.locationId)?.name ??
        params.sharedAgreement.locationId;
      resolvedAgreement = {
        day: resolvedDay,
        minuteOfDay: startMinute,
        locationId: params.sharedAgreement.locationId,
        locationName: agreedLocName,
        activity: params.sharedAgreement.activity,
      };
      sharedFixedBlockTemplate = {
        day: resolvedDay,
        kind: 'social',
        fixed: true,
        oneOff: true,
        startMinute,
        durationMinutes,
        locationId: params.sharedAgreement.locationId,
        objectId: groundedObj,
        activity: params.sharedAgreement.activity,
        emoji: params.sharedAgreement.emoji || '🤝',
        source: 'social_commitment',
      };
    }
  }

  let commitmentsAdded = 0;
  const totalSpan = Math.max(1.5, params.turns.length * 1.5);
  const convStartSim = Math.max(0, simMin - totalSpan);
  const stepPerTurn = totalSpan / Math.max(1, params.turns.length);
  const fallbackSummary = `${participants.map((p) => p.name.split(' ')[0]).join(', ')} talked together at ${loc.name}.`;

  let beliefRevisionsDelta = 0;
  let disagreementsDelta = 0;

  let nextAgents = state.agents.map((ag) => {
    if (!partSet.has(ag.id)) return ag;
    const sumEntry = params.summaryByAgent[ag.id] ?? { summary: fallbackSummary, importance: 5 };
    const shift = params.emotionalShiftByAgent?.[ag.id] ?? { deltaValence: 0.08, deltaArousal: 0.06 };
    const calibratedImp = scoreImportance({
      kind: 'conversation',
      description: sumEntry.summary,
      recentMemories: ag.memories,
      participantRating: sumEntry.importance,
    });

    const convMem = createMemoryNode({
      id: alloc.next(`conv_${ag.id}`),
      createdAt: simMin,
      type: 'observation',
      source: 'conversation',
      description: sumEntry.summary,
      importance: calibratedImp,
    });

    const nextDrives = {
      ...ag.drives,
      social: Math.min(100, ag.drives.social + 18),
    };
    const nextMood = applyEmotionalAppraisal(
      ag.mood,
      nextDrives,
      shift.deltaValence,
      shift.deltaArousal,
    );

    const nextSocialGraph = { ...ag.socialGraph };
    const nextLastConversed = { ...ag.lastConversedAt };
    for (const peer of participants) {
      if (peer.id === ag.id) continue;
      nextLastConversed[peer.id] = simMin;
      const tom = params.tomUpdates?.find((u) => u.fromId === ag.id && u.targetId === peer.id);
      if (tom && tom.deltaTrust < 0) {
        disagreementsDelta += 1;
      }
      nextSocialGraph[peer.id] = updateSocialEdge(nextSocialGraph[peer.id], {
        targetId: peer.id,
        roleLabel: nextSocialGraph[peer.id]?.roleLabel ?? peer.occupation,
        deltaTrust: tom?.deltaTrust ?? 3,
        deltaAffection: tom?.deltaAffection ?? 3,
        deltaFamiliarity: 7,
        inferredGoal: tom?.inferredGoal ?? peer.currently,
        simMinutes: simMin,
      });
    }

    let nextSchedule = ag.dailySchedule;
    if (sharedFixedBlockTemplate) {
      const fixedBlk: ScheduleBlock = {
        ...sharedFixedBlockTemplate,
        id: alloc.next(`commit_${ag.id}`),
      };
      nextSchedule = patchScheduleWithBlock(nextSchedule, fixedBlk);
      commitmentsAdded += 1;
    }

    const myTurns = params.turns
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.speakerId === ag.id);
    const firstTurn = myTurns[0];
    const remainingTurns = myTurns.slice(1);

    const linkRes = attachAssociativeLinks(convMem, ag.memories);
    let updatedAgent: AgentState = {
      ...ag,
      isThinking: false,
      inConversationWith: undefined,
      conversationStartedAtSim: undefined,
      currently: sumEntry.planUpdate?.trim() ? sumEntry.planUpdate.trim() : ag.currently,
      drives: nextDrives,
      mood: nextMood,
      socialGraph: nextSocialGraph,
      lastConversedAt: nextLastConversed,
      dailySchedule: nextSchedule,
      memories: compactMemories(
        [linkRes.linkedNode, ...linkRes.updatedExisting],
        DEFAULT_MEMORY_CAP,
        simMin,
        alloc.next,
      ),
      importanceAccumulator: ag.importanceAccumulator + calibratedImp,
      speechBubble: firstTurn
        ? {
            text: firstTurn.t.text,
            speakerName: ag.name.split(' ')[0],
            expiresAtSimMin: Math.max(simMin + 3, convStartSim + (firstTurn.idx + 1) * stepPerTurn + 2),
          }
        : ag.speechBubble,
      speechBubbleQueue: remainingTurns.map(({ t, idx }) => ({
        text: t.text,
        speakerName: ag.name.split(' ')[0],
        showAtSimMin: simMin + idx * 1.4,
        expiresAtSimMin: simMin + idx * 1.4 + 4.5,
      })),
    };

    const explicitBeliefs = params.beliefUpdatesByAgent?.[ag.id] ?? [];
    for (const bu of explicitBeliefs) {
      let inferredSpeaker = bu.speakerId && partSet.has(bu.speakerId) ? bu.speakerId : undefined;
      if (!inferredSpeaker && bu.subjectId !== ag.id) {
        const subjectAgent = participants.find((p) => p.id === bu.subjectId);
        const subjectTokens = subjectAgent
          ? [subjectAgent.id.toLowerCase(), subjectAgent.name.split(' ')[0].toLowerCase()]
          : [bu.subjectId.toLowerCase()];
        const claimTokens = extractKeywords(bu.claim).slice(0, 4);
        const matchingTurn = params.turns.find((t) => {
          if (t.speakerId === ag.id) return false;
          const low = t.text.toLowerCase();
          return (
            subjectTokens.some((tok) => low.includes(tok)) ||
            claimTokens.some((tok) => low.includes(tok))
          );
        });
        inferredSpeaker =
          matchingTurn?.speakerId ?? participants.find((p) => p.id !== ag.id)?.id ?? ag.id;
      }
      const speakerId = bu.subjectId === ag.id ? ag.id : (inferredSpeaker ?? ag.id);
      const bRes = applyTrustGatedBeliefUpdate(
        updatedAgent,
        speakerId,
        {
          subjectId: bu.subjectId,
          predicate: bu.predicate,
          claim: bu.claim,
          confidence: bu.confidence ?? 0.72,
          sourceMemoryId: linkRes.linkedNode.id,
        },
        simMin,
        alloc.next,
      );
      updatedAgent = bRes.agent;
      if (bRes.revised) {
        beliefRevisionsDelta += 1;
      } else if (!bRes.accepted) {
        disagreementsDelta += 1;
      }
    }
    if (shift.deltaValence <= -0.08) {
      disagreementsDelta += 1;
    }

    return updatedAgent;
  });

  // Recompute reputations
  nextAgents = nextAgents.map((a) =>
    partSet.has(a.id) ? { ...a, reputation: computeResidentReputation(a.id, nextAgents) } : a,
  );

  // Propagate discussed memes among all group participants
  const discussedSet = new Set(params.memeIdsDiscussed ?? []);
  let nextMemes: TrackedMeme[] = (state.memes ?? []).map((meme) => {
    if (!discussedSet.has(meme.id)) return meme;
    const knower = participants.find((p) => Boolean(meme.knownBy[p.id]));
    if (!knower) return meme;
    const nextKnownBy = { ...meme.knownBy };
    const sampleTurn = params.turns.find((t) => t.speakerId === knower.id)?.text ?? meme.topic;
    for (const p of participants) {
      if (!nextKnownBy[p.id]) {
        nextKnownBy[p.id] = {
          simMinutes: simMin,
          heardFromId: knower.id,
          snippet: sampleTurn.slice(0, 120),
        };
      }
    }
    return { ...meme, knownBy: nextKnownBy };
  });

  for (const item of params.newNews ?? []) {
    const topic = item.topic?.trim();
    if (!topic || topic.length < 6) continue;
    const keywords = item.keywords.length > 0 ? item.keywords.slice(0, 6) : extractKeywords(topic).slice(0, 6);
    if (isNearDuplicateMeme(nextMemes, topic, keywords)) continue;
    const knownBy: TrackedMeme['knownBy'] = {};
    for (const p of participants) {
      knownBy[p.id] = { simMinutes: simMin, heardFromId: anchor.id, snippet: topic };
    }
    nextMemes = [
      {
        id: alloc.next('meme_grp'),
        topic,
        keywords,
        originAgentId: anchor.id,
        createdAt: simMin,
        knownBy,
      },
      ...nextMemes,
    ].slice(0, 20);
  }

  const mainSummary = params.summaryByAgent[anchor.id]?.summary ?? fallbackSummary;
  const isGroup = participants.length > 2;
  const titleNames = participants.map((p) => p.name.split(' ')[0]).join(', ');

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_grp_${anchor.id}`),
    simMinutes: simMin,
    type: 'conversation',
    title: isGroup ? `Group talk: ${titleNames}` : `${titleNames} conversed`,
    detail: resolvedAgreement
      ? `${mainSummary} Agreed: Day ${resolvedAgreement.day} at ${resolvedAgreement.locationName} (${resolvedAgreement.activity}).`
      : mainSummary,
    agentIds: participants.map((p) => p.id),
    locationName: loc.name,
  };

  let postWorld: WorldState = {
    ...state,
    idSeq: alloc.seq(),
    agents: nextAgents,
    memes: nextMemes,
    stats: {
      ...state.stats,
      socialCommitments: (state.stats?.socialCommitments ?? 0) + commitmentsAdded,
      compressedScenes: (state.stats?.compressedScenes ?? 0) + 1,
      beliefRevisions: (state.stats?.beliefRevisions ?? 0) + beliefRevisionsDelta,
      refusalsAndDisagreements: (state.stats?.refusalsAndDisagreements ?? 0) + disagreementsDelta,
      conversationsTotal: (state.stats?.conversationsTotal ?? 0) + 1,
    },
    chronicle: [chrEvent, ...state.chronicle].slice(0, 140),
  };

  if (params.gossipUpdates && params.gossipUpdates.length > 0) {
    postWorld = applyGossipUpdates(postWorld, params.gossipUpdates, alloc.next).world;
  }

  if (params.bilateralDeal) {
    postWorld = applyNegotiatedDeal(postWorld, params.bilateralDeal, alloc.next).world;
  }

  const overhearRes = applyAmbientOverhearing(
    postWorld,
    {
      participantIds: participants.map((p) => p.id),
      locationId: anchor.currentLocationId ?? 'outdoors',
      locationName: loc.name,
      summary: mainSummary,
      sampleLine: params.turns[0]?.text ?? mainSummary,
      discussedMemeIds: Array.from(discussedSet),
    },
    alloc.next,
  );
  postWorld = overhearRes.world;

  const convRecord: ConversationRecord = {
    id: alloc.next(`dlg_grp_${anchor.id}`),
    simMinutes: simMin,
    locationId: loc.id,
    locationName: loc.name,
    participantIds: participants.map((p) => p.id),
    participantNames: participants.map((p) => p.name),
    turns: params.turns,
    summary: mainSummary,
    reason: params.reason,
    agreement: resolvedAgreement,
    isGroup,
    compressed: true,
    overheardByIds: overhearRes.overheardByIds.length > 0 ? overhearRes.overheardByIds : undefined,
    gossipUpdates: params.gossipUpdates && params.gossipUpdates.length > 0 ? params.gossipUpdates : undefined,
  };

  return {
    ...postWorld,
    idSeq: alloc.seq(),
    conversations: [convRecord, ...postWorld.conversations].slice(0, 40),
  };
}

export function applyAutonomousDecision(
  state: WorldState,
  agentId: string,
  decision: BdiDecisionResult,
  options?: { deferUntilArrival?: boolean },
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const next = applyBdiDecisionResult(
    state,
    agentId,
    decision,
    alloc.next,
    patchScheduleWithBlock,
    options,
  );
  return {
    ...next,
    idSeq: alloc.seq(),
  };
}

export function applyReflectionResult(
  state: WorldState,
  agentId: string,
  reflections: Array<{ insight: string; importance: number; evidenceIds: string[] }>,
  accessedMemoryIds: string[] = [],
  beliefUpdates: ExtractedBeliefUpdate[] = [],
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const simMin = state.simMinutes;
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const citedCounts = new Map<string, number>();
  for (const ref of reflections) {
    for (const id of ref.evidenceIds ?? []) {
      citedCounts.set(id, (citedCounts.get(id) ?? 0) + 1);
    }
  }
  const accessedSet = new Set(accessedMemoryIds);

  const newNodes = reflections.map((ref) =>
    createMemoryNode({
      id: alloc.next(`refl_${agentId}`),
      createdAt: simMin,
      type: 'reflection',
      description: ref.insight,
      importance: scoreImportance({
        kind: 'reflection',
        description: ref.insight,
        recentMemories: agent.memories,
      }),
      evidenceIds: ref.evidenceIds,
    }),
  );

  let beliefRevisionsDelta = 0;
  const nextAgents = state.agents.map((ag) => {
    if (ag.id !== agentId) return ag;
    let memPool = ag.memories.map((m) => {
      const addCite = citedCounts.get(m.id) ?? 0;
      const wasAccessed = accessedSet.has(m.id);
      if (addCite === 0 && !wasAccessed) return m;
      return {
        ...m,
        timesCited: (m.timesCited ?? 0) + addCite,
        lastAccessed: wasAccessed ? Math.max(m.lastAccessed, simMin) : m.lastAccessed,
      };
    });
    const linkedNewNodes: MemoryNode[] = [];
    for (const node of newNodes) {
      const linkRes = attachAssociativeLinks(node, [...linkedNewNodes, ...memPool]);
      linkedNewNodes.push(linkRes.linkedNode);
      memPool = linkRes.updatedExisting.slice(linkedNewNodes.length - 1);
    }
    let updatedAgent: AgentState = {
      ...ag,
      isThinking: false,
      importanceAccumulator: 0,
      actionEmoji: '💭',
      drives: { ...ag.drives, purpose: Math.min(100, ag.drives.purpose + 8) },
      memories: compactMemories(
        [...linkedNewNodes, ...memPool],
        DEFAULT_MEMORY_CAP,
        simMin,
        alloc.next,
      ),
    };
    for (const bu of beliefUpdates) {
      const bRes = applyTrustGatedBeliefUpdate(
        updatedAgent,
        agentId,
        {
          subjectId: bu.subjectId,
          predicate: bu.predicate,
          claim: bu.claim,
          confidence: bu.confidence ?? 0.76,
          sourceMemoryId: linkedNewNodes[0]?.id,
        },
        simMin,
        alloc.next,
      );
      updatedAgent = bRes.agent;
      if (bRes.revised) beliefRevisionsDelta += 1;
    }
    return updatedAgent;
  });

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_refl_${agentId}`),
    simMinutes: simMin,
    type: 'reflection',
    title: `${agent.name} formed ${reflections.length} reflections`,
    detail: reflections[0]?.insight ?? 'Synthesized recent experiences.',
    agentIds: [agentId],
    locationName: state.locations.find((l) => l.id === agent.currentLocationId)?.name,
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    agents: nextAgents,
    stats:
      beliefRevisionsDelta > 0
        ? {
            ...state.stats,
            beliefRevisions: (state.stats.beliefRevisions ?? 0) + beliefRevisionsDelta,
          }
        : state.stats,
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

export function applyFailedReflectionFallback(state: WorldState, agentId: string): WorldState {
  return {
    ...state,
    agents: state.agents.map((ag) =>
      ag.id === agentId
        ? {
            ...ag,
            isThinking: false,
            importanceAccumulator: Math.floor(ag.importanceAccumulator / 2),
          }
        : ag,
    ),
  };
}

export function applyConsolidationResult(
  state: WorldState,
  agentId: string,
  params: {
    consolidatedInsights: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
    prunedMemoryIds?: string[];
    socialUpdates?: Array<{ targetId: string; inferredGoal: string; deltaTrust?: number }>;
    beliefUpdates?: ExtractedBeliefUpdate[];
  },
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const simMin = state.simMinutes;
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const pruneSet = new Set(params.prunedMemoryIds ?? []);
  const citedCounts = new Map<string, number>();
  for (const c of params.consolidatedInsights) {
    for (const id of c.evidenceIds ?? []) {
      citedCounts.set(id, (citedCounts.get(id) ?? 0) + 1);
    }
  }

  const newNodes = params.consolidatedInsights.map((c) =>
    createMemoryNode({
      id: alloc.next(`cons_${agentId}`),
      createdAt: simMin,
      type: 'consolidated',
      description: c.insight,
      importance: Math.max(
        c.importance,
        scoreImportance({
          kind: 'consolidated',
          description: c.insight,
          recentMemories: agent.memories,
        }),
      ),
      evidenceIds: c.evidenceIds,
    }),
  );

  // Phase 4 Rule 8: consolidation may prune ONLY existing memories with importance <= 4
  let actuallyPrunedCount = 0;
  let keptMemories = agent.memories
    .filter((m) => {
      if (pruneSet.has(m.id) && m.importance <= 4) {
        actuallyPrunedCount += 1;
        return false;
      }
      return true;
    })
    .map((m) => {
      const addCite = citedCounts.get(m.id) ?? 0;
      if (addCite === 0) return m;
      return {
        ...m,
        timesCited: (m.timesCited ?? 0) + addCite,
      };
    });

  const linkedNewNodes: MemoryNode[] = [];
  for (const node of newNodes) {
    const linkRes = attachAssociativeLinks(node, [...linkedNewNodes, ...keptMemories]);
    linkedNewNodes.push(linkRes.linkedNode);
    keptMemories = linkRes.updatedExisting.slice(linkedNewNodes.length - 1);
  }

  const nextSocialGraph = { ...agent.socialGraph };
  for (const su of params.socialUpdates ?? []) {
    if (su.targetId && su.targetId !== agentId) {
      nextSocialGraph[su.targetId] = updateSocialEdge(nextSocialGraph[su.targetId], {
        targetId: su.targetId,
        roleLabel: agent.relationships[su.targetId] ?? 'Smallville neighbor',
        deltaTrust: su.deltaTrust ?? 0,
        deltaAffection: 0,
        deltaFamiliarity: 2,
        inferredGoal: su.inferredGoal,
        simMinutes: simMin,
      });
    }
  }

  const nextDrives = {
    ...agent.drives,
    energy: Math.min(100, Math.max(agent.drives.energy, 88)),
  };

  let beliefRevisionsDelta = 0;
  const nextAgents = state.agents.map((ag) => {
    if (ag.id !== agentId) return ag;
    let updatedAgent: AgentState = {
      ...ag,
      isThinking: false,
      importanceAccumulator: Math.floor(ag.importanceAccumulator * 0.5),
      actionEmoji: '🛌',
      drives: nextDrives,
      mood: applyEmotionalAppraisal(ag.mood, nextDrives, 0.1, -0.15),
      socialGraph: nextSocialGraph,
      memories: compactMemories(
        [...linkedNewNodes, ...keptMemories],
        DEFAULT_MEMORY_CAP,
        simMin,
        alloc.next,
      ),
    };
    for (const bu of params.beliefUpdates ?? []) {
      const bRes = applyTrustGatedBeliefUpdate(
        updatedAgent,
        agentId,
        {
          subjectId: bu.subjectId,
          predicate: bu.predicate,
          claim: bu.claim,
          confidence: bu.confidence ?? 0.78,
          sourceMemoryId: linkedNewNodes[0]?.id,
        },
        simMin,
        alloc.next,
      );
      updatedAgent = bRes.agent;
      if (bRes.revised) beliefRevisionsDelta += 1;
    }
    return updatedAgent;
  });

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_cons_${agentId}`),
    simMinutes: simMin,
    type: 'consolidation',
    title: `${agent.name} consolidated ${newNodes.length} sleep memories`,
    detail:
      params.consolidatedInsights[0]?.insight ??
      `Synthesized day’s experiences and pruned ${actuallyPrunedCount} routine observations.`,
    agentIds: [agentId],
    locationName: state.locations.find((l) => l.id === agent.homeLocationId)?.name,
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    agents: nextAgents,
    stats:
      beliefRevisionsDelta > 0
        ? {
            ...state.stats,
            beliefRevisions: (state.stats.beliefRevisions ?? 0) + beliefRevisionsDelta,
          }
        : state.stats,
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

export function applyPlanResult(
  state: WorldState,
  agentId: string,
  res: {
    updatedSummary: string;
    blocks: Array<{
      kind?: ScheduleBlockKind;
      startMinute: number;
      durationMinutes: number;
      locationId: string;
      objectId?: string;
      activity: string;
      subSteps?: string[];
      emoji: string;
    }>;
  },
  options: { isMorningPlan?: boolean; accessedMemoryIds?: string[] } = {},
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const isMorningPlan = Boolean(options.isMorningPlan);
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const timeInfo = formatSimTime(state.simMinutes);
  const validLocIds = new Set(state.locations.map((l) => l.id));
  const objLocationById = new Map(state.objects.map((o) => [o.id, o.locationId]));
  const defaultObjByLocation = new Map<string, string>();
  for (const o of state.objects) {
    if (o.kind !== 'bed' && !defaultObjByLocation.has(o.locationId)) {
      defaultObjByLocation.set(o.locationId, o.id);
    }
  }
  const homeBedId = getHomeBedObjectId(agent.homeLocationId, state.objects);

  // Surgical re-plan boundary: for mid-day re-plans, find the next fixed commitment on today (if any)
  const fixedTodayFuture = agent.dailySchedule
    .filter(
      (b) =>
        b.day === timeInfo.day &&
        b.fixed &&
        (isMorningPlan || b.startMinute + b.durationMinutes > timeInfo.minuteOfDay),
    )
    .sort((a, b) => a.startMinute - b.startMinute);

  const nextFixedStart = !isMorningPlan
    ? fixedTodayFuture.find((b) => b.startMinute >= timeInfo.minuteOfDay)?.startMinute ?? 1440
    : 1440;

  // Preserve future days, past blocks on re-plan, fixed blocks, AND non-fixed blocks at/after nextFixedStart on re-plan
  const preservedBlocks: ScheduleBlock[] = [];
  for (const b of agent.dailySchedule) {
    if (b.day > timeInfo.day) {
      preservedBlocks.push(b);
      continue;
    }
    if (b.day < timeInfo.day) continue;
    if (b.fixed) {
      if (isMorningPlan || b.startMinute + b.durationMinutes > timeInfo.minuteOfDay) {
        preservedBlocks.push(b);
      }
      continue;
    }
    if (!isMorningPlan) {
      if (b.startMinute < timeInfo.minuteOfDay) {
        // Trim any active block up to now so nothing overlaps the surgical window
        const cappedDur = Math.min(b.durationMinutes, timeInfo.minuteOfDay - b.startMinute);
        if (cappedDur >= 10) {
          preservedBlocks.push({ ...b, durationMinutes: cappedDur });
        }
      } else if (b.startMinute >= nextFixedStart) {
        preservedBlocks.push(b);
      }
    }
  }

  const rawNewBlocks: ScheduleBlock[] = res.blocks.map((b) => {
    const resolvedLocId = validLocIds.has(b.locationId) ? b.locationId : agent.homeLocationId;
    const objLoc = b.objectId ? objLocationById.get(b.objectId) : undefined;
    const resolvedObjId =
      objLoc === resolvedLocId ? b.objectId : defaultObjByLocation.get(resolvedLocId);
    return {
      id: alloc.next(`${isMorningPlan ? 'morn' : 'replan'}_${agentId}`),
      day: timeInfo.day,
      kind: b.kind ?? 'work',
      startMinute: b.startMinute,
      durationMinutes: b.durationMinutes,
      locationId: resolvedLocId,
      objectId: resolvedObjId,
      activity: b.activity,
      subSteps: b.subSteps,
      emoji: b.emoji || '📅',
      source: (isMorningPlan ? 'morning_plan' : 'llm_replan') as 'morning_plan' | 'llm_replan',
    };
  });

  // For surgical re-plan, keep candidate blocks strictly within [minuteOfDay, nextFixedStart)
  const scopedCandidates = isMorningPlan
    ? rawNewBlocks
    : rawNewBlocks
        .filter((nb) => nb.startMinute < nextFixedStart && nb.startMinute + nb.durationMinutes > timeInfo.minuteOfDay)
        .map((nb) => {
          const clampedStart = Math.max(timeInfo.minuteOfDay, nb.startMinute);
          const maxEnd = Math.min(nextFixedStart, clampedStart + nb.durationMinutes);
          return {
            ...nb,
            startMinute: clampedStart,
            durationMinutes: Math.max(15, maxEnd - clampedStart),
          };
        });

  const todayPreservedFixed = preservedBlocks.filter(
    (b) => b.day === timeInfo.day && (b.fixed || (!isMorningPlan && (b.startMinute < timeInfo.minuteOfDay || b.startMinute >= nextFixedStart))),
  );

  const validatedToday = validateAndRepairPlanBlocks({
    day: timeInfo.day,
    isMorningPlan,
    homeLocationId: agent.homeLocationId,
    homeBedObjectId: homeBedId,
    validLocationIds: validLocIds,
    objectLocationById: objLocationById,
    defaultObjectByLocation: defaultObjByLocation,
    fixedBlocksToday: todayPreservedFixed,
    candidateBlocks: scopedCandidates,
  });

  const futureDayBlocks = preservedBlocks.filter((b) => b.day > timeInfo.day);
  const mergedSchedule = [...validatedToday, ...futureDayBlocks].sort(
    (a, b) => a.day - b.day || a.startMinute - b.startMinute,
  );

  const planDesc = `${agent.name} ${isMorningPlan ? `planned Day ${timeInfo.day}` : 'updated today’s plan'}: ${res.updatedSummary}`;
  const planMemory = createMemoryNode({
    id: alloc.next(`plan_mem_${agentId}`),
    createdAt: state.simMinutes,
    type: 'plan',
    source: 'plan',
    description: planDesc,
    importance: scoreImportance({
      kind: 'plan',
      description: planDesc,
      recentMemories: agent.memories,
    }),
  });

  const accessedSet = new Set(options.accessedMemoryIds ?? []);

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_plan_${agentId}`),
    simMinutes: state.simMinutes,
    type: 'plan',
    title: `${agent.name} ${isMorningPlan ? `synthesized Day ${timeInfo.day} plan` : 'revised daily schedule'}`,
    detail: res.updatedSummary,
    agentIds: [agentId],
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    agents: state.agents.map((a) => {
      if (a.id !== agentId) return a;
      const updatedOld = a.memories.map((m) =>
        accessedSet.has(m.id)
          ? { ...m, lastAccessed: Math.max(m.lastAccessed, state.simMinutes) }
          : m,
      );
      return {
        ...a,
        isThinking: false,
        currently: res.updatedSummary,
        dailySchedule: mergedSchedule,
        activeScheduleId: undefined,
        lastReplannedDay: isMorningPlan ? timeInfo.day : a.lastReplannedDay,
        memories: compactMemories(
          [planMemory, ...updatedOld],
          DEFAULT_MEMORY_CAP,
          state.simMinutes,
          alloc.next,
        ),
      };
    }),
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

/**
 * Fallback routine after 3 failed morning plan calls so other residents never stall,
 * keeping existing future/fixed commitments intact.
 */
export function applyFallbackPlan(state: WorldState, agentId: string): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const timeInfo = formatSimTime(state.simMinutes);
  const seedAgent = createScenarioAgents(
    state.scenarioId ?? 'default',
    state.simMinutes,
  ).find((a) => a.id === agentId);
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const keptFixedAndFuture = agent.dailySchedule.filter(
    (b) => b.day > timeInfo.day || (b.day === timeInfo.day && b.fixed),
  );
  const fixedToday = keptFixedAndFuture.filter((b) => b.day === timeInfo.day && b.fixed);

  const routineBlocks = (seedAgent?.dailySchedule ?? agent.dailySchedule)
    .filter((b) => b.source !== 'drive_interrupt' && !b.oneOff)
    .filter((b) => !resolveDayBlockCollision(b, fixedToday))
    .map((b) => ({
      ...b,
      id: alloc.next(`fallback_${agentId}`),
      day: timeInfo.day,
      source: 'seed' as const,
    }));

  const merged = [...keptFixedAndFuture, ...routineBlocks].sort(
    (a, b) => a.day - b.day || a.startMinute - b.startMinute,
  );

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_fallback_${agentId}`),
    simMinutes: state.simMinutes,
    type: 'plan',
    title: `${agent.name} fell back to daily routine for Day ${timeInfo.day}`,
    detail: 'Reused baseline schedule after repeated morning plan call failures.',
    agentIds: [agentId],
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    agents: state.agents.map((a) =>
      a.id === agentId
        ? {
            ...a,
            isThinking: false,
            dailySchedule: merged.length > 0 ? merged : a.dailySchedule,
            activeScheduleId: undefined,
            lastReplannedDay: timeInfo.day,
          }
        : a,
    ),
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

export function applyReactionResult(
  state: WorldState,
  agentId: string,
  res: {
    react: boolean;
    reason: string;
    newActivity?: string;
    kind?: ScheduleBlockKind;
    locationId?: string;
    objectId?: string;
    durationMinutes?: number;
    emoji?: string;
    talkTo?: string;
  },
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const timeInfo = formatSimTime(state.simMinutes);
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const reactionDay = state.reactionDay === timeInfo.day ? timeInfo.day : timeInfo.day;
  const prevCounts = state.reactionDay === timeInfo.day ? (state.reactionsTodayByAgent ?? {}) : {};
  const currentCount = prevCounts[agentId] ?? 0;

  // Hard cap: max 4 reactions per resident per sim day
  if (currentCount >= 4) {
    return clearAgentThinkingState(state, [agentId], false);
  }

  const nextCounts = { ...prevCounts, [agentId]: currentCount + 1 };
  const nextLastSim = { ...(state.lastReactionSimByAgent ?? {}), [agentId]: state.simMinutes };

  if (!res.react || !res.newActivity) {
    return {
      ...clearAgentThinkingState(state, [agentId], false),
      reactionDay,
      reactionsTodayByAgent: nextCounts,
      lastReactionSimByAgent: nextLastSim,
    };
  }

  // Surgically patch ONLY from now until the next fixed block on today
  const nextFixedStart =
    agent.dailySchedule
      .filter((b) => b.day === timeInfo.day && b.fixed && b.startMinute >= timeInfo.minuteOfDay)
      .sort((a, b) => a.startMinute - b.startMinute)[0]?.startMinute ?? 1440;

  const activeBlock = getActiveScheduleBlock(
    agent.dailySchedule,
    timeInfo.day,
    timeInfo.minuteOfDay,
    agent.homeLocationId,
  );
  if (activeBlock?.fixed) {
    return {
      ...clearAgentThinkingState(state, [agentId], false),
      reactionDay,
      reactionsTodayByAgent: nextCounts,
      lastReactionSimByAgent: nextLastSim,
    };
  }

  const maxSpan = Math.max(15, nextFixedStart - timeInfo.minuteOfDay);
  const durationMinutes = Math.min(maxSpan, Math.max(20, res.durationMinutes ?? 45));
  const validLocIds = new Set(state.locations.map((l) => l.id));
  const resolvedLoc =
    res.locationId && validLocIds.has(res.locationId)
      ? res.locationId
      : activeBlock?.locationId ?? agent.homeLocationId;
  const resolvedObj =
    res.objectId &&
    state.objects.some((o) => o.id === res.objectId && o.locationId === resolvedLoc)
      ? res.objectId
      : state.objects.find((o) => o.locationId === resolvedLoc && o.kind !== 'bed')?.id;

  const reactionBlock: ScheduleBlock = {
    id: alloc.next(`react_blk_${agentId}`),
    day: timeInfo.day,
    kind: res.kind ?? 'social',
    startMinute: timeInfo.minuteOfDay,
    durationMinutes,
    locationId: resolvedLoc,
    objectId: resolvedObj,
    activity: res.newActivity,
    subSteps: generateRuleSubSteps({
      activity: res.newActivity,
      kind: res.kind ?? 'social',
      durationMinutes,
    }),
    emoji: res.emoji || '✨',
    source: 'llm_replan',
    oneOff: true,
  };

  // Truncate current non-fixed block up to minuteOfDay and surgically place reactionBlock without losing fixed blocks
  const baseSchedule = agent.dailySchedule.flatMap((b) => {
    if (b.day !== timeInfo.day || b.fixed) return [b];
    const bEnd = b.startMinute + b.durationMinutes;
    if (bEnd <= timeInfo.minuteOfDay || b.startMinute >= timeInfo.minuteOfDay + durationMinutes) {
      return [b];
    }
    const prefixDur = timeInfo.minuteOfDay - b.startMinute;
    if (prefixDur >= 15) {
      return [{ ...b, durationMinutes: prefixDur }];
    }
    return [];
  });
  const nextSchedule = patchScheduleWithBlock(baseSchedule, reactionBlock);

  const reactionMem = createMemoryNode({
    id: alloc.next(`react_${agentId}`),
    createdAt: state.simMinutes,
    type: 'plan',
    source: 'reaction',
    description: `${agent.name} decided to react (${res.reason}): ${res.newActivity}`,
    importance: 6,
  });

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_react_${agentId}`),
    simMinutes: state.simMinutes,
    type: 'reaction',
    title: `${agent.name} reacted and adjusted schedule`,
    detail: `${res.reason} → ${res.newActivity}`,
    agentIds: [agentId],
    locationName: state.locations.find((l) => l.id === resolvedLoc)?.name,
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    reactionDay,
    reactionsTodayByAgent: nextCounts,
    lastReactionSimByAgent: nextLastSim,
    agents: state.agents.map((a) =>
      a.id === agentId
        ? {
            ...a,
            isThinking: false,
            currently: res.newActivity!,
            dailySchedule: nextSchedule,
            activeScheduleId: undefined,
            memories: compactMemories(
              [reactionMem, ...a.memories],
              DEFAULT_MEMORY_CAP,
              state.simMinutes,
              alloc.next,
            ),
          }
        : a,
    ),
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

export function applyBlockSubSteps(
  state: WorldState,
  agentId: string,
  blockId: string,
  subSteps: string[],
): WorldState {
  if (subSteps.length === 0) return state;
  const timeInfo = formatSimTime(state.simMinutes);
  return {
    ...state,
    agents: state.agents.map((ag) => {
      if (ag.id !== agentId) return ag;
      const nextSchedule = ag.dailySchedule.map((b) =>
        b.id === blockId ? { ...b, subSteps: subSteps.slice(0, 5) } : b,
      );
      const updatedBlock = nextSchedule.find((b) => b.id === blockId);
      const nextSubStep =
        ag.activeScheduleId === blockId && updatedBlock
          ? resolveSubStep(updatedBlock, timeInfo.minuteOfDay) ?? subSteps[0]
          : ag.currentSubStep;
      return {
        ...ag,
        isThinking: false,
        dailySchedule: nextSchedule,
        currentSubStep: nextSubStep,
      };
    }),
  };
}

export function applyInterviewResult(
  state: WorldState,
  agentId: string,
  question: string,
  res: { answer: string; citedMemoryIds: string[]; observationSummary: string },
  accessedMemoryIds: string[] = [],
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const nextState = markAccessed(
    state,
    agentId,
    [...accessedMemoryIds, ...res.citedMemoryIds],
    state.simMinutes,
  );
  const refreshedAgent = nextState.agents.find((a) => a.id === agentId) ?? agent;

  const obs = createMemoryNode({
    id: alloc.next(`int_${agentId}`),
    createdAt: state.simMinutes,
    type: 'observation',
    description: res.observationSummary,
    importance: scoreImportance({
      kind: 'conversation',
      description: res.observationSummary,
      recentMemories: refreshedAgent.memories,
      participantRating: 6,
    }),
  });

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_int_${agentId}`),
    simMinutes: state.simMinutes,
    type: 'interview',
    title: `Gazette interviewed ${agent.name}`,
    detail: `Q: “${question}” — A: ${res.answer}`,
    agentIds: [agentId],
  };

  return {
    ...nextState,
    idSeq: alloc.seq(),
    agents: nextState.agents.map((a) =>
      a.id === agentId
        ? {
            ...a,
            drives: { ...a.drives, social: Math.min(100, a.drives.social + 6) },
            memories: compactMemories(
              [obs, ...a.memories],
              DEFAULT_MEMORY_CAP,
              state.simMinutes,
              alloc.next,
            ),
            importanceAccumulator: a.importanceAccumulator + obs.importance,
            speechBubble: {
              text: res.answer,
              speakerName: a.name.split(' ')[0],
              expiresAtSimMin: state.simMinutes + 10,
            },
          }
        : a,
    ),
    chronicle: [chrEvent, ...nextState.chronicle].slice(0, 80),
  };
}

export function applyWhisperResult(
  state: WorldState,
  agentId: string,
  thought: string,
  res: {
    reactionBubble: string;
    memoryObservation: string;
    importance: number;
    newAction: string;
    targetLocationId?: string;
    emoji: string;
    emotionalShift?: EmotionalShift;
  },
  accessedMemoryIds: string[] = [],
): WorldState {
  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const nextState = markAccessed(state, agentId, accessedMemoryIds, state.simMinutes);
  const agent = nextState.agents.find((a) => a.id === agentId);
  if (!agent) return state;

  const obs = createMemoryNode({
    id: alloc.next(`whisp_${agentId}`),
    createdAt: state.simMinutes,
    type: 'observation',
    description: res.memoryObservation,
    importance: scoreImportance({
      kind: 'conversation',
      description: res.memoryObservation,
      recentMemories: agent.memories,
      participantRating: res.importance,
    }),
  });

  const targetLoc = res.targetLocationId
    ? nextState.locations.find((l) => l.id === res.targetLocationId)
    : undefined;

  let newPath = agent.path;
  let newTargetX = agent.targetX;
  let newTargetY = agent.targetY;
  if (targetLoc) {
    const dest = findNearestWalkableTile(nextState.tiles, targetLoc.doorX, targetLoc.doorY);
    newTargetX = dest.x;
    newTargetY = dest.y;
    newPath = findPath(
      nextState.tiles,
      Math.round(agent.x),
      Math.round(agent.y),
      dest.x,
      dest.y,
    );
  }

  const chrEvent: ChronicleEvent = {
    id: alloc.next(`chr_whisp_${agentId}`),
    simMinutes: state.simMinutes,
    type: 'whisper',
    title: `Inner thought whispered to ${agent.name}`,
    detail: `“${thought}” → ${res.newAction}`,
    agentIds: [agentId],
    locationName: targetLoc?.name,
  };

  return {
    ...nextState,
    idSeq: alloc.seq(),
    agents: nextState.agents.map((a) =>
      a.id === agentId
        ? {
            ...a,
            currentAction: res.newAction,
            currently: res.newAction,
            actionEmoji: res.emoji || '💭',
            mood: res.emotionalShift
              ? applyEmotionalAppraisal(
                  a.mood,
                  a.drives,
                  res.emotionalShift.deltaValence,
                  res.emotionalShift.deltaArousal,
                )
              : a.mood,
            targetX: newTargetX,
            targetY: newTargetY,
            path: newPath,
            memories: compactMemories(
              [obs, ...a.memories],
              DEFAULT_MEMORY_CAP,
              state.simMinutes,
              alloc.next,
            ),
            importanceAccumulator: a.importanceAccumulator + obs.importance,
            speechBubble: {
              text: res.reactionBubble,
              speakerName: a.name.split(' ')[0],
              expiresAtSimMin: state.simMinutes + 10,
            },
          }
        : a,
    ),
    chronicle: [chrEvent, ...nextState.chronicle].slice(0, 80),
  };
}

export function applyBroadcast(state: WorldState, rawText: string): WorldState {
  const text = rawText.trim();
  if (!text) return state;

  const alloc = makeIdAllocator(state.idSeq ?? 1);
  const nextAgents = state.agents.map((ag) => {
    const desc = `Town announcement in Smallville: ${text}`;
    const imp = scoreImportance({
      kind: 'broadcast',
      description: desc,
      recentMemories: ag.memories,
    });
    const obs = createMemoryNode({
      id: alloc.next(`bcast_${ag.id}`),
      createdAt: state.simMinutes,
      type: 'observation',
      description: desc,
      importance: imp,
    });
    return {
      ...ag,
      memories: compactMemories(
        [obs, ...ag.memories],
        DEFAULT_MEMORY_CAP,
        state.simMinutes,
        alloc.next,
      ),
      importanceAccumulator: ag.importanceAccumulator + imp,
    };
  });

  const newMeme: TrackedMeme = {
    id: alloc.next('meme_bcast'),
    topic: text,
    keywords: extractKeywords(text).slice(0, 6),
    originAgentId: 'bulletin',
    createdAt: state.simMinutes,
    knownBy: Object.fromEntries(
      nextAgents.map((ag) => [
        ag.id,
        {
          simMinutes: state.simMinutes,
          heardFromId: 'bulletin',
          snippet: text,
        },
      ]),
    ),
  };

  const chrEvent: ChronicleEvent = {
    id: alloc.next('chr_bcast'),
    simMinutes: state.simMinutes,
    type: 'world_event',
    title: 'Town Bulletin Announcement',
    detail: text,
    agentIds: nextAgents.map((a) => a.id),
    locationName: 'Smallville Town Board',
  };

  return {
    ...state,
    idSeq: alloc.seq(),
    agents: nextAgents,
    memes: [newMeme, ...(state.memes ?? [])].slice(0, 20),
    chronicle: [chrEvent, ...state.chronicle].slice(0, 80),
  };
}

