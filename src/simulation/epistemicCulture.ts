/**
 * Phase 3 — Epistemic Reality, Rumor Mutation, Deception & Emergent Cultural Norms.
 *
 * Separates objective world state from subjective agent beliefs:
 * - Tracks rumor propagation hops, telephone-game claim mutation & veracity degradation
 * - Supports strategic deception (originators know their claim is false) & trust-gated skepticism
 * - Enables town-hall / library fact-checking that debunks falsehoods OR confirms whistleblowers
 * - Evolves shared cultural norms from actual contract, loan, pricing & civic compliance
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { attachAssociativeLinks, upsertBelief } from './cognitiveDepth';
import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { applyEmotionalAppraisal, updateSocialEdge } from './psychology';
import { postPublicNotice } from './socialFabric';
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type ChronicleEvent,
  type CulturalNorm,
  type CulturalNormKey,
  type GroundTruthStatus,
  type RumorVeracity,
  type TownRumor,
  type WorldState,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function addLinkedMemory(
  agent: AgentState,
  node: ReturnType<typeof createMemoryNode>,
  simMinutes: number,
  allocId: (prefix: string) => string,
) {
  const { linkedNode, updatedExisting } = attachAssociativeLinks(node, agent.memories);
  return compactMemories(
    [linkedNode, ...updatedExisting],
    DEFAULT_MEMORY_CAP,
    simMinutes,
    allocId,
  );
}

// ---------------------------------------------------------------------------
// 1. Seed & Query Emergent Cultural Norms
// ---------------------------------------------------------------------------

export function createInitialCulturalNorms(day = 1): CulturalNorm[] {
  return [
    {
      id: 'norm_debt_honor',
      key: 'debt_honor',
      title: 'Honor Debts & Contracts',
      description: 'Residents are expected to repay loans and keep bilateral agreements on schedule.',
      strength: 66,
      complianceRate: 0.82,
      violationsCount: 0,
      endorsementsCount: 0,
      championIds: [],
      lastUpdatedDay: day,
    },
    {
      id: 'norm_fair_pricing',
      key: 'fair_pricing',
      title: 'Fair Merchant Dealing',
      description: 'Shops and cafes earn neighborhood goodwill by keeping staples affordable.',
      strength: 60,
      complianceRate: 0.78,
      violationsCount: 0,
      endorsementsCount: 0,
      championIds: [],
      lastUpdatedDay: day,
    },
    {
      id: 'norm_mutual_aid',
      key: 'mutual_aid',
      title: 'Neighborly Mutual Aid',
      description: 'Community members support neighbors facing illness or hard times.',
      strength: 62,
      complianceRate: 0.76,
      violationsCount: 0,
      endorsementsCount: 0,
      championIds: [],
      lastUpdatedDay: day,
    },
    {
      id: 'norm_civic_duty',
      key: 'civic_duty',
      title: 'Civic Participation',
      description: 'Town governance thrives when residents show up to vote and deliberate.',
      strength: 58,
      complianceRate: 0.74,
      violationsCount: 0,
      endorsementsCount: 0,
      championIds: [],
      lastUpdatedDay: day,
    },
    {
      id: 'norm_truthfulness',
      key: 'truthfulness',
      title: 'Truthfulness & Public Evidence',
      description: 'Slander and fabricated rumors damage standing when exposed in public records.',
      strength: 64,
      complianceRate: 0.8,
      violationsCount: 0,
      endorsementsCount: 0,
      championIds: [],
      lastUpdatedDay: day,
    },
  ];
}

export function getNormComplianceModifier(
  world: WorldState,
  agentId: string,
  normKey: CulturalNormKey,
): number {
  const norm = (world.culturalNorms ?? []).find((n) => n.key === normKey);
  if (!norm) return 0;
  const base = (norm.strength - 50) / 200; // in [-0.20, +0.25]
  const champBoost = norm.championIds.includes(agentId) ? 0.08 : 0;
  return Number(clamp(base + champBoost, -0.1, 0.25).toFixed(3));
}

export function endorseCulturalNorm(
  world: WorldState,
  agentId: string,
  normKey: CulturalNormKey,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return { world, ok: false, reason: 'Unknown resident' };

  const norms =
    world.culturalNorms && world.culturalNorms.length > 0
      ? world.culturalNorms
      : createInitialCulturalNorms(formatSimTime(world.simMinutes).day);
  const idx = norms.findIndex((n) => n.key === normKey);
  if (idx < 0) return { world, ok: false, reason: 'Unknown cultural norm' };

  const target = norms[idx];
  const day = formatSimTime(world.simMinutes).day;
  const nextNorm: CulturalNorm = {
    ...target,
    strength: clamp(target.strength + 5, 10, 100),
    endorsementsCount: target.endorsementsCount + 1,
    championIds: Array.from(new Set([...target.championIds, agentId])).slice(-10),
    lastUpdatedDay: day,
  };
  const nextNorms = norms.map((n, i) => (i === idx ? nextNorm : n));

  const mem = createMemoryNode({
    id: allocId(`mem_norm_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'norm',
    description: `${agent.name} publicly championed the town norm "${target.title}".`,
    importance: 6,
  });

  const nextAgents = world.agents.map((ag) =>
    ag.id === agentId
      ? {
          ...ag,
          reputation: clamp((ag.reputation ?? 55) + 2, -100, 100),
          memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
        }
      : ag,
  );

  const chr: ChronicleEvent = {
    id: allocId('chr_norm'),
    simMinutes: world.simMinutes,
    type: 'civic',
    title: `${agent.name} affirmed "${target.title}"`,
    detail: `Public endorsement strengthened town support for ${target.title} (${nextNorm.strength}/100).`,
    agentIds: [agentId],
    locationName: 'Town Hall & Gazette',
  };

  return {
    ok: true,
    reason: `Endorsed "${target.title}"`,
    world: {
      ...world,
      agents: nextAgents,
      culturalNorms: nextNorms,
      chronicle: [chr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        normEndorsements: (world.stats.normEndorsements ?? 0) + 1,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Objective Ground-Truth Verifier & Telephone-Game Rumor Mutation
// ---------------------------------------------------------------------------

export function evaluateClaimVeracity(
  world: WorldState,
  params: { claim: string; subjectAgentId?: string; isDeceptive?: boolean },
): RumorVeracity {
  if (params.isDeceptive) return 'false';
  const low = params.claim.toLowerCase();
  const subject = params.subjectAgentId
    ? world.agents.find((a) => a.id === params.subjectAgentId)
    : undefined;

  if (/\b(default|unpaid loan|owes|debt)\b/.test(low) && subject) {
    const hasLoan = (world.loans ?? []).some(
      (l) => l.borrowerId === subject.id && (l.status === 'defaulted' || l.status === 'active'),
    );
    return hasLoan ? 'true' : 'false';
  }

  if (/\b(breach|broke contract|reneged|failed to deliver)\b/.test(low) && subject) {
    const hasBreach = (world.serviceContracts ?? []).some(
      (c) => c.counterpartyId === subject.id && c.status === 'breached',
    );
    return hasBreach ? 'true' : 'false';
  }

  if (/\b(broke|bankrupt|insolvent|out of cash)\b/.test(low) && subject) {
    const lowWallet = (subject.wallet ?? 100) < 45;
    const lowBiz = Object.values(world.businesses ?? {}).some(
      (b) => b.ownerId === subject.id && b.treasury < 65,
    );
    return lowWallet || lowBiz ? 'true' : 'false';
  }

  if (/\b(laid off|fired|unemployed|jobless)\b/.test(low) && subject) {
    return !subject.employerLocationId ? 'true' : 'false';
  }

  if (/\b(sick|ill|cold|unwell)\b/.test(low) && subject) {
    const unwell = (subject.illness && subject.illness !== 'none') || (subject.health ?? 95) < 65;
    return unwell ? 'true' : 'false';
  }

  if (/\b(boycott|dispute|sued|arbitration)\b/.test(low) && subject) {
    const activeBoycott = (world.boycotts ?? []).some(
      (b) => b.active && world.businesses?.[b.targetLocationId]?.ownerId === subject.id,
    );
    const activeDispute = (world.disputes ?? []).some(
      (d) => d.respondentId === subject.id || d.claimantId === subject.id,
    );
    return activeBoycott || activeDispute ? 'true' : 'false';
  }

  return 'true';
}

export function mutateRumorClaim(claim: string, hopCount: number, isHostile: boolean): string {
  const clean = claim.trim();
  if (hopCount <= 0) return clean.slice(0, 220);

  let mutated = clean
    .replace(/\btight on cash\b/gi, 'nearly insolvent')
    .replace(/\blate on\b/gi, 'refusing to honor')
    .replace(/\bdisagreed\b/gi, 'bitterly clashed')
    .replace(/\braised prices\b/gi, 'been overcharging neighbors');

  if (mutated === clean && hopCount >= 2) {
    const trimmed = clean.replace(/[.!?]+$/, '');
    mutated = isHostile
      ? `Word around town insists ${trimmed} — and some say it is worse than admitted.`
      : `Neighbors say ${trimmed} (unverified hearsay).`;
  }
  return mutated.slice(0, 220);
}

function veracityToGroundTruth(v: RumorVeracity): GroundTruthStatus {
  if (v === 'true') return 'verified';
  if (v === 'false') return 'false';
  return 'unverifiable';
}

// ---------------------------------------------------------------------------
// 3. Rumor Creation, Multi-Hop Propagation, Gossip Bridge & Debunking
// ---------------------------------------------------------------------------

export function propagateRumorHop(
  world: WorldState,
  rumorId: string,
  speakerId: string,
  listenerId: string,
  allocId: (prefix: string) => string,
): { world: WorldState; propagated: boolean; believed: boolean } {
  if (speakerId === listenerId) return { world, propagated: false, believed: false };
  const rumors = world.rumors ?? [];
  const rIdx = rumors.findIndex((r) => r.id === rumorId);
  if (rIdx < 0) return { world, propagated: false, believed: false };
  const rumor = rumors[rIdx];
  if (rumor.debunked) return { world, propagated: false, believed: false };
  if (rumor.believerIds.includes(listenerId) || rumor.skepticIds.includes(listenerId)) {
    return { world, propagated: false, believed: false };
  }

  const speaker = world.agents.find((a) => a.id === speakerId);
  const listener = world.agents.find((a) => a.id === listenerId);
  if (!speaker || !listener) return { world, propagated: false, believed: false };

  const speakerTrust = listener.socialGraph[speakerId]?.trust ?? 45;
  const stubbornness = listener.temperament?.stubbornness ?? 0.55;
  const subjectTrustFromSpeaker = rumor.subjectAgentId
    ? speaker.socialGraph[rumor.subjectAgentId]?.trust ?? 50
    : 50;
  const isHostile = rumor.isDeceptive || subjectTrustFromSpeaker < 38;

  const nextHop = rumor.hopCount + 1;
  const shouldMutate = nextHop >= 2 || (isHostile && nextHop >= 1);
  const nextClaim = shouldMutate
    ? mutateRumorClaim(rumor.currentClaim, nextHop, isHostile)
    : rumor.currentClaim;

  let nextVeracity: RumorVeracity = rumor.veracity;
  if (nextVeracity === 'true' && shouldMutate && nextClaim !== rumor.originalClaim) {
    nextVeracity = 'distorted';
  } else if (nextVeracity === 'distorted' && isHostile && nextHop >= 3) {
    nextVeracity = 'false';
  }

  // Subject recognizes false smear about themselves as false; low-trust/stubborn listeners resist
  const isFalseSelfSmear = listener.id === rumor.subjectAgentId && nextVeracity !== 'true';
  const resisted =
    isFalseSelfSmear || speakerTrust < 30 || (stubbornness >= 0.72 && speakerTrust < 55);
  const believed = !resisted;

  const nextRumor: TownRumor = {
    ...rumor,
    currentClaim: nextClaim,
    veracity: nextVeracity,
    hopCount: nextHop,
    lastMutatedAt: nextClaim !== rumor.currentClaim ? world.simMinutes : rumor.lastMutatedAt,
    believerIds: believed ? [...rumor.believerIds, listener.id] : rumor.believerIds,
    skepticIds: !believed ? [...rumor.skepticIds, listener.id] : rumor.skepticIds,
  };

  const memDesc = believed
    ? `${speaker.name.split(' ')[0]} told ${listener.name.split(' ')[0]} a rumor: "${nextClaim}"`
    : `${speaker.name.split(' ')[0]} shared an unverified rumor ("${nextClaim}"), which ${listener.name.split(' ')[0]} doubted.`;
  const mem = createMemoryNode({
    id: allocId(`mem_rum_${listener.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'rumor',
    description: memDesc,
    importance: believed ? 6 : 4,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== listener.id) return ag;
    let nextBeliefs = ag.beliefs ?? [];
    let nextGraph = ag.socialGraph;
    if (believed && rumor.subjectAgentId) {
      const bRes = upsertBelief(
        nextBeliefs,
        {
          subjectId: rumor.subjectAgentId,
          predicate: 'reputation',
          claim: nextClaim,
          confidence: clamp(0.42 + speakerTrust / 200, 0.3, 0.88),
          sourceMemoryId: mem.id,
          provenance: rumor.isDeceptive ? 'deception' : 'rumor',
          sourceAgentId: speaker.id,
          hopCount: nextHop,
          groundTruthStatus: veracityToGroundTruth(nextVeracity),
        },
        world.simMinutes,
        allocId,
      );
      nextBeliefs = bRes.beliefs;

      if (isHostile && rumor.subjectAgentId !== ag.id) {
        const subjEdge = nextGraph[rumor.subjectAgentId];
        nextGraph = {
          ...nextGraph,
          [rumor.subjectAgentId]: updateSocialEdge(subjEdge, {
            targetId: rumor.subjectAgentId,
            roleLabel: subjEdge?.roleLabel ?? 'Subject of rumor',
            deltaTrust: -5,
            deltaAffection: -3,
            deltaFamiliarity: 2,
            inferredGoal: nextClaim.slice(0, 140),
            simMinutes: world.simMinutes,
          }),
        };
      }
    }
    return {
      ...ag,
      beliefs: nextBeliefs,
      socialGraph: nextGraph,
      memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
    };
  });

  return {
    propagated: true,
    believed,
    world: {
      ...world,
      agents: nextAgents,
      rumors: rumors.map((r, i) => (i === rIdx ? nextRumor : r)),
      stats: {
        ...world.stats,
        rumorsSpread: (world.stats.rumorsSpread ?? 0) + 1,
        refusalsAndDisagreements:
          (world.stats.refusalsAndDisagreements ?? 0) + (believed ? 0 : 1),
      },
    },
  };
}

export function createOrSpreadRumor(
  world: WorldState,
  params: {
    speakerId: string;
    targetAgentId?: string;
    subjectAgentId?: string;
    subjectLocationId?: string;
    claim: string;
    isDeceptive?: boolean;
    existingRumorId?: string;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; rumor?: TownRumor } {
  if (params.existingRumorId) {
    const existing = (world.rumors ?? []).find(
      (r) => r.id === params.existingRumorId && !r.debunked,
    );
    if (existing) {
      const listenerId =
        params.targetAgentId ??
        world.agents.find(
          (a) =>
            a.id !== params.speakerId &&
            !existing.believerIds.includes(a.id) &&
            !existing.skepticIds.includes(a.id),
        )?.id;
      if (!listenerId) return { world, ok: false };
      const prop = propagateRumorHop(world, existing.id, params.speakerId, listenerId, allocId);
      return {
        world: prop.world,
        ok: prop.propagated,
        rumor: prop.world.rumors?.find((r) => r.id === existing.id),
      };
    }
  }

  const speaker = world.agents.find((a) => a.id === params.speakerId);
  const cleanClaim = params.claim.trim().slice(0, 220);
  if (!speaker || !cleanClaim) return { world, ok: false };

  const isDeceptive = Boolean(params.isDeceptive);
  const veracity = evaluateClaimVeracity(world, {
    claim: cleanClaim,
    subjectAgentId: params.subjectAgentId,
    isDeceptive,
  });

  const rumor: TownRumor = {
    id: allocId('rum'),
    originAgentId: speaker.id,
    originName: speaker.name,
    ...(params.subjectAgentId ? { subjectAgentId: params.subjectAgentId } : {}),
    ...(params.subjectLocationId ? { subjectLocationId: params.subjectLocationId } : {}),
    originalClaim: cleanClaim,
    currentClaim: cleanClaim,
    isDeceptive,
    veracity,
    hopCount: 0,
    createdAt: world.simMinutes,
    believerIds: isDeceptive ? [] : [speaker.id],
    skepticIds: [],
    debunked: false,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_rum_orig_${speaker.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'rumor',
    description: isDeceptive
      ? `${speaker.name} fabricated and circulated a misleading claim: "${cleanClaim}".`
      : `${speaker.name} started sharing a claim around town: "${cleanClaim}".`,
    importance: 6,
  });

  let working: WorldState = {
    ...world,
    agents: world.agents.map((ag) =>
      ag.id === speaker.id
        ? { ...ag, memories: addLinkedMemory(ag, mem, world.simMinutes, allocId) }
        : ag,
    ),
    rumors: [rumor, ...(world.rumors ?? [])].slice(0, 32),
    stats: {
      ...world.stats,
      rumorsSpread: (world.stats.rumorsSpread ?? 0) + 1,
      deceptionsAttempted: (world.stats.deceptionsAttempted ?? 0) + (isDeceptive ? 1 : 0),
    },
  };

  const nearbyListener =
    params.targetAgentId ??
    working.agents.find(
      (a) =>
        a.id !== speaker.id &&
        a.id !== params.subjectAgentId &&
        Boolean(speaker.currentLocationId) &&
        a.currentLocationId === speaker.currentLocationId,
    )?.id;

  if (nearbyListener) {
    working = propagateRumorHop(working, rumor.id, speaker.id, nearbyListener, allocId).world;
  }

  return {
    world: working,
    ok: true,
    rumor: working.rumors?.find((r) => r.id === rumor.id),
  };
}

/**
 * Lightweight bridge called from applyGossipUpdates: registers gossip claims in world.rumors
 * and attaches provenance onto the listener's belief graph without inflating memory count.
 */
export function recordRumorFromGossip(
  world: WorldState,
  gossip: {
    speakerId: string;
    listenerId: string;
    aboutAgentId: string;
    claim: string;
    deltaTrust: number;
  },
  allocId: (prefix: string) => string,
): WorldState {
  const speaker = world.agents.find((a) => a.id === gossip.speakerId);
  const listener = world.agents.find((a) => a.id === gossip.listenerId);
  if (!speaker || !listener) return world;

  const cleanClaim = gossip.claim.trim().slice(0, 220);
  if (!cleanClaim) return world;

  const existingIdx = (world.rumors ?? []).findIndex(
    (r) =>
      !r.debunked &&
      r.subjectAgentId === gossip.aboutAgentId &&
      r.originalClaim.toLowerCase().slice(0, 40) === cleanClaim.toLowerCase().slice(0, 40),
  );

  let nextRumors = [...(world.rumors ?? [])];
  let activeVeracity: RumorVeracity;
  let activeHop: number;
  let finalClaim = cleanClaim;

  if (existingIdx >= 0) {
    const prev = nextRumors[existingIdx];
    activeHop = prev.hopCount + 1;
    finalClaim =
      activeHop >= 2
        ? mutateRumorClaim(prev.currentClaim, activeHop, gossip.deltaTrust < 0)
        : prev.currentClaim;
    activeVeracity =
      prev.veracity === 'true' && finalClaim !== prev.originalClaim ? 'distorted' : prev.veracity;
    nextRumors[existingIdx] = {
      ...prev,
      hopCount: activeHop,
      currentClaim: finalClaim,
      veracity: activeVeracity,
      believerIds: Array.from(new Set([...prev.believerIds, listener.id])),
    };
  } else {
    activeVeracity = evaluateClaimVeracity(world, {
      claim: cleanClaim,
      subjectAgentId: gossip.aboutAgentId,
    });
    activeHop = 1;
    const newRumor: TownRumor = {
      id: allocId('rum'),
      originAgentId: speaker.id,
      originName: speaker.name,
      subjectAgentId: gossip.aboutAgentId,
      originalClaim: cleanClaim,
      currentClaim: cleanClaim,
      isDeceptive: false,
      veracity: activeVeracity,
      hopCount: 1,
      createdAt: world.simMinutes,
      believerIds: [speaker.id, listener.id],
      skepticIds: [],
      debunked: false,
    };
    nextRumors = [newRumor, ...nextRumors].slice(0, 32);
  }

  const speakerTrust = listener.socialGraph[speaker.id]?.trust ?? 45;
  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== listener.id) return ag;
    const bRes = upsertBelief(
      ag.beliefs,
      {
        subjectId: gossip.aboutAgentId,
        predicate: 'reputation',
        claim: finalClaim,
        confidence: clamp(0.45 + speakerTrust / 200, 0.35, 0.85),
        provenance: 'rumor',
        sourceAgentId: speaker.id,
        hopCount: activeHop,
        groundTruthStatus: veracityToGroundTruth(activeVeracity),
      },
      world.simMinutes,
      allocId,
    );
    return { ...ag, beliefs: bRes.beliefs };
  });

  return {
    ...world,
    agents: nextAgents,
    rumors: nextRumors,
    stats: {
      ...world.stats,
      rumorsSpread: (world.stats.rumorsSpread ?? 0) + 1,
    },
  };
}

export function factCheckRumor(
  world: WorldState,
  investigatorId: string,
  rumorId: string,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; debunked: boolean; verifiedTrue: boolean; summary: string } {
  const rumors = world.rumors ?? [];
  const rIdx = rumors.findIndex((r) => r.id === rumorId);
  const investigator = world.agents.find((a) => a.id === investigatorId);
  if (rIdx < 0 || !investigator) {
    return { world, ok: false, debunked: false, verifiedTrue: false, summary: 'Rumor or investigator not found' };
  }

  const rumor = rumors[rIdx];
  if (rumor.debunked) {
    return { world, ok: false, debunked: false, verifiedTrue: false, summary: 'Rumor already debunked' };
  }

  const originalVeracity = evaluateClaimVeracity(world, {
    claim: rumor.originalClaim,
    subjectAgentId: rumor.subjectAgentId,
    isDeceptive: rumor.isDeceptive,
  });
  const isFalseOrDistorted =
    rumor.isDeceptive ||
    rumor.veracity === 'false' ||
    rumor.veracity === 'distorted' ||
    originalVeracity === 'false';

  const day = formatSimTime(world.simMinutes).day;
  let nextNorms =
    world.culturalNorms && world.culturalNorms.length > 0
      ? [...world.culturalNorms]
      : createInitialCulturalNorms(day);
  const truthNormIdx = nextNorms.findIndex((n) => n.key === 'truthfulness');

  if (isFalseOrDistorted) {
    const misledSet = new Set([investigator.id, ...rumor.believerIds]);
    const summaryText = rumor.isDeceptive
      ? `${investigator.name} exposed a fabricated rumor by ${rumor.originName}: "${rumor.currentClaim}" contradicts Smallville public records.`
      : `${investigator.name} fact-checked and debunked a distorted rumor: "${rumor.currentClaim}".`;

    const noticeMem = createMemoryNode({
      id: allocId(`mem_fc_${investigator.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'civic',
      description: summaryText,
      importance: 8,
    });

    let beliefRevs = 0;
    const nextAgents = world.agents.map((ag) => {
      let updated = ag;
      let nextGraph = ag.socialGraph;
      let nextRep = ag.reputation ?? 55;
      let nextBeliefs = ag.beliefs ?? [];
      let nextMemories = ag.memories;

      if (ag.id === rumor.originAgentId && rumor.isDeceptive) {
        nextRep = clamp(nextRep - 14, -100, 100);
        updated = {
          ...updated,
          mood: applyEmotionalAppraisal(ag.mood, ag.drives, -0.2, 0.14),
        };
      }
      if (rumor.subjectAgentId && ag.id === rumor.subjectAgentId) {
        nextRep = clamp(nextRep + 8, -100, 100);
      }

      if (misledSet.has(ag.id) && rumor.subjectAgentId) {
        const correctedClaim = `Verified public record: rumor claiming "${rumor.currentClaim.slice(0, 90)}" was debunked.`;
        const bRes = upsertBelief(
          nextBeliefs,
          {
            subjectId: rumor.subjectAgentId,
            predicate: 'reputation',
            claim: correctedClaim,
            confidence: 0.96,
            sourceMemoryId: noticeMem.id,
            provenance: 'public_record',
            sourceAgentId: investigator.id,
            hopCount: 0,
            groundTruthStatus: 'verified',
          },
          world.simMinutes,
          allocId,
        );
        nextBeliefs = bRes.beliefs;
        if (bRes.revised) beliefRevs += 1;

        if (rumor.isDeceptive && ag.id !== rumor.originAgentId) {
          const deceiverEdge = nextGraph[rumor.originAgentId];
          nextGraph = {
            ...nextGraph,
            [rumor.originAgentId]: updateSocialEdge(deceiverEdge, {
              targetId: rumor.originAgentId,
              roleLabel: deceiverEdge?.roleLabel ?? 'Spoke falsely',
              deltaTrust: -20,
              deltaAffection: -12,
              deltaFamiliarity: 4,
              inferredGoal: 'Caught spreading deceptive rumor',
              simMinutes: world.simMinutes,
            }),
          };
        }
        nextMemories = addLinkedMemory(updated, noticeMem, world.simMinutes, allocId);
      }

      return {
        ...updated,
        reputation: nextRep,
        socialGraph: nextGraph,
        beliefs: nextBeliefs,
        memories: nextMemories,
      };
    });

    if (truthNormIdx >= 0) {
      const tn = nextNorms[truthNormIdx];
      nextNorms[truthNormIdx] = {
        ...tn,
        strength: clamp(tn.strength + 4, 10, 100),
        violationsCount: tn.violationsCount + (rumor.isDeceptive ? 1 : 0),
        lastUpdatedDay: day,
      };
    }

    const updatedRumor: TownRumor = {
      ...rumor,
      debunked: true,
      debunkedByAgentId: investigator.id,
      debunkedAt: world.simMinutes,
    };

    let nextWorld: WorldState = {
      ...world,
      agents: nextAgents,
      rumors: rumors.map((r, i) => (i === rIdx ? updatedRumor : r)),
      culturalNorms: nextNorms,
      chronicle: [
        {
          id: allocId('chr_debunk'),
          simMinutes: world.simMinutes,
          type: 'civic' as const,
          title: `Fact-check debunked rumor by ${rumor.originName.split(' ')[0]}`,
          detail: summaryText,
          agentIds: [investigator.id, rumor.originAgentId, ...(rumor.subjectAgentId ? [rumor.subjectAgentId] : [])],
          locationName: 'Town Hall & Gazette',
        },
        ...world.chronicle,
      ].slice(0, 140),
      stats: {
        ...world.stats,
        rumorsDebunked: (world.stats.rumorsDebunked ?? 0) + 1,
        deceptionsExposed: (world.stats.deceptionsExposed ?? 0) + (rumor.isDeceptive ? 1 : 0),
        beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevs,
      },
    };

    nextWorld = postPublicNotice(
      nextWorld,
      {
        authorId: investigator.id,
        authorName: investigator.name,
        category: 'civic',
        title: `Gazette Fact-Check: False Rumor Debunked`,
        body: summaryText,
        locationId: 'town_hall',
        createMeme: false,
      },
      allocId,
    );

    return { world: nextWorld, ok: true, debunked: true, verifiedTrue: false, summary: summaryText };
  }

  // Verified TRUE -> confirm public record & boost whistleblower standing!
  const verifiedSummary = `${investigator.name} verified town records confirming ${rumor.originName}'s report: "${rumor.originalClaim}".`;
  const verMem = createMemoryNode({
    id: allocId(`mem_ver_${investigator.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: verifiedSummary,
    importance: 7,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id === investigator.id || ag.id === rumor.originAgentId) {
      let nextBeliefs = ag.beliefs ?? [];
      if (rumor.subjectAgentId) {
        nextBeliefs = upsertBelief(
          nextBeliefs,
          {
            subjectId: rumor.subjectAgentId,
            predicate: 'reputation',
            claim: `Confirmed public record: ${rumor.originalClaim}`,
            confidence: 0.96,
            sourceMemoryId: verMem.id,
            provenance: 'public_record',
            sourceAgentId: investigator.id,
            hopCount: 0,
            groundTruthStatus: 'verified',
          },
          world.simMinutes,
          allocId,
        ).beliefs;
      }
      return {
        ...ag,
        reputation: clamp((ag.reputation ?? 55) + 5, -100, 100),
        beliefs: nextBeliefs,
        memories: addLinkedMemory(ag, verMem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  if (truthNormIdx >= 0) {
    const tn = nextNorms[truthNormIdx];
    nextNorms[truthNormIdx] = {
      ...tn,
      strength: clamp(tn.strength + 3, 10, 100),
      lastUpdatedDay: day,
    };
  }

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    rumors: rumors.map((r, i) => (i === rIdx ? { ...r, veracity: 'true' } : r)),
    culturalNorms: nextNorms,
    chronicle: [
      {
        id: allocId('chr_ver'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `Public record confirmed report by ${rumor.originName.split(' ')[0]}`,
        detail: verifiedSummary,
        agentIds: [investigator.id, rumor.originAgentId],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: investigator.id,
      authorName: investigator.name,
      category: 'news',
      title: `Verified Public Record: ${rumor.originName.split(' ')[0]}'s Report`,
      body: verifiedSummary,
      locationId: 'town_hall',
      createMeme: false,
    },
    allocId,
  );

  return { world: nextWorld, ok: true, debunked: false, verifiedTrue: true, summary: verifiedSummary };
}

// ---------------------------------------------------------------------------
// 4. Daily Epistemic & Cultural Norm Evolution
// ---------------------------------------------------------------------------

export function stepCulturalNorms(world: WorldState, currentDay: number): WorldState {
  const norms =
    world.culturalNorms && world.culturalNorms.length > 0
      ? world.culturalNorms
      : createInitialCulturalNorms(currentDay);

  const loans = world.loans ?? [];
  const repaid = loans.filter((l) => l.status === 'repaid').length;
  const defaulted = loans.filter((l) => l.status === 'defaulted').length;
  const activeBoycotts = (world.boycotts ?? []).filter((b) => b.active).length;
  const exposedDeceptions = world.stats.deceptionsExposed ?? 0;
  const unexposedDeceptions = (world.rumors ?? []).filter(
    (r) => r.isDeceptive && !r.debunked,
  ).length;
  const totalVotes = world.stats.civicVotesCast ?? 0;
  const clinicWorks = (world.stats.clinicTreatments ?? 0) + (world.townModifiers?.communityClinic ? 2 : 0);

  const nextNorms = norms.map((norm) => {
    let delta = 0;
    let complianceRate = norm.complianceRate;
    let violationsAdd = 0;

    switch (norm.key) {
      case 'debt_honor': {
        const total = repaid + defaulted;
        if (total > 0) {
          complianceRate = Number((repaid / total).toFixed(2));
          delta = repaid > defaulted ? 1 : -2;
          violationsAdd = defaulted > 0 ? 1 : 0;
        }
        break;
      }
      case 'fair_pricing': {
        delta = activeBoycotts > 0 ? -2 : 1;
        complianceRate = Number(clamp(activeBoycotts > 0 ? 0.65 : 0.8, 0.2, 1).toFixed(2));
        violationsAdd = activeBoycotts;
        break;
      }
      case 'mutual_aid': {
        delta = clinicWorks > 0 ? 1 : 0;
        break;
      }
      case 'civic_duty': {
        delta = totalVotes > 0 ? 1 : 0;
        break;
      }
      case 'truthfulness': {
        if (unexposedDeceptions > exposedDeceptions) delta = -1;
        else if (exposedDeceptions > 0) delta = 1;
        break;
      }
    }

    return {
      ...norm,
      strength: clamp(norm.strength + delta, 10, 100),
      complianceRate,
      violationsCount: norm.violationsCount + violationsAdd,
      lastUpdatedDay: currentDay,
    };
  });

  return {
    ...world,
    culturalNorms: nextNorms,
  };
}

export function applyDailyEpistemicAndCultureRollover(
  world: WorldState,
  currentDay: number,
  _allocId: (prefix: string) => string,
): WorldState {
  const retainedRumors = (world.rumors ?? [])
    .filter((r) => !r.debunked || world.simMinutes - (r.debunkedAt ?? r.createdAt) <= 4 * 1440)
    .slice(0, 32);

  const working: WorldState = {
    ...world,
    rumors: retainedRumors,
  };
  return stepCulturalNorms(working, currentDay);
}
