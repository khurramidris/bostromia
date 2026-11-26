import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { isBusinessBoycottedByAgent } from './powerAndInstitutions';
import { applyEmotionalAppraisal } from './psychology';
import {
  DEFAULT_MEMORY_CAP,
  type AgentProject,
  type AgentState,
  type BusinessState,
  type ChronicleEvent,
  type EconomicTransaction,
  type ItemKind,
  type LocationZone,
  type TownModifiers,
  type WorldObject,
  type WorldState,
} from './types';

export interface CalendarInfo {
  day: number;
  weekdayIndex: number; // 0 = Mon .. 6 = Sun
  weekdayShort: string;
  weekdayFull: string;
  isWeekend: boolean;
  isPayday: boolean;
  hour24: number;
  minute: number;
  minuteOfDay: number;
  timeLabel: string;
  fullLabel: string;
}

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAYS_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function getCalendarInfo(simMinutes: number): CalendarInfo {
  const base = formatSimTime(simMinutes);
  const weekdayIndex = (Math.max(1, base.day) - 1) % 7;
  const weekdayShort = WEEKDAYS_SHORT[weekdayIndex];
  const weekdayFull = WEEKDAYS_FULL[weekdayIndex];
  const isWeekend = weekdayIndex >= 5;
  const isPayday = base.day % 3 === 0 || weekdayIndex === 4;
  return {
    day: base.day,
    weekdayIndex,
    weekdayShort,
    weekdayFull,
    isWeekend,
    isPayday,
    hour24: base.hour24,
    minute: base.minute,
    minuteOfDay: base.minuteOfDay,
    timeLabel: base.timeLabel,
    fullLabel: `${weekdayShort} · Day ${base.day}, ${base.timeLabel}`,
  };
}

export interface ItemMetadata {
  label: string;
  basePrice: number;
  wholesaleCost: number;
  hungerRestore: number;
  energyRestore: number;
  edible: boolean;
}

export const ITEM_CATALOG: Record<ItemKind, ItemMetadata> = {
  coffee: {
    label: 'Espresso',
    basePrice: 4,
    wholesaleCost: 2,
    hungerRestore: 8,
    energyRestore: 16,
    edible: true,
  },
  pastry: {
    label: 'Pastry',
    basePrice: 5,
    wholesaleCost: 2,
    hungerRestore: 22,
    energyRestore: 5,
    edible: true,
  },
  bread: {
    label: 'Sourdough Loaf',
    basePrice: 6,
    wholesaleCost: 3,
    hungerRestore: 28,
    energyRestore: 4,
    edible: true,
  },
  meal: {
    label: 'Warm Meal',
    basePrice: 12,
    wholesaleCost: 5,
    hungerRestore: 45,
    energyRestore: 8,
    edible: true,
  },
  groceries: {
    label: 'Groceries',
    basePrice: 10,
    wholesaleCost: 5,
    hungerRestore: 30,
    energyRestore: 4,
    edible: true,
  },
  produce: {
    label: 'Fresh Produce',
    basePrice: 7,
    wholesaleCost: 3,
    hungerRestore: 24,
    energyRestore: 5,
    edible: true,
  },
  medicine: {
    label: 'Herbal Remedy',
    basePrice: 14,
    wholesaleCost: 6,
    hungerRestore: 0,
    energyRestore: 22,
    edible: true,
  },
  craft_goods: {
    label: 'Craft Hardware',
    basePrice: 18,
    wholesaleCost: 8,
    hungerRestore: 0,
    energyRestore: 0,
    edible: false,
  },
  book: {
    label: 'Book / Journal',
    basePrice: 11,
    wholesaleCost: 5,
    hungerRestore: 0,
    energyRestore: 0,
    edible: false,
  },
  flowers: {
    label: 'Fresh Bouquet',
    basePrice: 9,
    wholesaleCost: 4,
    hungerRestore: 0,
    energyRestore: 0,
    edible: false,
  },
  drink: {
    label: 'Evening Beverage',
    basePrice: 7,
    wholesaleCost: 3,
    hungerRestore: 8,
    energyRestore: 4,
    edible: true,
  },
};

export const DEFAULT_TOWN_MODIFIERS: TownModifiers = {
  streetLighting: false,
  marketStipend: false,
  extendedLibrary: false,
  communityClinic: false,
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Dynamically initializes businesses for any town map based on location categories & residents
 * (no brittle dependency on a single town's hardcoded names—gracefully adapts to any LocationZone list).
 */
export function createInitialBusinesses(
  locations: LocationZone[],
  agents: AgentState[],
): Record<string, BusinessState> {
  const businesses: Record<string, BusinessState> = {};

  // Helper to match resident to workplace via occupation or home
  const findOwnerForLoc = (loc: LocationZone): string => {
    const locWords = loc.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const byOcc = agents.find((a) => {
      const occ = a.occupation.toLowerCase();
      return (
        locWords.some((w) => occ.includes(w)) ||
        (loc.category === 'cafe' && (occ.includes('cafe') || occ.includes('baker'))) ||
        (loc.category === 'pub' && (occ.includes('pub') || occ.includes('bartender'))) ||
        (loc.category === 'shop' && (occ.includes('pharmacy') || occ.includes('carpenter') || occ.includes('shop'))) ||
        (loc.category === 'civic' && (occ.includes('clinic') || occ.includes('doctor') || occ.includes('mayor') || occ.includes('journalist')))
      );
    });
    if (byOcc) return byOcc.id;
    const resident = agents.find((a) => a.homeLocationId === loc.id);
    return resident?.id ?? agents[0]?.id ?? 'town';
  };

  // Detect supplier hubs dynamically by category/name
  const gardenLoc = locations.find(
    (l) => l.category === 'park' && l.name.toLowerCase().includes('garden'),
  );
  const bakeryLoc = locations.find(
    (l) => l.category === 'cafe' && l.name.toLowerCase().includes('bak'),
  );
  const clinicLoc = locations.find(
    (l) => l.category === 'civic' && l.name.toLowerCase().includes('clinic'),
  );

  for (const loc of locations) {
    if (loc.category === 'home') continue;
    const lowerName = loc.name.toLowerCase();

    if (loc.category === 'cafe' && lowerName.includes('bak')) {
      const ownerId = agents.find((a) => a.occupation.toLowerCase().includes('baker'))?.id ?? findOwnerForLoc(loc);
      const employees = agents
        .filter((a) => a.id !== ownerId && a.occupation.toLowerCase().includes('baker'))
        .map((a) => a.id);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: employees,
        openHour: 6,
        closeHour: 18,
        openOnWeekends: true,
        treasury: 420,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 14,
        produces: ['bread', 'pastry'],
        supplierLocationId: gardenLoc?.id,
        stock: {
          bread: { quantity: 14, price: 6, maxStock: 24, wholesaleCost: 3 },
          pastry: { quantity: 16, price: 5, maxStock: 28, wholesaleCost: 2 },
          coffee: { quantity: 10, price: 4, maxStock: 18, wholesaleCost: 2 },
        },
      };
    } else if (loc.category === 'cafe') {
      const ownerId =
        agents.find((a) => a.occupation.toLowerCase().includes('cafe'))?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 7,
        closeHour: 20,
        openOnWeekends: true,
        treasury: 480,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 15,
        produces: ['coffee', 'meal'],
        supplierLocationId: bakeryLoc?.id,
        stock: {
          coffee: { quantity: 22, price: 4, maxStock: 36, wholesaleCost: 2 },
          pastry: { quantity: 14, price: 5, maxStock: 24, wholesaleCost: 2.5 },
          meal: { quantity: 12, price: 11, maxStock: 20, wholesaleCost: 5 },
        },
      };
    } else if (loc.category === 'pub') {
      const ownerId =
        agents.find(
          (a) =>
            a.occupation.toLowerCase().includes('pub') ||
            a.occupation.toLowerCase().includes('bartend'),
        )?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 12,
        closeHour: 23,
        openOnWeekends: true,
        treasury: 510,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 16,
        produces: ['drink', 'meal'],
        supplierLocationId: bakeryLoc?.id,
        stock: {
          meal: { quantity: 14, price: 13, maxStock: 24, wholesaleCost: 6 },
          drink: { quantity: 24, price: 7, maxStock: 36, wholesaleCost: 3 },
        },
      };
    } else if (loc.category === 'shop' && lowerName.includes('workshop')) {
      const ownerId =
        agents.find(
          (a) =>
            a.occupation.toLowerCase().includes('carpenter') ||
            a.occupation.toLowerCase().includes('craft') ||
            a.occupation.toLowerCase().includes('workshop'),
        )?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 8,
        closeHour: 18,
        openOnWeekends: false,
        treasury: 360,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 18,
        produces: ['craft_goods'],
        stock: {
          craft_goods: { quantity: 10, price: 18, maxStock: 20, wholesaleCost: 8 },
        },
      };
    } else if (loc.category === 'shop') {
      const ownerId =
        agents.find(
          (a) =>
            a.occupation.toLowerCase().includes('pharmac') ||
            a.occupation.toLowerCase().includes('market') ||
            a.occupation.toLowerCase().includes('grocer'),
        )?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 8,
        closeHour: 19,
        openOnWeekends: true,
        treasury: 540,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 16,
        produces: ['groceries'],
        supplierLocationId: gardenLoc?.id ?? clinicLoc?.id,
        stock: {
          groceries: { quantity: 18, price: 10, maxStock: 30, wholesaleCost: 5 },
          produce: { quantity: 14, price: 7, maxStock: 24, wholesaleCost: 3 },
          medicine: { quantity: 10, price: 14, maxStock: 18, wholesaleCost: 6 },
          flowers: { quantity: 10, price: 9, maxStock: 18, wholesaleCost: 4 },
        },
      };
    } else if (loc.category === 'park' && lowerName.includes('garden')) {
      const ownerId =
        agents.find(
          (a) =>
            a.occupation.toLowerCase().includes('agronom') ||
            a.occupation.toLowerCase().includes('garden') ||
            a.occupation.toLowerCase().includes('farm'),
        )?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 7,
        closeHour: 17,
        openOnWeekends: true,
        treasury: 280,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 15,
        produces: ['produce', 'flowers'],
        stock: {
          produce: { quantity: 22, price: 6, maxStock: 40, wholesaleCost: 2 },
          flowers: { quantity: 14, price: 8, maxStock: 24, wholesaleCost: 3 },
        },
      };
    } else if (loc.category === 'civic' && lowerName.includes('clinic')) {
      const ownerId =
        agents.find(
          (a) =>
            a.occupation.toLowerCase().includes('doctor') ||
            a.occupation.toLowerCase().includes('physician') ||
            a.occupation.toLowerCase().includes('clinic'),
        )?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 8,
        closeHour: 18,
        openOnWeekends: false,
        treasury: 460,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 22,
        produces: ['medicine'],
        supplierLocationId: gardenLoc?.id,
        stock: {
          medicine: { quantity: 16, price: 12, maxStock: 28, wholesaleCost: 5 },
        },
      };
    } else if (loc.category === 'college' && lowerName.includes('library')) {
      const ownerId =
        agents.find((a) => a.occupation.toLowerCase().includes('librar'))?.id ?? findOwnerForLoc(loc);
      businesses[loc.id] = {
        locationId: loc.id,
        name: loc.name,
        category: loc.category,
        ownerId,
        employeeIds: [],
        openHour: 8,
        closeHour: 20,
        openOnWeekends: true,
        treasury: 320,
        dailyRevenue: 0,
        dailyExpenses: 0,
        wagePerHour: 15,
        produces: ['book'],
        stock: {
          book: { quantity: 12, price: 11, maxStock: 20, wholesaleCost: 5 },
        },
      };
    }
  }

  return businesses;
}

/**
 * Hydrates real wallets, wages, employers, goods, skills, and active multi-day projects
 * onto residents without breaking any existing seed fields.
 */
export function hydrateAgentsEconomyAndProjects(
  agents: AgentState[],
  locations: LocationZone[],
  businesses: Record<string, BusinessState>,
  simMinutes: number,
): AgentState[] {
  const bizList = Object.values(businesses);
  const locById = new Map(locations.map((l) => [l.id, l]));

  return agents.map((ag, idx) => {
    const ownedBiz = bizList.find((b) => b.ownerId === ag.id);
    const employedBiz = ownedBiz ?? bizList.find((b) => b.employeeIds.includes(ag.id));

    // Infer workplace from schedule work blocks if not explicitly owner/employee
    const workBlockLocId = ag.dailySchedule.find((b) => b.kind === 'work')?.locationId;
    const employerLocationId =
      ag.employerLocationId ?? employedBiz?.locationId ?? workBlockLocId ?? ag.homeLocationId;

    const occLower = ag.occupation.toLowerCase();
    const isStudent = occLower.includes('student');
    const isOwner = Boolean(ownedBiz);
    const defaultWallet = isOwner ? 240 + (idx % 5) * 25 : isStudent ? 85 + (idx % 4) * 15 : 145 + (idx % 5) * 20;
    const defaultWage = ownedBiz?.wagePerHour ?? (isStudent ? 11 : occLower.includes('professor') || occLower.includes('doctor') ? 22 : 16);
    const defaultExpenses = isStudent ? 12 : isOwner ? 18 : 15;

    // Derive initial active multi-day project from the agent's primary goal
    const primaryGoal = ag.goals?.[0] ?? ag.currently;
    const projectLocId =
      (employerLocationId && locById.has(employerLocationId) ? employerLocationId : ag.homeLocationId);
    const projectCategory: AgentProject['category'] = occLower.includes('student') || occLower.includes('professor') || occLower.includes('librar')
      ? 'research'
      : occLower.includes('mayor') || occLower.includes('journal') || occLower.includes('doctor')
        ? 'civic'
        : occLower.includes('artist') || occLower.includes('animat') || occLower.includes('paint') || occLower.includes('music')
          ? 'creative'
          : isOwner
            ? 'business'
            : 'craft';

    const existingProjects = ag.projects && ag.projects.length > 0 ? ag.projects : [
      {
        id: `proj_${ag.id}_1`,
        title: primaryGoal.length > 76 ? `${primaryGoal.slice(0, 73)}...` : primaryGoal,
        category: projectCategory,
        progress: 15 + (idx % 4) * 10,
        targetLocationId: projectLocId,
        collaboratorIds: Object.keys(ag.socialGraph).slice(0, 2),
        status: 'active' as const,
        startedAtSimMin: simMinutes,
      },
    ];

    const initialGoods: Partial<Record<ItemKind, number>> = ag.goods ?? {
      groceries: 2,
      coffee: 1,
    };

    const primarySkill = occLower.split(/[\s,&]+/).find((w) => w.length > 3) ?? 'craft';
    const skills = ag.skills ?? {
      [primarySkill]: 58 + (idx % 5) * 6,
      civic: 40 + (idx % 4) * 8,
    };

    return {
      ...ag,
      wallet: typeof ag.wallet === 'number' && Number.isFinite(ag.wallet) ? ag.wallet : defaultWallet,
      dailyExpenses:
        typeof ag.dailyExpenses === 'number' && Number.isFinite(ag.dailyExpenses)
          ? ag.dailyExpenses
          : defaultExpenses,
      employerLocationId,
      wagePerHour:
        typeof ag.wagePerHour === 'number' && Number.isFinite(ag.wagePerHour)
          ? ag.wagePerHour
          : defaultWage,
      goods: initialGoods,
      skills,
      projects: existingProjects,
      reputation: typeof ag.reputation === 'number' ? ag.reputation : computeResidentReputation(ag.id, agents),
    };
  });
}

export function computeResidentReputation(agentId: string, allAgents: AgentState[]): number {
  let sum = 0;
  let count = 0;
  for (const other of allAgents) {
    if (other.id === agentId) continue;
    const edge = other.socialGraph[agentId];
    if (!edge) continue;
    sum += edge.trust * 0.6 + edge.affection * 0.4;
    count += 1;
  }
  if (count === 0) return 20;
  return Math.max(-100, Math.min(100, Math.round(sum / count)));
}

export function isBusinessOpen(
  biz: BusinessState,
  calendar: CalendarInfo,
  modifiers?: TownModifiers,
): boolean {
  if (calendar.isWeekend && !biz.openOnWeekends) return false;
  const closeHour =
    modifiers?.extendedLibrary && biz.name.toLowerCase().includes('library')
      ? Math.min(23, biz.closeHour + 2)
      : biz.closeHour;
  return calendar.hour24 >= biz.openHour && calendar.hour24 < closeHour;
}

/**
 * Decoupled venue resolver: finds the closest currently-open food business with available edible stock,
 * or falls back to the resident's own home if closed / broke / no food business exists.
 */
export function findNearestOpenFoodVenue(
  world: WorldState,
  agent: AgentState,
): { locationId: string; locationName: string; objectId?: string; isHome: boolean; itemKind?: ItemKind; price: number } {
  const calendar = getCalendarInfo(world.simMinutes);
  const businesses = world.businesses ?? {};
  const wallet = agent.wallet ?? 100;

  let best: {
    locationId: string;
    locationName: string;
    objectId?: string;
    dist: number;
    itemKind: ItemKind;
    price: number;
  } | null = null;

  for (const loc of world.locations) {
    if (loc.category !== 'cafe' && loc.category !== 'pub' && loc.category !== 'shop') continue;
    const biz = businesses[loc.id];
    if (biz && !isBusinessOpen(biz, calendar, world.townModifiers)) continue;
    if (isBusinessBoycottedByAgent(world, agent.id, loc.id)) continue;

    // Pick cheapest affordable edible item in stock
    let pickedItem: { kind: ItemKind; price: number } | null = null;
    if (biz) {
      const edibleEntries = (Object.entries(biz.stock) as Array<[ItemKind, { quantity: number; price: number }]>)
        .filter(([k, entry]) => entry && entry.quantity > 0 && ITEM_CATALOG[k]?.edible && entry.price <= wallet)
        .sort((a, b) => a[1].price - b[1].price);
      if (edibleEntries.length > 0) {
        pickedItem = { kind: edibleEntries[0][0], price: edibleEntries[0][1].price };
      } else {
        continue; // out of stock or unaffordable
      }
    } else if (loc.category === 'cafe' || loc.category === 'pub') {
      pickedItem = { kind: 'meal', price: 10 };
    }

    if (!pickedItem) continue;
    const dist = Math.hypot(agent.x - loc.doorX, agent.y - loc.doorY);
    if (!best || dist < best.dist) {
      const tableOrCounter = world.objects.find(
        (o) =>
          o.locationId === loc.id &&
          (o.kind === 'table' || o.kind === 'counter' || o.kind === 'bar'),
      );
      best = {
        locationId: loc.id,
        locationName: loc.name,
        objectId: tableOrCounter?.id,
        dist,
        itemKind: pickedItem.kind,
        price: pickedItem.price,
      };
    }
  }

  if (best) {
    return {
      locationId: best.locationId,
      locationName: best.locationName,
      objectId: best.objectId,
      isHome: false,
      itemKind: best.itemKind,
      price: best.price,
    };
  }

  const homeLoc = world.locations.find((l) => l.id === agent.homeLocationId);
  const homeTable = world.objects.find(
    (o) =>
      o.locationId === agent.homeLocationId &&
      (o.kind === 'stove' || o.kind === 'table' || o.kind === 'counter'),
  );
  return {
    locationId: agent.homeLocationId,
    locationName: homeLoc?.name ?? 'Home',
    objectId: homeTable?.id,
    isHome: true,
    price: 0,
  };
}

/**
 * Executes a validated retail purchase from a business into an agent's goods/drives.
 */
export function executePurchaseAction(
  world: WorldState,
  agentId: string,
  locationId: string,
  itemKind: ItemKind,
  consumeImmediately: boolean,
  allocId: (prefix: string) => string,
): {
  world: WorldState;
  ok: boolean;
  reason?: string;
  transaction?: EconomicTransaction;
} {
  const businesses = world.businesses;
  const biz = businesses?.[locationId];
  const agent = world.agents.find((a) => a.id === agentId);
  if (!biz || !agent) return { world, ok: false, reason: 'missing_actor_or_business' };

  const calendar = getCalendarInfo(world.simMinutes);
  if (!isBusinessOpen(biz, calendar, world.townModifiers)) {
    return { world, ok: false, reason: 'business_closed' };
  }
  if (isBusinessBoycottedByAgent(world, agentId, locationId)) {
    return { world, ok: false, reason: 'boycotted_by_buyer' };
  }

  const stockEntry = biz.stock[itemKind];
  if (!stockEntry || stockEntry.quantity <= 0) {
    return { world, ok: false, reason: 'out_of_stock' };
  }

  const price = stockEntry.price;
  const wallet = agent.wallet ?? 0;
  if (wallet < price) {
    return { world, ok: false, reason: 'insufficient_funds' };
  }

  const rawTaxPct = world.leadership?.taxRatePct ?? 8;
  const taxRate = Math.max(0, Math.min(0.35, rawTaxPct / 100));
  const salesTax = roundMoney(price * taxRate);
  const bizNet = roundMoney(price - salesTax);
  const meta = ITEM_CATALOG[itemKind];

  const tx: EconomicTransaction = {
    id: allocId('tx_buy'),
    simMinutes: world.simMinutes,
    kind: 'purchase',
    fromId: agent.id,
    toId: biz.locationId,
    amount: price,
    itemKind,
    quantity: 1,
    note: `${agent.name.split(' ')[0]} bought ${meta.label.toLowerCase()} at ${biz.name} ($${price})`,
  };

  const nextBiz: BusinessState = {
    ...biz,
    treasury: roundMoney(biz.treasury + bizNet),
    dailyRevenue: roundMoney(biz.dailyRevenue + price),
    stock: {
      ...biz.stock,
      [itemKind]: {
        ...stockEntry,
        quantity: stockEntry.quantity - 1,
      },
    },
  };

  const nextAgents = world.agents.map((a) => {
    if (a.id !== agent.id) return a;
    const nextGoods = { ...(a.goods ?? {}) };
    let nextDrives = a.drives;
    let nextMood = a.mood;

    if (consumeImmediately && meta.edible) {
      nextDrives = {
        ...a.drives,
        hunger: Math.min(100, a.drives.hunger + meta.hungerRestore),
        energy: Math.min(100, a.drives.energy + meta.energyRestore),
      };
      nextMood = applyEmotionalAppraisal(a.mood, nextDrives, 0.06, 0.03);
    } else {
      nextGoods[itemKind] = (nextGoods[itemKind] ?? 0) + 1;
    }

    const obs = createMemoryNode({
      id: allocId(`econ_${a.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'economy',
      description: `${a.name.split(' ')[0]} paid $${price} for ${meta.label.toLowerCase()} at ${biz.name} (wallet $${roundMoney(wallet - price)}).`,
      importance: wallet - price < 25 ? 6 : 3,
    });

    return {
      ...a,
      wallet: roundMoney(wallet - price),
      goods: nextGoods,
      drives: nextDrives,
      mood: nextMood,
      memories: compactMemories([obs, ...a.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId),
    };
  });

  const nextStats = {
    ...world.stats,
    economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
    totalTradeVolume: roundMoney((world.stats.totalTradeVolume ?? 0) + price),
  };

  return {
    ok: true,
    transaction: tx,
    world: {
      ...world,
      agents: nextAgents,
      businesses: { ...businesses, [locationId]: nextBiz },
      townTreasury: roundMoney((world.townTreasury ?? 350) + salesTax),
      transactions: [tx, ...(world.transactions ?? [])].slice(0, 120),
      stats: nextStats,
    },
  };
}

/**
 * Executes a real work shift tick: produces goods into business stock, pays wages,
 * advances relevant craft skills, and triggers wholesale supply-chain restocking when low.
 */
export function executeWorkShiftTick(
  world: WorldState,
  agentId: string,
  hoursWorked: number,
  allocId: (prefix: string) => string,
): { world: WorldState; earned: number; producedItem?: ItemKind } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent || !agent.currentLocationId) return { world, earned: 0 };

  const businesses = { ...(world.businesses ?? {}) };
  const candidateBiz = businesses[agent.currentLocationId];
  const biz =
    candidateBiz && (candidateBiz.ownerId === agent.id || candidateBiz.employeeIds.includes(agent.id))
      ? candidateBiz
      : undefined;
  const wageRate = agent.wagePerHour ?? biz?.wagePerHour ?? 15;
  const grossWage = roundMoney(Math.max(2, wageRate * hoursWorked));

  let paidAmount = grossWage;
  let producedItem: ItemKind | undefined;
  let townTreasury = world.townTreasury ?? 350;
  const newTransactions: EconomicTransaction[] = [];

  if (biz) {
    const canProduce = biz.produces && biz.produces.length > 0;
    const nextStock = { ...biz.stock };

    if (canProduce && biz.produces) {
      // Pick whichever produced item has lowest ratio to maxStock
      const targetKind = biz.produces.reduce((lowest, k) => {
        const curEntry = nextStock[k];
        const lowEntry = nextStock[lowest];
        const curRatio = curEntry ? curEntry.quantity / Math.max(1, curEntry.maxStock) : 1;
        const lowRatio = lowEntry ? lowEntry.quantity / Math.max(1, lowEntry.maxStock) : 1;
        return curRatio < lowRatio ? k : lowest;
      }, biz.produces[0]);

      const entry = nextStock[targetKind];
      if (entry && entry.quantity < entry.maxStock) {
        const batchSize = world.townModifiers?.marketStipend ? 3 : 2;
        nextStock[targetKind] = {
          ...entry,
          quantity: Math.min(entry.maxStock, entry.quantity + batchSize),
        };
        producedItem = targetKind;
      }
    }

    // Pay wage from business treasury (owners draw living pay only up to actual business treasury)
    if (biz.ownerId === agent.id) {
      paidAmount =
        biz.treasury > 120
          ? Math.min(grossWage, roundMoney(biz.treasury - 100))
          : Math.min(roundMoney(grossWage * 0.5), Math.max(0, roundMoney(biz.treasury)));
    } else {
      paidAmount = Math.min(grossWage, Math.max(0, roundMoney(biz.treasury)));
    }

    let nextTreasury = roundMoney(Math.max(0, biz.treasury - paidAmount));
    let nextExpenses = roundMoney(biz.dailyExpenses + paidAmount);

    // Supply-chain wholesale restocking from upstream supplier if stock runs below 35%
    if (
      biz.supplierLocationId &&
      businesses[biz.supplierLocationId] &&
      world.simMinutes - (biz.lastRestockSimMin ?? -999) >= 180
    ) {
      const supplier = businesses[biz.supplierLocationId];
      for (const [kindKey, entry] of Object.entries(nextStock) as Array<[ItemKind, { quantity: number; price: number; maxStock: number; wholesaleCost: number }]>) {
        if (!entry || entry.quantity >= entry.maxStock * 0.35) continue;
        const supStock = supplier.stock[kindKey];
        if (!supStock || supStock.quantity < 4) continue;
        const qty = Math.min(6, entry.maxStock - entry.quantity, supStock.quantity - 2);
        const totalCost = roundMoney(qty * entry.wholesaleCost);
        if (qty > 0 && nextTreasury >= totalCost + 60) {
          nextTreasury = roundMoney(nextTreasury - totalCost);
          nextExpenses = roundMoney(nextExpenses + totalCost);
          nextStock[kindKey] = { ...entry, quantity: entry.quantity + qty };
          businesses[biz.supplierLocationId] = {
            ...supplier,
            treasury: roundMoney(supplier.treasury + totalCost),
            dailyRevenue: roundMoney(supplier.dailyRevenue + totalCost),
            stock: {
              ...supplier.stock,
              [kindKey]: { ...supStock, quantity: supStock.quantity - qty },
            },
          };
          newTransactions.push({
            id: allocId('tx_restock'),
            simMinutes: world.simMinutes,
            kind: 'restock',
            fromId: biz.locationId,
            toId: supplier.locationId,
            amount: totalCost,
            itemKind: kindKey,
            quantity: qty,
            note: `${biz.name} restocked ${qty}× ${ITEM_CATALOG[kindKey].label.toLowerCase()} from ${supplier.name} ($${totalCost})`,
          });
          break;
        }
      }
    }

    businesses[biz.locationId] = {
      ...biz,
      treasury: nextTreasury,
      dailyExpenses: nextExpenses,
      stock: nextStock,
      lastRestockSimMin: newTransactions.length > 0 ? world.simMinutes : biz.lastRestockSimMin,
    };
  } else {
    // Civic / college / freelance salary drawn strictly from town treasury (preserving $50 municipal floor)
    const availableTreasury = Math.max(0, roundMoney(townTreasury - 50));
    paidAmount = Math.min(grossWage, availableTreasury);
    townTreasury = roundMoney(townTreasury - paidAmount);
  }

  if (paidAmount > 0) {
    newTransactions.push({
      id: allocId('tx_wage'),
      simMinutes: world.simMinutes,
      kind: 'wage',
      fromId: biz?.locationId ?? 'town_treasury',
      toId: agent.id,
      amount: paidAmount,
      note: `${agent.name.split(' ')[0]} earned $${paidAmount} shift pay${producedItem ? ` (produced ${ITEM_CATALOG[producedItem].label.toLowerCase()})` : ''}`,
    });
  }

  const nextAgents = world.agents.map((a) => {
    if (a.id !== agent.id) return a;
    const skillKeys = Object.keys(a.skills ?? {});
    const primarySkill = skillKeys[0] ?? 'craft';
    const nextSkills = {
      ...(a.skills ?? {}),
      [primarySkill]: Math.min(100, roundMoney((a.skills?.[primarySkill] ?? 50) + 0.18)),
    };
    return {
      ...a,
      wallet: roundMoney((a.wallet ?? 100) + paidAmount),
      skills: nextSkills,
      lastWorkTickSimMin: world.simMinutes,
    };
  });

  const volumeAdded = newTransactions.reduce((s, t) => s + t.amount, 0);

  return {
    earned: paidAmount,
    producedItem,
    world: {
      ...world,
      agents: nextAgents,
      businesses,
      townTreasury,
      transactions: [...newTransactions, ...(world.transactions ?? [])].slice(0, 120),
      stats: {
        ...world.stats,
        economicTransactions: (world.stats.economicTransactions ?? 0) + newTransactions.length,
        totalTradeVolume: roundMoney((world.stats.totalTradeVolume ?? 0) + volumeAdded),
      },
    },
  };
}

/**
 * Advances an agent's active multi-day personal/community project and logs real completion milestones.
 */
export function advanceAgentProject(
  world: WorldState,
  agentId: string,
  deltaProgress: number,
  allocId: (prefix: string) => string,
): { world: WorldState; completedProject?: AgentProject } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent || !agent.projects || agent.projects.length === 0) {
    return { world };
  }

  const activeIdx = agent.projects.findIndex((p) => p.status === 'active');
  if (activeIdx < 0) return { world };

  const target = agent.projects[activeIdx];
  const nextProgress = Math.min(100, Math.round(target.progress + deltaProgress));
  if (nextProgress === target.progress) return { world };

  const justCompleted = nextProgress >= 100;
  const updatedProject: AgentProject = {
    ...target,
    progress: nextProgress,
    status: justCompleted ? 'completed' : 'active',
    completedAtSimMin: justCompleted ? world.simMinutes : undefined,
  };

  let nextChronicle = world.chronicle;
  const nextAgents = world.agents.map((a) => {
    if (a.id !== agentId) return a;
    const nextProjects = a.projects ? [...a.projects] : [];
    nextProjects[activeIdx] = updatedProject;
    let nextMemories = a.memories;
    let nextDrives = {
      ...a.drives,
      purpose: Math.min(100, a.drives.purpose + (justCompleted ? 18 : 3)),
    };
    let nextMood = a.mood;

    if (justCompleted) {
      nextMood = applyEmotionalAppraisal(a.mood, nextDrives, 0.22, 0.14);
      const mem = createMemoryNode({
        id: allocId(`proj_${a.id}`),
        createdAt: world.simMinutes,
        type: 'reflection',
        source: 'plan',
        description: `${a.name} completed a major milestone: "${updatedProject.title}"!`,
        importance: 8,
      });
      nextMemories = compactMemories([mem, ...a.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId);
    }

    return {
      ...a,
      projects: nextProjects,
      drives: nextDrives,
      mood: nextMood,
      reputation: Math.min(100, (a.reputation ?? 20) + (justCompleted ? 6 : 0)),
      memories: nextMemories,
    };
  });

  if (justCompleted) {
    const evt: ChronicleEvent = {
      id: allocId('chr_proj'),
      simMinutes: world.simMinutes,
      type: 'project',
      title: `${agent.name} completed "${updatedProject.title}"`,
      detail: `After sustained multi-day effort, ${agent.name} finished their ${updatedProject.category} project.`,
      agentIds: [agent.id, ...updatedProject.collaboratorIds],
      locationName:
        world.locations.find((l) => l.id === updatedProject.targetLocationId)?.name ??
        world.worldName ??
        'Town',
    };
    nextChronicle = [evt, ...world.chronicle].slice(0, 140);
  }

  return {
    completedProject: justCompleted ? updatedProject : undefined,
    world: {
      ...world,
      agents: nextAgents,
      chronicle: nextChronicle,
    },
  };
}

/**
 * Applies daily rent/living upkeep at midnight rollover and resets business daily revenue counters.
 */
export function applyDailyEconomicRollover(
  world: WorldState,
  newDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  const newTransactions: EconomicTransaction[] = [];
  let townTreasury = world.townTreasury ?? 350;

  const nextAgents = world.agents.map((a) => {
    if ((a.lastUpkeepDay ?? 1) >= newDay) return a;
    const upkeep = a.dailyExpenses ?? 14;
    const wallet = a.wallet ?? 100;
    const paid = roundMoney(Math.min(wallet, upkeep));
    townTreasury = roundMoney(townTreasury + paid);

    if (paid > 0) {
      newTransactions.push({
        id: allocId('tx_upkeep'),
        simMinutes: world.simMinutes,
        kind: 'upkeep',
        fromId: a.id,
        toId: 'town_treasury',
        amount: paid,
        note: `${a.name.split(' ')[0]} paid daily utilities & household upkeep ($${paid})`,
      });
    }

    const nextWallet = roundMoney(Math.max(0, wallet - paid));
    let nextMemories = a.memories;
    if (nextWallet < 30) {
      const warnMem = createMemoryNode({
        id: allocId(`econ_low_${a.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'economy',
        description: `${a.name} noticed savings running low ($${nextWallet} left after daily expenses) and needs to prioritize paid work shifts.`,
        importance: 7,
      });
      nextMemories = compactMemories([warnMem, ...a.memories], DEFAULT_MEMORY_CAP, world.simMinutes, allocId);
    }

    return {
      ...a,
      wallet: nextWallet,
      lastUpkeepDay: newDay,
      memories: nextMemories,
    };
  });

  const nextBusinesses: Record<string, BusinessState> = {};
  for (const [locId, biz] of Object.entries(world.businesses ?? {})) {
    nextBusinesses[locId] = {
      ...biz,
      dailyRevenue: 0,
      dailyExpenses: 0,
    };
  }

  return {
    ...world,
    agents: nextAgents,
    businesses: nextBusinesses,
    townTreasury,
    transactions: [...newTransactions, ...(world.transactions ?? [])].slice(0, 120),
    stats: {
      ...world.stats,
      economicTransactions: (world.stats.economicTransactions ?? 0) + newTransactions.length,
    },
  };
}

/**
 * Helper to execute an agent consuming an item from their own goods inventory (e.g. home groceries).
 */
export function executeConsumeItemAction(
  world: WorldState,
  agentId: string,
  itemKind?: ItemKind,
): { world: WorldState; consumed?: ItemKind } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return { world };

  const goods = { ...(agent.goods ?? {}) };
  let picked = itemKind;
  if (!picked || !(goods[picked] && goods[picked]! > 0)) {
    const avail = (Object.entries(goods) as Array<[ItemKind, number]>).find(
      ([k, qty]) => qty > 0 && ITEM_CATALOG[k]?.edible,
    );
    if (!avail) {
      // Fallback to basic home pantry staples when a hungry resident eats at home with an empty inventory
      if (!itemKind && agent.currentLocationId === agent.homeLocationId && agent.drives.hunger < 45) {
        const nextAgents = world.agents.map((a) => {
          if (a.id !== agentId) return a;
          const nextDrives = {
            ...a.drives,
            hunger: Math.min(100, a.drives.hunger + 18),
            energy: Math.min(100, a.drives.energy + 4),
          };
          return {
            ...a,
            drives: nextDrives,
            mood: applyEmotionalAppraisal(a.mood, nextDrives, 0.04, 0.01),
          };
        });
        return {
          consumed: 'bread',
          world: {
            ...world,
            agents: nextAgents,
          },
        };
      }
      return { world };
    }
    picked = avail[0];
  }

  const meta = ITEM_CATALOG[picked];
  if (!meta) return { world };
  goods[picked] = Math.max(0, (goods[picked] ?? 0) - 1);

  const nextAgents = world.agents.map((a) => {
    if (a.id !== agentId) return a;
    const nextDrives = {
      ...a.drives,
      hunger: Math.min(100, a.drives.hunger + meta.hungerRestore),
      energy: Math.min(100, a.drives.energy + meta.energyRestore),
    };
    return {
      ...a,
      goods,
      drives: nextDrives,
      mood: applyEmotionalAppraisal(a.mood, nextDrives, 0.05, 0.02),
    };
  });

  return {
    consumed: picked,
    world: {
      ...world,
      agents: nextAgents,
    },
  };
}

export function findObjectForLocation(
  objects: WorldObject[],
  locationId: string,
  preferredKinds: WorldObject['kind'][],
): WorldObject | undefined {
  for (const kind of preferredKinds) {
    const match = objects.find((o) => o.locationId === locationId && o.kind === kind);
    if (match) return match;
  }
  return objects.find((o) => o.locationId === locationId);
}
