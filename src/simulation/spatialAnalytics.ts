import { getCalendarInfo, isBusinessOpen, ITEM_CATALOG } from './worldEconomy';
import type {
  AgentState,
  ChronicleEvent,
  CivicProposal,
  LocationZone,
  TrackedMeme,
  WorldObject,
  WorldState,
} from './types';

export type MapLensId = 'normal' | 'wealth' | 'mood' | 'trust' | 'meme' | 'civic';

export interface MapLensDefinition {
  id: MapLensId;
  label: string;
  shortLabel: string;
  description: string;
}

export const MAP_LENSES: readonly MapLensDefinition[] = [
  {
    id: 'normal',
    label: 'Town View',
    shortLabel: 'Town',
    description: 'Standard architectural view of Smallville.',
  },
  {
    id: 'wealth',
    label: 'Wealth & Trade',
    shortLabel: 'Wealth',
    description: 'Business treasuries, resident savings, and cash-tight alerts.',
  },
  {
    id: 'mood',
    label: 'Mood & Vitality',
    shortLabel: 'Mood',
    description: 'Resident emotional valence, hunger, and health across buildings.',
  },
  {
    id: 'trust',
    label: 'Trust Network',
    shortLabel: 'Trust',
    description: 'Social bonds and friction radiating from the selected resident.',
  },
  {
    id: 'meme',
    label: 'Rumor Spread',
    shortLabel: 'Rumors',
    description: 'Information diffusion paths and reach across town.',
  },
  {
    id: 'civic',
    label: 'Civic Pulse',
    shortLabel: 'Civic',
    description: 'Active ballot positions, town hall proposals, and civic hubs.',
  },
];

export interface LocationOverlayStyle {
  locationId: string;
  colorHex: string;
  intensity: number; // 0..1
  badgeText?: string;
}

export interface AgentOverlayStyle {
  agentId: string;
  colorHex: string;
  intensity: number; // 0..1
  statusLabel: string;
}

export interface SpatialArc {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  colorHex: string;
  weight: number; // 0.2..1
  label?: string;
}

export interface MapLensOverlayResult {
  lens: MapLensId;
  title: string;
  subtitle: string;
  legend: Array<{ label: string; colorHex: string }>;
  locations: Record<string, LocationOverlayStyle>;
  agents: Record<string, AgentOverlayStyle>;
  arcs: SpatialArc[];
  activeMemeId?: string;
  activeProposalId?: string;
}

export interface BuildingYieldMetric {
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}

export interface BuildingYieldCardData {
  location: LocationZone;
  specialization: string;
  openStatus: 'open' | 'closed' | 'always';
  hoursLabel: string;
  ownerName?: string;
  yields: BuildingYieldMetric[];
  inventory: Array<{ kind: string; label: string; qty: number; price: number }>;
  ventures: Array<{ id: string; name: string; founderName: string; revenue: number; stock: number }>;
  clubs: Array<{ id: string; name: string; memberCount: number; scheduleLabel: string }>;
  staff: Array<{ id: string; name: string; occupation: string; wagePerHour: number; present: boolean }>;
  presentAgents: Array<{
    id: string;
    name: string;
    shortName: string;
    occupation: string;
    emoji: string;
    moodTone: 'emerald' | 'amber' | 'rose';
  }>;
  objects: WorldObject[];
  recentEvents: ChronicleEvent[];
}

export type PictogramTone = 'emerald' | 'amber' | 'rose' | 'slate';

export interface PictogramCell {
  agentId: string;
  name: string;
  shortName: string;
  occupation: string;
  bucket: string;
  tone: PictogramTone;
  detail: string;
}

export interface PictogramRow {
  id: string;
  title: string;
  ratioLabel: string;
  subtitle: string;
  cells: PictogramCell[];
  legend: Array<{ label: string; count: number; tone: PictogramTone }>;
}

export interface TownAdvisorBrief {
  id: 'economy' | 'civic' | 'social';
  role: string;
  title: string;
  status: 'healthy' | 'watch' | 'alert';
  headlineMetric: string;
  bullets: string[];
  action: {
    label: string;
    lens: MapLensId;
    focusLocationId?: string;
    focusAgentId?: string;
  };
}

export type ExplorerMetricId =
  | 'wallet'
  | 'avgTrust'
  | 'reputation'
  | 'moodValence'
  | 'energy'
  | 'hunger'
  | 'memoryCount'
  | 'skillsAvg';

export interface ExplorerMetricMeta {
  id: ExplorerMetricId;
  label: string;
  unit: string;
  format: (v: number) => string;
}

export const EXPLORER_METRICS: readonly ExplorerMetricMeta[] = [
  { id: 'wallet', label: 'Savings ($)', unit: '$', format: (v) => `$${Math.round(v)}` },
  { id: 'avgTrust', label: 'Avg Trust', unit: 'pts', format: (v) => `${Math.round(v)}` },
  { id: 'reputation', label: 'Reputation', unit: 'pts', format: (v) => `${Math.round(v)}` },
  { id: 'moodValence', label: 'Mood Valence', unit: '', format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) },
  { id: 'energy', label: 'Energy', unit: '%', format: (v) => `${Math.round(v)}%` },
  { id: 'hunger', label: 'Satiety', unit: '%', format: (v) => `${Math.round(v)}%` },
  { id: 'memoryCount', label: 'Memories', unit: '', format: (v) => `${Math.round(v)}` },
  { id: 'skillsAvg', label: 'Skill Level', unit: 'pts', format: (v) => `${Math.round(v)}` },
];

export interface ExplorerPoint {
  agentId: string;
  name: string;
  shortName: string;
  occupation: string;
  locationId: string | null;
  locationName: string;
  xVal: number;
  yVal: number;
  xNorm: number; // 0..1
  yNorm: number; // 0..1
  colorHex: string;
  wallet: number;
  avgTrust: number;
  moodValence: number;
}

export interface ExplorerDataset {
  xMetric: ExplorerMetricMeta;
  yMetric: ExplorerMetricMeta;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  points: ExplorerPoint[];
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shortName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function getAgentAvgTrust(agent: AgentState): number {
  const edges = Object.values(agent.socialGraph ?? {});
  if (edges.length === 0) return 45;
  return edges.reduce((sum, e) => sum + e.trust, 0) / edges.length;
}

function getAgentSkillsAvg(agent: AgentState): number {
  const vals = Object.values(agent.skills ?? {});
  if (vals.length === 0) return 50;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function getActiveMeme(world: WorldState, memeId?: string): TrackedMeme | undefined {
  const memes = world.memes ?? [];
  if (memes.length === 0) return undefined;
  if (memeId) {
    const exact = memes.find((m) => m.id === memeId);
    if (exact) return exact;
  }
  return [...memes].sort(
    (a, b) => Object.keys(b.knownBy).length - Object.keys(a.knownBy).length,
  )[0];
}

function getActiveProposal(world: WorldState, proposalId?: string): CivicProposal | undefined {
  const proposals = world.proposals ?? [];
  if (proposals.length === 0) return undefined;
  if (proposalId) {
    const exact = proposals.find((p) => p.id === proposalId);
    if (exact) return exact;
  }
  const open = proposals.filter((p) => p.status === 'open');
  const pool = open.length > 0 ? open : proposals;
  return [...pool].sort(
    (a, b) =>
      b.votesFor.length + b.votesAgainst.length - (a.votesFor.length + a.votesAgainst.length),
  )[0];
}

function getAgentMoodTone(agent: AgentState): 'emerald' | 'amber' | 'rose' {
  const unwell = Boolean(agent.illness && agent.illness !== 'none') || (agent.health ?? 100) < 68;
  if (unwell || agent.mood.valence < -0.15 || agent.drives.hunger < 28 || agent.drives.energy < 22) {
    return 'rose';
  }
  if (agent.mood.valence >= 0.12 && agent.drives.hunger >= 45) {
    return 'emerald';
  }
  return 'amber';
}

export function computeMapLensOverlay(
  world: WorldState,
  lens: MapLensId,
  options?: { memeId?: string; proposalId?: string; focusAgentId?: string },
): MapLensOverlayResult {
  if (lens === 'normal') {
    return {
      lens: 'normal',
      title: 'Town View',
      subtitle: 'Click any building or resident to inspect live activity.',
      legend: [],
      locations: {},
      agents: {},
      arcs: [],
    };
  }

  const locations: Record<string, LocationOverlayStyle> = {};
  const agents: Record<string, AgentOverlayStyle> = {};
  const arcs: SpatialArc[] = [];

  if (lens === 'wealth') {
    const businesses = world.businesses ?? {};
    for (const loc of world.locations) {
      const biz = businesses[loc.id];
      if (biz) {
        const treasury = Math.round(biz.treasury);
        const colorHex = treasury >= 320 ? '#2D6A4F' : treasury >= 160 ? '#D97706' : '#DC2626';
        locations[loc.id] = {
          locationId: loc.id,
          colorHex,
          intensity: treasury >= 320 ? 0.65 : treasury >= 160 ? 0.45 : 0.72,
          badgeText: `$${treasury}`,
        };
      } else {
        const homeResidents = world.agents.filter((a) => a.homeLocationId === loc.id);
        if (homeResidents.length > 0) {
          const avgWallet = Math.round(
            homeResidents.reduce((s, a) => s + (a.wallet ?? 0), 0) / homeResidents.length,
          );
          const colorHex = avgWallet >= 180 ? '#2D6A4F' : avgWallet >= 85 ? '#D97706' : '#DC2626';
          locations[loc.id] = {
            locationId: loc.id,
            colorHex,
            intensity: 0.42,
            badgeText: `avg $${avgWallet}`,
          };
        }
      }
    }

    for (const ag of world.agents) {
      const w = Math.round(ag.wallet ?? 0);
      const colorHex = w >= 180 ? '#10B981' : w >= 75 ? '#F59E0B' : '#EF4444';
      agents[ag.id] = {
        agentId: ag.id,
        colorHex,
        intensity: w < 75 ? 0.95 : 0.75,
        statusLabel: `$${w}`,
      };
    }

    const totalCash = Math.round(world.agents.reduce((s, a) => s + (a.wallet ?? 0), 0));
    const treasury = Math.round(world.townTreasury ?? 0);
    return {
      lens,
      title: 'Wealth & Trade Lens',
      subtitle: `Town Treasury $${treasury} · Resident Savings $${totalCash}`,
      legend: [
        { label: 'Flush ($180+ / $320+ biz)', colorHex: '#2D6A4F' },
        { label: 'Steady', colorHex: '#D97706' },
        { label: 'Cash-Tight (<$75)', colorHex: '#DC2626' },
      ],
      locations,
      agents,
      arcs,
    };
  }

  if (lens === 'mood') {
    for (const ag of world.agents) {
      const tone = getAgentMoodTone(ag);
      const colorHex = tone === 'emerald' ? '#10B981' : tone === 'amber' ? '#F59E0B' : '#EF4444';
      const statusLabel =
        ag.illness && ag.illness !== 'none'
          ? ag.illness.replace(/_/g, ' ')
          : ag.drives.hunger < 28
            ? 'Hungry'
            : tone === 'emerald'
              ? 'Upbeat'
              : tone === 'amber'
                ? 'Steady'
                : 'Strained';
      agents[ag.id] = {
        agentId: ag.id,
        colorHex,
        intensity: tone === 'rose' ? 0.95 : 0.75,
        statusLabel,
      };
    }

    for (const loc of world.locations) {
      const here = world.agents.filter((a) => a.currentLocationId === loc.id);
      if (here.length === 0) continue;
      const strained = here.filter((a) => getAgentMoodTone(a) === 'rose').length;
      const upbeat = here.filter((a) => getAgentMoodTone(a) === 'emerald').length;
      const colorHex = strained > 0 ? '#DC2626' : upbeat >= here.length / 2 ? '#2D6A4F' : '#D97706';
      locations[loc.id] = {
        locationId: loc.id,
        colorHex,
        intensity: strained > 0 ? 0.65 : 0.48,
        badgeText: `${here.length} here`,
      };
    }

    const strainedCount = world.agents.filter((a) => getAgentMoodTone(a) === 'rose').length;
    const upbeatCount = world.agents.filter((a) => getAgentMoodTone(a) === 'emerald').length;
    return {
      lens,
      title: 'Mood & Vitality Lens',
      subtitle: `${upbeatCount} upbeat · ${strainedCount} strained or hungry`,
      legend: [
        { label: 'Upbeat & Fed', colorHex: '#10B981' },
        { label: 'Steady / Neutral', colorHex: '#F59E0B' },
        { label: 'Strained / Hungry / Unwell', colorHex: '#EF4444' },
      ],
      locations,
      agents,
      arcs,
    };
  }

  if (lens === 'trust') {
    const focusAgent =
      world.agents.find((a) => a.id === options?.focusAgentId) ?? world.agents[0];
    if (focusAgent) {
      agents[focusAgent.id] = {
        agentId: focusAgent.id,
        colorHex: '#1B4332',
        intensity: 1,
        statusLabel: 'Focus',
      };
      const locTrustSum: Record<string, { sum: number; count: number }> = {};
      for (const other of world.agents) {
        if (other.id === focusAgent.id) continue;
        const edge = focusAgent.socialGraph[other.id];
        const trust = edge?.trust ?? 45;
        const colorHex = trust >= 65 ? '#10B981' : trust < 38 ? '#EF4444' : '#94A3B8';
        agents[other.id] = {
          agentId: other.id,
          colorHex,
          intensity: trust >= 65 || trust < 38 ? 0.9 : 0.45,
          statusLabel: `Trust ${Math.round(trust)}`,
        };
        if (trust >= 62 || trust < 38) {
          arcs.push({
            id: `trust_${focusAgent.id}_${other.id}`,
            fromAgentId: focusAgent.id,
            toAgentId: other.id,
            colorHex: trust >= 62 ? '#10B981' : '#EF4444',
            weight: trust >= 62 ? Math.min(1, (trust - 50) / 50) : Math.min(1, (45 - trust) / 45),
            label: `${Math.round(trust)}`,
          });
        }
        if (other.currentLocationId) {
          const cur = locTrustSum[other.currentLocationId] ?? { sum: 0, count: 0 };
          cur.sum += trust;
          cur.count += 1;
          locTrustSum[other.currentLocationId] = cur;
        }
      }
      for (const [locId, agg] of Object.entries(locTrustSum)) {
        const avg = Math.round(agg.sum / agg.count);
        locations[locId] = {
          locationId: locId,
          colorHex: avg >= 62 ? '#2D6A4F' : avg < 40 ? '#DC2626' : '#D97706',
          intensity: 0.45,
          badgeText: `T:${avg}`,
        };
      }
    }

    return {
      lens,
      title: 'Trust Network Lens',
      subtitle: focusAgent
        ? `Social bonds from ${focusAgent.name} (${arcs.length} strong or strained ties)`
        : 'Select a resident to inspect trust bonds.',
      legend: [
        { label: 'Trusted Ally (62+)', colorHex: '#10B981' },
        { label: 'Acquaintance', colorHex: '#94A3B8' },
        { label: 'Strained (<38)', colorHex: '#EF4444' },
      ],
      locations,
      agents,
      arcs: arcs.slice(0, 14),
    };
  }

  if (lens === 'meme') {
    const meme = getActiveMeme(world, options?.memeId);
    if (meme) {
      const originId = meme.originAgentId;
      for (const ag of world.agents) {
        const entry = meme.knownBy[ag.id];
        if (ag.id === originId) {
          agents[ag.id] = {
            agentId: ag.id,
            colorHex: '#D97706',
            intensity: 1,
            statusLabel: 'Origin',
          };
        } else if (entry) {
          agents[ag.id] = {
            agentId: ag.id,
            colorHex: '#10B981',
            intensity: 0.9,
            statusLabel: 'Heard',
          };
          const fromId =
            entry.heardFromId && world.agents.some((a) => a.id === entry.heardFromId)
              ? entry.heardFromId
              : originId;
          if (fromId && fromId !== ag.id) {
            arcs.push({
              id: `meme_${meme.id}_${fromId}_${ag.id}`,
              fromAgentId: fromId,
              toAgentId: ag.id,
              colorHex: '#10B981',
              weight: 0.75,
            });
          }
        } else {
          agents[ag.id] = {
            agentId: ag.id,
            colorHex: '#94A3B8',
            intensity: 0.35,
            statusLabel: 'Unaware',
          };
        }
      }

      for (const loc of world.locations) {
        const here = world.agents.filter((a) => a.currentLocationId === loc.id);
        if (here.length === 0) continue;
        const aware = here.filter((a) => Boolean(meme.knownBy[a.id])).length;
        const ratio = aware / here.length;
        locations[loc.id] = {
          locationId: loc.id,
          colorHex: aware === 0 ? '#64748B' : ratio >= 0.5 ? '#2D6A4F' : '#D97706',
          intensity: aware === 0 ? 0.22 : 0.45 + ratio * 0.35,
          badgeText: `${aware}/${here.length}`,
        };
      }
    }

    const reach = meme ? Object.keys(meme.knownBy).length : 0;
    return {
      lens,
      title: 'Rumor Spread Lens',
      subtitle: meme
        ? `"${meme.topic.slice(0, 58)}${meme.topic.length > 58 ? '…' : ''}" — ${reach}/${world.agents.length} know`
        : 'No active town rumors yet.',
      legend: [
        { label: 'Originator', colorHex: '#D97706' },
        { label: 'Aware', colorHex: '#10B981' },
        { label: 'Unaware', colorHex: '#94A3B8' },
      ],
      locations,
      agents,
      arcs: arcs.slice(0, 16),
      activeMemeId: meme?.id,
    };
  }

  // lens === 'civic'
  const proposal = getActiveProposal(world, options?.proposalId);
  const forSet = new Set(proposal?.votesFor ?? []);
  const againstSet = new Set(proposal?.votesAgainst ?? []);
  for (const ag of world.agents) {
    if (forSet.has(ag.id)) {
      agents[ag.id] = {
        agentId: ag.id,
        colorHex: '#10B981',
        intensity: 0.92,
        statusLabel: 'Voted For',
      };
    } else if (againstSet.has(ag.id)) {
      agents[ag.id] = {
        agentId: ag.id,
        colorHex: '#EF4444',
        intensity: 0.92,
        statusLabel: 'Voted Against',
      };
    } else {
      agents[ag.id] = {
        agentId: ag.id,
        colorHex: '#94A3B8',
        intensity: 0.38,
        statusLabel: 'Undecided',
      };
    }
  }

  for (const loc of world.locations) {
    if (loc.category === 'civic') {
      locations[loc.id] = {
        locationId: loc.id,
        colorHex: '#2D6A4F',
        intensity: 0.72,
        badgeText: proposal ? `${proposal.votesFor.length}–${proposal.votesAgainst.length}` : 'Hall',
      };
    } else {
      const here = world.agents.filter((a) => a.currentLocationId === loc.id);
      const votedHere = here.filter((a) => forSet.has(a.id) || againstSet.has(a.id)).length;
      if (votedHere > 0) {
        const oppHere = here.filter((a) => againstSet.has(a.id)).length;
        locations[loc.id] = {
          locationId: loc.id,
          colorHex: oppHere > votedHere / 2 ? '#DC2626' : '#2D6A4F',
          intensity: 0.45,
          badgeText: `${votedHere} voted`,
        };
      }
    }
  }

  return {
    lens: 'civic',
    title: 'Civic Pulse Lens',
    subtitle: proposal
      ? `${proposal.title} (${proposal.votesFor.length} For · ${proposal.votesAgainst.length} Against · $${proposal.cost})`
      : 'No civic proposals on the ballot.',
    legend: [
      { label: 'Voted For', colorHex: '#10B981' },
      { label: 'Voted Against', colorHex: '#EF4444' },
      { label: 'Undecided', colorHex: '#94A3B8' },
    ],
    locations,
    agents,
    arcs,
    activeProposalId: proposal?.id,
  };
}

function getSpecializationLabel(loc: LocationZone, hasBusiness: boolean): string {
  if (loc.id === 'smallville_clinic') return 'Health Clinic';
  if (loc.id === 'oakridge_bakery') return 'Artisan Bakery';
  if (loc.id === 'willow_workshop') return 'Craft Workshop';
  if (loc.id === 'harvey_library') return 'Public Library';
  switch (loc.category) {
    case 'cafe':
      return hasBusiness ? 'Social Roastery' : 'Cafe';
    case 'pub':
      return 'Evening Tavern';
    case 'shop':
      return 'Market Commerce';
    case 'civic':
      return 'Civic Hall';
    case 'college':
      return 'Campus District';
    case 'park':
      return 'Public Commons';
    case 'home':
      return 'Residential Quarter';
    default:
      return 'Town Landmark';
  }
}

export function computeBuildingYieldCard(
  world: WorldState,
  locationId: string,
): BuildingYieldCardData | null {
  const location = world.locations.find((l) => l.id === locationId);
  if (!location) return null;

  const calendar = getCalendarInfo(world.simMinutes);
  const biz = world.businesses?.[locationId];
  const openStatus: 'open' | 'closed' | 'always' = biz
    ? isBusinessOpen(biz, calendar, world.townModifiers)
      ? 'open'
      : 'closed'
    : 'always';
  const hoursLabel = biz
    ? `${String(biz.openHour).padStart(2, '0')}:00–${String(biz.closeHour).padStart(2, '0')}:00`
    : 'Open 24h';

  const owner = biz?.ownerId ? world.agents.find((a) => a.id === biz.ownerId) : undefined;
  const presentAgentsRaw = world.agents.filter((a) => a.currentLocationId === locationId);
  const staffRaw = world.agents.filter((a) => a.employerLocationId === locationId);

  const yields: BuildingYieldMetric[] = [];
  if (biz) {
    const netFlow = Math.round(biz.dailyRevenue - biz.dailyExpenses);
    yields.push(
      {
        label: 'Treasury',
        value: `$${Math.round(biz.treasury)}`,
        tone: biz.treasury >= 250 ? 'emerald' : biz.treasury >= 120 ? 'amber' : 'rose',
      },
      {
        label: 'Daily Rev',
        value: `$${Math.round(biz.dailyRevenue)}`,
        tone: biz.dailyRevenue > 0 ? 'emerald' : 'slate',
      },
      {
        label: 'Net Flow',
        value: `${netFlow >= 0 ? '+' : ''}$${netFlow}`,
        tone: netFlow > 0 ? 'emerald' : netFlow === 0 ? 'slate' : 'rose',
      },
      {
        label: 'Wage / hr',
        value: `$${biz.wagePerHour}`,
        tone: 'slate',
      },
    );
  } else if (location.category === 'civic') {
    const openProps = (world.proposals ?? []).filter((p) => p.status === 'open').length;
    const passedProps = (world.proposals ?? []).filter((p) => p.status === 'passed').length;
    yields.push(
      {
        label: 'Town Treasury',
        value: `$${Math.round(world.townTreasury ?? 0)}`,
        tone: (world.townTreasury ?? 0) >= 250 ? 'emerald' : 'amber',
      },
      {
        label: 'Open Ballots',
        value: String(openProps),
        tone: openProps > 0 ? 'amber' : 'slate',
      },
      {
        label: 'Enacted Laws',
        value: String(passedProps),
        tone: passedProps > 0 ? 'emerald' : 'slate',
      },
      {
        label: 'Inside Now',
        value: String(presentAgentsRaw.length),
        tone: 'slate',
      },
    );
  } else {
    const homeResidents = world.agents.filter((a) => a.homeLocationId === locationId);
    const cohort = homeResidents.length > 0 ? homeResidents : presentAgentsRaw;
    const avgWallet =
      cohort.length > 0
        ? Math.round(cohort.reduce((s, a) => s + (a.wallet ?? 0), 0) / cohort.length)
        : 0;
    const avgMood =
      cohort.length > 0
        ? cohort.reduce((s, a) => s + a.mood.valence, 0) / cohort.length
        : 0;
    yields.push(
      {
        label: 'Present Now',
        value: String(presentAgentsRaw.length),
        tone: presentAgentsRaw.length > 0 ? 'emerald' : 'slate',
      },
      {
        label: homeResidents.length > 0 ? 'Household' : 'Staff',
        value: String(homeResidents.length > 0 ? homeResidents.length : staffRaw.length),
        tone: 'slate',
      },
      {
        label: 'Avg Savings',
        value: cohort.length > 0 ? `$${avgWallet}` : '—',
        tone: avgWallet >= 150 ? 'emerald' : avgWallet >= 75 ? 'amber' : 'slate',
      },
      {
        label: 'Avg Mood',
        value: cohort.length > 0 ? `${avgMood >= 0 ? '+' : ''}${avgMood.toFixed(2)}` : '—',
        tone: avgMood >= 0.1 ? 'emerald' : avgMood < -0.1 ? 'rose' : 'slate',
      },
    );
  }

  const inventory = biz
    ? Object.entries(biz.stock)
        .filter(([, entry]) => Boolean(entry && entry.quantity > 0))
        .map(([kind, entry]) => ({
          kind,
          label: ITEM_CATALOG[kind as keyof typeof ITEM_CATALOG]?.label ?? kind,
          qty: entry!.quantity,
          price: entry!.price,
        }))
        .slice(0, 6)
    : [];

  const ventures = (world.ventures ?? [])
    .filter((v) => v.active && v.locationId === locationId)
    .map((v) => ({
      id: v.id,
      name: v.name,
      founderName: world.agents.find((a) => a.id === v.founderId)?.name ?? v.founderId,
      revenue: Math.round(v.revenue ?? 0),
      stock: v.stock,
    }));

  const clubs = (world.clubs ?? [])
    .filter((c) => c.locationId === locationId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      memberCount: c.memberIds.length,
      scheduleLabel: `${WEEKDAY_NAMES[c.meetingWeekday % 7]} ${String(c.meetingHour).padStart(2, '0')}:00`,
    }));

  const staff = staffRaw.map((a) => ({
    id: a.id,
    name: a.name,
    occupation: a.occupation,
    wagePerHour: a.wagePerHour ?? biz?.wagePerHour ?? 14,
    present: a.currentLocationId === locationId,
  }));

  const presentAgents = presentAgentsRaw.map((a) => ({
    id: a.id,
    name: a.name,
    shortName: shortName(a.name),
    occupation: a.occupation,
    emoji: a.actionEmoji,
    moodTone: getAgentMoodTone(a),
  }));

  const objects = world.objects.filter((o) => o.locationId === locationId);
  const recentEvents = world.chronicle
    .filter(
      (ev) =>
        ev.locationName === location.name ||
        ev.locationName === location.shortName ||
        ev.detail.includes(location.name),
    )
    .slice(0, 3);

  return {
    location,
    specialization: getSpecializationLabel(location, Boolean(biz)),
    openStatus,
    hoursLabel,
    ownerName: owner?.name,
    yields,
    inventory,
    ventures,
    clubs,
    staff,
    presentAgents,
    objects,
    recentEvents,
  };
}

export function computeResidentPictograms(
  world: WorldState,
  options?: { memeId?: string; proposalId?: string },
): PictogramRow[] {
  const total = world.agents.length;
  const rows: PictogramRow[] = [];

  // Row 1: Rumor / Information Spread
  const meme = getActiveMeme(world, options?.memeId);
  if (meme) {
    let aware = 0;
    const cells: PictogramCell[] = world.agents.map((ag) => {
      const isOrigin = ag.id === meme.originAgentId;
      const entry = meme.knownBy[ag.id];
      const heard = Boolean(entry);
      if (heard) aware += 1;
      const heardFromAgent = entry?.heardFromId
        ? world.agents.find((a) => a.id === entry.heardFromId)?.name
        : undefined;
      return {
        agentId: ag.id,
        name: ag.name,
        shortName: shortName(ag.name),
        occupation: ag.occupation,
        bucket: isOrigin ? 'Origin' : heard ? 'Aware' : 'Unaware',
        tone: isOrigin ? 'amber' : heard ? 'emerald' : 'slate',
        detail: isOrigin
          ? 'Originated this news'
          : heard
            ? `Heard from ${heardFromAgent ?? 'neighbor'}`
            : 'Has not heard yet',
      };
    });
    rows.push({
      id: 'pictogram_meme',
      title: 'Rumor Reach',
      ratioLabel: `${aware} of ${total} residents`,
      subtitle: meme.topic,
      cells,
      legend: [
        { label: 'Origin', count: meme.knownBy[meme.originAgentId] ? 1 : 0, tone: 'amber' },
        { label: 'Aware', count: Math.max(0, aware - (meme.knownBy[meme.originAgentId] ? 1 : 0)), tone: 'emerald' },
        { label: 'Unaware', count: Math.max(0, total - aware), tone: 'slate' },
      ],
    });
  }

  // Row 2: Civic Ballot Split
  const proposal = getActiveProposal(world, options?.proposalId);
  if (proposal) {
    const forSet = new Set(proposal.votesFor);
    const againstSet = new Set(proposal.votesAgainst);
    const cells: PictogramCell[] = world.agents.map((ag) => {
      const isFor = forSet.has(ag.id);
      const isAgainst = againstSet.has(ag.id);
      return {
        agentId: ag.id,
        name: ag.name,
        shortName: shortName(ag.name),
        occupation: ag.occupation,
        bucket: isFor ? 'For' : isAgainst ? 'Against' : 'Undecided',
        tone: isFor ? 'emerald' : isAgainst ? 'rose' : 'slate',
        detail: isFor
          ? `Supports (${ag.dossier?.civicWorldview ?? 'civic'})`
          : isAgainst
            ? `Opposes (${ag.dossier?.civicWorldview ?? 'civic'})`
            : `Has not voted yet`,
      };
    });
    rows.push({
      id: 'pictogram_civic',
      title: 'Civic Ballot',
      ratioLabel: `${forSet.size} for · ${againstSet.size} against`,
      subtitle: `${proposal.title} ($${proposal.cost} · ${proposal.status})`,
      cells,
      legend: [
        { label: 'For', count: forSet.size, tone: 'emerald' },
        { label: 'Against', count: againstSet.size, tone: 'rose' },
        { label: 'Undecided', count: Math.max(0, total - forSet.size - againstSet.size), tone: 'slate' },
      ],
    });
  }

  // Row 3: Financial Cushion
  let flushCount = 0;
  let steadyCount = 0;
  let tightCount = 0;
  const wealthCells: PictogramCell[] = world.agents.map((ag) => {
    const w = Math.round(ag.wallet ?? 0);
    if (w >= 180) {
      flushCount += 1;
      return {
        agentId: ag.id,
        name: ag.name,
        shortName: shortName(ag.name),
        occupation: ag.occupation,
        bucket: 'Flush',
        tone: 'emerald',
        detail: `$${w} saved (${ag.careerTier ?? 'practitioner'})`,
      };
    }
    if (w >= 75) {
      steadyCount += 1;
      return {
        agentId: ag.id,
        name: ag.name,
        shortName: shortName(ag.name),
        occupation: ag.occupation,
        bucket: 'Steady',
        tone: 'amber',
        detail: `$${w} saved`,
      };
    }
    tightCount += 1;
    return {
      agentId: ag.id,
      name: ag.name,
      shortName: shortName(ag.name),
      occupation: ag.occupation,
      bucket: 'Tight',
      tone: 'rose',
      detail: `$${w} remaining — tight reserves`,
    };
  });
  rows.push({
    id: 'pictogram_wealth',
    title: 'Household Cushion',
    ratioLabel: `${flushCount} of ${total} flush`,
    subtitle: `${steadyCount} steady · ${tightCount} below $75`,
    cells: wealthCells,
    legend: [
      { label: 'Flush ($180+)', count: flushCount, tone: 'emerald' },
      { label: 'Steady', count: steadyCount, tone: 'amber' },
      { label: 'Tight (<$75)', count: tightCount, tone: 'rose' },
    ],
  });

  // Row 4: Wellbeing & Vitality
  let upbeatCount = 0;
  let calmCount = 0;
  let strainedCount = 0;
  const moodCells: PictogramCell[] = world.agents.map((ag) => {
    const tone = getAgentMoodTone(ag);
    if (tone === 'emerald') upbeatCount += 1;
    else if (tone === 'amber') calmCount += 1;
    else strainedCount += 1;
    return {
      agentId: ag.id,
      name: ag.name,
      shortName: shortName(ag.name),
      occupation: ag.occupation,
      bucket: tone === 'emerald' ? 'Thriving' : tone === 'amber' ? 'Steady' : 'Strained',
      tone,
      detail: `Mood ${ag.mood.valence >= 0 ? '+' : ''}${ag.mood.valence.toFixed(2)} · Hunger ${Math.round(ag.drives.hunger)}% · Energy ${Math.round(ag.drives.energy)}%`,
    };
  });
  rows.push({
    id: 'pictogram_wellbeing',
    title: 'Wellbeing & Vitality',
    ratioLabel: `${upbeatCount} of ${total} thriving`,
    subtitle: `${calmCount} steady · ${strainedCount} strained, hungry, or unwell`,
    cells: moodCells,
    legend: [
      { label: 'Thriving', count: upbeatCount, tone: 'emerald' },
      { label: 'Steady', count: calmCount, tone: 'amber' },
      { label: 'Strained', count: strainedCount, tone: 'rose' },
    ],
  });

  return rows;
}

export function computeTownAdvisors(world: WorldState): TownAdvisorBrief[] {
  const agents = world.agents;
  const total = Math.max(1, agents.length);
  const businesses = Object.values(world.businesses ?? {});

  // 1. Economy Advisor
  const wallets = agents.map((a) => a.wallet ?? 0);
  const avgWallet = Math.round(wallets.reduce((s, w) => s + w, 0) / total);
  const tightAgents = agents.filter((a) => (a.wallet ?? 0) < 75);
  const tightestAgent = [...agents].sort((a, b) => (a.wallet ?? 0) - (b.wallet ?? 0))[0];
  const topBiz = [...businesses].sort((a, b) => b.treasury - a.treasury)[0];
  const lowBiz = [...businesses].sort((a, b) => a.treasury - b.treasury)[0];
  const activeLoans = (world.loans ?? []).filter((l) => l.status === 'active').length;
  const activeVentures = (world.ventures ?? []).filter((v) => v.active).length;

  const econStatus: TownAdvisorBrief['status'] =
    tightAgents.length >= Math.ceil(total * 0.28) || (world.townTreasury ?? 0) < 180
      ? 'alert'
      : tightAgents.length > 0 || (lowBiz && lowBiz.treasury < 150)
        ? 'watch'
        : 'healthy';

  const economyAdvisor: TownAdvisorBrief = {
    id: 'economy',
    role: 'Treasury & Trade',
    title: 'Economic Advisor',
    status: econStatus,
    headlineMetric: `$${Math.round(world.townTreasury ?? 0)} Treasury`,
    bullets: [
      `Average resident savings sit at $${avgWallet}; ${tightAgents.length} of ${agents.length} hold under $75.`,
      topBiz
        ? `${topBiz.name} leads commercial reserves at $${Math.round(topBiz.treasury)} (${activeVentures} pop-up venture${activeVentures === 1 ? '' : 's'}, ${activeLoans} active loan${activeLoans === 1 ? '' : 's'}).`
        : `${activeVentures} active micro-ventures and ${activeLoans} peer loans circulating.`,
    ],
    action: tightAgents.length > 0 && tightestAgent
      ? {
          label: `Inspect ${shortName(tightestAgent.name)} ($${Math.round(tightestAgent.wallet ?? 0)})`,
          lens: 'wealth',
          focusAgentId: tightestAgent.id,
        }
      : {
          label: topBiz ? `Inspect ${topBiz.name}` : 'Open Wealth Lens',
          lens: 'wealth',
          focusLocationId: topBiz?.locationId,
        },
  };

  // 2. Civic Advisor
  const openProps = (world.proposals ?? []).filter((p) => p.status === 'open');
  const passedProps = (world.proposals ?? []).filter((p) => p.status === 'passed');
  const topProp = getActiveProposal(world);
  const quorum = Math.max(4, Math.ceil(agents.length * 0.25));
  const townHall = world.locations.find((l) => l.category === 'civic');
  const election = world.election;

  const civicStatus: TownAdvisorBrief['status'] =
    election?.status === 'voting'
      ? 'alert'
      : openProps.length > 0
        ? 'watch'
        : 'healthy';

  const civicAdvisor: TownAdvisorBrief = {
    id: 'civic',
    role: 'Town Council',
    title: 'Civic Advisor',
    status: civicStatus,
    headlineMetric:
      election?.status === 'voting'
        ? `Polls Open (${election.votersCast.length}/${agents.length})`
        : `${openProps.length} Open · ${passedProps.length} Passed`,
    bullets: [
      topProp
        ? `"${topProp.title}" stands at ${topProp.votesFor.length} For / ${topProp.votesAgainst.length} Against (quorum ${quorum}, cost $${topProp.cost}).`
        : 'No pending municipal proposals on the floor right now.',
      election
        ? `Mayoral race (${election.status}) has ${election.candidates.length} candidate${election.candidates.length === 1 ? '' : 's'} with Day ${election.electionDay} vote.`
        : `${(world.petitions ?? []).filter((p) => p.status === 'gathering').length} grassroots petition(s) gathering signatures.`,
    ],
    action: {
      label: townHall ? `Inspect ${townHall.shortName}` : 'Open Civic Lens',
      lens: 'civic',
      focusLocationId: townHall?.id,
    },
  };

  // 3. Social & Wellbeing Advisor
  const strainedAgents = agents.filter((a) => getAgentMoodTone(a) === 'rose');
  const sickAgents = agents.filter((a) => a.illness && a.illness !== 'none');
  const topMeme = getActiveMeme(world);
  const topMemeReach = topMeme ? Object.keys(topMeme.knownBy).length : 0;
  const clinic = world.locations.find((l) => l.id === 'smallville_clinic');

  // Identify most strained or lowest-trust pair
  let lowestTrustPair: { a: AgentState; bName: string; trust: number } | null = null;
  for (const ag of agents) {
    for (const [targetId, edge] of Object.entries(ag.socialGraph)) {
      if (!lowestTrustPair || edge.trust < lowestTrustPair.trust) {
        const bName = agents.find((x) => x.id === targetId)?.name ?? targetId;
        lowestTrustPair = { a: ag, bName, trust: edge.trust };
      }
    }
  }

  const socialStatus: TownAdvisorBrief['status'] =
    sickAgents.length >= 2 || strainedAgents.length >= Math.ceil(total * 0.35)
      ? 'alert'
      : strainedAgents.length > 0 || (lowestTrustPair && lowestTrustPair.trust < 32)
        ? 'watch'
        : 'healthy';

  const socialAdvisor: TownAdvisorBrief = {
    id: 'social',
    role: 'Community & Health',
    title: 'Social Advisor',
    status: socialStatus,
    headlineMetric: `${strainedAgents.length} Strained · ${sickAgents.length} Ill`,
    bullets: [
      topMeme
        ? `Top rumor "${topMeme.topic.slice(0, 44)}${topMeme.topic.length > 44 ? '…' : ''}" reached ${topMemeReach}/${agents.length} residents.`
        : 'Town rumor mill is currently quiet.',
      lowestTrustPair && lowestTrustPair.trust < 40
        ? `Sharpest friction: ${shortName(lowestTrustPair.a.name)} -> ${shortName(lowestTrustPair.bName)} (trust ${Math.round(lowestTrustPair.trust)}).`
        : `${world.conversations.length} conversations logged across ${agents.length} residents.`,
    ],
    action:
      sickAgents.length > 0 && clinic
        ? {
            label: `Inspect ${clinic.shortName}`,
            lens: 'mood',
            focusLocationId: clinic.id,
          }
        : lowestTrustPair && lowestTrustPair.trust < 40
          ? {
              label: `Inspect ${shortName(lowestTrustPair.a.name)}'s Ties`,
              lens: 'trust',
              focusAgentId: lowestTrustPair.a.id,
            }
          : {
              label: 'Inspect Rumor Spread',
              lens: 'meme',
              focusAgentId: topMeme?.originAgentId,
            },
  };

  return [economyAdvisor, civicAdvisor, socialAdvisor];
}

function readExplorerMetric(agent: AgentState, metric: ExplorerMetricId): number {
  switch (metric) {
    case 'wallet':
      return agent.wallet ?? 0;
    case 'avgTrust':
      return getAgentAvgTrust(agent);
    case 'reputation':
      return agent.reputation ?? 55;
    case 'moodValence':
      return agent.mood.valence;
    case 'energy':
      return agent.drives.energy;
    case 'hunger':
      return agent.drives.hunger;
    case 'memoryCount':
      return agent.memories.length;
    case 'skillsAvg':
      return getAgentSkillsAvg(agent);
  }
}

export function computeExplorerPoints(
  world: WorldState,
  xMetricId: ExplorerMetricId,
  yMetricId: ExplorerMetricId,
): ExplorerDataset {
  const xMetric = EXPLORER_METRICS.find((m) => m.id === xMetricId) ?? EXPLORER_METRICS[0];
  const yMetric = EXPLORER_METRICS.find((m) => m.id === yMetricId) ?? EXPLORER_METRICS[1];

  const locNameById = new Map(world.locations.map((l) => [l.id, l.shortName]));
  const raw = world.agents.map((ag) => ({
    ag,
    xVal: readExplorerMetric(ag, xMetric.id),
    yVal: readExplorerMetric(ag, yMetric.id),
  }));

  const xVals = raw.map((r) => r.xVal);
  const yVals = raw.map((r) => r.yVal);
  const xMin = xVals.length > 0 ? Math.min(...xVals) : 0;
  const xMax = xVals.length > 0 ? Math.max(...xVals) : 100;
  const yMin = yVals.length > 0 ? Math.min(...yVals) : 0;
  const yMax = yVals.length > 0 ? Math.max(...yVals) : 100;
  const xSpan = Math.max(0.001, xMax - xMin);
  const ySpan = Math.max(0.001, yMax - yMin);

  const points: ExplorerPoint[] = raw.map(({ ag, xVal, yVal }) => ({
    agentId: ag.id,
    name: ag.name,
    shortName: shortName(ag.name),
    occupation: ag.occupation,
    locationId: ag.currentLocationId ?? null,
    locationName: ag.currentLocationId
      ? locNameById.get(ag.currentLocationId) ?? ag.currentLocationId
      : 'Outdoors',
    xVal,
    yVal,
    xNorm: xMax === xMin ? 0.5 : (xVal - xMin) / xSpan,
    yNorm: yMax === yMin ? 0.5 : (yVal - yMin) / ySpan,
    colorHex: ag.appearance?.shirt || '#2D6A4F',
    wallet: Math.round(ag.wallet ?? 0),
    avgTrust: Math.round(getAgentAvgTrust(ag)),
    moodValence: ag.mood.valence,
  }));

  return {
    xMetric,
    yMetric,
    xMin,
    xMax,
    yMin,
    yMax,
    points,
  };
}
