/**
 * Phase D — Living Institutions:
 * - Dynamic Supply-Demand Pricing & Macro-Economy Telemetry (Gini, Inflation, Employment)
 * - Dynamic Labor Market (Job Postings, Hiring, Wage Adjustments, Financial Distress Layoffs)
 * - Health, Contagion & Clinic Care (Dr. Elena Vance's Smallville Clinic)
 * - Mayoral Elections & Town Leadership (ToM-grounded secret ballots & approval rating)
 * - Community Clubs & Weekly Gatherings
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { applyEmotionalAppraisal } from './psychology';
import { postPublicNotice } from './socialFabric';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type BusinessState,
  type ChronicleEvent,
  type EconomicTransaction,
  type ItemKind,
  type JobPosting,
  type MacroEconomySnapshot,
  type ScheduleBlock,
  type SocialClub,
  type TownElection,
  type TownLeadership,
  type WorldState,
} from './types';
import { getCalendarInfo } from './worldEconomy';

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Seeds the 4 civic, cultural, merchant, and garden clubs of Smallville.
 */
export function createInitialClubs(agents: AgentState[]): SocialClub[] {
  const has = (id: string) => agents.some((a) => a.id === id);
  const filterKnown = (ids: string[]) => ids.filter(has);

  return [
    {
      id: 'club_civic_forum',
      name: 'Smallville Civic Forum',
      category: 'civic',
      locationId: 'town_hall',
      meetingWeekday: 2, // Wednesday
      meetingHour: 18,
      memberIds: filterKnown(['sam', 'hailey', 'clara', 'elena', 'john']),
      description: 'Weekly public forum debating budgets, elections, and town improvements.',
    },
    {
      id: 'club_arts_circle',
      name: 'Oak Hill Literary & Arts Circle',
      category: 'arts',
      locationId: 'harvey_library',
      meetingWeekday: 3, // Thursday
      meetingHour: 19,
      memberIds: filterKnown(['clara', 'abigail', 'rajiv', 'eddy', 'klaus', 'maria']),
      description: 'Writers, painters, musicians, and scholars sharing works in progress.',
    },
    {
      id: 'club_merchants_guild',
      name: 'Main Street Merchants Guild',
      category: 'commerce',
      locationId: 'hobbs_cafe',
      meetingWeekday: 1, // Tuesday
      meetingHour: 17,
      memberIds: filterKnown(['isabella', 'john', 'mateo', 'arthur', 'devon', 'priya']),
      description: 'Shopkeepers and artisans coordinating wholesale supply chains and local commerce.',
    },
    {
      id: 'club_garden_coop',
      name: 'Southside Garden Co-op',
      category: 'garden',
      locationId: 'community_garden',
      meetingWeekday: 5, // Saturday
      meetingHour: 10,
      memberIds: filterKnown(['priya', 'elena', 'mei', 'wolfgang', 'lucas']),
      description: 'Neighborhood growers cultivating fresh produce, herbs, and seasonal beds.',
    },
  ];
}

export function createInitialLeadership(agents: AgentState[]): TownLeadership {
  return {
    mayorId: null,
    mayorName: null,
    electedDay: 0,
    termEndsDay: 7,
    taxRatePct: 8,
    approvalRating: 60,
  };
}

export function createInitialElection(agents: AgentState[], electionDay = 7): TownElection {
  const sam = agents.find((a) => a.id === 'sam');
  const isabella = agents.find((a) => a.id === 'isabella');
  const elena = agents.find((a) => a.id === 'elena');
  const candidates = [
    sam
      ? {
          agentId: sam.id,
          name: sam.name,
          platform: 'Prudent municipal budgets, illuminated streets, and Main Street stability.',
          votes: 0,
        }
      : null,
    isabella
      ? {
          agentId: isabella.id,
          name: isabella.name,
          platform: 'Vibrant community events, small business support, and neighborhood vitality.',
          votes: 0,
        }
      : null,
    elena
      ? {
          agentId: elena.id,
          name: elena.name,
          platform: 'Accessible community clinic care, clean parks, and resident wellbeing.',
          votes: 0,
        }
      : null,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));

  return {
    cycleNumber: 1,
    status: 'campaigning',
    electionDay,
    candidates,
    votersCast: [],
  };
}

export function createInitialJobPostings(
  businesses: Record<string, BusinessState>,
  simMinutes: number,
): JobPosting[] {
  const postings: JobPosting[] = [];
  const hobbs = businesses['hobbs_cafe'];
  if (hobbs) {
    postings.push({
      id: 'job_hobbs_barista',
      locationId: hobbs.locationId,
      businessName: hobbs.name,
      roleTitle: 'Afternoon Barista & Baker Assistant',
      wagePerHour: Math.max(15, hobbs.wagePerHour),
      createdAt: simMinutes,
      status: 'open',
    });
  }
  const workshop = businesses['willow_workshop'];
  if (workshop) {
    postings.push({
      id: 'job_workshop_apprentice',
      locationId: workshop.locationId,
      businessName: workshop.name,
      roleTitle: 'Woodworking & Repair Apprentice',
      wagePerHour: Math.max(17, workshop.wagePerHour),
      createdAt: simMinutes,
      status: 'open',
    });
  }
  return postings;
}

/**
 * Hydrates Phase D/E defaults onto an agent list (health, clubs, tier).
 */
export function hydrateInstitutionalFields(
  agents: AgentState[],
  clubs: SocialClub[],
): AgentState[] {
  const clubIdsByAgent = new Map<string, string[]>();
  for (const club of clubs) {
    for (const mid of club.memberIds) {
      const list = clubIdsByAgent.get(mid) ?? [];
      list.push(club.id);
      clubIdsByAgent.set(mid, list);
    }
  }

  return agents.map((ag) => ({
    ...ag,
    tier: ag.tier ?? 'focal',
    health: ag.health ?? 94,
    illness: ag.illness ?? 'none',
    clubIds: ag.clubIds ?? clubIdsByAgent.get(ag.id) ?? [],
  }));
}

/**
 * Exact deterministic Gini coefficient (0 = perfect equality, 1 = maximal inequality).
 */
export function computeGiniCoefficient(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;
  const sorted = values.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) return 0;
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  return Number(clamp(weightedSum / (n * sum), 0, 1).toFixed(3));
}

const BASELINE_ITEM_PRICES: Record<ItemKind, number> = {
  coffee: 4,
  pastry: 5,
  bread: 6,
  meal: 11,
  groceries: 10,
  produce: 6,
  medicine: 13,
  craft_goods: 18,
  book: 11,
  flowers: 9,
  drink: 7,
};

/**
 * Computes a complete daily Macro-Economy & Population Telemetry snapshot.
 */
export function computeMacroSnapshot(world: WorldState): MacroEconomySnapshot {
  const n = Math.max(1, world.agents.length);
  const wallets = world.agents.map((a) => a.wallet ?? 0);
  const avgWealth = Math.round(wallets.reduce((s, w) => s + w, 0) / n);
  const giniIndex = computeGiniCoefficient(wallets);
  const employedCount = world.agents.filter(
    (a) => Boolean(a.employerLocationId) || (a.wagePerHour ?? 0) > 0,
  ).length;
  const employmentRatePct = Math.round((employedCount / n) * 100);
  const sickCount = world.agents.filter(
    (a) => a.illness === 'mild_cold' || (a.health ?? 100) < 60,
  ).length;

  // Weighted price index across active retail items
  let ratioSum = 0;
  let ratioCount = 0;
  for (const biz of Object.values(world.businesses ?? {})) {
    for (const [k, entry] of Object.entries(biz.stock)) {
      if (!entry) continue;
      const base = BASELINE_ITEM_PRICES[k as ItemKind] ?? entry.price;
      if (base > 0) {
        ratioSum += entry.price / base;
        ratioCount += 1;
      }
    }
  }
  const priceIndex = ratioCount > 0 ? Number((ratioSum / ratioCount).toFixed(2)) : 1.0;

  return {
    day: formatSimTime(world.simMinutes).day,
    simMinutes: Math.round(world.simMinutes),
    tradeVolume: Math.round(world.stats.totalTradeVolume ?? 0),
    avgWealth,
    giniIndex,
    employmentRatePct,
    priceIndex,
    townTreasury: Math.round(world.townTreasury ?? 0),
    populationCount: world.agents.length,
    sickCount,
  };
}

/**
 * Rebalances retail prices daily based on real stock scarcity & marketStipend policy.
 */
export function rebalanceMarketPrices(world: WorldState): WorldState {
  if (!world.businesses) return world;
  const stipendActive = Boolean(world.townModifiers?.marketStipend);
  const shortageShock = (world.activeShocks ?? []).some(
    (s) => s.active && s.kind === 'supply_shortage',
  );
  const surplusShock = (world.activeShocks ?? []).some(
    (s) => s.active && s.kind === 'harvest_surplus',
  );
  const nextBusinesses: Record<string, BusinessState> = {};

  for (const [locId, biz] of Object.entries(world.businesses)) {
    const nextStock: BusinessState['stock'] = {};
    for (const [rawKind, entry] of Object.entries(biz.stock)) {
      if (!entry) continue;
      const kind = rawKind as ItemKind;
      const base = BASELINE_ITEM_PRICES[kind] ?? entry.price;
      const fillRatio = entry.maxStock > 0 ? entry.quantity / entry.maxStock : 0.5;
      let nextPrice = entry.price;

      if (fillRatio <= 0.25) {
        nextPrice = Math.min(Math.ceil(base * 1.45), entry.price + 1);
      } else if (fillRatio >= 0.85) {
        nextPrice = Math.max(Math.max(2, entry.wholesaleCost + 1), entry.price - 1);
      }

      if (shortageShock && fillRatio <= 0.6) {
        nextPrice = Math.min(Math.ceil(base * 1.55), nextPrice + 1);
      } else if (
        surplusShock &&
        (kind === 'produce' || kind === 'groceries' || kind === 'bread' || kind === 'meal')
      ) {
        nextPrice = Math.max(Math.max(2, entry.wholesaleCost + 1), nextPrice - 1);
      }

      if (
        stipendActive &&
        (kind === 'groceries' || kind === 'produce' || kind === 'bread' || kind === 'meal')
      ) {
        const capped = Math.max(2, Math.round(base * 0.85));
        nextPrice = Math.min(nextPrice, capped);
      }

      nextStock[kind] = { ...entry, price: nextPrice };
    }
    nextBusinesses[locId] = { ...biz, stock: nextStock };
  }

  return { ...world, businesses: nextBusinesses };
}

/**
 * Dynamic Labor Market:
 * 1. Healthy businesses with high revenue or low staffing open new job postings.
 * 2. Residents seeking income or better pay apply and get hired with real shifts.
 * 3. Financially distressed businesses cut wages or shed extra staff.
 */
export function runLaborMarketCycle(
  world: WorldState,
  allocId: (prefix: string) => string,
): { world: WorldState; hires: number; layoffs: number } {
  if (!world.businesses) return { world, hires: 0, layoffs: 0 };

  let nextBusinesses: Record<string, BusinessState> = { ...world.businesses };
  let nextPostings: JobPosting[] = [...(world.jobPostings ?? [])];
  let nextAgents: AgentState[] = [...world.agents];
  const newChronicle: ChronicleEvent[] = [];
  const day = formatSimTime(world.simMinutes).day;
  let hires = 0;
  let layoffs = 0;

  // 1. Businesses with healthy reserves & <= 2 staff open a job posting
  for (const biz of Object.values(nextBusinesses)) {
    const alreadyOpen = nextPostings.some(
      (p) => p.locationId === biz.locationId && p.status === 'open',
    );
    const totalStaff = new Set([biz.ownerId, ...biz.employeeIds].filter(Boolean)).size;
    if (!alreadyOpen && biz.treasury >= 360 && totalStaff < 3 && nextPostings.filter((p) => p.status === 'open').length < 4) {
      const posting: JobPosting = {
        id: allocId('job'),
        locationId: biz.locationId,
        businessName: biz.name,
        roleTitle:
          biz.category === 'cafe'
            ? 'Counter & Kitchen Associate'
            : biz.category === 'pub'
              ? 'Evening Tavern Server'
              : biz.category === 'shop'
                ? 'Shop Clerk & Stock Specialist'
                : 'Assistant Staff',
        wagePerHour: biz.wagePerHour + 1,
        createdAt: world.simMinutes,
        status: 'open',
      };
      nextPostings = [posting, ...nextPostings].slice(0, 16);
    }

    // 3. Financial distress check: treasury < $35 with non-owner employees
    const removableEmp = biz.employeeIds.find((id) => id !== biz.ownerId);
    if (biz.treasury < 35 && removableEmp) {
      nextBusinesses[biz.locationId] = {
        ...biz,
        employeeIds: biz.employeeIds.filter((id) => id !== removableEmp),
        wagePerHour: Math.max(11, biz.wagePerHour - 1),
      };
      nextAgents = nextAgents.map((ag) => {
        if (ag.id !== removableEmp) return ag;
        const mem = createMemoryNode({
          id: allocId(`mem_layoff_${ag.id}`),
          createdAt: world.simMinutes,
          type: 'observation',
          source: 'economy',
          description: `${biz.name} had to let ${ag.name} go due to tight finances.`,
          importance: 8,
        });
        return {
          ...ag,
          employerLocationId: undefined,
          wagePerHour: 0,
          mood: applyEmotionalAppraisal(ag.mood, ag.drives, -0.25, 0.12),
          memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
        };
      });
      const laidOffAgent = world.agents.find((a) => a.id === removableEmp);
      newChronicle.push({
        id: allocId('chr_layoff'),
        simMinutes: world.simMinutes,
        type: 'economy',
        title: `${biz.name} downsized staff`,
        detail: `${laidOffAgent?.name ?? removableEmp} was let go while ${biz.name} rebuilds cash reserves.`,
        agentIds: [removableEmp, biz.ownerId].filter(Boolean),
        locationName: biz.name,
      });
      layoffs += 1;
    }
  }

  // 2. Match open job postings to residents who need income or a higher wage
  for (let i = 0; i < nextPostings.length; i++) {
    const post = nextPostings[i];
    if (post.status !== 'open') continue;
    const biz = nextBusinesses[post.locationId];
    if (!biz || biz.treasury < 150) continue;

    // Candidate priority: unemployed with lower wallet first, then underpaid non-owners
    const candidates = nextAgents
      .filter((ag) => {
        if (biz.ownerId === ag.id || biz.employeeIds.includes(ag.id)) return false;
        const ownsBusiness = Object.values(nextBusinesses).some((b) => b.ownerId === ag.id);
        if (ownsBusiness) return false;
        const unemployed = !ag.employerLocationId;
        const lowFunds = (ag.wallet ?? 120) < 110;
        const betterPay = post.wagePerHour >= (ag.wagePerHour ?? 0) + 3;
        return unemployed || (lowFunds && betterPay);
      })
      .sort((a, b) => (a.wallet ?? 120) - (b.wallet ?? 120) || a.id.localeCompare(b.id));

    const hire = candidates[0];
    if (!hire) continue;

    // Remove from old employer if switching jobs
    if (hire.employerLocationId && nextBusinesses[hire.employerLocationId]) {
      const oldBiz = nextBusinesses[hire.employerLocationId];
      nextBusinesses[hire.employerLocationId] = {
        ...oldBiz,
        employeeIds: oldBiz.employeeIds.filter((id) => id !== hire.id),
      };
    }

    nextBusinesses[biz.locationId] = {
      ...biz,
      employeeIds: Array.from(new Set([...biz.employeeIds, hire.id])),
    };

    nextPostings[i] = {
      ...post,
      status: 'filled',
      hiredAgentId: hire.id,
    };

    const shiftBlock: ScheduleBlock = {
      id: allocId(`sched_job_${hire.id}`),
      day,
      kind: 'work',
      startMinute: Math.max(biz.openHour * 60 + 60, 10 * 60),
      durationMinutes: 180,
      locationId: biz.locationId,
      activity: `Working shift as ${post.roleTitle} at ${biz.name}`,
      subSteps: ['Checking in with shop owner', 'Serving neighbors & restocking'],
      emoji: '💼',
      source: 'bdi_decision',
    };

    nextAgents = nextAgents.map((ag) => {
      if (ag.id !== hire.id) return ag;
      const mem = createMemoryNode({
        id: allocId(`mem_hire_${ag.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'economy',
        description: `${ag.name} was hired at ${biz.name} as ${post.roleTitle} for $${post.wagePerHour}/hr.`,
        importance: 8,
      });
      return {
        ...ag,
        employerLocationId: biz.locationId,
        wagePerHour: post.wagePerHour,
        dailySchedule: [...ag.dailySchedule, shiftBlock].sort(
          (a, b) => a.day - b.day || a.startMinute - b.startMinute,
        ),
        mood: applyEmotionalAppraisal(ag.mood, ag.drives, 0.22, 0.14),
        memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
      };
    });

    newChronicle.push({
      id: allocId('chr_hire'),
      simMinutes: world.simMinutes,
      type: 'economy',
      title: `${hire.name.split(' ')[0]} hired at ${biz.name}`,
      detail: `Accepted ${post.roleTitle} position at $${post.wagePerHour}/hr.`,
      agentIds: [hire.id, biz.ownerId].filter(Boolean),
      locationName: biz.name,
    });
    hires += 1;
  }

  let updatedWorld: WorldState = {
    ...world,
    businesses: nextBusinesses,
    jobPostings: nextPostings,
    agents: nextAgents,
    stats: {
      ...world.stats,
      jobsFilled: (world.stats.jobsFilled ?? 0) + hires,
    },
    chronicle:
      newChronicle.length > 0
        ? [...newChronicle, ...world.chronicle].slice(0, 140)
        : world.chronicle,
  };

  if (hires > 0 && newChronicle[0]) {
    updatedWorld = postPublicNotice(
      updatedWorld,
      {
        authorId: 'town_hall',
        authorName: 'Smallville Employment Ledger',
        category: 'job',
        title: newChronicle[0].title,
        body: newChronicle[0].detail,
        locationId: 'town_hall',
      },
      allocId,
    );
  }

  return { world: updatedWorld, hires, layoffs };
}

/**
 * Health drift, deterministic indoor cold contagion, and real Clinic treatment at Smallville Clinic.
 */
export function stepHealthAndClinic(
  world: WorldState,
  allocId: (prefix: string) => string,
): { world: WorldState; treatments: number; newInfections: number } {
  const clinicBiz = world.businesses?.['smallville_clinic'];
  const subsidized = Boolean(world.townModifiers?.communityClinic);
  const baseFee = clinicBiz?.stock.medicine?.price ?? 12;
  const clinicFee = subsidized ? Math.max(4, Math.round(baseFee * 0.5)) : baseFee;

  // Identify rooms currently hosting someone with a mild_cold
  const contagiousRooms = new Set<string>();
  for (const ag of world.agents) {
    if (ag.illness === 'mild_cold' && ag.currentLocationId && ag.path.length === 0) {
      contagiousRooms.add(ag.currentLocationId);
    }
  }

  let treatments = 0;
  let newInfections = 0;
  const newChronicle: ChronicleEvent[] = [];
  const newTx: EconomicTransaction[] = [];
  let nextClinicBiz = clinicBiz ? { ...clinicBiz } : undefined;

  const nextAgents = world.agents.map((ag) => {
    let health = ag.health ?? 94;
    let illness = ag.illness ?? 'none';
    let wallet = ag.wallet ?? 120;
    let lastClinicVisit = ag.lastClinicVisitSimMin;
    let memories = ag.memories;
    let mood = ag.mood;

    // 1. Physiological drift based on drives
    if (ag.drives.energy < 18 || ag.drives.hunger < 18) {
      health = clamp(health - 1.2, 20, 100);
      if (health < 55 && illness === 'none') {
        illness = 'fatigued';
      }
    } else if (ag.drives.energy >= 65 && ag.drives.hunger >= 55) {
      health = clamp(health + (illness === 'mild_cold' ? 0.35 : 0.8), 20, 100);
      if (illness === 'fatigued' && health >= 72) {
        illness = 'none';
      }
      if (illness === 'mild_cold' && health >= 88) {
        illness = 'none';
      }
    }

    // 2. Deterministic indoor contagion from sick room-mate (low rate, deterministic hash)
    if (
      illness === 'none' &&
      ag.currentLocationId &&
      ag.currentLocationId !== 'smallville_clinic' &&
      contagiousRooms.has(ag.currentLocationId) &&
      ag.drives.energy < 60
    ) {
      const roll = deterministicHash(`${ag.id}:${Math.floor(world.simMinutes / 30)}:contagion`);
      if (roll < 0.06) {
        illness = 'mild_cold';
        health = Math.min(health, 64);
        newInfections += 1;
        const mem = createMemoryNode({
          id: allocId(`mem_sick_${ag.id}`),
          createdAt: world.simMinutes,
          type: 'observation',
          source: 'health',
          description: `${ag.name} came down with a mild seasonal cold and needs rest or clinic medicine.`,
          importance: 7,
        });
        memories = compactMemories([mem, ...memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId);
      }
    }

    // 3. Real Clinic Treatment when visiting Smallville Clinic while sick or low health
    const needsCare = illness !== 'none' || health < 70;
    const clinicCooldownOk = world.simMinutes - (lastClinicVisit ?? -999) >= 240;
    if (
      needsCare &&
      clinicCooldownOk &&
      ag.currentLocationId === 'smallville_clinic' &&
      ag.path.length === 0
    ) {
      const affordable = wallet >= clinicFee || subsidized;
      const charge = subsidized ? Math.min(wallet, clinicFee) : clinicFee;
      if (affordable) {
        wallet = Math.max(0, Number((wallet - charge).toFixed(2)));
        health = clamp(health + 28, 0, 100);
        illness = 'none';
        lastClinicVisit = world.simMinutes;
        mood = applyEmotionalAppraisal(mood, ag.drives, 0.16, -0.05);
        treatments += 1;

        if (nextClinicBiz) {
          const med = nextClinicBiz.stock.medicine;
          nextClinicBiz = {
            ...nextClinicBiz,
            treasury: Number((nextClinicBiz.treasury + charge).toFixed(2)),
            dailyRevenue: Number((nextClinicBiz.dailyRevenue + charge).toFixed(2)),
            stock: med
              ? {
                  ...nextClinicBiz.stock,
                  medicine: { ...med, quantity: Math.max(0, med.quantity - 1) },
                }
              : nextClinicBiz.stock,
          };
        }

        newTx.push({
          id: allocId('tx_clinic'),
          simMinutes: world.simMinutes,
          kind: 'purchase',
          fromId: ag.id,
          toId: 'smallville_clinic',
          amount: charge,
          itemKind: 'medicine',
          quantity: 1,
          note: `${ag.name.split(' ')[0]} received clinic care & tonic ($${charge})`,
        });

        const mem = createMemoryNode({
          id: allocId(`mem_clinic_${ag.id}`),
          createdAt: world.simMinutes,
          type: 'observation',
          source: 'health',
          description: `${ag.name} visited Smallville Clinic for treatment ($${charge}) and recovered well.`,
          importance: 7,
        });
        memories = compactMemories([mem, ...memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId);

        newChronicle.push({
          id: allocId('chr_clinic'),
          simMinutes: world.simMinutes,
          type: 'world_event',
          title: `${ag.name.split(' ')[0]} treated at Smallville Clinic`,
          detail: `Received herbal medicine and recovered to ${Math.round(health)}% health ($${charge}).`,
          agentIds: [ag.id, 'elena'],
          locationName: 'Smallville Clinic & Greenhouse',
        });
      }
    }

    return {
      ...ag,
      health: Number(health.toFixed(1)),
      illness,
      wallet,
      lastClinicVisitSimMin: lastClinicVisit,
      mood,
      memories,
    };
  });

  const nextBusinesses =
    world.businesses && nextClinicBiz
      ? { ...world.businesses, smallville_clinic: nextClinicBiz }
      : world.businesses;

  return {
    world: {
      ...world,
      agents: nextAgents,
      businesses: nextBusinesses,
      transactions:
        newTx.length > 0 ? [...newTx, ...(world.transactions ?? [])].slice(0, 120) : world.transactions,
      stats: {
        ...world.stats,
        clinicTreatments: (world.stats.clinicTreatments ?? 0) + treatments,
        economicTransactions: (world.stats.economicTransactions ?? 0) + newTx.length,
        totalTradeVolume:
          (world.stats.totalTradeVolume ?? 0) + newTx.reduce((s, t) => s + t.amount, 0),
      },
      chronicle:
        newChronicle.length > 0
          ? [...newChronicle, ...world.chronicle].slice(0, 140)
          : world.chronicle,
    },
    treatments,
    newInfections,
  };
}

/**
 * Casts a single resident's secret mayoral ballot grounded in their Theory-of-Mind edges,
 * candidate community reputation, and shared club memberships.
 */
export function castElectionVote(
  world: WorldState,
  agentId: string,
  allocId: (prefix: string) => string,
  preferredCandidateId?: string,
): { world: WorldState; votedForId?: string } {
  const election = world.election;
  if (!election || election.status !== 'voting' || election.candidates.length === 0) {
    return { world };
  }
  if (election.votersCast.includes(agentId)) return { world };

  const voter = world.agents.find((a) => a.id === agentId);
  if (!voter) return { world };

  const explicitCand = preferredCandidateId
    ? election.candidates.find((c) => c.agentId === preferredCandidateId)
    : undefined;

  let bestCandidate = explicitCand ?? election.candidates[0];
  if (!explicitCand) {
    const voterClubs = new Set(voter.clubIds ?? []);
    let bestScore = -Infinity;

    for (const cand of election.candidates) {
      if (cand.agentId === voter.id) {
        bestCandidate = cand;
        bestScore = 999;
        break;
      }
      const candAgent = world.agents.find((a) => a.id === cand.agentId);
      const edge = voter.socialGraph[cand.agentId];
      const trustScore = edge ? edge.trust * 0.55 + edge.affection * 0.35 : 20;
      const repScore = (candAgent?.reputation ?? 55) * 0.4;
      const sharedClubBonus = (candAgent?.clubIds ?? []).some((cid) => voterClubs.has(cid)) ? 14 : 0;
      const sharedCoalitionBonus = (world.coalitions ?? []).some(
        (c) => c.active && c.memberIds.includes(voter.id) && c.memberIds.includes(cand.agentId),
      )
        ? 10
        : 0;
      const tieBreaker = deterministicHash(`${voter.id}:${cand.agentId}:${election.cycleNumber}`) * 8;
      const score = trustScore + repScore + sharedClubBonus + sharedCoalitionBonus + tieBreaker;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }
  }

  const nextCandidates = election.candidates.map((c) =>
    c.agentId === bestCandidate.agentId ? { ...c, votes: c.votes + 1 } : c,
  );
  const nextVoters = [...election.votersCast, agentId];

  const mem = createMemoryNode({
    id: allocId(`mem_vote_mayor_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'election',
    description: `${voter.name} cast a mayoral election ballot for ${bestCandidate.name}.`,
    importance: 7,
  });

  const nextAgents = world.agents.map((ag) =>
    ag.id === agentId
      ? {
          ...ag,
          memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
        }
      : ag,
  );

  return {
    world: {
      ...world,
      agents: nextAgents,
      election: {
        ...election,
        candidates: nextCandidates,
        votersCast: nextVoters,
      },
      stats: {
        ...world.stats,
        civicVotesCast: (world.stats.civicVotesCast ?? 0) + 1,
      },
    },
    votedForId: bestCandidate.agentId,
  };
}

/**
 * Allows any resident to organically declare candidacy in the upcoming or active Mayoral Election
 * with their own LLM-authored platform (breaking hardcoded candidate slates).
 */
export function declareMayoralCandidacy(
  world: WorldState,
  agentId: string,
  platform: string,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return { world, ok: false, reason: 'Unknown resident' };

  const election = world.election;
  if (!election || election.status === 'completed') {
    return { world, ok: false, reason: 'No active or upcoming election cycle' };
  }
  if (election.candidates.some((c) => c.agentId === agentId)) {
    return { world, ok: false, reason: `${agent.name} is already on the mayoral ballot` };
  }
  if (election.candidates.length >= 6) {
    return { world, ok: false, reason: 'Mayoral ballot is already at maximum capacity' };
  }

  const cleanPlatform =
    platform.trim().slice(0, 200) ||
    `Practical neighborhood leadership grounded in ${agent.occupation.toLowerCase()} experience.`;

  const mem = createMemoryNode({
    id: allocId(`mem_cand_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'election',
    description: `${agent.name} officially declared candidacy for Mayor of Smallville on a platform of: "${cleanPlatform}".`,
    importance: 9,
  });

  let nextWorld: WorldState = {
    ...world,
    agents: world.agents.map((ag) =>
      ag.id === agentId
        ? {
            ...ag,
            reputation: clamp((ag.reputation ?? 55) + 3, -100, 100),
            memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
          }
        : ag,
    ),
    election: {
      ...election,
      candidates: [
        ...election.candidates,
        {
          agentId: agent.id,
          name: agent.name,
          platform: cleanPlatform,
          votes: 0,
        },
      ],
    },
    chronicle: [
      {
        id: allocId('chr_cand'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `${agent.name} entered the Mayoral Race`,
        detail: `Platform: "${cleanPlatform}"`,
        agentIds: [agent.id],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: agent.id,
      authorName: agent.name,
      category: 'civic',
      title: `${agent.name} Announces Candidacy for Mayor`,
      body: cleanPlatform,
      locationId: 'town_hall',
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: 'Candidacy declared' };
}

/**
 * Starts or opens a live Town Mayoral Election immediately (or transitions to voting on Election Day).
 */
export function openTownElection(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  const day = formatSimTime(world.simMinutes).day;
  const prevCycle = world.election?.cycleNumber ?? 0;
  const preserveCandidates =
    world.election?.status === 'campaigning' && world.election.candidates.length >= 2
      ? world.election.candidates.map((c) => ({ ...c, votes: 0 }))
      : createInitialElection(world.agents, day).candidates;
  const nextElection: TownElection = {
    cycleNumber: world.election?.status === 'campaigning' ? Math.max(1, prevCycle) : prevCycle + 1,
    status: 'voting',
    electionDay: day,
    candidates: preserveCandidates,
    votersCast: [],
  };

  let nextWorld: WorldState = {
    ...world,
    election: nextElection,
    chronicle: [
      {
        id: allocId('chr_election_open'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `Town Mayoral Election #${nextElection.cycleNumber} polls are open`,
        detail: `Candidates: ${nextElection.candidates.map((c) => c.name).join(', ')}. Residents are casting ballots.`,
        agentIds: nextElection.candidates.map((c) => c.agentId),
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: 'town_hall',
      authorName: 'Smallville Election Commission',
      category: 'civic',
      title: `Polls Open: Mayoral Election #${nextElection.cycleNumber}`,
      body: `Vote today among ${nextElection.candidates.map((c) => c.name).join(', ')}.`,
      locationId: 'town_hall',
    },
    allocId,
  );

  return nextWorld;
}

/**
 * Tallies all remaining resident ballots (if finalizeAll = true) and inaugurates the elected Mayor.
 */
export function finalizeTownElection(
  world: WorldState,
  allocId: (prefix: string) => string,
  finalizeAllVoters = true,
): WorldState {
  let working = world;
  if (!working.election || working.election.status !== 'voting') return working;

  if (finalizeAllVoters) {
    for (const ag of working.agents) {
      if (!working.election?.votersCast.includes(ag.id)) {
        working = castElectionVote(working, ag.id, allocId).world;
      }
    }
  }

  const election = working.election!;
  const sorted = [...election.candidates].sort(
    (a, b) => b.votes - a.votes || a.agentId.localeCompare(b.agentId),
  );
  const winner = sorted[0];
  if (!winner) return working;

  const day = formatSimTime(working.simMinutes).day;
  const completedElection: TownElection = {
    ...election,
    status: 'completed',
    winnerId: winner.agentId,
    winnerName: winner.name,
  };

  const approval = computeMayorApproval(working.agents, winner.agentId);
  const nextLeadership: TownLeadership = {
    mayorId: winner.agentId,
    mayorName: winner.name,
    electedDay: day,
    termEndsDay: day + 7,
    taxRatePct: winner.agentId === 'sam' ? 7 : 8,
    approvalRating: approval,
  };

  const tallyLine = sorted.map((c) => `${c.name.split(' ')[0]} (${c.votes})`).join(', ');
  const nextAgents = working.agents.map((ag) => {
    const isWinner = ag.id === winner.agentId;
    const mem = createMemoryNode({
      id: allocId(`mem_mayor_res_${ag.id}`),
      createdAt: working.simMinutes,
      type: 'observation',
      source: 'election',
      description: isWinner
        ? `${ag.name} won the Smallville Mayoral Election (${tallyLine}) and was inaugurated as Mayor!`
        : `${winner.name} won the Smallville Mayoral Election (${tallyLine}).`,
      importance: isWinner ? 9 : 7,
    });
    return {
      ...ag,
      reputation: isWinner ? clamp((ag.reputation ?? 55) + 10, -100, 100) : ag.reputation,
      mood: isWinner ? applyEmotionalAppraisal(ag.mood, ag.drives, 0.3, 0.2) : ag.mood,
      memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, working.simMinutes, allocId),
    };
  });

  let nextWorld: WorldState = {
    ...working,
    agents: nextAgents,
    election: completedElection,
    leadership: nextLeadership,
    stats: {
      ...working.stats,
      electionsCompleted: (working.stats.electionsCompleted ?? 0) + 1,
    },
    chronicle: [
      {
        id: allocId('chr_mayor_elected'),
        simMinutes: working.simMinutes,
        type: 'civic' as const,
        title: `${winner.name} elected Mayor of Smallville`,
        detail: `Final tally: ${tallyLine}. Term runs through Day ${nextLeadership.termEndsDay}.`,
        agentIds: [winner.agentId],
        locationName: 'Town Hall & Gazette',
      },
      ...working.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: winner.agentId,
      authorName: `Mayor ${winner.name}`,
      category: 'civic',
      title: `Election Results: ${winner.name} Elected Mayor`,
      body: `Thank you Smallville! Final count: ${tallyLine}.`,
      locationId: 'town_hall',
    },
    allocId,
  );

  return nextWorld;
}

export function computeMayorApproval(agents: AgentState[], mayorId: string | null): number {
  if (!mayorId || agents.length === 0) return 60;
  let sum = 0;
  let count = 0;
  for (const ag of agents) {
    if (ag.id === mayorId) continue;
    const edge = ag.socialGraph[mayorId];
    if (edge) {
      sum += clamp((edge.trust + 100) / 2, 0, 100);
      count += 1;
    } else {
      const mayor = agents.find((a) => a.id === mayorId);
      sum += clamp(mayor?.reputation ?? 58, 0, 100);
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : 60;
}

/**
 * Advances automatic election day transitions and gradual voter turnout.
 */
export function stepTownElection(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  const calendar = getCalendarInfo(world.simMinutes);
  let working = world;

  if (!working.election) {
    working = { ...working, election: createInitialElection(working.agents, 7) };
  }
  const election = working.election!;

  // Transition campaigning -> voting on Election Day at 08:00
  if (
    election.status === 'campaigning' &&
    calendar.day >= election.electionDay &&
    calendar.hour24 >= 8
  ) {
    working = openTownElection(working, allocId);
  }

  // While voting is open, only ambient citizens auto-cast ballots; focal agents decide autonomously via BDI decisions
  if (working.election?.status === 'voting') {
    const ambientVotersRemaining = working.agents.filter(
      (a) => (a.tier ?? 'focal') === 'ambient' && !working.election!.votersCast.includes(a.id),
    );
    const prioritized = [
      ...ambientVotersRemaining.filter((a) => a.currentLocationId === 'town_hall'),
      ...ambientVotersRemaining.filter((a) => a.currentLocationId !== 'town_hall').slice(0, 2),
    ].slice(0, 3);

    for (const voter of prioritized) {
      working = castElectionVote(working, voter.id, allocId).world;
    }

    // Close polls when all voted or after 19:00 on election day (finalize remaining ambient ballots only; focal agents who chose not to vote genuinely abstain)
    const updatedElection = working.election!;
    if (
      updatedElection.votersCast.length >= working.agents.length ||
      (calendar.day >= updatedElection.electionDay && calendar.hour24 >= 19)
    ) {
      for (const ag of working.agents) {
        if ((ag.tier ?? 'focal') === 'ambient' && !working.election?.votersCast.includes(ag.id)) {
          working = castElectionVote(working, ag.id, allocId).world;
        }
      }
      working = finalizeTownElection(working, allocId, false);
    }
  }

  // Start a new election cycle once a mayor's term expires
  if (
    working.election?.status === 'completed' &&
    working.leadership &&
    calendar.day >= working.leadership.termEndsDay
  ) {
    const nextCycle = (working.election.cycleNumber ?? 1) + 1;
    working = {
      ...working,
      election: {
        ...createInitialElection(working.agents, calendar.day + 7),
        cycleNumber: nextCycle,
      },
    };
  }

  return working;
}

/**
 * Community Club Weekly Gatherings:
 * When 2+ members of a club are present at their club hall during meeting hours,
 * mutual trust & familiarity grow and a club gathering event is logged.
 */
export function stepSocialClubs(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  const clubs = world.clubs;
  if (!clubs || clubs.length === 0) return world;
  const calendar = getCalendarInfo(world.simMinutes);

  let gatherings = 0;
  let nextAgents = world.agents;
  const newChronicle: ChronicleEvent[] = [];

  for (const club of clubs) {
    if (
      calendar.weekdayIndex !== club.meetingWeekday ||
      calendar.hour24 !== club.meetingHour
    ) {
      continue;
    }
    const membersPresent = nextAgents.filter(
      (a) =>
        club.memberIds.includes(a.id) &&
        a.currentLocationId === club.locationId &&
        a.path.length === 0,
    );
    if (membersPresent.length < 2) continue;

    const presentIds = new Set(membersPresent.map((m) => m.id));
    nextAgents = nextAgents.map((ag) => {
      if (!presentIds.has(ag.id)) return ag;
      const nextGraph = { ...ag.socialGraph };
      for (const peer of membersPresent) {
        if (peer.id === ag.id) continue;
        const prev = nextGraph[peer.id];
        nextGraph[peer.id] = prev
          ? {
              ...prev,
              trust: clamp(prev.trust + 2, -100, 100),
              affection: clamp(prev.affection + 2, -100, 100),
              familiarity: clamp(prev.familiarity + 3, 0, 100),
              lastUpdatedSimMin: world.simMinutes,
            }
          : {
              targetId: peer.id,
              roleLabel: `${club.name} member`,
              trust: 56,
              affection: 55,
              familiarity: 35,
              inferredGoal: `Collaborating in ${club.name}`,
              lastUpdatedSimMin: world.simMinutes,
            };
      }
      const mem = createMemoryNode({
        id: allocId(`mem_club_${ag.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'club',
        description: `${ag.name} met with ${club.name} peers (${membersPresent.map((m) => m.name.split(' ')[0]).join(', ')}).`,
        importance: 6,
      });
      return {
        ...ag,
        socialGraph: nextGraph,
        drives: { ...ag.drives, social: clamp(ag.drives.social + 10, 0, 100) },
        memories: compactMemories([mem, ...ag.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
      };
    });

    gatherings += 1;
    newChronicle.push({
      id: allocId('chr_club'),
      simMinutes: world.simMinutes,
      type: 'civic',
      title: `${club.name} held its weekly gathering`,
      detail: `${membersPresent.map((m) => m.name.split(' ')[0]).join(', ')} convened to share ideas and plans.`,
      agentIds: membersPresent.map((m) => m.id),
    });
  }

  if (gatherings === 0) return world;

  return {
    ...world,
    agents: nextAgents,
    stats: {
      ...world.stats,
      clubGatherings: (world.stats.clubGatherings ?? 0) + gatherings,
    },
    chronicle: [...newChronicle, ...world.chronicle].slice(0, 140),
  };
}

/**
 * Runs daily Phase D institutional rollover (price rebalancing, labor market cycle,
 * leadership approval refresh, and macro-economy snapshot recording).
 */
export function applyDailyInstitutionalRollover(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  let working = rebalanceMarketPrices(world);
  working = runLaborMarketCycle(working, allocId).world;

  if (working.leadership?.mayorId) {
    working = {
      ...working,
      leadership: {
        ...working.leadership,
        approvalRating: computeMayorApproval(working.agents, working.leadership.mayorId),
      },
    };
  }

  const snapshot = computeMacroSnapshot(working);
  const prevHistory = working.macroHistory ?? [];
  const filtered = prevHistory.filter((s) => s.day !== snapshot.day);
  const macroHistory = [...filtered, snapshot].slice(-30);

  return {
    ...working,
    macroHistory,
  };
}
