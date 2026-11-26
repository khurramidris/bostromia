import {
  getNormComplianceModifier,
  recordRumorFromGossip,
} from './epistemicCulture';
import { compactMemories, createMemoryNode, extractKeywords, formatSimTime } from './memory';
import { getCoalitionVotingBias } from './powerAndInstitutions';
import { applyEmotionalAppraisal, updateSocialEdge } from './psychology';
import { computeResidentReputation } from './worldEconomy';
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type ChronicleEvent,
  type CivicProposal,
  type GossipUpdate,
  type LocationZone,
  type NoticeCategory,
  type NoticeItem,
  type TownModifierKey,
  type WorldState,
} from './types';

export function createInitialNotices(
  locations: LocationZone[],
  agents: AgentState[],
  simMinutes: number,
): NoticeItem[] {
  const civicLoc =
    locations.find((l) => l.category === 'civic') ??
    locations.find((l) => l.category === 'cafe') ??
    locations[0];
  const cafeLoc = locations.find((l) => l.category === 'cafe') ?? civicLoc;
  const shopLoc = locations.find((l) => l.category === 'shop') ?? civicLoc;

  const journalist = agents.find((a) => a.occupation.toLowerCase().includes('journal')) ?? agents[0];
  const cafeOwner = agents.find((a) => a.occupation.toLowerCase().includes('cafe')) ?? agents[0];
  const farmer =
    agents.find(
      (a) =>
        a.occupation.toLowerCase().includes('agronom') ||
        a.occupation.toLowerCase().includes('garden'),
    ) ?? agents[agents.length - 1];

  return [
    {
      id: 'notice_seed_1',
      authorId: journalist?.id ?? 'town_gazette',
      authorName: journalist?.name ?? 'Community Gazette',
      category: 'civic',
      title: 'Town Council Open Ballot: Street Lighting & Market Support',
      body: 'Residents may vote at Town Hall on funding cedar street lanterns along South Lane ($120) and an organic harvest market stipend ($80).',
      locationId: civicLoc?.id ?? 'town_hall',
      createdAt: simMinutes - 45,
      readByAgentIds: journalist ? [journalist.id] : [],
    },
    {
      id: 'notice_seed_2',
      authorId: cafeOwner?.id ?? 'local_cafe',
      authorName: cafeOwner?.name ?? 'Local Cafe',
      category: 'market',
      title: 'Fresh Morning Pastries & Local Coffee Deals',
      body: 'Open daily from 7:00 AM with locally baked pastries, hot espresso, and lunch plates. Seeking steady local produce & baked deliveries.',
      locationId: cafeLoc?.id ?? 'hobbs_cafe',
      createdAt: simMinutes - 30,
      readByAgentIds: cafeOwner ? [cafeOwner.id] : [],
    },
    {
      id: 'notice_seed_3',
      authorId: farmer?.id ?? 'community_garden',
      authorName: farmer?.name ?? 'Community Garden',
      category: 'event',
      title: 'Fresh Harvest Produce & Cooperative Shift Openings',
      body: 'Heirloom greens and herbs are ready for town markets. Neighbors looking for extra work or community volunteering are welcome.',
      locationId: shopLoc?.id ?? 'willows_market',
      createdAt: simMinutes - 20,
      readByAgentIds: farmer ? [farmer.id] : [],
    },
  ];
}

export function createInitialProposals(
  agents: AgentState[],
  simMinutes: number,
): CivicProposal[] {
  const lampChampion =
    agents.find(
      (a) =>
        a.occupation.toLowerCase().includes('carpenter') ||
        a.goals.some((g) => g.toLowerCase().includes('lighting')),
    ) ?? agents[0];
  const marketChampion =
    agents.find(
      (a) =>
        a.occupation.toLowerCase().includes('agronom') ||
        a.goals.some((g) => g.toLowerCase().includes('harvest')),
    ) ?? agents[Math.min(1, agents.length - 1)];
  const libraryChampion =
    agents.find((a) => a.occupation.toLowerCase().includes('librar')) ??
    agents[Math.min(2, agents.length - 1)];

  return [
    {
      id: 'prop_street_lighting',
      title: 'Install Cedar Street Lanterns on South Lane',
      description:
        'Funds timber street lighting across evening walkways, reducing night fatigue and boosting evening community mood.',
      proposerId: lampChampion?.id ?? 'citizen',
      proposerName: lampChampion?.name ?? 'Community Member',
      cost: 120,
      effectKey: 'streetLighting',
      votesFor: lampChampion ? [lampChampion.id] : [],
      votesAgainst: [],
      status: 'open',
      createdAt: simMinutes - 60,
    },
    {
      id: 'prop_market_stipend',
      title: 'Local Harvest & Artisan Production Grant',
      description:
        'Supports local bakeries, gardens, and workshops with wholesale tooling so businesses produce 50% more stock per shift.',
      proposerId: marketChampion?.id ?? 'citizen',
      proposerName: marketChampion?.name ?? 'Community Member',
      cost: 80,
      effectKey: 'marketStipend',
      votesFor: marketChampion ? [marketChampion.id] : [],
      votesAgainst: [],
      status: 'open',
      createdAt: simMinutes - 50,
    },
    {
      id: 'prop_extended_library',
      title: 'Extend Evening Library & Study Hours',
      description:
        'Keeps the community library open 2 hours later each evening for students, writers, and civic reading circles.',
      proposerId: libraryChampion?.id ?? 'citizen',
      proposerName: libraryChampion?.name ?? 'Community Member',
      cost: 60,
      effectKey: 'extendedLibrary',
      votesFor: libraryChampion ? [libraryChampion.id] : [],
      votesAgainst: [],
      status: 'open',
      createdAt: simMinutes - 40,
    },
  ];
}

/**
 * Posts a new public notice to the town notice board / gazette.
 */
export function postPublicNotice(
  world: WorldState,
  params: {
    authorId: string;
    authorName: string;
    category: NoticeCategory;
    title: string;
    body: string;
    locationId?: string;
    createMeme?: boolean;
  },
  allocId: (prefix: string) => string,
): WorldState {
  const title = params.title.trim().slice(0, 120);
  const body = params.body.trim().slice(0, 420);
  if (!title || !body) return world;

  const fallbackLoc =
    world.locations.find((l) => l.category === 'civic')?.id ??
    world.locations[0]?.id ??
    'town_hall';
  const locationId = params.locationId ?? fallbackLoc;

  let nextMemes = world.memes;
  let memeId: string | undefined;
  if (params.createMeme !== false) {
    memeId = allocId('meme_notice');
    const kw = extractKeywords(`${title} ${body}`).slice(0, 8);
    nextMemes = [
      ...world.memes,
      {
        id: memeId,
        topic: title,
        keywords: kw.length > 0 ? kw : ['notice'],
        originAgentId: params.authorId,
        createdAt: world.simMinutes,
        knownBy:
          params.authorId !== 'citizen_observer'
            ? {
                [params.authorId]: {
                  simMinutes: world.simMinutes,
                  heardFromId: params.authorId,
                  snippet: body.slice(0, 120),
                },
              }
            : {},
      },
    ];
  }

  const notice: NoticeItem = {
    id: allocId('notice'),
    authorId: params.authorId,
    authorName: params.authorName,
    category: params.category,
    title,
    body,
    locationId,
    createdAt: world.simMinutes,
    readByAgentIds: params.authorId !== 'citizen_observer' ? [params.authorId] : [],
    memeId,
  };

  const locName = world.locations.find((l) => l.id === locationId)?.name ?? 'Notice Board';
  const chr: ChronicleEvent = {
    id: allocId('chr_notice'),
    simMinutes: world.simMinutes,
    type: 'notice',
    title: `Notice posted: ${title}`,
    detail: `${params.authorName} posted (${params.category}): ${body}`,
    agentIds: params.authorId !== 'citizen_observer' ? [params.authorId] : [],
    locationName: locName,
  };

  return {
    ...world,
    notices: [notice, ...(world.notices ?? [])].slice(0, 40),
    memes: nextMemes,
    chronicle: [chr, ...world.chronicle].slice(0, 140),
  };
}

/**
 * When a resident visits a public hub (civic, cafe, shop, college), they asynchronously
 * scan up to 1 unread public notice and absorb its information + linked meme.
 */
export function scanNoticeBoardForAgent(
  world: WorldState,
  agentId: string,
  allocId: (prefix: string) => string,
): { world: WorldState; readNotice?: NoticeItem } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent || !agent.currentLocationId || agent.path.length > 0) return { world };

  const loc = world.locations.find((l) => l.id === agent.currentLocationId);
  if (!loc || (loc.category !== 'civic' && loc.category !== 'cafe' && loc.category !== 'shop' && loc.category !== 'college')) {
    return { world };
  }

  const notices = world.notices ?? [];
  const unread = notices.find(
    (n) =>
      !n.readByAgentIds.includes(agent.id) &&
      (n.locationId === loc.id || loc.category === 'civic'),
  );
  if (!unread) return { world };

  const nextNotices = notices.map((n) =>
    n.id === unread.id ? { ...n, readByAgentIds: [...n.readByAgentIds, agent.id] } : n,
  );

  const mem = createMemoryNode({
    id: allocId(`notice_read_${agent.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'notice',
    description: `${agent.name.split(' ')[0]} read a public notice by ${unread.authorName}: "${unread.title}" — ${unread.body}`,
    importance: unread.category === 'civic' || unread.category === 'event' ? 6 : 5,
  });

  const nextAgents = world.agents.map((a) =>
    a.id === agent.id
      ? {
          ...a,
          memories: compactMemories([mem, ...a.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
          importanceAccumulator: a.importanceAccumulator + mem.importance,
        }
      : a,
  );

  const nextMemes = unread.memeId
    ? world.memes.map((m) =>
        m.id === unread.memeId && !m.knownBy[agent.id]
          ? {
              ...m,
              knownBy: {
                ...m.knownBy,
                [agent.id]: {
                  simMinutes: world.simMinutes,
                  heardFromId: 'bulletin',
                  snippet: unread.title,
                },
              },
            }
          : m,
      )
    : world.memes;

  return {
    readNotice: unread,
    world: {
      ...world,
      agents: nextAgents,
      notices: nextNotices,
      memes: nextMemes,
      stats: {
        ...world.stats,
        noticesRead: (world.stats.noticesRead ?? 0) + 1,
      },
    },
  };
}

/**
 * Adds a new civic proposal for residents to deliberate and vote on.
 */
export function createCivicProposal(
  world: WorldState,
  params: {
    proposerId: string;
    proposerName: string;
    title: string;
    description: string;
    cost: number;
    effectKey: TownModifierKey;
  },
  allocId: (prefix: string) => string,
): WorldState {
  const title = params.title.trim().slice(0, 120);
  const description = params.description.trim().slice(0, 360);
  if (!title || !description) return world;

  const prop: CivicProposal = {
    id: allocId('prop'),
    title,
    description,
    proposerId: params.proposerId,
    proposerName: params.proposerName,
    cost: Math.max(20, Math.min(500, Math.round(params.cost))),
    effectKey: params.effectKey,
    votesFor: params.proposerId !== 'citizen_observer' ? [params.proposerId] : [],
    votesAgainst: [],
    status: 'open',
    createdAt: world.simMinutes,
  };

  const chr: ChronicleEvent = {
    id: allocId('chr_prop'),
    simMinutes: world.simMinutes,
    type: 'civic',
    title: `Civic proposal opened: ${title}`,
    detail: `${params.proposerName} proposed "${title}" ($${prop.cost}). Residents can now vote.`,
    agentIds: params.proposerId !== 'citizen_observer' ? [params.proposerId] : [],
    locationName: world.locations.find((l) => l.category === 'civic')?.name ?? 'Town Hall',
  };

  return {
    ...world,
    proposals: [prop, ...(world.proposals ?? [])].slice(0, 20),
    chronicle: [chr, ...world.chronicle].slice(0, 140),
  };
}

/**
 * Evaluates a resident's authentic civic vote based on traits, trust in proposer, wallet/treasury,
 * and casts the vote—enacting the proposal automatically once majority quorum is reached!
 */
export function getCivicQuorum(agentCount: number): number {
  return Math.max(4, Math.ceil(agentCount * 0.25));
}

export function castCivicVote(
  world: WorldState,
  agentId: string,
  proposalId: string,
  supportOverride: boolean | undefined,
  allocId: (prefix: string) => string,
): { world: WorldState; voted: boolean; enacted?: CivicProposal } {
  const proposals = world.proposals ?? [];
  const prop = proposals.find((p) => p.id === proposalId && p.status === 'open');
  const agent = world.agents.find((a) => a.id === agentId);
  if (!prop || !agent) return { world, voted: false };

  if (prop.votesFor.includes(agentId) || prop.votesAgainst.includes(agentId)) {
    return { world, voted: false };
  }

  let support: boolean;
  if (typeof supportOverride === 'boolean') {
    support = supportOverride;
  } else {
    let score = 0.08;
    const edgeToProposer = agent.socialGraph[prop.proposerId];
    if (edgeToProposer) {
      score += (edgeToProposer.trust - 38) / 100;
    }
    const worldview = (agent.dossier?.civicWorldview ?? '').toLowerCase();
    const posture = (agent.dossier?.financialPosture ?? '').toLowerCase();
    const stubbornness = agent.temperament?.stubbornness ?? 0.45;
    if (
      (worldview.includes('fiscal') || worldview.includes('conservative') || posture === 'frugal') &&
      prop.cost >= 75
    ) {
      score -= prop.cost >= 100 ? 0.48 : 0.34;
    }
    if (worldview.includes('community') || worldview.includes('reform') || worldview.includes('public')) {
      score += 0.16;
    }
    if (stubbornness >= 0.72 && (edgeToProposer?.trust ?? 45) < 55) {
      score -= 0.22;
    }
    const goalsText = `${agent.currently} ${agent.goals.join(' ')} ${agent.occupation}`.toLowerCase();
    if (prop.effectKey === 'streetLighting' && (goalsText.includes('light') || goalsText.includes('evening') || goalsText.includes('safe'))) {
      score += 0.42;
    }
    if (prop.effectKey === 'marketStipend' && (goalsText.includes('market') || goalsText.includes('bak') || goalsText.includes('cafe') || goalsText.includes('harvest'))) {
      score += 0.42;
    }
    if (prop.effectKey === 'extendedLibrary' && (goalsText.includes('student') || goalsText.includes('book') || goalsText.includes('librar') || goalsText.includes('research') || goalsText.includes('professor'))) {
      score += 0.42;
    }
    if (prop.effectKey === 'communityClinic' && (goalsText.includes('clinic') || goalsText.includes('health') || goalsText.includes('doctor') || goalsText.includes('care'))) {
      score += 0.42;
    }
    // Fiscal caution if treasury is tight
    if ((world.townTreasury ?? 350) < prop.cost * 1.2) {
      score -= 0.35;
    }
    score += getCoalitionVotingBias(world, agentId, prop.effectKey, prop.proposerId);
    score += getNormComplianceModifier(world, agentId, 'civic_duty') * 0.5;
    support = score >= 0;
  }

  const nextFor = support ? [...prop.votesFor, agentId] : prop.votesFor;
  const nextAgainst = !support ? [...prop.votesAgainst, agentId] : prop.votesAgainst;
  const quorum = getCivicQuorum(world.agents.length);
  let nextStatus: CivicProposal['status'] = prop.status;
  let resolvedAt = prop.resolvedAt;
  let nextTreasury = world.townTreasury ?? 350;
  const nextModifiers = {
    streetLighting: false,
    marketStipend: false,
    extendedLibrary: false,
    communityClinic: false,
    ...(world.townModifiers ?? {}),
  };
  const newChronicle: ChronicleEvent[] = [];
  let enacted: CivicProposal | undefined;

  if (nextFor.length >= quorum && nextTreasury >= prop.cost) {
    nextStatus = 'passed';
    resolvedAt = world.simMinutes;
    nextTreasury = Math.round((nextTreasury - prop.cost) * 100) / 100;
    nextModifiers[prop.effectKey] = true;
    enacted = { ...prop, votesFor: nextFor, votesAgainst: nextAgainst, status: 'passed', resolvedAt };
    newChronicle.push({
      id: allocId('chr_enact'),
      simMinutes: world.simMinutes,
      type: 'civic',
      title: `Proposal passed: ${prop.title}`,
      detail: `Approved ${nextFor.length}–${nextAgainst.length} ($${prop.cost} allocated from town treasury). Town modifier "${prop.effectKey}" is now active!`,
      agentIds: nextFor.slice(0, 6),
      locationName: world.locations.find((l) => l.category === 'civic')?.name ?? 'Town Hall',
    });
  } else if (nextAgainst.length >= quorum) {
    nextStatus = 'rejected';
    resolvedAt = world.simMinutes;
    newChronicle.push({
      id: allocId('chr_reject'),
      simMinutes: world.simMinutes,
      type: 'civic',
      title: `Proposal declined: ${prop.title}`,
      detail: `Declined ${nextFor.length}–${nextAgainst.length} after community ballot.`,
      agentIds: nextAgainst.slice(0, 6),
      locationName: world.locations.find((l) => l.category === 'civic')?.name ?? 'Town Hall',
    });
  }

  const nextProposals = proposals.map((p) =>
    p.id === prop.id
      ? { ...p, votesFor: nextFor, votesAgainst: nextAgainst, status: nextStatus, resolvedAt }
      : p,
  );

  const voteMem = createMemoryNode({
    id: allocId(`vote_${agent.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: `${agent.name.split(' ')[0]} voted ${support ? 'FOR' : 'AGAINST'} the civic proposal "${prop.title}".`,
    importance: 6,
  });

  const nextAgents = world.agents.map((a) =>
    a.id === agent.id
      ? {
          ...a,
          memories: compactMemories([voteMem, ...a.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
          drives: { ...a.drives, purpose: Math.min(100, a.drives.purpose + 4) },
          reputation: Math.min(100, (a.reputation ?? 20) + 1),
        }
      : a,
  );

  return {
    voted: true,
    enacted,
    world: {
      ...world,
      agents: nextAgents,
      proposals: nextProposals,
      townTreasury: nextTreasury,
      townModifiers: nextModifiers,
      chronicle: [...newChronicle, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        civicVotesCast: (world.stats.civicVotesCast ?? 0) + 1,
      },
    },
  };
}

/**
 * Applies third-party gossip & reputation propagation:
 * When speaker A mentions person C to listener B, B updates their directed social edge toward C
 * weighted by how much B trusts A (even if B has never personally met C!).
 */
export function applyGossipUpdates(
  world: WorldState,
  gossipUpdates: GossipUpdate[],
  allocId: (prefix: string) => string,
): { world: WorldState; appliedCount: number } {
  if (!gossipUpdates || gossipUpdates.length === 0) {
    return { world, appliedCount: 0 };
  }

  const validIds = new Set(world.agents.map((a) => a.id));
  const agentNameById = new Map(world.agents.map((a) => [a.id, a.name]));
  let appliedCount = 0;

  let nextAgents = [...world.agents];

  for (const g of gossipUpdates) {
    if (
      !validIds.has(g.speakerId) ||
      !validIds.has(g.listenerId) ||
      !validIds.has(g.aboutAgentId) ||
      g.speakerId === g.listenerId ||
      g.listenerId === g.aboutAgentId ||
      g.speakerId === g.aboutAgentId
    ) {
      continue;
    }

    const speakerName = agentNameById.get(g.speakerId) ?? g.speakerId;
    const aboutName = agentNameById.get(g.aboutAgentId) ?? g.aboutAgentId;

    nextAgents = nextAgents.map((ag) => {
      if (ag.id !== g.listenerId) return ag;

      // Trust-weighted credibility factor: trusted friends shape opinion strongly; distrusted peers barely move it
      const speakerEdge = ag.socialGraph[g.speakerId];
      const speakerTrust = speakerEdge?.trust ?? 25;
      const weight = Math.max(0.15, Math.min(1, (speakerTrust + 20) / 120));

      const scaledTrust = Math.round(g.deltaTrust * weight);
      const scaledAff = Math.round(g.deltaAffection * weight);
      const existingAbout = ag.socialGraph[g.aboutAgentId];
      const updatedEdge = updateSocialEdge(existingAbout, {
        targetId: g.aboutAgentId,
        roleLabel: existingAbout?.roleLabel ?? 'Heard of via neighbor',
        deltaTrust: scaledTrust,
        deltaAffection: scaledAff,
        deltaFamiliarity: 4,
        inferredGoal: g.claim.slice(0, 180),
        simMinutes: world.simMinutes,
      });

      const gossipMem = createMemoryNode({
        id: allocId(`gossip_${ag.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'gossip',
        description: `${speakerName.split(' ')[0]} told ${ag.name.split(' ')[0]} about ${aboutName}: "${g.claim}"`,
        importance: Math.abs(scaledTrust) >= 6 ? 7 : 5,
      });

      appliedCount += 1;
      return {
        ...ag,
        socialGraph: {
          ...ag.socialGraph,
          [g.aboutAgentId]: updatedEdge,
        },
        memories: compactMemories([gossipMem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
        importanceAccumulator: ag.importanceAccumulator + gossipMem.importance,
      };
    });
  }

  // Recompute community reputation scores after gossip updates
  if (appliedCount > 0) {
    nextAgents = nextAgents.map((ag) => ({
      ...ag,
      reputation: computeResidentReputation(ag.id, nextAgents),
    }));
  }

  let outWorld: WorldState = {
    ...world,
    agents: nextAgents,
    stats: {
      ...world.stats,
      gossipUpdatesApplied: (world.stats.gossipUpdatesApplied ?? 0) + appliedCount,
    },
  };

  if (appliedCount > 0) {
    for (const g of gossipUpdates) {
      if (
        validIds.has(g.speakerId) &&
        validIds.has(g.listenerId) &&
        validIds.has(g.aboutAgentId) &&
        g.speakerId !== g.listenerId &&
        g.listenerId !== g.aboutAgentId &&
        g.speakerId !== g.aboutAgentId
      ) {
        outWorld = recordRumorFromGossip(outWorld, g, allocId);
      }
    }
  }

  return {
    appliedCount,
    world: outWorld,
  };
}

/**
 * Ambient Room Overhearing:
 * Non-sleeping bystanders in the same indoor room (or within 4 tiles outdoors) overhear salient
 * conversation lines, record an 'overheard' observation, and absorb discussed memes!
 */
export function applyAmbientOverhearing(
  world: WorldState,
  params: {
    participantIds: string[];
    locationId: string;
    locationName: string;
    summary: string;
    sampleLine: string;
    discussedMemeIds: string[];
  },
  allocId: (prefix: string) => string,
): { world: WorldState; overheardByIds: string[] } {
  const participantSet = new Set(params.participantIds);
  const participants = world.agents.filter((a) => participantSet.has(a.id));
  if (participants.length === 0) return { world, overheardByIds: [] };

  const anchor = participants[0];
  const isOutdoors = params.locationId === 'outdoors';
  const timeInfo = formatSimTime(world.simMinutes);
  const isLateNight = timeInfo.hour24 >= 23 || timeInfo.hour24 < 6;

  const overheardByIds: string[] = [];
  const speakerNames = participants.map((p) => p.name.split(' ')[0]).join(' & ');

  let nextMemes = world.memes;
  const nextAgents = world.agents.map((ag) => {
    if (participantSet.has(ag.id)) return ag;
    if (isLateNight && ag.currentLocationId === ag.homeLocationId) return ag;

    const sameRoom = !isOutdoors && ag.currentLocationId === params.locationId && ag.path.length === 0;
    const closeOutdoors =
      isOutdoors &&
      ag.currentLocationId === null &&
      Math.hypot(ag.x - anchor.x, ag.y - anchor.y) <= 4.2;

    if (!sameRoom && !closeOutdoors) return ag;

    overheardByIds.push(ag.id);

    const desc = `At ${params.locationName}, ${ag.name.split(' ')[0]} overheard ${speakerNames} discussing: "${params.sampleLine.slice(0, 140)}"`;
    const mem = createMemoryNode({
      id: allocId(`overheard_${ag.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'overheard',
      description: desc,
      importance: params.discussedMemeIds.length > 0 ? 6 : 4,
    });

    // Slight social/curiosity mood shift
    const nextMood = applyEmotionalAppraisal(ag.mood, ag.drives, 0.02, 0.04);

    return {
      ...ag,
      mood: nextMood,
      memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
      importanceAccumulator: ag.importanceAccumulator + mem.importance,
    };
  });

  if (overheardByIds.length > 0 && params.discussedMemeIds.length > 0) {
    const discussedSet = new Set(params.discussedMemeIds);
    nextMemes = world.memes.map((m) => {
      if (!discussedSet.has(m.id)) return m;
      const nextKnownBy = { ...m.knownBy };
      for (const listenerId of overheardByIds) {
        if (!nextKnownBy[listenerId]) {
          nextKnownBy[listenerId] = {
            simMinutes: world.simMinutes,
            heardFromId: anchor.id,
            snippet: `Overheard: ${params.sampleLine.slice(0, 90)}`,
          };
        }
      }
      return { ...m, knownBy: nextKnownBy };
    });
  }

  return {
    overheardByIds,
    world: {
      ...world,
      agents: nextAgents,
      memes: nextMemes,
      stats: {
        ...world.stats,
        overheardEvents: (world.stats.overheardEvents ?? 0) + overheardByIds.length,
      },
    },
  };
}
