/**
 * Phases G & H — Emergent Bilateral Contracts (Loans & Defaults), Grassroots Petitions,
 * Resident-Founded Micro-Ventures, Housing/Rent Mobility, Household Partnerships,
 * Career Ladders & Ambient Temperament Surrogates.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { attachAssociativeLinks, upsertBelief } from './cognitiveDepth';
import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { createServiceContract, joinCivicCoalition } from './powerAndInstitutions';
import { applyEmotionalAppraisal } from './psychology';
import { createCivicProposal, postPublicNotice } from './socialFabric';
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type CareerTier,
  type ChronicleEvent,
  type CitizenPetition,
  type EconomicTransaction,
  type HousingStatus,
  type ItemKind,
  type LoanContract,
  type LocationZone,
  type MicroVenture,
  type NegotiatedDeal,
  type TownModifierKey,
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

const HOME_OWNER_IDS = new Set([
  'isabella',
  'john',
  'mei',
  'sam',
  'arthur',
  'elena',
  'mateo',
  'devon',
  'priya',
  'clara',
]);

const SHARED_HOUSING_LOCATIONS = ['moore_cottages', 'artist_cottages', 'lin_home'] as const;

export function inferCareerTier(agent: Pick<AgentState, 'skills' | 'age' | 'wagePerHour'>): CareerTier {
  const maxSkill = Math.max(0, ...Object.values(agent.skills ?? {}));
  if (maxSkill >= 88 || (agent.age >= 45 && (agent.wagePerHour ?? 0) >= 20)) return 'master';
  if (maxSkill >= 72 || agent.age >= 34) return 'senior';
  if (maxSkill >= 50 || agent.age >= 25) return 'practitioner';
  return 'apprentice';
}

/**
 * Hydrates initial housing tenure, rent, household partner ties, and career tier across residents.
 */
export function hydrateHousingAndCareers(
  agents: AgentState[],
  locations: readonly LocationZone[],
): AgentState[] {
  const locById = new Map(locations.map((l) => [l.id, l]));
  return agents.map((ag) => {
    const isOwner = !ag.isProcedural && HOME_OWNER_IDS.has(ag.id);
    const housingStatus: HousingStatus =
      ag.housingStatus ?? (isOwner ? 'owner' : ag.isProcedural ? 'shared' : 'renter');
    const homeLoc = locById.get(ag.homeLocationId);
    const defaultRent =
      housingStatus === 'owner'
        ? 0
        : housingStatus === 'shared'
          ? 24
          : homeLoc?.district === 'Main Street'
            ? 42
            : 34;

    // Seed obvious family/housemate partnerships from same homeLocationId when high familiarity
    let partners = ag.householdPartnerIds;
    if (!partners) {
      partners = agents
        .filter(
          (other) =>
            other.id !== ag.id &&
            other.homeLocationId === ag.homeLocationId &&
            (ag.socialGraph[other.id]?.trust ?? 0) >= 65,
        )
        .slice(0, 2)
        .map((o) => o.id);
    }

    return {
      ...ag,
      housingStatus,
      monthlyRent: ag.monthlyRent ?? defaultRent,
      householdPartnerIds: partners,
      careerTier: ag.careerTier ?? inferCareerTier(ag),
      promotionsCount: ag.promotionsCount ?? 0,
    };
  });
}

/**
 * Seeds initial grassroots petitions awaiting resident signatures before hitting the civic ballot.
 */
export function createInitialPetitions(
  agents: readonly AgentState[],
  simMinutes: number,
): CitizenPetition[] {
  const clinicSponsor = agents.find((a) => a.id === 'elena') ?? agents[0];
  const marketSponsor = agents.find((a) => a.id === 'priya') ?? agents[Math.min(1, agents.length - 1)];
  const target = Math.max(4, Math.min(8, Math.ceil(agents.length * 0.25)));
  const petitions: CitizenPetition[] = [];

  if (clinicSponsor) {
    petitions.push({
      id: 'pet_clinic_fund',
      title: 'Community Clinic Access Petition',
      description:
        'Halves clinic visit fees for all residents and guarantees medicine reserves during seasonal colds.',
      effectKey: 'communityClinic',
      sponsorId: clinicSponsor.id,
      sponsorName: clinicSponsor.name,
      signerIds: [clinicSponsor.id],
      targetSignatures: target,
      status: 'gathering',
      createdAt: simMinutes,
    });
  }

  if (marketSponsor) {
    petitions.push({
      id: 'pet_produce_coop',
      title: 'Local Produce Stipend Petition',
      description:
        'Stabilizes staple grocery and produce prices so low-cash households are protected from inflation.',
      effectKey: 'marketStipend',
      sponsorId: marketSponsor.id,
      sponsorName: marketSponsor.name,
      signerIds: [marketSponsor.id],
      targetSignatures: target,
      status: 'gathering',
      createdAt: simMinutes,
    });
  }

  return petitions;
}

/**
 * Phase G: Bilateral Peer Loan Negotiation & Issuance (hard ledger + trust & risk gating).
 */
export function issueBilateralLoan(
  world: WorldState,
  lenderId: string,
  borrowerId: string,
  principalRaw: number,
  durationDays = 3,
  allocId: (prefix: string) => string,
  bypassTrustGate = false,
): { world: WorldState; ok: boolean; reason: string; loan?: LoanContract } {
  if (lenderId === borrowerId) {
    return { world, ok: false, reason: 'Cannot lend to self' };
  }
  const lender = world.agents.find((a) => a.id === lenderId);
  const borrower = world.agents.find((a) => a.id === borrowerId);
  if (!lender || !borrower) {
    return { world, ok: false, reason: 'Unknown lender or borrower' };
  }

  const principal = Math.max(20, Math.min(150, Math.round(principalRaw)));
  const lenderWallet = lender.wallet ?? 0;
  if (lenderWallet < principal + 60) {
    return { world, ok: false, reason: `${lender.name} lacks spare liquidity to lend $${principal}` };
  }

  // Prevent duplicate active loans between the same pair
  const alreadyActive = (world.loans ?? []).some(
    (l) => l.status === 'active' && l.lenderId === lenderId && l.borrowerId === borrowerId,
  );
  if (alreadyActive) {
    return { world, ok: false, reason: 'An active loan already exists between these residents' };
  }

  // Trust & temperament risk gate: frugal/stubborn lenders refuse untrusted borrowers!
  const edge = lender.socialGraph[borrowerId];
  const trust = edge?.trust ?? 40;
  const riskTol = lender.temperament?.riskTolerance ?? 0.5;
  const posture = lender.dossier?.financialPosture ?? 'balanced';
  const minTrustNeeded = posture === 'frugal' ? 58 : posture === 'anxious' ? 62 : 42 - riskTol * 15;
  const hasPriorDefault = (world.loans ?? []).some(
    (l) => l.borrowerId === borrowerId && l.status === 'defaulted',
  );

  if (!bypassTrustGate && (hasPriorDefault || trust < minTrustNeeded)) {
    const refusalMem = createMemoryNode({
      id: allocId(`mem_loan_ref_${lenderId}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'contract',
      description: `${lender.name} declined ${borrower.name}'s request for a $${principal} loan due to credit/trust caution.`,
      importance: 6,
    });
    const nextAgents = world.agents.map((ag) =>
      ag.id === lenderId || ag.id === borrowerId
        ? {
            ...ag,
            memories: addLinkedMemory(ag, refusalMem, world.simMinutes, allocId),
          }
        : ag,
    );
    return {
      world: {
        ...world,
        agents: nextAgents,
        stats: {
          ...world.stats,
          refusalsAndDisagreements: (world.stats.refusalsAndDisagreements ?? 0) + 1,
        },
      },
      ok: false,
      reason: `${lender.name} refused the $${principal} loan (trust ${Math.round(trust)} < ${Math.round(minTrustNeeded)} or prior default)`,
    };
  }

  const day = formatSimTime(world.simMinutes).day;
  const interestPct = posture === 'frugal' ? 12 : trust >= 75 ? 5 : 8;
  const amountDue = Math.round(principal * (1 + interestPct / 100));
  const loan: LoanContract = {
    id: allocId('loan'),
    lenderId,
    borrowerId,
    principal,
    interestPct,
    amountDue,
    issuedDay: day,
    dueDay: day + Math.max(1, durationDays),
    status: 'active',
  };

  const lenderMem = createMemoryNode({
    id: allocId(`mem_lent_${lenderId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'contract',
    description: `${lender.name} lent $${principal} to ${borrower.name} at ${interestPct}% interest ($${amountDue} due Day ${loan.dueDay}).`,
    importance: 7,
  });
  const borrowerMem = createMemoryNode({
    id: allocId(`mem_borr_${borrowerId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'contract',
    description: `${borrower.name} borrowed $${principal} from ${lender.name} ($${amountDue} due Day ${loan.dueDay}).`,
    importance: 7,
  });

  let beliefRevDelta = 0;
  const nextAgents = world.agents.map((ag) => {
    if (ag.id === lenderId) {
      const bRes = upsertBelief(
        ag.beliefs,
        {
          subjectId: borrowerId,
          predicate: 'obligation',
          claim: `${borrower.name} owes me $${amountDue} by Day ${loan.dueDay}.`,
          confidence: 0.95,
          sourceMemoryId: lenderMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (bRes.revised) beliefRevDelta += 1;
      return {
        ...ag,
        wallet: Number((lenderWallet - principal).toFixed(2)),
        beliefs: bRes.beliefs,
        memories: addLinkedMemory(ag, lenderMem, world.simMinutes, allocId),
      };
    }
    if (ag.id === borrowerId) {
      const bRes = upsertBelief(
        ag.beliefs,
        {
          subjectId: lenderId,
          predicate: 'obligation',
          claim: `I must repay $${amountDue} to ${lender.name} by Day ${loan.dueDay}.`,
          confidence: 0.95,
          sourceMemoryId: borrowerMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (bRes.revised) beliefRevDelta += 1;
      return {
        ...ag,
        wallet: Number(((ag.wallet ?? 0) + principal).toFixed(2)),
        beliefs: bRes.beliefs,
        memories: addLinkedMemory(ag, borrowerMem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  const tx: EconomicTransaction = {
    id: allocId('tx_loan'),
    simMinutes: world.simMinutes,
    kind: 'loan',
    fromId: lenderId,
    toId: borrowerId,
    amount: principal,
    note: `Bilateral loan: ${lender.name.split(' ')[0]} lent $${principal} to ${borrower.name.split(' ')[0]} (due D${loan.dueDay})`,
  };

  const chr: ChronicleEvent = {
    id: allocId('chr_loan'),
    simMinutes: world.simMinutes,
    type: 'economy',
    title: `${lender.name} extended a $${principal} loan to ${borrower.name}`,
    detail: `Repayment of $${amountDue} (${interestPct}% interest) scheduled for Day ${loan.dueDay}.`,
    agentIds: [lenderId, borrowerId],
  };

  return {
    world: {
      ...world,
      agents: nextAgents,
      loans: [loan, ...(world.loans ?? [])].slice(0, 60),
      transactions: [tx, ...(world.transactions ?? [])].slice(0, 140),
      chronicle: [chr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
        totalTradeVolume: Number(((world.stats.totalTradeVolume ?? 0) + principal).toFixed(2)),
        loansIssued: (world.stats.loansIssued ?? 0) + 1,
        beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevDelta,
      },
    },
    ok: true,
    reason: 'Loan issued',
    loan,
  };
}

/**
 * Settles maturing loans at daily rollover: repays if solvent, or triggers formal default
 * with trust collapse, bi-temporal belief superseding, and reputation penalty.
 */
export function settleMaturingLoans(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): { world: WorldState; repaid: number; defaulted: number } {
  const loans = world.loans ?? [];
  const maturing = loans.filter((l) => l.status === 'active' && currentDay >= l.dueDay);
  if (maturing.length === 0) return { world, repaid: 0, defaulted: 0 };

  let nextAgents = [...world.agents];
  const nextLoans = [...loans];
  const newTx: EconomicTransaction[] = [];
  const newChr: ChronicleEvent[] = [];
  let repaid = 0;
  let defaulted = 0;
  let beliefRevs = 0;

  for (const loan of maturing) {
    const lenderIdx = nextAgents.findIndex((a) => a.id === loan.lenderId);
    const borrowerIdx = nextAgents.findIndex((a) => a.id === loan.borrowerId);
    if (lenderIdx < 0 || borrowerIdx < 0) continue;

    const lender = nextAgents[lenderIdx];
    const borrower = nextAgents[borrowerIdx];
    const borrowerWallet = borrower.wallet ?? 0;
    const loanIdx = nextLoans.findIndex((l) => l.id === loan.id);

    if (borrowerWallet >= loan.amountDue) {
      // Full repayment -> trust boost + supersede obligation belief!
      const repayMem = createMemoryNode({
        id: allocId(`mem_repay_${loan.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'contract',
        description: `${borrower.name} repaid $${loan.amountDue} in full to ${lender.name} on Day ${currentDay}.`,
        importance: 7,
      });

      const lenderBelief = upsertBelief(
        lender.beliefs,
        {
          subjectId: borrower.id,
          predicate: 'obligation',
          claim: `${borrower.name} repaid their $${loan.amountDue} loan reliably on time.`,
          confidence: 0.95,
          sourceMemoryId: repayMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (lenderBelief.revised) beliefRevs += 1;

      const borrowerBelief = upsertBelief(
        borrower.beliefs,
        {
          subjectId: lender.id,
          predicate: 'obligation',
          claim: `Debt to ${lender.name} is fully settled.`,
          confidence: 0.95,
          sourceMemoryId: repayMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (borrowerBelief.revised) beliefRevs += 1;

      const prevEdge = lender.socialGraph[borrower.id];
      const nextLenderGraph = {
        ...lender.socialGraph,
        [borrower.id]: prevEdge
          ? {
              ...prevEdge,
              trust: clamp(prevEdge.trust + 10, -100, 100),
              affection: clamp(prevEdge.affection + 5, -100, 100),
              lastUpdatedSimMin: world.simMinutes,
            }
          : {
              targetId: borrower.id,
              roleLabel: 'Reliable borrower',
              trust: 72,
              affection: 58,
              familiarity: 40,
              inferredGoal: 'Honoring financial commitments',
              lastUpdatedSimMin: world.simMinutes,
            },
      };

      nextAgents[lenderIdx] = {
        ...lender,
        wallet: Number(((lender.wallet ?? 0) + loan.amountDue).toFixed(2)),
        socialGraph: nextLenderGraph,
        beliefs: lenderBelief.beliefs,
        memories: addLinkedMemory(lender, repayMem, world.simMinutes, allocId),
      };
      nextAgents[borrowerIdx] = {
        ...borrower,
        wallet: Number((borrowerWallet - loan.amountDue).toFixed(2)),
        reputation: clamp((borrower.reputation ?? 55) + 5, -100, 100),
        beliefs: borrowerBelief.beliefs,
        memories: addLinkedMemory(borrower, repayMem, world.simMinutes, allocId),
      };
      if (loanIdx >= 0) {
        nextLoans[loanIdx] = { ...loan, status: 'repaid', resolvedDay: currentDay };
      }
      newTx.push({
        id: allocId('tx_repay'),
        simMinutes: world.simMinutes,
        kind: 'repayment',
        fromId: borrower.id,
        toId: lender.id,
        amount: loan.amountDue,
        note: `${borrower.name.split(' ')[0]} repaid $${loan.amountDue} loan to ${lender.name.split(' ')[0]}`,
      });
      newChr.push({
        id: allocId('chr_repay'),
        simMinutes: world.simMinutes,
        type: 'economy',
        title: `${borrower.name} repaid $${loan.amountDue} loan to ${lender.name}`,
        detail: `Timely repayment raised mutual trust and credit standing.`,
        agentIds: [borrower.id, lender.id],
      });
      repaid += 1;
    } else {
      // Loan Default -> durable grudge, trust slash, belief superseding, reputation hit!
      const defMem = createMemoryNode({
        id: allocId(`mem_def_${loan.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'contract',
        description: `${borrower.name} defaulted on a $${loan.amountDue} loan owed to ${lender.name} on Day ${currentDay}.`,
        importance: 9,
      });

      let lenderBeliefs = lender.beliefs;
      const b1 = upsertBelief(
        lenderBeliefs,
        {
          subjectId: borrower.id,
          predicate: 'trustworthiness',
          claim: `${borrower.name} broke their word and defaulted on $${loan.amountDue} — do not lend again.`,
          confidence: 0.96,
          sourceMemoryId: defMem.id,
        },
        world.simMinutes,
        allocId,
      );
      lenderBeliefs = b1.beliefs;
      if (b1.revised) beliefRevs += 1;

      const b2 = upsertBelief(
        lenderBeliefs,
        {
          subjectId: borrower.id,
          predicate: 'obligation',
          claim: `${borrower.name} defaulted on $${loan.amountDue} on Day ${currentDay}.`,
          confidence: 0.98,
          sourceMemoryId: defMem.id,
        },
        world.simMinutes,
        allocId,
      );
      lenderBeliefs = b2.beliefs;
      if (b2.revised) beliefRevs += 1;

      const prevEdge = lender.socialGraph[borrower.id];
      const nextLenderGraph = {
        ...lender.socialGraph,
        [borrower.id]: prevEdge
          ? {
              ...prevEdge,
              trust: clamp(prevEdge.trust - 32, -100, 100),
              affection: clamp(prevEdge.affection - 18, -100, 100),
              inferredGoal: 'Struggling with unpaid debts',
              lastUpdatedSimMin: world.simMinutes,
            }
          : {
              targetId: borrower.id,
              roleLabel: 'Defaulted borrower',
              trust: 12,
              affection: 22,
              familiarity: 45,
              inferredGoal: 'Struggling with unpaid debts',
              lastUpdatedSimMin: world.simMinutes,
            },
      };

      nextAgents[lenderIdx] = {
        ...lender,
        mood: applyEmotionalAppraisal(lender.mood, lender.drives, -0.22, 0.15),
        socialGraph: nextLenderGraph,
        beliefs: lenderBeliefs,
        memories: addLinkedMemory(lender, defMem, world.simMinutes, allocId),
      };
      nextAgents[borrowerIdx] = {
        ...borrower,
        reputation: clamp((borrower.reputation ?? 55) - 14, -100, 100),
        mood: applyEmotionalAppraisal(borrower.mood, borrower.drives, -0.25, 0.12),
        memories: addLinkedMemory(borrower, defMem, world.simMinutes, allocId),
      };
      if (loanIdx >= 0) {
        nextLoans[loanIdx] = { ...loan, status: 'defaulted', resolvedDay: currentDay };
      }
      newChr.push({
        id: allocId('chr_default'),
        simMinutes: world.simMinutes,
        type: 'economy',
        title: `${borrower.name} defaulted on $${loan.amountDue} loan from ${lender.name}`,
        detail: `Trust dropped sharply and ${borrower.name}'s community credit standing fell.`,
        agentIds: [borrower.id, lender.id],
      });
      defaulted += 1;
    }
  }

  return {
    world: {
      ...world,
      agents: nextAgents,
      loans: nextLoans,
      transactions: [...newTx, ...(world.transactions ?? [])].slice(0, 140),
      chronicle: [...newChr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        loansRepaid: (world.stats.loansRepaid ?? 0) + repaid,
        loansDefaulted: (world.stats.loansDefaulted ?? 0) + defaulted,
        beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevs,
      },
    },
    repaid,
    defaulted,
  };
}

/**
 * Phase G: Grassroots Citizen Petitions — worldview + stubbornness + sponsor-trust gated.
 * Fiscal conservatives push back against costly subsidies; reaching quorum escalates to a real CivicProposal!
 */
export function signCitizenPetition(
  world: WorldState,
  agentId: string,
  petitionId: string,
  allocId: (prefix: string) => string,
  forceSign = false,
): { world: WorldState; signed: boolean; escalated: boolean; reason: string } {
  const petitions = world.petitions ?? [];
  const idx = petitions.findIndex((p) => p.id === petitionId);
  if (idx < 0) return { world, signed: false, escalated: false, reason: 'Petition not found' };

  const pet = petitions[idx];
  if (pet.status !== 'gathering') {
    return { world, signed: false, escalated: false, reason: 'Petition is no longer gathering signatures' };
  }
  if (pet.signerIds.includes(agentId)) {
    return { world, signed: false, escalated: false, reason: 'Already signed' };
  }

  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return { world, signed: false, escalated: false, reason: 'Unknown resident' };

  if (!forceSign) {
    const worldview = agent.dossier?.civicWorldview ?? 'pragmatist';
    const stubbornness = agent.temperament?.stubbornness ?? 0.55;
    const sponsorTrust = agent.socialGraph[pet.sponsorId]?.trust ?? 48;

    let affinity = (sponsorTrust - 45) / 100;
    if (pet.effectKey === 'communityClinic' || pet.effectKey === 'marketStipend') {
      if (worldview === 'communitarian' || worldview === 'reformist') affinity += 0.35;
      if (worldview === 'fiscal_conservative') affinity -= 0.35 + stubbornness * 0.2;
    } else if (pet.effectKey === 'streetLighting') {
      if (worldview === 'fiscal_conservative' || worldview === 'pragmatist') affinity += 0.25;
    } else if (pet.effectKey === 'extendedLibrary') {
      if (worldview === 'communitarian' || worldview === 'reformist') affinity += 0.28;
      if (worldview === 'fiscal_conservative') affinity -= 0.18;
    }
    if ((agent.wallet ?? 120) < 90 && (pet.effectKey === 'marketStipend' || pet.effectKey === 'communityClinic')) {
      affinity += 0.25;
    }

    if (affinity < 0.05) {
      return {
        world: {
          ...world,
          stats: {
            ...world.stats,
            refusalsAndDisagreements: (world.stats.refusalsAndDisagreements ?? 0) + 1,
          },
        },
        signed: false,
        escalated: false,
        reason: `${agent.name} declined to sign (${worldview})`,
      };
    }
  }

  const nextSigners = [...pet.signerIds, agentId];
  const reachedQuorum = nextSigners.length >= pet.targetSignatures;
  const nextPetitions = [...petitions];

  const signMem = createMemoryNode({
    id: allocId(`mem_pet_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: `${agent.name} signed the "${pet.title}" (${nextSigners.length}/${pet.targetSignatures} signatures).`,
    importance: 6,
  });

  let nextWorld: WorldState = {
    ...world,
    agents: world.agents.map((a) =>
      a.id === agentId
        ? { ...a, memories: addLinkedMemory(a, signMem, world.simMinutes, allocId) }
        : a,
    ),
  };

  if (reachedQuorum) {
    const costByEffect: Record<TownModifierKey, number> = {
      streetLighting: 140,
      marketStipend: 160,
      extendedLibrary: 110,
      communityClinic: 150,
    };
    const alreadyOpen = (nextWorld.proposals ?? []).some(
      (p) => p.effectKey === pet.effectKey && p.status === 'open',
    );
    let escalatedProposalId: string | undefined;
    if (!alreadyOpen) {
      nextWorld = createCivicProposal(
        nextWorld,
        {
          proposerId: pet.sponsorId,
          proposerName: `${pet.sponsorName} (${nextSigners.length}-signer coalition)`,
          title: pet.title.replace(/\s*Petition$/i, ''),
          description: pet.description,
          cost: costByEffect[pet.effectKey],
          effectKey: pet.effectKey,
        },
        allocId,
      );
      escalatedProposalId = nextWorld.proposals?.[0]?.id;
    }
    nextPetitions[idx] = {
      ...pet,
      signerIds: nextSigners,
      status: 'escalated',
      escalatedProposalId,
    };
    nextWorld = {
      ...nextWorld,
      petitions: nextPetitions,
      stats: {
        ...nextWorld.stats,
        petitionsEscalated: (nextWorld.stats.petitionsEscalated ?? 0) + 1,
      },
      chronicle: [
        {
          id: allocId('chr_pet_esc'),
          simMinutes: world.simMinutes,
          type: 'civic' as const,
          title: `"${pet.title}" reached quorum and entered Town Hall ballot`,
          detail: `${nextSigners.length} residents co-signed to advance this policy onto the official civic docket.`,
          agentIds: nextSigners.slice(0, 5),
          locationName: 'Town Hall & Gazette',
        },
        ...nextWorld.chronicle,
      ].slice(0, 140),
    };
    return { world: nextWorld, signed: true, escalated: true, reason: 'Petition escalated to ballot' };
  }

  nextPetitions[idx] = { ...pet, signerIds: nextSigners };
  return {
    world: { ...nextWorld, petitions: nextPetitions },
    signed: true,
    escalated: false,
    reason: 'Petition signed',
  };
}

/**
 * Phase G: Resident-Founded Micro-Ventures — entrepreneurial citizens launch pop-up stalls
 * when capitalized & ambitious, introducing real competition into the town economy.
 */
const VENTURE_BLUEPRINTS: Array<{
  locationId: string;
  itemKind: ItemKind;
  unitPrice: number;
  titleSuffix: string;
}> = [
  { locationId: 'johnson_park', itemKind: 'coffee', unitPrice: 4, titleSuffix: 'Park Espresso Cart' },
  { locationId: 'community_garden', itemKind: 'produce', unitPrice: 6, titleSuffix: 'Heirloom Greens Stand' },
  { locationId: 'artist_cottages', itemKind: 'craft_goods', unitPrice: 14, titleSuffix: 'Print & Craft Stall' },
  { locationId: 'town_hall', itemKind: 'pastry', unitPrice: 5, titleSuffix: 'Morning Tart Table' },
  { locationId: 'harvey_library', itemKind: 'book', unitPrice: 11, titleSuffix: 'Used Book Kiosk' },
];

export interface LaunchVentureOptions {
  name?: string;
  locationId?: string;
  itemKind?: ItemKind;
  unitPrice?: number;
}

const DEFAULT_PRICE_BY_ITEM: Record<ItemKind, number> = {
  coffee: 4,
  pastry: 5,
  bread: 6,
  meal: 10,
  groceries: 9,
  produce: 6,
  medicine: 12,
  craft_goods: 14,
  book: 11,
  flowers: 8,
  drink: 7,
};

export function launchMicroVenture(
  world: WorldState,
  founderId: string,
  allocId: (prefix: string) => string,
  nameOrOptions?: string | LaunchVentureOptions,
): { world: WorldState; ok: boolean; reason: string; venture?: MicroVenture } {
  const founder = world.agents.find((a) => a.id === founderId);
  if (!founder) return { world, ok: false, reason: 'Unknown founder' };

  const existing = (world.ventures ?? []).find((v) => v.founderId === founderId && v.active);
  if (existing) {
    return { world, ok: false, reason: `${founder.name} already runs an active micro-venture` };
  }

  const startupCost = 90;
  if ((founder.wallet ?? 0) < startupCost + 35) {
    return { world, ok: false, reason: `${founder.name} needs at least $${startupCost + 35} to launch a venture` };
  }

  const opts: LaunchVentureOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions ?? {});

  const bpIndex =
    Math.abs(founderId.split('').reduce((s, c) => s + c.charCodeAt(0), 0)) %
    VENTURE_BLUEPRINTS.length;
  const bp = VENTURE_BLUEPRINTS[bpIndex];
  const chosenLocId =
    opts.locationId && world.locations.some((l) => l.id === opts.locationId)
      ? opts.locationId
      : bp.locationId;
  const chosenItem: ItemKind = opts.itemKind ?? bp.itemKind;
  const chosenPrice =
    typeof opts.unitPrice === 'number' && Number.isFinite(opts.unitPrice)
      ? Math.max(2, Math.min(40, Math.round(opts.unitPrice)))
      : opts.itemKind
        ? DEFAULT_PRICE_BY_ITEM[opts.itemKind] ?? bp.unitPrice
        : bp.unitPrice;
  const day = formatSimTime(world.simMinutes).day;
  const firstName = founder.name.split(' ')[0];
  const name = opts.name?.trim() || `${firstName}'s ${bp.titleSuffix}`;

  const venture: MicroVenture = {
    id: allocId('vent'),
    founderId,
    founderName: founder.name,
    name,
    locationId: chosenLocId,
    itemKind: chosenItem,
    unitPrice: chosenPrice,
    stock: 8,
    revenue: 0,
    openedDay: day,
    active: true,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_vent_${founderId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'venture',
    description: `${founder.name} invested $${startupCost} to launch "${name}", selling ${chosenItem.replace('_', ' ')} at $${chosenPrice}.`,
    importance: 8,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== founderId) return ag;
    const bRes = upsertBelief(
      ag.beliefs,
      {
        subjectId: venture.id,
        predicate: 'world_fact',
        claim: `I founded "${name}" to build independent income selling ${chosenItem.replace('_', ' ')}.`,
        confidence: 0.95,
        sourceMemoryId: mem.id,
      },
      world.simMinutes,
      allocId,
    );
    return {
      ...ag,
      wallet: Number(((ag.wallet ?? 0) - startupCost).toFixed(2)),
      reputation: clamp((ag.reputation ?? 55) + 4, -100, 100),
      beliefs: bRes.beliefs,
      memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
    };
  });

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    ventures: [venture, ...(world.ventures ?? [])].slice(0, 24),
    transactions: [
      {
        id: allocId('tx_vent_open'),
        simMinutes: world.simMinutes,
        kind: 'upkeep' as const,
        fromId: founderId,
        toId: 'town_treasury',
        amount: startupCost,
        note: `${firstName} paid $${startupCost} permit & stock cost to open ${name}`,
      },
      ...(world.transactions ?? []),
    ].slice(0, 140),
    townTreasury: Number(((world.townTreasury ?? 650) + Math.round(startupCost * 0.25)).toFixed(2)),
    chronicle: [
      {
        id: allocId('chr_venture'),
        simMinutes: world.simMinutes,
        type: 'economy' as const,
        title: `${founder.name} launched "${name}"`,
        detail: `New resident-run stall offering ${chosenItem.replace('_', ' ')} at $${chosenPrice}.`,
        agentIds: [founderId],
      },
      ...world.chronicle,
    ].slice(0, 140),
    stats: {
      ...world.stats,
      venturesLaunched: (world.stats.venturesLaunched ?? 0) + 1,
      economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
    },
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: founderId,
      authorName: founder.name,
      category: 'market',
      title: `Now Open: ${name}`,
      body: `Fresh ${chosenItem.replace('_', ' ')} available for $${chosenPrice} — support local independent craft!`,
      locationId: chosenLocId,
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: 'Venture launched', venture };
}

/**
 * Real bilateral cash transfer between two residents (honors LLM transfer_money & dialogue deals).
 */
export function executePeerTransfer(
  world: WorldState,
  fromId: string,
  toId: string,
  amountRaw: number,
  note: string,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; amount: number } {
  if (fromId === toId) return { world, ok: false, reason: 'Cannot transfer to self', amount: 0 };
  const sender = world.agents.find((a) => a.id === fromId);
  const receiver = world.agents.find((a) => a.id === toId);
  if (!sender || !receiver) return { world, ok: false, reason: 'Unknown resident', amount: 0 };

  const amount = Math.max(5, Math.min(200, Math.round(amountRaw)));
  const senderWallet = sender.wallet ?? 0;
  if (senderWallet < amount + 10) {
    return {
      world,
      ok: false,
      reason: `${sender.name} lacks spare funds to send $${amount}`,
      amount: 0,
    };
  }

  const cleanNote = note.trim() || `Direct payment from ${sender.name.split(' ')[0]} to ${receiver.name.split(' ')[0]}`;
  const txMem = createMemoryNode({
    id: allocId(`mem_xfer_${fromId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'economy',
    description: `${sender.name} paid $${amount} directly to ${receiver.name}: ${cleanNote}.`,
    importance: 6,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id === fromId) {
      return {
        ...ag,
        wallet: Number((senderWallet - amount).toFixed(2)),
        memories: addLinkedMemory(ag, txMem, world.simMinutes, allocId),
      };
    }
    if (ag.id === toId) {
      const prevEdge = ag.socialGraph[fromId];
      return {
        ...ag,
        wallet: Number(((ag.wallet ?? 0) + amount).toFixed(2)),
        socialGraph: {
          ...ag.socialGraph,
          [fromId]: prevEdge
            ? {
                ...prevEdge,
                trust: clamp(prevEdge.trust + 6, -100, 100),
                affection: clamp(prevEdge.affection + 5, -100, 100),
                lastUpdatedSimMin: world.simMinutes,
              }
            : {
                targetId: fromId,
                roleLabel: 'Neighbor',
                trust: 62,
                affection: 58,
                familiarity: 35,
                inferredGoal: 'Supporting neighbors financially',
                lastUpdatedSimMin: world.simMinutes,
              },
        },
        memories: addLinkedMemory(ag, txMem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  const tx: EconomicTransaction = {
    id: allocId('tx_xfer'),
    simMinutes: world.simMinutes,
    kind: 'transfer',
    fromId,
    toId,
    amount,
    note: `${sender.name.split(' ')[0]} → ${receiver.name.split(' ')[0]} ($${amount}): ${cleanNote.slice(0, 80)}`,
  };

  const chr: ChronicleEvent = {
    id: allocId('chr_xfer'),
    simMinutes: world.simMinutes,
    type: 'economy',
    title: `${sender.name} transferred $${amount} to ${receiver.name}`,
    detail: cleanNote,
    agentIds: [fromId, toId],
  };

  return {
    world: {
      ...world,
      agents: nextAgents,
      transactions: [tx, ...(world.transactions ?? [])].slice(0, 140),
      chronicle: [chr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        economicTransactions: (world.stats.economicTransactions ?? 0) + 1,
        totalTradeVolume: Number(((world.stats.totalTradeVolume ?? 0) + amount).toFixed(2)),
      },
    },
    ok: true,
    reason: 'Transfer completed',
    amount,
  };
}

/**
 * Allows any resident to organically launch a new grassroots petition & rally neighbors.
 */
export function startCitizenPetition(
  world: WorldState,
  sponsorId: string,
  params: { title: string; description: string; effectKey: TownModifierKey },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; petition?: CitizenPetition } {
  const sponsor = world.agents.find((a) => a.id === sponsorId);
  if (!sponsor) return { world, ok: false, reason: 'Unknown sponsor' };

  const alreadyGathering = (world.petitions ?? []).some(
    (p) => p.status === 'gathering' && p.effectKey === params.effectKey,
  );
  if (alreadyGathering) {
    return { world, ok: false, reason: 'A petition for this policy is already gathering signatures' };
  }

  const target = Math.max(4, Math.min(8, Math.ceil(world.agents.length * 0.25)));
  const title = params.title.trim().slice(0, 100) || `Resident Initiative for ${params.effectKey}`;
  const description = params.description.trim().slice(0, 240) || `Grassroots petition sponsored by ${sponsor.name}.`;
  const petition: CitizenPetition = {
    id: allocId('pet'),
    title,
    description,
    effectKey: params.effectKey,
    sponsorId: sponsor.id,
    sponsorName: sponsor.name,
    signerIds: [sponsor.id],
    targetSignatures: target,
    status: 'gathering',
    createdAt: world.simMinutes,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_pet_start_${sponsorId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: `${sponsor.name} launched a grassroots petition: "${title}" (needs ${target} signatures).`,
    importance: 7,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== sponsorId) return ag;
    const bRes = upsertBelief(
      ag.beliefs,
      {
        subjectId: 'town_policy',
        predicate: 'policy_stance',
        claim: `I am organizing neighbors behind "${title}" (${description}).`,
        confidence: 0.9,
        sourceMemoryId: mem.id,
      },
      world.simMinutes,
      allocId,
    );
    return {
      ...ag,
      beliefs: bRes.beliefs,
      memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
    };
  });

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    petitions: [petition, ...(world.petitions ?? [])].slice(0, 16),
    chronicle: [
      {
        id: allocId('chr_pet_new'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `${sponsor.name} launched grassroots petition "${title}"`,
        detail: `${description} (${target} signatures needed for Town Hall ballot).`,
        agentIds: [sponsorId],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: sponsorId,
      authorName: sponsor.name,
      category: 'civic',
      title: `Petition: ${title}`,
      body: `${description} Seeking ${target} resident signatures.`,
      locationId: 'town_hall',
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: 'Petition launched', petition };
}

/**
 * Executes a bilateral deal negotiated (or explicitly refused) inside an LLM conversation.
 */
export function applyNegotiatedDeal(
  world: WorldState,
  deal: NegotiatedDeal,
  allocId: (prefix: string) => string,
): { world: WorldState; executed: boolean; summary: string } {
  const proposer = world.agents.find((a) => a.id === deal.proposerId);
  const responder = world.agents.find((a) => a.id === deal.responderId);
  if (!proposer || !responder || proposer.id === responder.id) {
    return { world, executed: false, summary: 'Invalid deal participants' };
  }

  if (!deal.accepted || deal.kind === 'refusal') {
    const propRefMem = createMemoryNode({
      id: allocId(`mem_refusal_prop_${proposer.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'contract',
      description: `${responder.name} declined ${proposer.name}'s proposal: ${deal.note}.`,
      importance: 6,
    });
    const respRefMem = createMemoryNode({
      id: allocId(`mem_refusal_resp_${responder.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'contract',
      description: `${responder.name} declined ${proposer.name}'s proposal: ${deal.note}.`,
      importance: 6,
    });
    return {
      world: {
        ...world,
        agents: world.agents.map((ag) => {
          if (ag.id === proposer.id) {
            return { ...ag, memories: addLinkedMemory(ag, propRefMem, world.simMinutes, allocId) };
          }
          if (ag.id === responder.id) {
            return { ...ag, memories: addLinkedMemory(ag, respRefMem, world.simMinutes, allocId) };
          }
          return ag;
        }),
        stats: {
          ...world.stats,
          refusalsAndDisagreements: (world.stats.refusalsAndDisagreements ?? 0) + 1,
        },
      },
      executed: true,
      summary: `${responder.name} declined proposal from ${proposer.name}`,
    };
  }

  if (deal.kind === 'loan') {
    const res = issueBilateralLoan(
      world,
      responder.id,
      proposer.id,
      deal.amount ?? 50,
      3,
      allocId,
      true,
    );
    return { world: res.world, executed: res.ok, summary: res.reason };
  }

  if (deal.kind === 'transfer') {
    const res = executePeerTransfer(
      world,
      proposer.id,
      responder.id,
      deal.amount ?? 25,
      deal.note,
      allocId,
    );
    return { world: res.world, executed: res.ok, summary: res.reason };
  }

  if (deal.kind === 'petition_support') {
    const targetPet =
      (deal.petitionId
        ? (world.petitions ?? []).find((p) => p.id === deal.petitionId && p.status === 'gathering')
        : undefined) ??
      (world.petitions ?? []).find(
        (p) => p.status === 'gathering' && !p.signerIds.includes(responder.id),
      );
    if (!targetPet) return { world, executed: false, summary: 'No gathering petition found' };
    const res = signCitizenPetition(world, responder.id, targetPet.id, allocId, true);
    return { world: res.world, executed: res.signed, summary: res.reason };
  }

  if (deal.kind === 'service_contract') {
    const res = createServiceContract(
      world,
      {
        proposerId: proposer.id,
        counterpartyId: responder.id,
        kind: deal.contractKind ?? 'patronage',
        terms: deal.note,
        agreedAmount: deal.amount ?? 40,
        bypassTrustGate: true,
      },
      allocId,
    );
    return { world: res.world, executed: res.ok, summary: res.reason };
  }

  if (deal.kind === 'coalition_invite') {
    const targetCoal =
      (deal.coalitionId
        ? (world.coalitions ?? []).find((c) => c.id === deal.coalitionId && c.active)
        : undefined) ??
      (world.coalitions ?? []).find((c) => c.active && c.memberIds.includes(proposer.id));
    if (!targetCoal) return { world, executed: false, summary: 'No active coalition found' };
    const res = joinCivicCoalition(world, responder.id, targetCoal.id, allocId, true);
    return { world: res.world, executed: res.ok, summary: res.reason };
  }

  return { world, executed: false, summary: 'Unsupported deal kind' };
}

/**
 * Steps active micro-ventures: settles local foot-traffic sales and daily restocking.
 */
export function stepMicroVentures(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  const ventures = world.ventures;
  if (!ventures || ventures.length === 0) return world;

  let nextAgents = [...world.agents];
  const nextVentures = [...ventures];
  const nextBusinesses = world.businesses ? { ...world.businesses } : undefined;
  let nextTownTreasury = world.townTreasury ?? 650;
  const newTx: EconomicTransaction[] = [];
  let tradeAdded = 0;

  for (let vIdx = 0; vIdx < nextVentures.length; vIdx++) {
    const v = nextVentures[vIdx];
    if (!v.active) continue;

    // Restock slowly if empty and founder has cash (credit wholesale supplier or town treasury to conserve money)
    if (v.stock <= 1) {
      const fIdx = nextAgents.findIndex((a) => a.id === v.founderId);
      if (fIdx >= 0 && (nextAgents[fIdx].wallet ?? 0) >= 24) {
        const restockCost = 18;
        nextAgents[fIdx] = {
          ...nextAgents[fIdx],
          wallet: Number(((nextAgents[fIdx].wallet ?? 0) - restockCost).toFixed(2)),
        };
        nextVentures[vIdx] = { ...v, stock: v.stock + 6 };
        const supplierId =
          nextBusinesses?.willows_market
            ? 'willows_market'
            : nextBusinesses?.oakridge_bakery
              ? 'oakridge_bakery'
              : 'town_treasury';
        if (supplierId !== 'town_treasury' && nextBusinesses?.[supplierId]) {
          const sup = nextBusinesses[supplierId];
          nextBusinesses[supplierId] = {
            ...sup,
            treasury: Number((sup.treasury + restockCost).toFixed(2)),
            dailyRevenue: Number((sup.dailyRevenue + restockCost).toFixed(2)),
          };
        } else {
          nextTownTreasury = Number((nextTownTreasury + restockCost).toFixed(2));
        }
        newTx.push({
          id: allocId('tx_vrestock'),
          simMinutes: world.simMinutes,
          kind: 'restock',
          fromId: v.founderId,
          toId: supplierId,
          amount: restockCost,
          itemKind: v.itemKind,
          quantity: 6,
          note: `${v.name} restocked 6× ${v.itemKind.replace('_', ' ')} wholesale ($${restockCost})`,
        });
        tradeAdded += restockCost;
      }
      continue;
    }

    // Find a solvent passerby at the venture's location
    const buyerIdx = nextAgents.findIndex(
      (a) =>
        a.id !== v.founderId &&
        a.currentLocationId === v.locationId &&
        (a.wallet ?? 0) >= v.unitPrice + 25,
    );
    if (buyerIdx < 0) continue;

    const founderIdx = nextAgents.findIndex((a) => a.id === v.founderId);
    if (founderIdx < 0) continue;

    const buyer = nextAgents[buyerIdx];
    const founder = nextAgents[founderIdx];

    nextAgents[buyerIdx] = {
      ...buyer,
      wallet: Number(((buyer.wallet ?? 0) - v.unitPrice).toFixed(2)),
      goods: {
        ...(buyer.goods ?? {}),
        [v.itemKind]: ((buyer.goods ?? {})[v.itemKind] ?? 0) + 1,
      },
      drives:
        v.itemKind === 'coffee' || v.itemKind === 'pastry' || v.itemKind === 'produce'
          ? { ...buyer.drives, hunger: clamp(buyer.drives.hunger + 14, 0, 100) }
          : { ...buyer.drives, purpose: clamp(buyer.drives.purpose + 6, 0, 100) },
    };
    nextAgents[founderIdx] = {
      ...founder,
      wallet: Number(((founder.wallet ?? 0) + v.unitPrice).toFixed(2)),
    };
    nextVentures[vIdx] = {
      ...v,
      stock: Math.max(0, v.stock - 1),
      revenue: Number((v.revenue + v.unitPrice).toFixed(2)),
    };
    newTx.push({
      id: allocId('tx_vsale'),
      simMinutes: world.simMinutes,
      kind: 'venture_sale',
      fromId: buyer.id,
      toId: founder.id,
      amount: v.unitPrice,
      itemKind: v.itemKind,
      quantity: 1,
      note: `${buyer.name.split(' ')[0]} bought ${v.itemKind.replace('_', ' ')} from ${v.name} ($${v.unitPrice})`,
    });
    tradeAdded += v.unitPrice;
  }

  if (newTx.length === 0) return { ...world, agents: nextAgents, ventures: nextVentures };

  return {
    ...world,
    agents: nextAgents,
    businesses: nextBusinesses ?? world.businesses,
    townTreasury: nextTownTreasury,
    ventures: nextVentures,
    transactions: [...newTx, ...(world.transactions ?? [])].slice(0, 140),
    stats: {
      ...world.stats,
      economicTransactions: (world.stats.economicTransactions ?? 0) + newTx.length,
      totalTradeVolume: Number(((world.stats.totalTradeVolume ?? 0) + tradeAdded).toFixed(2)),
    },
  };
}

/**
 * Phase H: Long-Horizon Housing Rent, Relocations & Household Partnerships.
 */
export function stepHousingAndHouseholds(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): { world: WorldState; moves: number } {
  // Rent settles every 3 sim-days
  if (currentDay <= 1 || currentDay % 3 !== 0) {
    return { world, moves: 0 };
  }

  let moves = 0;
  let rentTreasuryAdd = 0;
  const newTx: EconomicTransaction[] = [];
  const newChr: ChronicleEvent[] = [];
  const validHomeIds = new Set(
    world.locations.filter((l) => l.category === 'home').map((l) => l.id),
  );
  const fallbackShared =
    SHARED_HOUSING_LOCATIONS.find((id) => validHomeIds.has(id)) ??
    world.locations.find((l) => l.category === 'home')?.id ??
    'moore_cottages';

  const partnerMoves: Array<{ moverId: string; moverName: string; partnerId: string }> = [];
  const leftPartners: Array<{ moverId: string; formerPartnerIds: string[] }> = [];

  const firstPassAgents = world.agents.map((ag) => {
    const status = ag.housingStatus ?? 'renter';
    const rent = ag.monthlyRent ?? (status === 'owner' ? 0 : 32);
    if (status === 'owner' || rent <= 0) return ag;

    const wallet = ag.wallet ?? 0;
    if (wallet >= rent + 20) {
      rentTreasuryAdd += rent;
      newTx.push({
        id: allocId('tx_rent'),
        simMinutes: world.simMinutes,
        kind: 'rent',
        fromId: ag.id,
        toId: 'town_treasury',
        amount: rent,
        note: `${ag.name.split(' ')[0]} paid $${rent} housing rent (${status})`,
      });
      // Prosperous shared renter upgrades to independent rental
      if (status === 'shared' && wallet >= 320) {
        moves += 1;
        const independentHome =
          Array.from(validHomeIds).find((hid) => hid !== ag.homeLocationId) ?? ag.homeLocationId;
        if (ag.householdPartnerIds && ag.householdPartnerIds.length > 0) {
          leftPartners.push({ moverId: ag.id, formerPartnerIds: [...ag.householdPartnerIds] });
        }
        const upMem = createMemoryNode({
          id: allocId(`mem_uphouse_${ag.id}`),
          createdAt: world.simMinutes,
          type: 'observation',
          source: 'housing',
          description: `${ag.name} upgraded from shared rooms to an independent rental home after building savings.`,
          importance: 7,
        });
        newChr.push({
          id: allocId('chr_house_up'),
          simMinutes: world.simMinutes,
          type: 'world_event',
          title: `${ag.name} upgraded to an independent rental`,
          detail: `Strong savings allowed ${ag.name} to leave shared housing.`,
          agentIds: [ag.id],
        });
        return {
          ...ag,
          homeLocationId: independentHome,
          wallet: Number((wallet - rent).toFixed(2)),
          housingStatus: 'renter' as HousingStatus,
          monthlyRent: 34,
          householdPartnerIds: [],
          memories: addLinkedMemory(ag, upMem, world.simMinutes, allocId),
        };
      }
      return {
        ...ag,
        wallet: Number((wallet - rent).toFixed(2)),
      };
    }

    // Rent strain: renter moves into shared housing with a trusted peer to cut rent in half
    if (status === 'renter') {
      const trustedPeer = Object.values(ag.socialGraph)
        .filter((e) => e.trust >= 62)
        .sort((a, b) => b.trust - a.trust)[0];
      const partnerAgent = trustedPeer
        ? world.agents.find((other) => other.id === trustedPeer.targetId)
        : undefined;
      const targetHome =
        partnerAgent && validHomeIds.has(partnerAgent.homeLocationId)
          ? partnerAgent.homeLocationId
          : fallbackShared;

      moves += 1;
      if (partnerAgent) {
        partnerMoves.push({ moverId: ag.id, moverName: ag.name, partnerId: partnerAgent.id });
      }
      const moveMem = createMemoryNode({
        id: allocId(`mem_move_${ag.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'housing',
        description: partnerAgent
          ? `${ag.name} formed a shared household with ${partnerAgent.name} to lower rent to $20.`
          : `${ag.name} relocated into shared cottage housing to reduce living costs to $20.`,
        importance: 7,
      });
      newChr.push({
        id: allocId('chr_move'),
        simMinutes: world.simMinutes,
        type: 'world_event',
        title: partnerAgent
          ? `${ag.name} formed a shared household with ${partnerAgent.name}`
          : `${ag.name} moved to shared housing due to rent pressure`,
        detail: `Reduced housing rent from $${rent} to $20 to stabilize household cash.`,
        agentIds: partnerAgent ? [ag.id, partnerAgent.id] : [ag.id],
      });
      return {
        ...ag,
        homeLocationId: targetHome,
        housingStatus: 'shared' as HousingStatus,
        monthlyRent: 20,
        householdPartnerIds: partnerAgent
          ? Array.from(new Set([...(ag.householdPartnerIds ?? []), partnerAgent.id]))
          : ag.householdPartnerIds,
        memories: addLinkedMemory(ag, moveMem, world.simMinutes, allocId),
      };
    }

    return ag;
  });

  const nextAgents = firstPassAgents.map((ag) => {
    let nextAg = ag;
    for (const pm of partnerMoves) {
      if (pm.partnerId === nextAg.id) {
        const hostMem = createMemoryNode({
          id: allocId(`mem_host_${nextAg.id}`),
          createdAt: world.simMinutes,
          type: 'observation',
          source: 'housing',
          description: `${pm.moverName} moved in to form a shared household with ${nextAg.name}.`,
          importance: 6,
        });
        nextAg = {
          ...nextAg,
          householdPartnerIds: Array.from(new Set([...(nextAg.householdPartnerIds ?? []), pm.moverId])),
          memories: addLinkedMemory(nextAg, hostMem, world.simMinutes, allocId),
        };
      }
    }
    for (const lp of leftPartners) {
      if (lp.formerPartnerIds.includes(nextAg.id) && nextAg.householdPartnerIds) {
        nextAg = {
          ...nextAg,
          householdPartnerIds: nextAg.householdPartnerIds.filter((id) => id !== lp.moverId),
        };
      }
    }
    return nextAg;
  });

  return {
    world: {
      ...world,
      agents: nextAgents,
      townTreasury: Number(((world.townTreasury ?? 650) + rentTreasuryAdd).toFixed(2)),
      transactions: [...newTx, ...(world.transactions ?? [])].slice(0, 140),
      chronicle: [...newChr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        housingMoves: (world.stats.housingMoves ?? 0) + moves,
        economicTransactions: (world.stats.economicTransactions ?? 0) + newTx.length,
      },
    },
    moves,
  };
}

/**
 * Phase H: Career Ladders & Skill Promotions — sustained work & project mastery unlock
 * real career tiers ('apprentice' -> 'practitioner' -> 'senior' -> 'master') and wage raises.
 */
const NEXT_TIER: Record<CareerTier, { next: CareerTier; minSkill: number; wageBonus: number } | null> = {
  apprentice: { next: 'practitioner', minSkill: 62, wageBonus: 2 },
  practitioner: { next: 'senior', minSkill: 82, wageBonus: 3 },
  senior: { next: 'master', minSkill: 94, wageBonus: 4 },
  master: null,
};

export function stepCareerProgression(
  world: WorldState,
  allocId: (prefix: string) => string,
): { world: WorldState; promotions: number } {
  let promotions = 0;
  const newChr: ChronicleEvent[] = [];

  const nextAgents = world.agents.map((ag) => {
    const currentTier = ag.careerTier ?? inferCareerTier(ag);
    const rule = NEXT_TIER[currentTier];
    if (!rule) return ag;

    const maxSkill = Math.max(0, ...Object.values(ag.skills ?? {}));
    const completedProjects = (ag.projects ?? []).filter((p) => p.status === 'completed').length;
    const effectiveSkill = maxSkill + completedProjects * 3;
    if (effectiveSkill < rule.minSkill) return ag;
    if (rule.next === 'master' && (ag.age < 24 || completedProjects < 1)) return ag;

    promotions += 1;
    const nextWage = (ag.wagePerHour ?? 14) + rule.wageBonus;
    const mem = createMemoryNode({
      id: allocId(`mem_promo_${ag.id}`),
      createdAt: world.simMinutes,
      type: 'observation',
      source: 'career',
      description: `${ag.name} earned a career promotion to ${rule.next} ${ag.occupation} ($${nextWage}/hr).`,
      importance: 8,
    });
    newChr.push({
      id: allocId('chr_promo'),
      simMinutes: world.simMinutes,
      type: 'economy',
      title: `${ag.name} promoted to ${rule.next} ${ag.occupation}`,
      detail: `Skill mastery raised hourly pay to $${nextWage}/hr.`,
      agentIds: [ag.id],
    });
    return {
      ...ag,
      careerTier: rule.next,
      wagePerHour: nextWage,
      promotionsCount: (ag.promotionsCount ?? 0) + 1,
      reputation: clamp((ag.reputation ?? 55) + 4, -100, 100),
      mood: applyEmotionalAppraisal(ag.mood, ag.drives, 0.2, 0.12),
      memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
    };
  });

  if (promotions === 0) return { world, promotions: 0 };

  return {
    world: {
      ...world,
      agents: nextAgents,
      chronicle: [...newChr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        careerPromotions: (world.stats.careerPromotions ?? 0) + promotions,
      },
    },
    promotions,
  };
}

/**
 * Phase I: Ambient Temperament Surrogate Policy — runs ONLY for scaled 'ambient' citizens
 * (0 LLM calls). Focal residents are NEVER hijacked by this routine; they make loan,
 * petition, and micro-venture decisions themselves via LLM BDI forks & bilateral dialogue.
 */
export function runAmbientSurrogateCycle(
  world: WorldState,
  allocId: (prefix: string) => string,
): WorldState {
  let working = world;
  const ambientAgents = working.agents.filter((a) => a.tier === 'ambient');
  if (ambientAgents.length === 0) return working;

  // 1. Cash-strapped ambient resident seeks a small peer loan from their most trusted solvent contact (max 1/day)
  const needy = ambientAgents.find(
    (a) =>
      (a.wallet ?? 120) < 55 &&
      !(working.loans ?? []).some((l) => l.status === 'active' && l.borrowerId === a.id),
  );
  if (needy) {
    const lender = ambientAgents
      .filter((a) => a.id !== needy.id && (a.wallet ?? 0) >= 210)
      .sort(
        (a, b) =>
          (b.socialGraph[needy.id]?.trust ?? 40) - (a.socialGraph[needy.id]?.trust ?? 40),
      )[0];
    if (lender) {
      working = issueBilateralLoan(working, lender.id, needy.id, 45, 3, allocId).world;
    }
  }

  // 2. Up to 3 ambient residents evaluate open grassroots petitions according to worldview & stubbornness
  const openPetition = (working.petitions ?? []).find((p) => p.status === 'gathering');
  if (openPetition) {
    const unsigned = ambientAgents
      .filter((a) => !openPetition.signerIds.includes(a.id))
      .slice(0, 3);
    for (const candidate of unsigned) {
      working = signCitizenPetition(working, candidate.id, openPetition.id, allocId, false).world;
    }
  }

  // 3. Ambitious, well-capitalized ambient resident launches a pop-up micro-venture (capped at 4 active town ventures)
  const activeVentures = (working.ventures ?? []).filter((v) => v.active).length;
  if (activeVentures < 4) {
    const entrepreneur = ambientAgents.find(
      (a) =>
        (a.wallet ?? 0) >= 240 &&
        (a.temperament?.ambition ?? 0.5) >= 0.72 &&
        (a.temperament?.riskTolerance ?? 0.5) >= 0.55 &&
        !(working.ventures ?? []).some((v) => v.founderId === a.id && v.active),
    );
    if (entrepreneur) {
      working = launchMicroVenture(working, entrepreneur.id, allocId).world;
    }
  }

  return working;
}

/**
 * Daily rollover orchestrator for Phases G, H & I.
 */
export function applyDailyContractsAndLifeRollover(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  let working = settleMaturingLoans(world, currentDay, allocId).world;
  working = stepHousingAndHouseholds(working, currentDay, allocId).world;
  working = stepCareerProgression(working, allocId).world;
  working = runAmbientSurrogateCycle(working, allocId);
  return working;
}
