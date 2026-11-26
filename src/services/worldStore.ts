import { createInitialPartyStats } from '../simulation/engine';
import { getAreaLabelAt, getLocationAt, SMALLVILLE_OBJECTS } from '../simulation/mapData';
import { compactMemories, formatSimTime, inferMemorySource } from '../simulation/memory';
import {
  createSeedAgents,
  createSeedMemes,
  DEFAULT_GOALS_BY_AGENT,
} from '../simulation/seedAgents';
import {
  DEFAULT_ABLATIONS,
  DEFAULT_MEMORY_CAP,
  WORLD_SCHEMA_VERSION,
  type ScheduleBlock,
  type ScheduleBlockKind,
  type WorldState,
} from '../simulation/types';
import {
  createInitialBusinesses,
  DEFAULT_TOWN_MODIFIERS,
  hydrateAgentsEconomyAndProjects,
} from '../simulation/worldEconomy';
import {
  computeMacroSnapshot,
  createInitialClubs,
  createInitialElection,
  createInitialJobPostings,
  createInitialLeadership,
  hydrateInstitutionalFields,
} from '../simulation/institutions';
import { createInitialNotices, createInitialProposals } from '../simulation/socialFabric';
import { hydrateCognitiveDepth } from '../simulation/cognitiveDepth';
import {
  createInitialPetitions,
  hydrateHousingAndCareers,
} from '../simulation/contractsAndLife';
import { hydrateWorldIntentStacks } from '../simulation/intentStack';
import { createInitialCulturalNorms } from '../simulation/epistemicCulture';
import { computeDiversitySnapshot } from '../simulation/diversityMetrics';

export const LEGACY_LOCAL_STORAGE_KEY = 'smallville_world_v3_80';
const LOCAL_STORAGE_KEY = 'smallville_world_snapshot_v2';
const WORLD_ID_STORAGE_KEY = 'smallville_world_id_v1';
const ACCESS_TOKEN_STORAGE_KEY = 'smallville_app_token_v1';
const DB_NAME = 'smallville_worlds_v1';
const STORE_NAME = 'world_snapshots';
const SNAPSHOT_KEY = 'current';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fallbackUuid(): string {
  const hex = '0123456789abcdef';
  const parts = [8, 4, 4, 4, 12];
  let seed = Math.floor(Date.now()) >>> 0;
  return parts
    .map((len, pIdx) => {
      let chunk = '';
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        let nibble = (seed >>> 28) & 0xf;
        if (pIdx === 2 && i === 0) nibble = 4;
        if (pIdx === 3 && i === 0) nibble = (nibble & 0x3) | 0x8;
        chunk += hex[nibble];
      }
      return chunk;
    })
    .join('-');
}

export function getOrCreateWorldId(): string {
  try {
    const existing = window.localStorage.getItem(WORLD_ID_STORAGE_KEY)?.trim();
    if (existing && UUID_REGEX.test(existing)) {
      return existing;
    }
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : fallbackUuid();
    window.localStorage.setItem(WORLD_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackUuid();
  }
}

export function getAppAccessToken(): string | null {
  try {
    const val = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim();
    return val || null;
  } catch {
    return null;
  }
}

export function setAppAccessToken(token: string | null): void {
  try {
    if (!token || !token.trim()) {
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token.trim());
    }
  } catch {
    // Ignore storage restriction
  }
}

export function stripEmbeddingsForSave(state: WorldState): WorldState {
  return {
    ...state,
    schemaVersion: WORLD_SCHEMA_VERSION,
    agents: state.agents.map((a) => ({
      ...a,
      isThinking: false,
      inConversationWith: undefined,
      conversationStartedAtSim: undefined,
      memories: compactMemories(a.memories, DEFAULT_MEMORY_CAP, state.simMinutes).map((m) => ({
        ...m,
        embedding: undefined,
      })),
    })),
  };
}

function inferLegacyBlockKind(blk: Partial<ScheduleBlock>): ScheduleBlockKind {
  if (blk.kind) return blk.kind;
  const text = (blk.activity ?? '').toLowerCase();
  if (text.includes('sleep') || text.includes('bed')) return 'sleep';
  if (text.includes('breakfast') || text.includes('lunch') || text.includes('dinner') || text.includes('coffee') || text.includes('tea')) {
    return 'meal';
  }
  if (blk.source === 'social_commitment' || text.includes('party') || text.includes('social')) {
    return 'social';
  }
  if (text.includes('shop') || text.includes('errand')) return 'errand';
  if (text.includes('walk') || text.includes('sketch') || text.includes('read') || text.includes('music')) {
    return 'leisure';
  }
  if (blk.source === 'drive_interrupt' || text.includes('rest')) return 'rest';
  return 'work';
}

export function migrateWorldState(raw: unknown): {
  world: WorldState | null;
  notice?: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { world: null };
  }
  const parsed = raw as Partial<WorldState>;
  if (
    parsed.mapWidth !== 80 ||
    parsed.mapHeight !== 46 ||
    !Array.isArray(parsed.agents) ||
    parsed.agents.length < 18 ||
    !Array.isArray(parsed.tiles) ||
    !Array.isArray(parsed.locations) ||
    !Array.isArray(parsed.objects) ||
    !Number.isFinite(parsed.simMinutes) ||
    !parsed.agents.every((a) => a && a.drives && a.mood && a.socialGraph && Array.isArray(a.memories))
  ) {
    return {
      world: null,
      notice: 'Saved town format was incompatible; started a fresh Smallville town.',
    };
  }

  const prevVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
  const simDay = formatSimTime(parsed.simMinutes as number).day;
  const seedMap = new Map(createSeedAgents(parsed.simMinutes as number).map((sa) => [sa.id, sa]));
  let seq = typeof parsed.idSeq === 'number' && parsed.idSeq > 0 ? Math.floor(parsed.idSeq) : 1000;
  let repairedDuplicates = 0;

  // Ensure newer v3 objects (such as beds in public residences) exist on migrated saves
  const existingObjIds = new Set(parsed.objects.map((o) => o.id));
  const mergedObjects = [
    ...parsed.objects,
    ...SMALLVILLE_OBJECTS.filter((o) => !existingObjIds.has(o.id)).map((o) => ({ ...o })),
  ];

  const migratedAgents = parsed.agents.map((a) => {
    const seenIds = new Set<string>();
    const uniqueMemories = a.memories.map((m) => {
      let id = m.id;
      if (seenIds.has(id)) {
        repairedDuplicates += 1;
        id = `${id}_mig_${seq++}`;
      }
      seenIds.add(id);
      return {
        ...m,
        id,
        source: m.source ?? inferMemorySource({ id, type: m.type }),
      };
    });

    const migratedSchedule: ScheduleBlock[] = (Array.isArray(a.dailySchedule) ? a.dailySchedule : []).map(
      (blk) => ({
        ...blk,
        day: typeof blk.day === 'number' && blk.day >= 1 ? Math.round(blk.day) : simDay,
        kind: inferLegacyBlockKind(blk),
      }),
    );

    const locNow = getLocationAt(parsed.locations!, a.x, a.y);

    return {
      ...a,
      goals:
        Array.isArray(a.goals) && a.goals.length > 0
          ? a.goals
          : (DEFAULT_GOALS_BY_AGENT[a.id] ?? seedMap.get(a.id)?.goals ?? []),
      currentLocationId: locNow ? locNow.id : null,
      currentAreaLabel: a.currentAreaLabel ?? getAreaLabelAt(parsed.locations!, a.x, a.y),
      dailySchedule: migratedSchedule,
      inventory: Array.isArray(a.inventory)
        ? a.inventory
        : (seedMap.get(a.id)?.inventory ?? []),
      isThinking: false,
      inConversationWith: undefined,
      conversationStartedAtSim: undefined,
      memories: compactMemories(uniqueMemories, DEFAULT_MEMORY_CAP, parsed.simMinutes as number),
    };
  });

  const businesses =
    parsed.businesses &&
    typeof parsed.businesses === 'object' &&
    !Array.isArray(parsed.businesses) &&
    Object.keys(parsed.businesses).length > 0
      ? parsed.businesses
      : createInitialBusinesses(parsed.locations!, migratedAgents);

  const hydratedAgents = hydrateAgentsEconomyAndProjects(
    migratedAgents,
    parsed.locations!,
    businesses,
    parsed.simMinutes as number,
  );

  const clubs =
    Array.isArray(parsed.clubs) && parsed.clubs.length > 0
      ? parsed.clubs
      : createInitialClubs(hydratedAgents);
  const institutionalAgents = hydrateInstitutionalFields(hydratedAgents, clubs);
  const allocMig = (prefix: string) => `${prefix}_mig_${seq++}`;
  const deepAgents = hydrateCognitiveDepth(
    institutionalAgents,
    parsed.simMinutes as number,
    allocMig,
  );
  const finalAgents = hydrateWorldIntentStacks(
    hydrateHousingAndCareers(deepAgents, parsed.locations!),
    parsed.simMinutes as number,
    allocMig,
  );
  const leadership = parsed.leadership ?? createInitialLeadership(finalAgents);
  const election = parsed.election ?? createInitialElection(finalAgents, Math.max(7, simDay + 6));
  const jobPostings =
    Array.isArray(parsed.jobPostings) && parsed.jobPostings.length > 0
      ? parsed.jobPostings
      : createInitialJobPostings(businesses, parsed.simMinutes as number);
  const petitions =
    Array.isArray(parsed.petitions) && parsed.petitions.length > 0
      ? parsed.petitions
      : createInitialPetitions(finalAgents, parsed.simMinutes as number);

  const migrated: WorldState = {
    ...(parsed as WorldState),
    schemaVersion: WORLD_SCHEMA_VERSION,
    worldName: parsed.worldName || 'Smallville',
    idSeq: seq,
    scenarioId: parsed.scenarioId ?? 'default',
    ablations: {
      ...DEFAULT_ABLATIONS,
      ...(parsed.ablations ?? {}),
    },
    reactionsTodayByAgent: parsed.reactionsTodayByAgent ?? {},
    reactionDay: parsed.reactionDay ?? simDay,
    lastReactionSimByAgent: parsed.lastReactionSimByAgent ?? {},
    partyStats: parsed.partyStats ?? createInitialPartyStats(),
    weather: parsed.weather ?? 'clear',
    objects: mergedObjects,
    memes: Array.isArray(parsed.memes)
      ? parsed.memes
      : createSeedMemes(parsed.simMinutes as number),
    businesses,
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    notices:
      Array.isArray(parsed.notices) && parsed.notices.length > 0
        ? parsed.notices
        : createInitialNotices(parsed.locations!, finalAgents, parsed.simMinutes as number),
    proposals:
      Array.isArray(parsed.proposals) && parsed.proposals.length > 0
        ? parsed.proposals
        : createInitialProposals(finalAgents, parsed.simMinutes as number),
    loans: Array.isArray(parsed.loans) ? parsed.loans : [],
    petitions,
    ventures: Array.isArray(parsed.ventures) ? parsed.ventures : [],
    letters: Array.isArray(parsed.letters) ? parsed.letters : [],
    autonomyMode: parsed.autonomyMode ?? 'intent_driven',
    serviceContracts: Array.isArray(parsed.serviceContracts) ? parsed.serviceContracts : [],
    disputes: Array.isArray(parsed.disputes) ? parsed.disputes : [],
    coalitions: Array.isArray(parsed.coalitions) ? parsed.coalitions : [],
    boycotts: Array.isArray(parsed.boycotts) ? parsed.boycotts : [],
    activeShocks: Array.isArray(parsed.activeShocks) ? parsed.activeShocks : [],
    rumors: Array.isArray(parsed.rumors) ? parsed.rumors : [],
    culturalNorms:
      Array.isArray(parsed.culturalNorms) && parsed.culturalNorms.length > 0
        ? parsed.culturalNorms
        : createInitialCulturalNorms(simDay),
    diversityHistory: Array.isArray(parsed.diversityHistory) ? parsed.diversityHistory : [],
    townTreasury:
      typeof parsed.townTreasury === 'number' && Number.isFinite(parsed.townTreasury)
        ? parsed.townTreasury
        : 650,
    townModifiers: {
      ...DEFAULT_TOWN_MODIFIERS,
      ...(parsed.townModifiers ?? {}),
    },
    compressedConversations: parsed.compressedConversations ?? false,
    clubs,
    leadership,
    election,
    jobPostings,
    scaleTarget: parsed.scaleTarget ?? finalAgents.length,
    stats: {
      system1Greetings: parsed.stats?.system1Greetings ?? 0,
      driveInterrupts: parsed.stats?.driveInterrupts ?? 0,
      perceptionEvents: parsed.stats?.perceptionEvents ?? 0,
      socialCommitments: parsed.stats?.socialCommitments ?? 0,
      llmCallsSaved: parsed.stats?.llmCallsSaved ?? 0,
      llmCallsMade: parsed.stats?.llmCallsMade ?? 0,
      tokensUsed: parsed.stats?.tokensUsed ?? 0,
      inputTokensUsed: parsed.stats?.inputTokensUsed ?? 0,
      outputTokensUsed: parsed.stats?.outputTokensUsed ?? 0,
      economicTransactions: parsed.stats?.economicTransactions ?? 0,
      totalTradeVolume: parsed.stats?.totalTradeVolume ?? 0,
      noticesRead: parsed.stats?.noticesRead ?? 0,
      civicVotesCast: parsed.stats?.civicVotesCast ?? 0,
      overheardEvents: parsed.stats?.overheardEvents ?? 0,
      gossipUpdatesApplied: parsed.stats?.gossipUpdatesApplied ?? 0,
      bdiDecisions: parsed.stats?.bdiDecisions ?? 0,
      compressedScenes: parsed.stats?.compressedScenes ?? 0,
      jobsFilled: parsed.stats?.jobsFilled ?? 0,
      clinicTreatments: parsed.stats?.clinicTreatments ?? 0,
      electionsCompleted: parsed.stats?.electionsCompleted ?? 0,
      clubGatherings: parsed.stats?.clubGatherings ?? 0,
      loansIssued: parsed.stats?.loansIssued ?? 0,
      loansDefaulted: parsed.stats?.loansDefaulted ?? 0,
      petitionsEscalated: parsed.stats?.petitionsEscalated ?? 0,
      venturesLaunched: parsed.stats?.venturesLaunched ?? 0,
      housingMoves: parsed.stats?.housingMoves ?? 0,
      careerPromotions: parsed.stats?.careerPromotions ?? 0,
      beliefRevisions: parsed.stats?.beliefRevisions ?? 0,
      refusalsAndDisagreements: parsed.stats?.refusalsAndDisagreements ?? 0,
      serviceContractsCreated: parsed.stats?.serviceContractsCreated ?? 0,
      serviceContractsFulfilled: parsed.stats?.serviceContractsFulfilled ?? 0,
      serviceContractsBreached: parsed.stats?.serviceContractsBreached ?? 0,
      disputesFiled: parsed.stats?.disputesFiled ?? 0,
      disputesResolved: parsed.stats?.disputesResolved ?? 0,
      coalitionsFormed: parsed.stats?.coalitionsFormed ?? 0,
      boycottsActive: parsed.stats?.boycottsActive ?? 0,
      shocksTriggered: parsed.stats?.shocksTriggered ?? 0,
      rumorsSpread: parsed.stats?.rumorsSpread ?? 0,
      rumorsDebunked: parsed.stats?.rumorsDebunked ?? 0,
      deceptionsAttempted: parsed.stats?.deceptionsAttempted ?? 0,
      deceptionsExposed: parsed.stats?.deceptionsExposed ?? 0,
      normEndorsements: parsed.stats?.normEndorsements ?? 0,
    },
    agents: finalAgents,
  };
  migrated.macroHistory =
    Array.isArray(parsed.macroHistory) && parsed.macroHistory.length > 0
      ? parsed.macroHistory
      : [computeMacroSnapshot(migrated)];
  if (!migrated.diversityHistory || migrated.diversityHistory.length === 0) {
    migrated.diversityHistory = [computeDiversitySnapshot(migrated)];
  }

  let notice: string | undefined;
  if (prevVersion < WORLD_SCHEMA_VERSION) {
    notice =
      repairedDuplicates > 0
        ? `Migrated town save from schema v${prevVersion} to v${WORLD_SCHEMA_VERSION} and repaired ${repairedDuplicates} duplicate memory IDs.`
        : `Migrated saved town from schema v${prevVersion} to v${WORLD_SCHEMA_VERSION}.`;
  }

  return { world: migrated, notice };
}

function openWorldDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function loadWorldSyncFallback(): {
  world: WorldState | null;
  notice?: string;
} {
  try {
    const raw =
      window.localStorage.getItem(LOCAL_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return { world: null };
    return migrateWorldState(JSON.parse(raw));
  } catch {
    return {
      world: null,
      notice: 'Saved local town snapshot could not be parsed; started a fresh town.',
    };
  }
}

export async function loadWorldFromIndexedDb(): Promise<{
  world: WorldState | null;
  notice?: string;
}> {
  const db = await openWorldDb();
  if (!db) return { world: null };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () => {
        db.close();
        if (!req.result) {
          resolve({ world: null });
          return;
        }
        resolve(migrateWorldState(req.result));
      };
      req.onerror = () => {
        db.close();
        resolve({ world: null });
      };
    } catch {
      db.close();
      resolve({ world: null });
    }
  });
}

export async function saveWorldSnapshot(state: WorldState): Promise<void> {
  const compact = stripEmbeddingsForSave(state);
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Ignore localStorage quota exceeded cleanly; IndexedDB holds larger worlds
  }

  const db = await openWorldDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(compact, SNAPSHOT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function clearWorldSnapshots(): Promise<void> {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }

  const db = await openWorldDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export function exportWorldJson(state: WorldState): {
  filename: string;
  content: string;
} {
  const compact = stripEmbeddingsForSave(state);
  const stamp = `day${compact.day}`;
  return {
    filename: `smallville-world-${stamp}-v${WORLD_SCHEMA_VERSION}.json`,
    content: JSON.stringify(compact, null, 2),
  };
}

export function importWorldJson(jsonText: string): {
  world: WorldState | null;
  notice?: string;
} {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const unwrapped =
      parsed && typeof parsed === 'object' && 'world' in (parsed as Record<string, unknown>)
        ? (parsed as { world: unknown }).world
        : parsed;
    const res = migrateWorldState(unwrapped);
    if (!res.world) {
      return {
        world: null,
        notice: res.notice ?? 'Imported JSON is not a valid Smallville world snapshot.',
      };
    }
    return res;
  } catch {
    return {
      world: null,
      notice: 'Failed to parse imported JSON file.',
    };
  }
}
