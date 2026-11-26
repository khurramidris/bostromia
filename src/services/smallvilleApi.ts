import { retrieveMemories } from '../simulation/memory';
import {
  expandAssociativeRetrieval,
  getActiveBeliefs,
} from '../simulation/cognitiveDepth';
import type {
  AgentState,
  BdiDecisionResult,
  ExtractedBeliefUpdate,
  GossipUpdate,
  LocationZone,
  NegotiatedDeal,
  ScheduleBlockKind,
  ScheduleCommitment,
  WorldObject,
  WorldState,
} from '../simulation/types';
import { formatQueryEmbedText } from './vectorStore';
import { getAppAccessToken, getOrCreateWorldId } from './worldStore';

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  retryAfterSec?: number;
  requiresAccessToken?: boolean;

  constructor(
    message: string,
    status: number,
    extra: { code?: string; retryAfterSec?: number; requiresAccessToken?: boolean } = {},
  ) {
    super(message);
    this.status = status;
    this.code = extra.code;
    this.retryAfterSec = extra.retryAfterSec;
    this.requiresAccessToken = extra.requiresAccessToken;
  }
}

function buildApiHeaders(includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    'x-world-id': getOrCreateWorldId(),
  };
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAppAccessToken();
  if (token) {
    headers['x-app-token'] = token;
  }
  return headers;
}

function clip(value: string | undefined, max = 580): string {
  if (!value) return '';
  return value.length <= max ? value : value.slice(0, max);
}

function buildAgentQuery(agent: AgentState, fallbackFocus = ''): string {
  const area = agent.currentAreaLabel ?? 'Smallville';
  const parts = [agent.currently, agent.currentAction, area, fallbackFocus].filter(Boolean);
  return parts.join(' ').trim() || agent.name;
}

function selectMemoriesForAgent(
  agent: AgentState,
  query: string,
  simMinutes: number,
  poolCount: number,
  queryEmbedding?: number[],
  noMemoryRetrieval = false,
) {
  if (noMemoryRetrieval) {
    // Ablation: no weighted retrieval — take top-10 most recent observations only
    return agent.memories
      .slice(0, Math.min(10, poolCount))
      .map((node) => ({ node }));
  }
  const primary = retrieveMemories(
    agent.memories,
    query,
    simMinutes,
    poolCount,
    undefined,
    queryEmbedding,
  );
  return expandAssociativeRetrieval(primary, agent.memories, 2);
}

function buildAgentPayload(
  agent: AgentState,
  locations: LocationZone[],
  objects: WorldObject[],
  query: string,
  simMinutes: number,
  queryEmbedding?: number[],
  candidateLimit = 0,
  noMemoryRetrieval = false,
  employerName?: string,
  focusSubjectIds?: string[],
) {
  const loc = agent.currentLocationId
    ? locations.find((l) => l.id === agent.currentLocationId)
    : undefined;
  const locationLabel = loc?.name ?? agent.currentAreaLabel ?? 'Town Outdoors';
  const nearbyObjects = loc
    ? objects
        .filter((o) => o.locationId === loc.id)
        .slice(0, 32)
        .map((o) => ({
          name: clip(o.name, 120),
          state: clip(o.state, 200),
          persistentNote: o.persistentNote ? clip(o.persistentNote, 240) : undefined,
        }))
    : [];

  const poolCount = candidateLimit > 0 ? Math.min(40, candidateLimit) : 8;
  const retrieved = selectMemoriesForAgent(
    agent,
    query,
    simMinutes,
    poolCount,
    queryEmbedding,
    noMemoryRetrieval,
  );

  const formattedPool = retrieved.map((r) => ({
    id: r.node.id,
    type: r.node.type,
    description: clip(r.node.description, 580),
    importance: r.node.importance,
    createdAt: r.node.createdAt,
    lastAccessed: r.node.lastAccessed,
  }));

  const socialEntries = Object.entries(agent.socialGraph).slice(0, 32);
  const relEntries = Object.entries(agent.relationships).slice(0, 32);
  const activeProjects = (agent.projects ?? [])
    .filter((p) => p.status === 'active')
    .slice(0, 4)
    .map((p) => ({
      id: p.id,
      title: clip(p.title, 120),
      progress: p.progress,
      category: p.category,
    }));

  const activeBeliefs = getActiveBeliefs(agent.beliefs, focusSubjectIds, 6).map((b) => ({
    subjectId: b.subjectId,
    predicate: b.predicate,
    claim: clip(b.claim, 200),
    confidence: b.confidence,
  }));

  return {
    accessedIds: formattedPool.slice(0, 8).map((m) => m.id),
    payload: {
      id: agent.id,
      name: clip(agent.name, 120),
      age: agent.age,
      occupation: clip(agent.occupation, 120),
      traits: agent.traits.slice(0, 20).map((t) => clip(t, 80)),
      goals: (agent.goals ?? []).slice(0, 10).map((g) => clip(g, 200)),
      innateSummary: clip(agent.innateSummary, 580),
      currently: clip(agent.currently, 580),
      currentAction: clip(agent.currentAction, 580),
      currentSubStep: agent.currentSubStep ? clip(agent.currentSubStep, 200) : undefined,
      locationName: clip(locationLabel, 120),
      inventory: agent.inventory.slice(0, 20).map((item) => clip(item, 80)),
      wallet: typeof agent.wallet === 'number' ? Math.round(agent.wallet * 100) / 100 : undefined,
      reputation: typeof agent.reputation === 'number' ? Math.round(agent.reputation) : undefined,
      employerName: employerName ? clip(employerName, 120) : undefined,
      housingStatus: agent.housingStatus,
      careerTier: agent.careerTier,
      dossier: agent.dossier
        ? {
            background: clip(agent.dossier.background, 320),
            financialPosture: agent.dossier.financialPosture,
            civicWorldview: agent.dossier.civicWorldview,
            speechStyle: clip(agent.dossier.speechStyle, 200),
            privateAgenda: clip(agent.dossier.privateAgenda, 220),
            redLines: agent.dossier.redLines.slice(0, 4).map((r) => clip(r, 160)),
          }
        : undefined,
      temperament: agent.temperament
        ? {
            stubbornness: agent.temperament.stubbornness,
            riskTolerance: agent.temperament.riskTolerance,
            ambition: agent.temperament.ambition,
            decoding: agent.temperament.decoding,
          }
        : undefined,
      beliefs: activeBeliefs.length > 0 ? activeBeliefs : undefined,
      projects: activeProjects.length > 0 ? activeProjects : undefined,
      goods: agent.goods && Object.keys(agent.goods).length > 0 ? agent.goods : undefined,
      drives: agent.drives,
      mood: {
        valence: agent.mood.valence,
        arousal: agent.mood.arousal,
        label: clip(agent.mood.label, 80),
      },
      socialGraph: Object.fromEntries(
        socialEntries.map(([tid, edge]) => [
          tid,
          {
            ...edge,
            roleLabel: clip(edge.roleLabel, 120),
            inferredGoal: clip(edge.inferredGoal, 240),
          },
        ]),
      ),
      nearbyObjects,
      relationships: Object.fromEntries(
        relEntries.map(([tid, rel]) => [tid, clip(rel, 240)]),
      ),
      retrievedMemories: formattedPool.slice(0, 20),
      ...(candidateLimit > 0 ? { candidateMemories: formattedPool } : {}),
    },
  };
}

async function parseErrorResponse(res: Response): Promise<ApiRequestError> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    retryAfterSec?: number;
    requiresAccessToken?: boolean;
  };
  const headerRetry = Number(res.headers.get('retry-after'));
  const retryAfterSec =
    data.retryAfterSec ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined);

  return new ApiRequestError(
    data.error || `Request failed with status ${res.status}`,
    res.status,
    {
      code: data.code,
      retryAfterSec,
      requiresAccessToken: Boolean(data.requiresAccessToken || res.status === 401),
    },
  );
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 50_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildApiHeaders(true),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw await parseErrorResponse(res);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiRequestError(
        `LLM API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        504,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerHealthPayload {
  ok: boolean;
  llmConfigured: boolean;
  provider?: string;
  model: string;
  models?: {
    default: string;
    converse: string;
    reflect: string;
    plan: string;
  };
  embeddingsConfigured?: boolean;
  embedModel?: string;
  serverSavesEnabled?: boolean;
  limits?: {
    maxCallsPerDay: number;
    ratePerMinute: number;
    rateBurst: number;
    freeModelDailyCap: number | null;
    freeModelPaidCreditCap: number | null;
  };
  usageToday?: {
    date: string;
    count: number;
    maxCallsPerDay: number;
    remaining: number;
  };
}

export interface ServerMetricsPayload {
  usageToday: { date: string; count: number; maxCallsPerDay: number; remaining: number };
  byJobType: Record<
    string,
    {
      calls: number;
      failures: number;
      p50LatencyMs: number;
      p95LatencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
}

export async function checkServerHealth(): Promise<ServerHealthPayload> {
  const res = await fetch('/api/health', {
    headers: buildApiHeaders(false),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function fetchServerMetrics(): Promise<ServerMetricsPayload> {
  const res = await fetch('/api/metrics', {
    headers: buildApiHeaders(false),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function fetchServerWorld(): Promise<WorldState | null> {
  try {
    const res = await fetch('/api/world', {
      headers: buildApiHeaders(false),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { world?: WorldState | null };
    return data.world ?? null;
  } catch {
    return null;
  }
}

export async function saveServerWorld(world: WorldState): Promise<void> {
  try {
    await fetch('/api/world', {
      method: 'POST',
      headers: buildApiHeaders(true),
      body: JSON.stringify({ world }),
    });
  } catch {
    // Browser storage stays authoritative when server saves are off
  }
}

export async function saveServerWorldWithStatus(
  world: WorldState,
): Promise<{ ok: boolean; persisted: boolean; serverSavesEnabled: boolean; message: string }> {
  try {
    const res = await fetch('/api/world', {
      method: 'POST',
      headers: buildApiHeaders(true),
      body: JSON.stringify({ world }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      persisted?: boolean;
      serverSavesEnabled?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        persisted: false,
        serverSavesEnabled: Boolean(data.serverSavesEnabled),
        message: data.error || `Server save failed (HTTP ${res.status}).`,
      };
    }
    if (!data.persisted) {
      return {
        ok: true,
        persisted: false,
        serverSavesEnabled: false,
        message: 'Server snapshots disabled (set ENABLE_SERVER_SAVES=true to persist on disk).',
      };
    }
    return {
      ok: true,
      persisted: true,
      serverSavesEnabled: true,
      message: `Saved Day ${world.day} (${world.agents.length} residents) to server snapshot.`,
    };
  } catch {
    return {
      ok: false,
      persisted: false,
      serverSavesEnabled: false,
      message: 'Could not reach server snapshot endpoint.',
    };
  }
}

export async function fetchServerWorldWithStatus(): Promise<{
  world: WorldState | null;
  serverSavesEnabled: boolean;
  message: string;
}> {
  try {
    const res = await fetch('/api/world', {
      headers: buildApiHeaders(false),
    });
    const data = (await res.json().catch(() => ({}))) as {
      world?: WorldState | null;
      serverSavesEnabled?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return {
        world: null,
        serverSavesEnabled: false,
        message: data.error || `Server load failed (HTTP ${res.status}).`,
      };
    }
    if (data.serverSavesEnabled === false) {
      return {
        world: null,
        serverSavesEnabled: false,
        message: 'Server snapshots disabled (set ENABLE_SERVER_SAVES=true on the server).',
      };
    }
    if (!data.world) {
      return {
        world: null,
        serverSavesEnabled: true,
        message: 'No server snapshot saved yet for this town ID.',
      };
    }
    return {
      world: data.world,
      serverSavesEnabled: true,
      message: `Loaded Day ${data.world.day ?? 1} snapshot from server.`,
    };
  } catch {
    return {
      world: null,
      serverSavesEnabled: false,
      message: 'Could not reach server snapshot endpoint.',
    };
  }
}

export async function deleteServerWorld(): Promise<void> {
  try {
    await fetch('/api/world', {
      method: 'DELETE',
      headers: buildApiHeaders(false),
    });
  } catch {
    // Non-fatal
  }
}

export async function requestEmbeddings(prefixedTexts: string[]): Promise<number[][]> {
  if (prefixedTexts.length === 0) return [];
  const res = await postJson<{ embeddings: number[][] }>(
    '/api/agent/embed',
    { texts: prefixedTexts.slice(0, 32).map((t) => clip(t, 595)) },
    50_000,
  );
  return res.embeddings;
}

async function tryEmbedQuery(agent: AgentState, query: string): Promise<number[] | undefined> {
  const embeddedCount = agent.memories.filter(
    (m) => m.embedding && m.embedding.length > 0,
  ).length;
  if (embeddedCount === 0) return undefined;
  try {
    const vecs = await requestEmbeddings([formatQueryEmbedText(query)]);
    return vecs[0]?.length ? vecs[0] : undefined;
  } catch {
    return undefined;
  }
}

export async function requestConversation(
  world: WorldState,
  agentA: AgentState,
  agentB: AgentState,
  simTimeLabel: string,
  startReason?: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const queryA = buildAgentQuery(agentA, `${agentB.name} ${agentB.currentAction}`);
  const queryB = buildAgentQuery(agentB, `${agentA.name} ${agentA.currentAction}`);
  const [embA, embB] = noRetr
    ? [undefined, undefined]
    : await Promise.all([tryEmbedQuery(agentA, queryA), tryEmbedQuery(agentB, queryB)]);

  const builtA = buildAgentPayload(agentA, world.locations, world.objects, queryA, world.simMinutes, embA, 30, noRetr, undefined, [agentB.id]);
  const builtB = buildAgentPayload(agentB, world.locations, world.objects, queryB, world.simMinutes, embB, 30, noRetr, undefined, [agentA.id]);

  const candidateMemes = (world.memes ?? [])
    .filter((m) => Boolean(m.knownBy[agentA.id]) || Boolean(m.knownBy[agentB.id]))
    .slice(0, 20)
    .map((m) => ({
      id: m.id,
      topic: clip(m.topic, 300),
      knownByIds: [
        ...(m.knownBy[agentA.id] ? [agentA.id] : []),
        ...(m.knownBy[agentB.id] ? [agentB.id] : []),
      ],
    }));

  return postJson<{
    turns: Array<{
      speakerId: string;
      speakerName: string;
      text: string;
      privateThought?: string;
    }>;
    summaryA: string;
    summaryB: string;
    importanceA?: number;
    importanceB?: number;
    importance: number;
    reason?: string;
    endedBy?: string;
    planUpdateA?: string;
    planUpdateB?: string;
    sharedAgreement?: {
      day: 'today' | 'tomorrow' | number;
      minuteOfDay: number;
      durationMinutes?: number;
      locationId: string;
      objectId?: string;
      activity: string;
      emoji?: string;
    };
    commitmentA?: ScheduleCommitment;
    commitmentB?: ScheduleCommitment;
    memeIdsDiscussedA?: string[];
    memeIdsDiscussedB?: string[];
    newNewsA?: Array<{ topic: string; keywords: string[] }>;
    newNewsB?: Array<{ topic: string; keywords: string[] }>;
    gossipUpdatesA?: GossipUpdate[];
    gossipUpdatesB?: GossipUpdate[];
    accessedMemoryIdsA?: string[];
    accessedMemoryIdsB?: string[];
    emotionalShiftA?: { deltaValence: number; deltaArousal: number };
    emotionalShiftB?: { deltaValence: number; deltaArousal: number };
    tomUpdateA?: { deltaTrust: number; deltaAffection: number; inferredGoal: string };
    tomUpdateB?: { deltaTrust: number; deltaAffection: number; inferredGoal: string };
    beliefUpdatesA?: ExtractedBeliefUpdate[];
    beliefUpdatesB?: ExtractedBeliefUpdate[];
    bilateralDeal?: NegotiatedDeal;
  }>(
    '/api/agent/converse',
    {
      agentA: builtA.payload,
      agentB: builtB.payload,
      worldName: world.worldName ? clip(world.worldName, 100) : undefined,
      simTimeLabel: clip(simTimeLabel, 120),
      simMinutes: world.simMinutes,
      startReason: startReason ? clip(startReason, 300) : undefined,
      candidateMemes,
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
      objects: world.objects
        .slice(0, 40)
        .map((o) => ({ id: o.id, name: clip(o.name, 120), locationId: o.locationId })),
    },
    130_000,
  );
}

/**
 * 1-call compressed multi-party scene (2..4 residents) for OpenRouter throughput
 * and genuine group dialogues with third-party gossip extraction.
 */
export async function requestGroupScene(
  world: WorldState,
  participantIds: string[],
  simTimeLabel: string,
  startReason?: string,
  privateTurns = false,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const participants = participantIds
    .map((id) => world.agents.find((a) => a.id === id))
    .filter((a): a is AgentState => Boolean(a))
    .slice(0, 4);

  const otherNames = participants.map((p) => p.name).join(' ');
  const businesses = world.businesses ?? {};
  const builtParticipants = participants.map((agent) => {
    const q = buildAgentQuery(agent, otherNames);
    const empLocId = agent.employerLocationId;
    const employerName = empLocId
      ? (businesses[empLocId]?.name ?? world.locations.find((l) => l.id === empLocId)?.name)
      : undefined;
    return buildAgentPayload(
      agent,
      world.locations,
      world.objects,
      q,
      world.simMinutes,
      undefined,
      0,
      noRetr,
      employerName,
      participants.filter((p) => p.id !== agent.id).map((p) => p.id),
    );
  });

  const pSet = new Set(participants.map((p) => p.id));
  const candidateMemes = (world.memes ?? [])
    .filter((m) => Object.keys(m.knownBy).some((id) => pSet.has(id)))
    .slice(0, 16)
    .map((m) => ({
      id: m.id,
      topic: clip(m.topic, 300),
      knownByIds: participants.filter((p) => Boolean(m.knownBy[p.id])).map((p) => p.id),
    }));

  const response = await postJson<{
    mode: 'scene';
    participantIds: string[];
    turns: Array<{
      speakerId: string;
      speakerName: string;
      text: string;
      privateThought?: string;
    }>;
    summaryByAgent: Record<string, { summary: string; importance: number; planUpdate?: string }>;
    emotionalShiftByAgent: Record<string, { deltaValence: number; deltaArousal: number }>;
    tomUpdates: Array<{
      fromId: string;
      targetId: string;
      deltaTrust: number;
      deltaAffection: number;
      inferredGoal: string;
    }>;
    gossipUpdates: GossipUpdate[];
    beliefUpdatesByAgent?: Record<string, ExtractedBeliefUpdate[]>;
    bilateralDeal?: NegotiatedDeal;
    memeIdsDiscussed: string[];
    newNews: Array<{ topic: string; keywords: string[] }>;
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
    importance: number;
  }>(
    '/api/agent/converse',
    {
      mode: privateTurns ? 'group_private' : 'scene',
      participants: builtParticipants.map((b) => b.payload),
      worldName: world.worldName ? clip(world.worldName, 100) : undefined,
      simTimeLabel: clip(simTimeLabel, 120),
      simMinutes: world.simMinutes,
      startReason: startReason ? clip(startReason, 300) : undefined,
      candidateMemes,
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
      objects: world.objects
        .slice(0, 40)
        .map((o) => ({ id: o.id, name: clip(o.name, 120), locationId: o.locationId })),
    },
    65_000,
  );

  const accessedMemoryIdsByAgent: Record<string, string[]> = {};
  participants.forEach((p, idx) => {
    accessedMemoryIdsByAgent[p.id] = builtParticipants[idx]?.accessedIds ?? [];
  });

  return {
    ...response,
    accessedMemoryIdsByAgent,
  };
}

/**
 * Autonomous BDI Strategic Decision Fork (1 LLM call).
 */
export async function requestAutonomousDecision(
  world: WorldState,
  agent: AgentState,
  simTimeLabel: string,
  forkReason?: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const businesses = world.businesses ?? {};
  const empLocId = agent.employerLocationId;
  const employerName = empLocId
    ? (businesses[empLocId]?.name ?? world.locations.find((l) => l.id === empLocId)?.name)
    : undefined;
  const query = buildAgentQuery(agent, `${forkReason ?? ''} project proposal notice budget`);
  const built = buildAgentPayload(
    agent,
    world.locations,
    world.objects,
    query,
    world.simMinutes,
    undefined,
    0,
    noRetr,
    employerName,
    Object.keys(agent.socialGraph),
  );

  const openProposals = (world.proposals ?? [])
    .filter((p) => p.status === 'open')
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      title: clip(p.title, 140),
      description: clip(p.description, 260),
      cost: p.cost,
    }));

  const recentNotices = (world.notices ?? []).slice(0, 6).map((n) => ({
    title: clip(n.title, 140),
    category: n.category,
  }));

  const openPetitions = (world.petitions ?? [])
    .filter((p) => p.status === 'gathering')
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      title: clip(p.title, 140),
      signatures: p.signerIds.length,
      requiredSignatures: p.targetSignatures,
    }));

  const election = world.election
    ? {
        status: world.election.status,
        electionDay: world.election.electionDay,
        hasVoted: world.election.votersCast.includes(agent.id),
        candidates: world.election.candidates.slice(0, 6).map((c) => ({
          agentId: c.agentId,
          name: clip(c.name, 100),
          platform: clip(c.platform, 200),
        })),
      }
    : undefined;

  const knownPeers = world.agents
    .filter((a) => a.id !== agent.id)
    .sort((a, b) => {
      const fA = agent.socialGraph[a.id]?.familiarity ?? 0;
      const fB = agent.socialGraph[b.id]?.familiarity ?? 0;
      return fB - fA;
    })
    .slice(0, 8)
    .map((peer) => {
      const w = peer.wallet ?? 120;
      const walletBand = w < 60 ? 'tight' : w >= 200 ? 'flush' : 'steady';
      return {
        id: peer.id,
        name: clip(peer.name, 100),
        trust: Math.round(agent.socialGraph[peer.id]?.trust ?? 45),
        walletBand,
      };
    });

  const ambitions = (agent.intentStack?.ambitions ?? [])
    .filter((a) => a.status === 'active')
    .slice(0, 4)
    .map((a) => ({
      title: clip(a.title, 140),
      domain: a.domain,
      progress: a.progress,
    }));

  const commitments = (agent.intentStack?.commitments ?? [])
    .filter((c) => c.status === 'pending')
    .slice(0, 5)
    .map((c) => ({
      title: clip(c.title, 140),
      locationId: c.locationId,
      dueDay: c.dueDay,
      dueMinute: c.dueMinute,
    }));

  const unreadLetters = (world.letters ?? [])
    .filter(
      (l) =>
        l.toAgentId === agent.id &&
        l.deliveredAt <= world.simMinutes &&
        (!l.readAt || world.simMinutes - l.readAt <= 90),
    )
    .slice(0, 4)
    .map((l) => ({
      fromAgentId: l.fromAgentId,
      fromName: clip(l.fromName, 100),
      subject: clip(l.subject, 110),
      body: clip(l.body, 340),
    }));

  const openDisputes = (world.disputes ?? [])
    .filter((d) => d.status === 'open')
    .slice(0, 6)
    .map((d) => ({
      id: d.id,
      category: d.category,
      claimSummary: clip(d.claimSummary, 180),
      claimedAmount: d.claimedAmount,
    }));

  const coalitions = (world.coalitions ?? [])
    .filter((c) => c.active)
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      name: clip(c.name, 80),
      agenda: c.agenda,
      memberCount: c.memberIds.length,
    }));

  const activeBoycotts = (world.boycotts ?? [])
    .filter((b) => b.active)
    .slice(0, 6)
    .map((b) => ({
      id: b.id,
      targetLocationId: b.targetLocationId,
      targetBusinessName: clip(b.targetBusinessName, 100),
      reason: clip(b.reason, 180),
    }));

  const activeShocks = (world.activeShocks ?? [])
    .filter((s) => s.active)
    .slice(0, 4)
    .map((s) => ({
      kind: s.kind,
      title: clip(s.title, 100),
      description: clip(s.description, 220),
    }));

  // Epistemic hygiene: ONLY send rumors this agent has heard or is the subject of, NEVER leaking objective veracity/isDeceptive!
  const activeRumors = (world.rumors ?? [])
    .filter(
      (r) =>
        !r.debunked &&
        (r.originAgentId === agent.id ||
          r.subjectAgentId === agent.id ||
          r.believerIds.includes(agent.id) ||
          r.skepticIds.includes(agent.id)),
    )
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      claim: clip(r.currentClaim, 220),
      originName: clip(r.originName, 100),
      hopCount: r.hopCount,
    }));

  const culturalNorms = (world.culturalNorms ?? [])
    .slice(0, 5)
    .map((n) => ({
      key: n.key,
      title: clip(n.title, 80),
      strength: n.strength,
    }));

  const result = await postJson<BdiDecisionResult>(
    '/api/agent/decide',
    {
      agent: built.payload,
      worldName: world.worldName ? clip(world.worldName, 100) : undefined,
      simTimeLabel: clip(simTimeLabel, 120),
      forkReason: forkReason ? clip(forkReason, 280) : undefined,
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
      openProposals,
      recentNotices,
      openPetitions,
      election,
      knownPeers,
      ambitions,
      commitments,
      unreadLetters,
      openDisputes,
      coalitions,
      activeBoycotts,
      activeShocks,
      activeRumors,
      culturalNorms,
    },
    45_000,
  );

  return {
    decision: result,
    accessedMemoryIds: built.accessedIds,
  };
}

/**
 * Park et al. (2023) 2-step reflection:
 * Step 1: Pass up to 100 recent memories to obtain 3 focal questions.
 * Step 2: Client retrieves top-12 memories per question (respecting noMemoryRetrieval ablation)
 *         and sends questionEvidenceSets -> returns verified insights citing only listed IDs.
 */
export async function requestReflection(
  world: WorldState,
  agent: AgentState,
  simTimeLabel: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const query = buildAgentQuery(agent);
  const emb = noRetr ? undefined : await tryEmbedQuery(agent, query);
  const built = buildAgentPayload(
    agent,
    world.locations,
    world.objects,
    query,
    world.simMinutes,
    emb,
    0,
    noRetr,
  );

  const recent100 = agent.memories
    .slice(0, Math.min(100, Math.max(20, agent.memories.length)))
    .map((m) => ({
      id: m.id,
      type: m.type,
      description: clip(m.description, 580),
      importance: m.importance,
    }));

  const qRes = await postJson<{ focalQuestions: string[] }>(
    '/api/agent/reflect/questions',
    {
      agent: built.payload,
      simTimeLabel: clip(simTimeLabel, 120),
      recentMemories: recent100,
    },
    45_000,
  );

  const accessedIds = new Set<string>(built.accessedIds);
  const questionEvidenceSets = await Promise.all(
    qRes.focalQuestions.slice(0, 3).map(async (q) => {
      const qEmb = noRetr ? undefined : await tryEmbedQuery(agent, q);
      const selected = selectMemoriesForAgent(agent, q, world.simMinutes, 12, qEmb, noRetr);
      for (const r of selected) accessedIds.add(r.node.id);
      return {
        question: clip(q, 580),
        memories: selected.map((r) => ({
          id: r.node.id,
          type: r.node.type,
          description: clip(r.node.description, 580),
          importance: r.node.importance,
        })),
      };
    }),
  );

  const response = await postJson<{
    focalQuestions: string[];
    reflections: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
  }>(
    '/api/agent/reflect',
    {
      agent: built.payload,
      simTimeLabel: clip(simTimeLabel, 120),
      questionEvidenceSets,
    },
    50_000,
  );

  return {
    ...response,
    accessedMemoryIds: Array.from(accessedIds),
  };
}

export async function requestPlanUpdate(
  world: WorldState,
  agent: AgentState,
  simTimeLabel: string,
  currentMinuteOfDay: number,
  isMorningPlan = false,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const query = isMorningPlan
    ? buildAgentQuery(agent, 'consolidated lessons commitments schedule morning')
    : buildAgentQuery(agent, 'daily schedule commitments');
  const emb = noRetr ? undefined : await tryEmbedQuery(agent, query);
  const built = buildAgentPayload(
    agent,
    world.locations,
    world.objects,
    query,
    world.simMinutes,
    emb,
    0,
    noRetr,
  );

  const response = await postJson<{
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
  }>(
    '/api/agent/plan',
    {
      agent: built.payload,
      simTimeLabel: clip(simTimeLabel, 120),
      currentMinuteOfDay,
      isMorningPlan,
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
      objects: world.objects
        .slice(0, 40)
        .map((o) => ({ id: o.id, name: clip(o.name, 120), locationId: o.locationId })),
    },
    50_000,
  );

  return {
    ...response,
    accessedMemoryIds: built.accessedIds,
  };
}

export async function requestReaction(
  world: WorldState,
  agent: AgentState,
  observation: string,
  simTimeLabel: string,
  partner?: AgentState,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const query = `${observation} ${agent.currently}`;
  const emb = noRetr ? undefined : await tryEmbedQuery(agent, query);
  const built = buildAgentPayload(
    agent,
    world.locations,
    world.objects,
    query,
    world.simMinutes,
    emb,
    0,
    noRetr,
    undefined,
    partner ? [partner.id] : undefined,
  );

  const response = await postJson<{
    react: boolean;
    reason: string;
    newActivity?: string;
    kind?: ScheduleBlockKind;
    locationId?: string;
    objectId?: string;
    durationMinutes?: number;
    emoji?: string;
    talkTo?: string;
  }>(
    '/api/agent/react',
    {
      agent: built.payload,
      observation: clip(observation, 580),
      simTimeLabel: clip(simTimeLabel, 120),
      partnerName: partner ? clip(partner.name, 120) : undefined,
      partnerAction: partner ? clip(partner.currentAction, 200) : undefined,
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
      objects: world.objects
        .slice(0, 40)
        .map((o) => ({ id: o.id, name: clip(o.name, 120), locationId: o.locationId })),
    },
    45_000,
  );

  return {
    ...response,
    accessedMemoryIds: built.accessedIds,
  };
}

export async function requestStepDetail(
  world: WorldState,
  agent: AgentState,
  block: { activity: string; kind: ScheduleBlockKind; durationMinutes: number },
  simTimeLabel: string,
) {
  const built = buildAgentPayload(
    agent,
    world.locations,
    world.objects,
    block.activity,
    world.simMinutes,
    undefined,
    0,
    true,
  );
  return postJson<{ subSteps: string[] }>(
    '/api/agent/step-detail',
    {
      agent: built.payload,
      block,
      simTimeLabel: clip(simTimeLabel, 120),
    },
    40_000,
  );
}

export async function requestInterview(
  world: WorldState,
  agent: AgentState,
  question: string,
  simTimeLabel: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const emb = noRetr ? undefined : await tryEmbedQuery(agent, question);
  const built = buildAgentPayload(agent, world.locations, world.objects, question, world.simMinutes, emb, 0, noRetr);
  const response = await postJson<{
    answer: string;
    citedMemoryIds: string[];
    observationSummary: string;
  }>(
    '/api/agent/interview',
    {
      agent: built.payload,
      question: clip(question, 580),
      simTimeLabel: clip(simTimeLabel, 120),
    },
    50_000,
  );
  return {
    ...response,
    accessedMemoryIds: built.accessedIds,
  };
}

export async function requestInterviewJudge(
  world: WorldState,
  agent: AgentState,
  question: string,
  answer: string,
  simTimeLabel: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const built = buildAgentPayload(agent, world.locations, world.objects, question, world.simMinutes, undefined, 0, noRetr);
  return postJson<{ score: number; rationale: string }>(
    '/api/agent/interview-judge',
    {
      agent: built.payload,
      question: clip(question, 580),
      answer: clip(answer, 580),
      simTimeLabel: clip(simTimeLabel, 120),
    },
    40_000,
  );
}

export async function requestWhisper(
  world: WorldState,
  agent: AgentState,
  thought: string,
  simTimeLabel: string,
) {
  const noRetr = Boolean(world.ablations?.noMemoryRetrieval);
  const emb = noRetr ? undefined : await tryEmbedQuery(agent, thought);
  const built = buildAgentPayload(agent, world.locations, world.objects, thought, world.simMinutes, emb, 0, noRetr);
  const response = await postJson<{
    reactionBubble: string;
    memoryObservation: string;
    importance: number;
    newAction: string;
    targetLocationId?: string;
    emoji: string;
    emotionalShift?: { deltaValence: number; deltaArousal: number };
  }>(
    '/api/agent/whisper',
    {
      agent: built.payload,
      thought: clip(thought, 580),
      simTimeLabel: clip(simTimeLabel, 120),
      locations: world.locations.slice(0, 40).map((l) => ({ id: l.id, name: clip(l.name, 120) })),
    },
    50_000,
  );
  return {
    ...response,
    accessedMemoryIds: built.accessedIds,
  };
}

export async function requestSleepConsolidation(
  world: WorldState,
  agent: AgentState,
  simTimeLabel: string,
) {
  const query = buildAgentQuery(agent);
  const built = buildAgentPayload(agent, world.locations, world.objects, query, world.simMinutes);
  const memories = agent.memories.slice(0, 24).map((m) => ({
    id: m.id,
    type: m.type,
    description: clip(m.description, 580),
    importance: m.importance,
  }));
  return postJson<{
    consolidatedInsights: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
    prunedMemoryIds: string[];
    socialUpdates?: Array<{ targetId: string; inferredGoal: string; deltaTrust?: number }>;
  }>(
    '/api/agent/consolidate',
    {
      agent: built.payload,
      simTimeLabel: clip(simTimeLabel, 120),
      memories,
    },
    50_000,
  );
}
