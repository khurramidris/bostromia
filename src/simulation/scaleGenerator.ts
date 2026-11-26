/**
 * Phase E — Scalable Society Generator & Multi-Tier Fidelity Manager.
 * Scales Smallville deterministically from 18 core residents to 36, 60, or 100+ residents
 * with tiered cognition ('focal' | 'active' | 'ambient') so LLM usage stays bounded at scale.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { makeIdAllocator } from './ids';
import { hydrateCognitiveDepth } from './cognitiveDepth';
import { hydrateHousingAndCareers } from './contractsAndLife';
import { hydrateWorldIntentStacks } from './intentStack';
import { createMemoryNode, formatSimTime } from './memory';
import { findNearestWalkableTile } from './pathfinding';
import {
  type AgentAppearance,
  type AgentState,
  type AgentTier,
  type LocationZone,
  type ScheduleBlock,
  type SocialEdge,
  type WorldState,
} from './types';

export const ALLOWED_SCALE_PRESETS = [18, 36, 60, 100] as const;

const FIRST_NAMES = [
  'Nadia', 'Omar', 'Hannah', 'Tariq', 'Sofia', 'Kenji', 'Amara', 'Liam',
  'Yuki', 'Dante', 'Leila', 'Victor', 'Zara', 'Caleb', 'Mina', 'Felix',
  'Sana', 'Owen', 'Camila', 'Idris', 'Tessa', 'Rohan', 'Nora', 'Bram',
  'Amina', 'Julian', 'Kira', 'Samir', 'Elise', 'Hector', 'Freya', 'Malik',
  'Chloé', 'Arjun', 'Gwen', 'Rafael', 'Sora', 'Elias', 'Anya', 'Darius',
  'Ines', 'Toby', 'Farah', 'Gideon', 'Lina', 'Kofi', 'Maren', 'Sandro',
  'Yara', 'Rowan', 'Paloma', 'Zain', 'Bina', 'Cyrus', 'Hana', 'Theo',
  'Laila', 'Nikolai', 'Rina', 'Jude', 'Aida', 'Kian', 'Opal', 'Soren',
  'Noor', 'Emil', 'Vera', 'Rami', 'Iris', 'Bastian', 'Selma', 'Kael',
  'Talia', 'Imran', 'Margo', 'Faisal', 'Clara-Mae', 'Dorian', 'Zoya', 'Hugo',
  'Asma', 'Lucian',
];

const LAST_NAMES = [
  'Alvarez', 'Okafor', 'Chen', 'Haddad', 'Kowalski', 'Sato', 'Mensah', 'Bauer',
  'Moreau', 'Patel', 'Lindqvist', 'Reyes', 'Farooq', 'Novak', 'Tanaka', 'Silva',
  'Adebayo', 'Rossi', 'Khoury', 'Fischer', 'Kim', 'Vargas', 'Qureshi', 'Jansen',
  'Diallo', 'Conti', 'Nassar', 'Bergman', 'Park', 'Salazar', 'Rahman', 'Gruber',
];

const SKIN_TONES = ['#F3D2B3', '#E8B892', '#D49B72', '#B57B52', '#8D5524', '#F7DEC8'];
const HAIR_COLORS = ['#1E1B18', '#4A3222', '#7C4D2B', '#C99A5B', '#6B7280', '#2B1F1E'];
const SHIRT_COLORS = [
  '#2D6A4F', '#3B5B7C', '#8C4A32', '#6C4F77', '#B45309', '#3F6212',
  '#475569', '#9A3412', '#1D4ED8', '#0F766E', '#7E22CE', '#374151',
];
const PANTS_COLORS = ['#1F2937', '#334155', '#3F3F46', '#44403C', '#1E3A5F'];
const ACCESSORIES: Array<AgentAppearance['accessory']> = [
  undefined, undefined, 'glasses', 'scarf', 'hat', 'apron', 'beret',
];

interface RoleArchetype {
  occupation: string;
  workLocationId: string;
  wagePerHour: number;
  traits: string[];
  goalTemplate: string;
  clubId: string;
  workEmoji: string;
}

const ROLE_ARCHETYPES: RoleArchetype[] = [
  {
    occupation: 'Apprentice Baker',
    workLocationId: 'oakridge_bakery',
    wagePerHour: 14,
    traits: ['early-riser', 'diligent', 'warm'],
    goalTemplate: 'Master artisan sourdough baking and save for a cottage kitchen',
    clubId: 'club_merchants_guild',
    workEmoji: '🥐',
  },
  {
    occupation: 'Market Stockist',
    workLocationId: 'willows_market',
    wagePerHour: 15,
    traits: ['organized', 'helpful', 'observant'],
    goalTemplate: 'Keep Willows Market shelves stocked with fresh regional produce',
    clubId: 'club_merchants_guild',
    workEmoji: '🧺',
  },
  {
    occupation: 'Cafe Server',
    workLocationId: 'hobbs_cafe',
    wagePerHour: 14,
    traits: ['friendly', 'energetic', 'curious'],
    goalTemplate: 'Know every regular customer by name and build community friendships',
    clubId: 'club_merchants_guild',
    workEmoji: '☕',
  },
  {
    occupation: 'Graduate Researcher',
    workLocationId: 'oak_hill_college',
    wagePerHour: 15,
    traits: ['analytical', 'thoughtful', 'persistent'],
    goalTemplate: 'Publish a field study on Smallville community life and civic habits',
    clubId: 'club_arts_circle',
    workEmoji: '📚',
  },
  {
    occupation: 'Library Archivist',
    workLocationId: 'harvey_library',
    wagePerHour: 15,
    traits: ['calm', 'meticulous', 'literary'],
    goalTemplate: 'Catalog historic town ledgers and expand evening reading circles',
    clubId: 'club_arts_circle',
    workEmoji: '📖',
  },
  {
    occupation: 'Civic Clerk',
    workLocationId: 'town_hall',
    wagePerHour: 16,
    traits: ['fair-minded', 'civic-minded', 'dependable'],
    goalTemplate: 'Improve public notice outreach and voter turnout across all districts',
    clubId: 'club_civic_forum',
    workEmoji: '🏛️',
  },
  {
    occupation: 'Botanical Nurse',
    workLocationId: 'smallville_clinic',
    wagePerHour: 19,
    traits: ['compassionate', 'steady', 'attentive'],
    goalTemplate: 'Keep seasonal illness low and expand greenhouse herbal remedies',
    clubId: 'club_garden_coop',
    workEmoji: '🩺',
  },
  {
    occupation: 'Urban Grower',
    workLocationId: 'community_garden',
    wagePerHour: 14,
    traits: ['patient', 'outdoorsy', 'generous'],
    goalTemplate: 'Grow heirloom vegetables to supply local kitchens and families',
    clubId: 'club_garden_coop',
    workEmoji: '🌱',
  },
  {
    occupation: 'Joinery Craftsman',
    workLocationId: 'willow_workshop',
    wagePerHour: 18,
    traits: ['practical', 'creative', 'inventive'],
    goalTemplate: 'Build durable timber furniture and repair bicycles for neighbors',
    clubId: 'club_merchants_guild',
    workEmoji: '🔨',
  },
  {
    occupation: 'Tavern Musician & Host',
    workLocationId: 'rose_crown_pub',
    wagePerHour: 15,
    traits: ['witty', 'sociable', 'expressive'],
    goalTemplate: 'Bring acoustic folk evenings to The Rose & Crown Pub',
    clubId: 'club_arts_circle',
    workEmoji: '🎵',
  },
  {
    occupation: 'Freelance Illustrator',
    workLocationId: 'artist_cottages',
    wagePerHour: 16,
    traits: ['imaginative', 'independent', 'perceptive'],
    goalTemplate: 'Create illustrated town maps and posters for seasonal gatherings',
    clubId: 'club_arts_circle',
    workEmoji: '🎨',
  },
  {
    occupation: 'Independent Consultant',
    workLocationId: 'harvey_library',
    wagePerHour: 0, // Unemployed/freelance pool for dynamic labor market!
    traits: ['adaptable', 'ambitious', 'resourceful'],
    goalTemplate: 'Find a rewarding full-time role in Smallville’s growing economy',
    clubId: 'club_civic_forum',
    workEmoji: '💼',
  },
];

const HOME_LOCATION_IDS = ['lin_home', 'artist_cottages', 'moore_cottages', 'oak_hill_college'];
const SOCIAL_HUB_IDS = ['hobbs_cafe', 'johnson_park', 'rose_crown_pub', 'community_garden', 'town_hall'];

export function getProceduralSocialHub(index: number): string {
  return SOCIAL_HUB_IDS[Math.abs(index) % SOCIAL_HUB_IDS.length];
}

function seededRand(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function buildProceduralSchedule(params: {
  agentId: string;
  day: number;
  homeLocationId: string;
  workLocationId: string;
  socialLocationId: string;
  occupation: string;
  workEmoji: string;
  homeBedId?: string;
  shiftOffsetMin: number;
  allocId: (prefix: string) => string;
}): ScheduleBlock[] {
  const {
    agentId,
    day,
    homeLocationId,
    workLocationId,
    socialLocationId,
    occupation,
    workEmoji,
    homeBedId,
    shiftOffsetMin,
    allocId,
  } = params;
  const workStart = 510 + (shiftOffsetMin % 90); // 8:30 AM - 10:00 AM
  const lunchStart = 720 + (shiftOffsetMin % 45); // 12:00 PM - 12:45 PM
  const afternoonStart = lunchStart + 50;
  const eveningStart = 1050 + (shiftOffsetMin % 60); // 5:30 PM - 6:30 PM

  return [
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'sleep',
      startMinute: 0,
      durationMinutes: 405,
      locationId: homeLocationId,
      objectId: homeBedId,
      activity: 'Sleeping peacefully at home',
      emoji: '😴',
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'meal',
      startMinute: 405,
      durationMinutes: 60,
      locationId: homeLocationId,
      activity: 'Making morning coffee and breakfast at home',
      emoji: '🍳',
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'work',
      startMinute: workStart,
      durationMinutes: Math.max(90, lunchStart - workStart),
      locationId: workLocationId,
      activity: `Working morning shift as ${occupation}`,
      emoji: workEmoji,
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'meal',
      startMinute: lunchStart,
      durationMinutes: 45,
      locationId: socialLocationId === 'hobbs_cafe' ? 'hobbs_cafe' : 'oakridge_bakery',
      activity: 'Stopping for a warm midday lunch',
      emoji: '🥪',
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'work',
      startMinute: afternoonStart,
      durationMinutes: 195,
      locationId: workLocationId,
      activity: `Afternoon tasks as ${occupation}`,
      emoji: workEmoji,
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'social',
      startMinute: eveningStart,
      durationMinutes: 110,
      locationId: socialLocationId,
      activity: 'Catching up with neighbors and checking town news',
      emoji: '💬',
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'meal',
      startMinute: 1200,
      durationMinutes: 60,
      locationId: homeLocationId,
      activity: 'Cooking dinner and unwinding at home',
      emoji: '🍲',
      source: 'seed',
    },
    {
      id: allocId(`sched_${agentId}`),
      day,
      kind: 'sleep',
      startMinute: 1350,
      durationMinutes: 90,
      locationId: homeLocationId,
      objectId: homeBedId,
      activity: 'Turning in for the night',
      emoji: '😴',
      source: 'seed',
    },
  ];
}

/**
 * Updates an individual resident's cognition fidelity tier ('focal' | 'active' | 'ambient').
 */
export function setAgentCognitionTier(
  world: WorldState,
  agentId: string,
  tier: AgentTier,
): WorldState {
  return {
    ...world,
    agents: world.agents.map((ag) => (ag.id === agentId ? { ...ag, tier } : ag)),
  };
}

/**
 * Counts residents by cognitive tier for UI dashboards & scaling telemetry.
 */
export function getTierCounts(agents: readonly AgentState[]): Record<AgentTier, number> {
  const counts: Record<AgentTier, number> = { focal: 0, active: 0, ambient: 0 };
  for (const ag of agents) {
    const t = ag.tier ?? 'focal';
    counts[t] += 1;
  }
  return counts;
}

/**
 * Deterministically scales the society up (to 36, 60, or 100 residents) or down (back to 18)
 * while preserving all 18 core Smallville residents and maintaining full world validity.
 */
export function scaleWorldPopulation(
  world: WorldState,
  targetPopulation: number,
  seed = 101,
): WorldState {
  const clampedTarget = Math.max(18, Math.min(120, Math.round(targetPopulation)));
  const currentCount = world.agents.length;
  if (clampedTarget === currentCount) {
    return { ...world, scaleTarget: clampedTarget };
  }

  const alloc = makeIdAllocator(world.idSeq);

  // Scale DOWN: remove procedural citizens cleanly and prune dangling social/business/club refs
  if (clampedTarget < currentCount) {
    const coreAgents = world.agents.filter((a) => !a.isProcedural);
    const procAgents = world.agents.filter((a) => a.isProcedural);
    const neededProc = Math.max(0, clampedTarget - coreAgents.length);
    const keptAgents = [...coreAgents, ...procAgents.slice(0, neededProc)];
    const keptIds = new Set(keptAgents.map((a) => a.id));

    const cleanedAgents = keptAgents.map((ag) => {
      const nextRel: Record<string, string> = {};
      for (const [k, v] of Object.entries(ag.relationships)) {
        if (keptIds.has(k)) nextRel[k] = v;
      }
      const nextGraph: Record<string, SocialEdge> = {};
      for (const [k, v] of Object.entries(ag.socialGraph)) {
        if (keptIds.has(k)) nextGraph[k] = v;
      }
      return {
        ...ag,
        relationships: nextRel,
        socialGraph: nextGraph,
        householdPartnerIds: ag.householdPartnerIds?.filter((id) => keptIds.has(id)),
        inConversationWith:
          ag.inConversationWith && keptIds.has(ag.inConversationWith)
            ? ag.inConversationWith
            : undefined,
      };
    });

    const cleanedBusinesses = world.businesses
      ? Object.fromEntries(
          Object.entries(world.businesses).map(([locId, biz]) => [
            locId,
            { ...biz, employeeIds: biz.employeeIds.filter((id) => keptIds.has(id)) },
          ]),
        )
      : undefined;

    const cleanedClubs = world.clubs?.map((club) => ({
      ...club,
      memberIds: club.memberIds.filter((id) => keptIds.has(id)),
    }));

    const cleanedLoans = world.loans?.filter(
      (l) => keptIds.has(l.lenderId) && keptIds.has(l.borrowerId),
    );
    const cleanedPetitions = world.petitions?.map((p) => ({
      ...p,
      signerIds: p.signerIds.filter((id) => keptIds.has(id)),
    }));
    const cleanedVentures = world.ventures?.filter((v) => keptIds.has(v.founderId));

    return {
      ...world,
      idSeq: alloc.seq(),
      agents: cleanedAgents,
      businesses: cleanedBusinesses,
      clubs: cleanedClubs,
      loans: cleanedLoans,
      petitions: cleanedPetitions,
      ventures: cleanedVentures,
      scaleTarget: clampedTarget,
      chronicle: [
        {
          id: alloc.next('chr_scale'),
          simMinutes: world.simMinutes,
          type: 'world_event' as const,
          title: `Society scale adjusted to ${cleanedAgents.length} residents`,
          detail: `Active population scaled cleanly while preserving all core households and history.`,
          agentIds: [],
        },
        ...world.chronicle,
      ].slice(0, 140),
    };
  }

  // Scale UP: procedurally generate deterministic residents with homes, jobs, clubs, and social ties
  const rng = seededRand(seed + clampedTarget * 31);
  const locById = new Map<string, LocationZone>(world.locations.map((l) => [l.id, l]));
  const bedByLoc = new Map<string, string>();
  for (const obj of world.objects) {
    if (obj.kind === 'bed' && !bedByLoc.has(obj.locationId)) {
      bedByLoc.set(obj.locationId, obj.id);
    }
  }

  const day = formatSimTime(world.simMinutes).day;
  const existingIds = new Set(world.agents.map((a) => a.id));
  const existingNames = new Set(world.agents.map((a) => a.name));
  const newAgents: AgentState[] = [];
  const nextBusinesses = world.businesses ? { ...world.businesses } : undefined;
  const nextClubs = world.clubs ? world.clubs.map((c) => ({ ...c, memberIds: [...c.memberIds] })) : undefined;

  const toCreate = clampedTarget - currentCount;
  for (let i = 0; i < toCreate; i++) {
    const globalIdx = currentCount + i;
    const role = ROLE_ARCHETYPES[globalIdx % ROLE_ARCHETYPES.length];
    const first = FIRST_NAMES[(globalIdx * 3 + Math.floor(rng() * 5)) % FIRST_NAMES.length];
    const last = LAST_NAMES[(globalIdx * 5 + Math.floor(rng() * 7)) % LAST_NAMES.length];
    let fullName = `${first} ${last}`;
    let suffix = 2;
    while (existingNames.has(fullName)) {
      fullName = `${first} ${last} ${suffix++}`;
    }
    existingNames.add(fullName);

    let id = `citizen_${globalIdx + 1}`;
    while (existingIds.has(id)) {
      id = `citizen_${alloc.next('c')}`;
    }
    existingIds.add(id);

    const homeLocationId = HOME_LOCATION_IDS[globalIdx % HOME_LOCATION_IDS.length];
    const homeLoc = locById.get(homeLocationId) ?? world.locations[0];
    const workLoc = locById.get(role.workLocationId) ?? homeLoc;
    const socialLocationId = SOCIAL_HUB_IDS[(globalIdx + 2) % SOCIAL_HUB_IDS.length];

    // Spawn near their current workplace or home on a valid walkable tile
    const spawnLoc = i % 3 === 0 ? homeLoc : workLoc;
    const rawSpawnX = spawnLoc.x + 2 + (globalIdx % Math.max(2, spawnLoc.w - 4));
    const rawSpawnY = spawnLoc.y + 2 + ((globalIdx * 3) % Math.max(2, spawnLoc.h - 4));
    const spawnTile = findNearestWalkableTile(world.tiles, rawSpawnX, rawSpawnY);

    // First 6 procedural residents join as 'active' (event-driven LLM); rest are 'ambient' (zero-LLM, promotable)
    const tier: AgentTier = i < 6 && currentCount < 28 ? 'active' : 'ambient';
    const age = 20 + Math.floor(rng() * 50);
    const wallet = 95 + Math.floor(rng() * 190);
    const hasEmployer = role.wagePerHour > 0 && Boolean(nextBusinesses?.[role.workLocationId]);

    const appearance: AgentAppearance = {
      skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
      hair: HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)],
      shirt: SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)],
      pants: PANTS_COLORS[Math.floor(rng() * PANTS_COLORS.length)],
      accessory: ACCESSORIES[Math.floor(rng() * ACCESSORIES.length)],
    };

    const schedule = buildProceduralSchedule({
      agentId: id,
      day,
      homeLocationId,
      workLocationId: role.workLocationId,
      socialLocationId,
      occupation: role.occupation,
      workEmoji: role.workEmoji,
      homeBedId: bedByLoc.get(homeLocationId),
      shiftOffsetMin: globalIdx * 11,
      allocId: alloc.next,
    });

    // Build authentic initial social ties to 2 existing core/neighbor residents
    const peerPool = world.agents;
    const relationships: Record<string, string> = {};
    const socialGraph: Record<string, SocialEdge> = {};
    const peerA = peerPool[globalIdx % peerPool.length];
    const peerB = peerPool[(globalIdx * 7 + 3) % peerPool.length];
    for (const peer of [peerA, peerB]) {
      if (!peer || peer.id === id || relationships[peer.id]) continue;
      const isCoworker = peer.employerLocationId === role.workLocationId;
      relationships[peer.id] = isCoworker ? 'Coworker' : 'Neighborhood acquaintance';
      socialGraph[peer.id] = {
        targetId: peer.id,
        roleLabel: isCoworker ? 'Coworker' : 'Neighbor',
        trust: isCoworker ? 62 : 52,
        affection: isCoworker ? 58 : 50,
        familiarity: isCoworker ? 45 : 28,
        inferredGoal: peer.goals[0] ?? 'Thriving in Smallville',
        lastUpdatedSimMin: world.simMinutes,
      };
    }

    const seedMem = createMemoryNode({
      id: alloc.next(`mem_seed_${id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'seed',
      description: `${fullName} settled into Smallville as a ${role.occupation} living at ${homeLoc.name}.`,
      importance: 8,
    });

    const newAgent: AgentState = {
      id,
      name: fullName,
      age,
      occupation: role.occupation,
      homeLocationId,
      traits: role.traits,
      goals: [role.goalTemplate],
      innateSummary: `${fullName} (${age}) is a ${role.traits.join(', ')} ${role.occupation} contributing to daily life across Smallville.`,
      currently: `Working as ${role.occupation} and getting to know neighbors.`,
      appearance,
      x: spawnTile.x,
      y: spawnTile.y,
      targetX: spawnTile.x,
      targetY: spawnTile.y,
      path: [],
      facing: 'down',
      currentLocationId: spawnLoc.id,
      currentAreaLabel: spawnLoc.name,
      currentAction: `Working as ${role.occupation}`,
      actionEmoji: role.workEmoji,
      drives: {
        energy: 78 + Math.floor(rng() * 18),
        hunger: 72 + Math.floor(rng() * 20),
        social: 65 + Math.floor(rng() * 22),
        purpose: 74 + Math.floor(rng() * 20),
      },
      mood: { valence: 0.2, arousal: 0.45, label: 'Content' },
      baselineMood: { valence: 0.2, arousal: 0.45 },
      inventory: ['house key', 'town map'],
      wallet,
      dailyExpenses: 18 + Math.floor(rng() * 8),
      employerLocationId: hasEmployer ? role.workLocationId : undefined,
      wagePerHour: hasEmployer ? role.wagePerHour : 0,
      goods: { groceries: 2, coffee: 1 },
      skills: { [role.occupation.toLowerCase().split(' ')[0]]: 35 + Math.floor(rng() * 35) },
      projects: [
        {
          id: alloc.next(`proj_${id}`),
          title: role.goalTemplate,
          category: 'craft',
          progress: 10 + Math.floor(rng() * 25),
          targetLocationId: role.workLocationId,
          collaboratorIds: [],
          status: 'active',
          startedAtSimMin: world.simMinutes,
        },
      ],
      reputation: 50 + Math.floor(rng() * 20),
      tier,
      isProcedural: true,
      health: 90 + Math.floor(rng() * 10),
      illness: 'none',
      clubIds: [role.clubId],
      memories: [seedMem],
      importanceAccumulator: 0,
      dailySchedule: schedule,
      relationships,
      socialGraph,
      lastConversedAt: {},
      isThinking: false,
    };

    newAgents.push(newAgent);

    if (hasEmployer && nextBusinesses?.[role.workLocationId]) {
      const b = nextBusinesses[role.workLocationId];
      nextBusinesses[role.workLocationId] = {
        ...b,
        employeeIds: Array.from(new Set([...b.employeeIds, id])),
      };
    }

    if (nextClubs) {
      const targetClub = nextClubs.find((c) => c.id === role.clubId);
      if (targetClub && !targetClub.memberIds.includes(id)) {
        targetClub.memberIds.push(id);
      }
    }
  }

  const hydratedNew = hydrateWorldIntentStacks(
    hydrateHousingAndCareers(
      hydrateCognitiveDepth(newAgents, world.simMinutes, alloc.next),
      world.locations,
    ),
    world.simMinutes,
    alloc.next,
  );
  const allAgents = [...world.agents, ...hydratedNew];
  const tiers = getTierCounts(allAgents);

  return {
    ...world,
    idSeq: alloc.seq(),
    agents: allAgents,
    businesses: nextBusinesses,
    clubs: nextClubs,
    scaleTarget: clampedTarget,
    chronicle: [
      {
        id: alloc.next('chr_scale_up'),
        simMinutes: world.simMinutes,
        type: 'world_event' as const,
        title: `Town population scaled to ${allAgents.length} residents`,
        detail: `${newAgents.length} new residents settled across all 3 districts (${tiers.focal} Focal LLM · ${tiers.active} Active · ${tiers.ambient} Ambient).`,
        agentIds: newAgents.slice(0, 4).map((a) => a.id),
      },
      ...world.chronicle,
    ].slice(0, 140),
  };
}
