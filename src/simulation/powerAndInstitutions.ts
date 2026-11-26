/**
 * Phase 2 — Emergent Power, Service Contracts, Civic Disputes & Arbitration,
 * Political Coalitions, Economic Boycotts, Dynamic Fiscal Governance & Town Shocks.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 * All financial mutations strictly conserve total town money across wallets,
 * treasuries, and active contract escrow.
 */

import { attachAssociativeLinks, upsertBelief } from './cognitiveDepth';
import { compactMemories, createMemoryNode, formatSimTime } from './memory';
import { applyEmotionalAppraisal } from './psychology';
import { postPublicNotice } from './socialFabric';
import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type BusinessState,
  type ChronicleEvent,
  type CivicCoalition,
  type CivicDispute,
  type CoalitionAgenda,
  type DisputeCategory,
  type EconomicBoycott,
  type EconomicTransaction,
  type ItemKind,
  type ServiceContract,
  type ServiceContractKind,
  type TownModifierKey,
  type TownShock,
  type TownShockKind,
  type WorldState,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
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
// 1. Bilateral Service Contracts & Escrow Conservation
// ---------------------------------------------------------------------------

export function createServiceContract(
  world: WorldState,
  params: {
    proposerId: string;
    counterpartyId: string;
    kind?: ServiceContractKind;
    terms?: string;
    agreedAmount?: number;
    durationDays?: number;
    locationId?: string;
    itemKind?: ItemKind;
    bypassTrustGate?: boolean;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; contract?: ServiceContract } {
  if (params.proposerId === params.counterpartyId) {
    return { world, ok: false, reason: 'Cannot form a contract with yourself' };
  }
  const proposer = world.agents.find((a) => a.id === params.proposerId);
  const counterparty = world.agents.find((a) => a.id === params.counterpartyId);
  if (!proposer || !counterparty) {
    return { world, ok: false, reason: 'Unknown contract party' };
  }

  const kind: ServiceContractKind = params.kind ?? 'patronage';
  const agreedAmount =
    kind === 'political_pact'
      ? 0
      : clamp(Math.round(params.agreedAmount ?? 45), 15, 180);

  const proposerWallet = proposer.wallet ?? 0;
  if (agreedAmount > 0 && proposerWallet < agreedAmount + 20) {
    return {
      world,
      ok: false,
      reason: `${proposer.name} lacks liquidity to escrow $${agreedAmount}`,
    };
  }

  const existingActive = (world.serviceContracts ?? []).some(
    (c) =>
      c.status === 'active' &&
      ((c.proposerId === proposer.id && c.counterpartyId === counterparty.id) ||
        (c.proposerId === counterparty.id && c.counterpartyId === proposer.id)),
  );
  if (existingActive) {
    return {
      world,
      ok: false,
      reason: 'An active service contract already exists between these residents',
    };
  }

  const trust = proposer.socialGraph[counterparty.id]?.trust ?? 48;
  const reverseTrust = counterparty.socialGraph[proposer.id]?.trust ?? 48;
  if (!params.bypassTrustGate && (trust < 30 || reverseTrust < 25)) {
    return {
      world: {
        ...world,
        stats: {
          ...world.stats,
          refusalsAndDisagreements: (world.stats.refusalsAndDisagreements ?? 0) + 1,
        },
      },
      ok: false,
      reason: `Insufficient mutual trust for ${kind.replace('_', ' ')} agreement`,
    };
  }

  const day = formatSimTime(world.simMinutes).day;
  const durationDays = Math.max(1, Math.min(7, Math.round(params.durationDays ?? 2)));
  const terms =
    params.terms?.trim().slice(0, 220) ||
    `${kind.replace(/_/g, ' ')} commitment between ${proposer.name} and ${counterparty.name}`;

  const contract: ServiceContract = {
    id: allocId('svc'),
    kind,
    proposerId: proposer.id,
    counterpartyId: counterparty.id,
    terms,
    escrowHeld: agreedAmount,
    agreedAmount,
    createdDay: day,
    dueDay: day + durationDays,
    status: 'active',
    ...(params.locationId ? { locationId: params.locationId } : {}),
    ...(params.itemKind ? { itemKind: params.itemKind } : {}),
  };

  const propMem = createMemoryNode({
    id: allocId(`mem_svc_p_${proposer.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'contract',
    description: `${proposer.name} entered a ${kind.replace(/_/g, ' ')} contract with ${counterparty.name}${agreedAmount > 0 ? ` ($${agreedAmount} held in escrow)` : ''}: ${terms}.`,
    importance: 7,
  });
  const counterMem = createMemoryNode({
    id: allocId(`mem_svc_c_${counterparty.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'contract',
    description: `${counterparty.name} agreed to a ${kind.replace(/_/g, ' ')} pact with ${proposer.name}${agreedAmount > 0 ? ` ($${agreedAmount} escrow payout on fulfillment)` : ''}: ${terms}.`,
    importance: 7,
  });

  let beliefRevs = 0;
  const nextAgents = world.agents.map((ag) => {
    if (ag.id === proposer.id) {
      const bRes = upsertBelief(
        ag.beliefs,
        {
          subjectId: counterparty.id,
          predicate: 'obligation',
          claim: `${counterparty.name} is bound by a ${kind.replace(/_/g, ' ')} agreement due Day ${contract.dueDay}.`,
          confidence: 0.9,
          sourceMemoryId: propMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (bRes.revised) beliefRevs += 1;
      return {
        ...ag,
        wallet: roundMoney(proposerWallet - agreedAmount),
        beliefs: bRes.beliefs,
        memories: addLinkedMemory(ag, propMem, world.simMinutes, allocId),
      };
    }
    if (ag.id === counterparty.id) {
      const bRes = upsertBelief(
        ag.beliefs,
        {
          subjectId: proposer.id,
          predicate: 'obligation',
          claim: `I pledged to fulfill "${terms}" for ${proposer.name} by Day ${contract.dueDay}.`,
          confidence: 0.9,
          sourceMemoryId: counterMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (bRes.revised) beliefRevs += 1;
      return {
        ...ag,
        beliefs: bRes.beliefs,
        memories: addLinkedMemory(ag, counterMem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  const chr: ChronicleEvent = {
    id: allocId('chr_svc'),
    simMinutes: world.simMinutes,
    type: 'economy',
    title: `${proposer.name} & ${counterparty.name} signed a ${kind.replace(/_/g, ' ')} contract`,
    detail: agreedAmount > 0 ? `$${agreedAmount} escrowed until Day ${contract.dueDay}.` : terms,
    agentIds: [proposer.id, counterparty.id],
  };

  return {
    ok: true,
    reason: 'Service contract active',
    contract,
    world: {
      ...world,
      agents: nextAgents,
      serviceContracts: [contract, ...(world.serviceContracts ?? [])].slice(0, 60),
      chronicle: [chr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        serviceContractsCreated: (world.stats.serviceContractsCreated ?? 0) + 1,
        beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevs,
      },
    },
  };
}

export function settleMaturingServiceContracts(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): { world: WorldState; fulfilled: number; breached: number } {
  const contracts = world.serviceContracts ?? [];
  const maturing = contracts.filter((c) => c.status === 'active' && currentDay >= c.dueDay);
  if (maturing.length === 0) return { world, fulfilled: 0, breached: 0 };

  let nextAgents = [...world.agents];
  const nextContracts = [...contracts];
  const newTx: EconomicTransaction[] = [];
  const newChr: ChronicleEvent[] = [];
  let fulfilled = 0;
  let breached = 0;
  let beliefRevs = 0;

  for (const contract of maturing) {
    const propIdx = nextAgents.findIndex((a) => a.id === contract.proposerId);
    const countIdx = nextAgents.findIndex((a) => a.id === contract.counterpartyId);
    if (propIdx < 0 || countIdx < 0) continue;

    const proposer = nextAgents[propIdx];
    const counterparty = nextAgents[countIdx];
    const cIdx = nextContracts.findIndex((c) => c.id === contract.id);

    const hasOpenDisputeBetween = (world.disputes ?? []).some(
      (d) =>
        d.status === 'open' &&
        ((d.claimantId === proposer.id && d.respondentId === counterparty.id) ||
          (d.claimantId === counterparty.id && d.respondentId === proposer.id)),
    );
    const counterpartyTrust = counterparty.socialGraph[proposer.id]?.trust ?? 50;
    const proposerTrust = proposer.socialGraph[counterparty.id]?.trust ?? 50;
    const supplyDestitute =
      contract.kind === 'supply_delivery' &&
      !counterparty.employerLocationId &&
      (counterparty.wallet ?? 0) < 12;

    const didFulfill =
      !hasOpenDisputeBetween &&
      counterpartyTrust >= 22 &&
      proposerTrust >= 20 &&
      !supplyDestitute;

    const escrow = contract.escrowHeld;

    if (didFulfill) {
      const fulMem = createMemoryNode({
        id: allocId(`mem_svc_ok_${contract.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'contract',
        description: `${counterparty.name} fulfilled the ${contract.kind.replace(/_/g, ' ')} agreement with ${proposer.name}${escrow > 0 ? ` and received $${escrow} from escrow` : ''}.`,
        importance: 7,
      });

      const propB = upsertBelief(
        proposer.beliefs,
        {
          subjectId: counterparty.id,
          predicate: 'obligation',
          claim: `${counterparty.name} fulfilled our ${contract.kind.replace(/_/g, ' ')} contract reliably.`,
          confidence: 0.94,
          sourceMemoryId: fulMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (propB.revised) beliefRevs += 1;

      const countB = upsertBelief(
        counterparty.beliefs,
        {
          subjectId: proposer.id,
          predicate: 'obligation',
          claim: `Contract with ${proposer.name} is completed and settled.`,
          confidence: 0.94,
          sourceMemoryId: fulMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (countB.revised) beliefRevs += 1;

      const prevPropEdge = proposer.socialGraph[counterparty.id];
      const nextPropGraph = {
        ...proposer.socialGraph,
        [counterparty.id]: prevPropEdge
          ? {
              ...prevPropEdge,
              trust: clamp(prevPropEdge.trust + 8, -100, 100),
              affection: clamp(prevPropEdge.affection + 5, -100, 100),
              lastUpdatedSimMin: world.simMinutes,
            }
          : {
              targetId: counterparty.id,
              roleLabel: 'Contract partner',
              trust: 66,
              affection: 58,
              familiarity: 40,
              inferredGoal: 'Honors bilateral commitments',
              lastUpdatedSimMin: world.simMinutes,
            },
      };

      nextAgents[propIdx] = {
        ...proposer,
        socialGraph: nextPropGraph,
        beliefs: propB.beliefs,
        memories: addLinkedMemory(proposer, fulMem, world.simMinutes, allocId),
      };
      nextAgents[countIdx] = {
        ...counterparty,
        wallet: roundMoney((counterparty.wallet ?? 0) + escrow),
        reputation: clamp((counterparty.reputation ?? 55) + 4, -100, 100),
        beliefs: countB.beliefs,
        memories: addLinkedMemory(counterparty, fulMem, world.simMinutes, allocId),
      };

      if (cIdx >= 0) {
        nextContracts[cIdx] = {
          ...contract,
          escrowHeld: 0,
          status: 'fulfilled',
          resolvedDay: currentDay,
        };
      }
      if (escrow > 0) {
        newTx.push({
          id: allocId('tx_svc_ok'),
          simMinutes: world.simMinutes,
          kind: 'transfer',
          fromId: proposer.id,
          toId: counterparty.id,
          amount: escrow,
          note: `Escrow released for fulfilled ${contract.kind.replace(/_/g, ' ')} pact`,
        });
      }
      newChr.push({
        id: allocId('chr_svc_ok'),
        simMinutes: world.simMinutes,
        type: 'economy',
        title: `${counterparty.name} fulfilled contract with ${proposer.name}`,
        detail: escrow > 0 ? `$${escrow} released from escrow.` : contract.terms,
        agentIds: [proposer.id, counterparty.id],
      });
      fulfilled += 1;
    } else {
      // Breached -> refund remaining escrow strictly back to proposer
      const breMem = createMemoryNode({
        id: allocId(`mem_svc_br_${contract.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'contract',
        description: `${counterparty.name} breached the ${contract.kind.replace(/_/g, ' ')} agreement with ${proposer.name}${escrow > 0 ? `; $${escrow} escrow returned to ${proposer.name}` : ''}.`,
        importance: 8,
      });

      const propB = upsertBelief(
        proposer.beliefs,
        {
          subjectId: counterparty.id,
          predicate: 'obligation',
          claim: `${counterparty.name} breached our ${contract.kind.replace(/_/g, ' ')} contract on Day ${currentDay}.`,
          confidence: 0.96,
          sourceMemoryId: breMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (propB.revised) beliefRevs += 1;

      const prevPropEdge = proposer.socialGraph[counterparty.id];
      const nextPropGraph = {
        ...proposer.socialGraph,
        [counterparty.id]: prevPropEdge
          ? {
              ...prevPropEdge,
              trust: clamp(prevPropEdge.trust - 24, -100, 100),
              affection: clamp(prevPropEdge.affection - 14, -100, 100),
              lastUpdatedSimMin: world.simMinutes,
            }
          : {
              targetId: counterparty.id,
              roleLabel: 'Breached contract',
              trust: 18,
              affection: 26,
              familiarity: 40,
              inferredGoal: 'Unreliable contractor',
              lastUpdatedSimMin: world.simMinutes,
            },
      };

      nextAgents[propIdx] = {
        ...proposer,
        wallet: roundMoney((proposer.wallet ?? 0) + escrow),
        mood: applyEmotionalAppraisal(proposer.mood, proposer.drives, -0.18, 0.14),
        socialGraph: nextPropGraph,
        beliefs: propB.beliefs,
        memories: addLinkedMemory(proposer, breMem, world.simMinutes, allocId),
      };
      nextAgents[countIdx] = {
        ...counterparty,
        reputation: clamp((counterparty.reputation ?? 55) - 10, -100, 100),
        memories: addLinkedMemory(counterparty, breMem, world.simMinutes, allocId),
      };

      if (cIdx >= 0) {
        nextContracts[cIdx] = {
          ...contract,
          escrowHeld: 0,
          status: 'breached',
          resolvedDay: currentDay,
        };
      }
      newChr.push({
        id: allocId('chr_svc_br'),
        simMinutes: world.simMinutes,
        type: 'economy',
        title: `${counterparty.name} breached ${contract.kind.replace(/_/g, ' ')} contract`,
        detail: `${proposer.name} recovered $${escrow} escrow; ${counterparty.name}'s standing fell.`,
        agentIds: [proposer.id, counterparty.id],
      });
      breached += 1;
    }
  }

  return {
    fulfilled,
    breached,
    world: {
      ...world,
      agents: nextAgents,
      serviceContracts: nextContracts,
      transactions: [...newTx, ...(world.transactions ?? [])].slice(0, 140),
      chronicle: [...newChr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        serviceContractsFulfilled: (world.stats.serviceContractsFulfilled ?? 0) + fulfilled,
        serviceContractsBreached: (world.stats.serviceContractsBreached ?? 0) + breached,
        economicTransactions: (world.stats.economicTransactions ?? 0) + newTx.length,
        totalTradeVolume: roundMoney(
          (world.stats.totalTradeVolume ?? 0) + newTx.reduce((s, t) => s + t.amount, 0),
        ),
        beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevs,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Civic Disputes & Impartial Town Hall Arbitration
// ---------------------------------------------------------------------------

export function fileCivicDispute(
  world: WorldState,
  params: {
    claimantId: string;
    respondentId: string;
    category?: DisputeCategory;
    claimSummary?: string;
    claimedAmount?: number;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; dispute?: CivicDispute } {
  if (params.claimantId === params.respondentId) {
    return { world, ok: false, reason: 'Cannot file a dispute against yourself' };
  }
  const claimant = world.agents.find((a) => a.id === params.claimantId);
  const respondent = world.agents.find((a) => a.id === params.respondentId);
  if (!claimant || !respondent) {
    return { world, ok: false, reason: 'Unknown claimant or respondent' };
  }

  const alreadyOpen = (world.disputes ?? []).some(
    (d) =>
      d.status === 'open' &&
      d.claimantId === claimant.id &&
      d.respondentId === respondent.id,
  );
  if (alreadyOpen) {
    return { world, ok: false, reason: 'A dispute against this resident is already pending hearing' };
  }

  const day = formatSimTime(world.simMinutes).day;
  const relatedLoan = (world.loans ?? []).find(
    (l) => l.status === 'defaulted' && l.lenderId === claimant.id && l.borrowerId === respondent.id,
  );
  const relatedContract = (world.serviceContracts ?? []).find(
    (c) =>
      c.status === 'breached' &&
      c.proposerId === claimant.id &&
      c.counterpartyId === respondent.id,
  );

  const category: DisputeCategory =
    params.category ??
    (relatedLoan ? 'loan_default' : relatedContract ? 'contract_breach' : 'reputation_harm');

  const claimedAmount = clamp(
    Math.round(
      params.claimedAmount ??
        relatedLoan?.amountDue ??
        (relatedContract ? Math.max(20, Math.round(relatedContract.agreedAmount * 0.5)) : 35),
    ),
    0,
    250,
  );

  const claimSummary =
    params.claimSummary?.trim().slice(0, 220) ||
    `${claimant.name} petitioned Town Hall regarding ${category.replace(/_/g, ' ')} involving ${respondent.name}.`;

  const dispute: CivicDispute = {
    id: allocId('dsp'),
    claimantId: claimant.id,
    claimantName: claimant.name,
    respondentId: respondent.id,
    respondentName: respondent.name,
    category,
    claimSummary,
    claimedAmount,
    filedDay: day,
    status: 'open',
    ...(relatedLoan ? { relatedLoanId: relatedLoan.id } : {}),
    ...(relatedContract ? { relatedContractId: relatedContract.id } : {}),
  };

  const mem = createMemoryNode({
    id: allocId(`mem_dsp_${claimant.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'dispute',
    description: `${claimant.name} filed a civic dispute at Town Hall against ${respondent.name} (${category.replace(/_/g, ' ')}, claiming $${claimedAmount}).`,
    importance: 8,
  });

  const nextAgents = world.agents.map((ag) =>
    ag.id === claimant.id || ag.id === respondent.id
      ? { ...ag, memories: addLinkedMemory(ag, mem, world.simMinutes, allocId) }
      : ag,
  );

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    disputes: [dispute, ...(world.disputes ?? [])].slice(0, 40),
    chronicle: [
      {
        id: allocId('chr_dsp'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `Civic dispute filed: ${claimant.name} vs. ${respondent.name}`,
        detail: `${category.replace(/_/g, ' ')} ($${claimedAmount} restitution sought) — queued for Town Hall arbitration.`,
        agentIds: [claimant.id, respondent.id],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
    stats: {
      ...world.stats,
      disputesFiled: (world.stats.disputesFiled ?? 0) + 1,
    },
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: claimant.id,
      authorName: claimant.name,
      category: 'civic',
      title: `Hearing Docket: ${claimant.name.split(' ')[0]} vs. ${respondent.name.split(' ')[0]}`,
      body: claimSummary,
      locationId: 'town_hall',
      createMeme: false,
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: 'Dispute filed for arbitration', dispute };
}

function selectImpartialArbiter(
  agents: readonly AgentState[],
  leadershipMayorId: string | null | undefined,
  claimantId: string,
  respondentId: string,
): AgentState | undefined {
  if (leadershipMayorId && leadershipMayorId !== claimantId && leadershipMayorId !== respondentId) {
    const mayor = agents.find((a) => a.id === leadershipMayorId);
    if (mayor) return mayor;
  }
  return [...agents]
    .filter((a) => a.id !== claimantId && a.id !== respondentId)
    .sort((a, b) => (b.reputation ?? 50) - (a.reputation ?? 50) || a.id.localeCompare(b.id))[0];
}

export function adjudicateOpenDisputes(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
  options?: { immediate?: boolean },
): { world: WorldState; upheld: number; dismissed: number } {
  const disputes = world.disputes ?? [];
  const pending = disputes.filter(
    (d) => d.status === 'open' && (options?.immediate || currentDay > d.filedDay),
  );
  if (pending.length === 0) return { world, upheld: 0, dismissed: 0 };

  let nextAgents = [...world.agents];
  const nextDisputes = [...disputes];
  const newTx: EconomicTransaction[] = [];
  const newChr: ChronicleEvent[] = [];
  let workingWorld = world;
  let upheld = 0;
  let dismissed = 0;
  let beliefRevs = 0;

  for (const dispute of pending) {
    const claimIdx = nextAgents.findIndex((a) => a.id === dispute.claimantId);
    const respIdx = nextAgents.findIndex((a) => a.id === dispute.respondentId);
    if (claimIdx < 0 || respIdx < 0) continue;

    const claimant = nextAgents[claimIdx];
    const respondent = nextAgents[respIdx];
    const arbiter = selectImpartialArbiter(
      nextAgents,
      world.leadership?.mayorId,
      claimant.id,
      respondent.id,
    );

    // Evaluate evidence against simulation ground truth
    const hasLoanEvidence = (world.loans ?? []).some(
      (l) =>
        (dispute.relatedLoanId ? l.id === dispute.relatedLoanId : true) &&
        l.status === 'defaulted' &&
        l.lenderId === claimant.id &&
        l.borrowerId === respondent.id,
    );
    const hasContractEvidence = (world.serviceContracts ?? []).some(
      (c) =>
        (dispute.relatedContractId ? c.id === dispute.relatedContractId : true) &&
        c.status === 'breached' &&
        c.proposerId === claimant.id &&
        c.counterpartyId === respondent.id,
    );
    const hasLayoffEvidence =
      dispute.category === 'unfair_layoff' &&
      (world.chronicle.some(
        (ev) =>
          ev.title.includes('downsized') &&
          ev.agentIds.includes(claimant.id) &&
          ev.agentIds.includes(respondent.id),
      ) ||
        claimant.memories.some(
          (m) =>
            m.source === 'economy' &&
            m.description.toLowerCase().includes('let') &&
            m.description.includes(claimant.name),
        ));
    const hasGossipEvidence =
      dispute.category === 'reputation_harm' &&
      (world.agents.some((other) =>
        other.memories.some(
          (m) =>
            m.source === 'gossip' &&
            m.description.includes(respondent.name.split(' ')[0]) &&
            m.description.includes(claimant.name.split(' ')[0]),
        ),
      ) ||
        ((claimant.socialGraph[respondent.id]?.trust ?? 50) < 25 &&
          (respondent.reputation ?? 55) < 42));

    const claimValid =
      hasLoanEvidence || hasContractEvidence || hasLayoffEvidence || hasGossipEvidence;

    const dIdx = nextDisputes.findIndex((d) => d.id === dispute.id);

    if (claimValid) {
      const respWallet = respondent.wallet ?? 0;
      const awarded = Math.min(
        dispute.claimedAmount,
        Math.max(0, Math.floor(respWallet - 15)),
      );
      const shortfall = awarded < dispute.claimedAmount;
      const rulingNote = `${arbiter?.name ?? 'Town Council'} upheld ${claimant.name}'s ${dispute.category.replace(/_/g, ' ')} claim against ${respondent.name}${awarded > 0 ? ` and ordered $${awarded} restitution` : ''}${shortfall ? ' (partial payment due to limited funds)' : ''}.`;

      const rulMem = createMemoryNode({
        id: allocId(`mem_rul_${dispute.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'dispute',
        description: rulingNote,
        importance: 8,
      });

      const claimB = upsertBelief(
        claimant.beliefs,
        {
          subjectId: respondent.id,
          predicate: 'obligation',
          claim: `${respondent.name} was held accountable by Town Hall (${awarded > 0 ? `$${awarded} restitution awarded` : 'formal censure recorded'}).`,
          confidence: 0.94,
          sourceMemoryId: rulMem.id,
        },
        world.simMinutes,
        allocId,
      );
      if (claimB.revised) beliefRevs += 1;

      nextAgents[claimIdx] = {
        ...claimant,
        wallet: roundMoney((claimant.wallet ?? 0) + awarded),
        mood: applyEmotionalAppraisal(claimant.mood, claimant.drives, 0.14, 0.06),
        beliefs: claimB.beliefs,
        memories: addLinkedMemory(claimant, rulMem, world.simMinutes, allocId),
      };
      nextAgents[respIdx] = {
        ...respondent,
        wallet: roundMoney(respWallet - awarded),
        reputation: clamp((respondent.reputation ?? 55) - (shortfall ? 16 : 10), -100, 100),
        mood: applyEmotionalAppraisal(respondent.mood, respondent.drives, -0.18, 0.1),
        memories: addLinkedMemory(respondent, rulMem, world.simMinutes, allocId),
      };

      if (dIdx >= 0) {
        nextDisputes[dIdx] = {
          ...dispute,
          status: 'upheld',
          arbiterId: arbiter?.id,
          arbiterName: arbiter?.name ?? 'Town Council',
          rulingNote,
          restitutionAwarded: awarded,
          resolvedDay: currentDay,
        };
      }

      if (awarded > 0) {
        newTx.push({
          id: allocId('tx_rest'),
          simMinutes: world.simMinutes,
          kind: 'transfer',
          fromId: respondent.id,
          toId: claimant.id,
          amount: awarded,
          note: `Arbitration restitution: ${respondent.name.split(' ')[0]} → ${claimant.name.split(' ')[0]}`,
        });
      }
      newChr.push({
        id: allocId('chr_rul_ok'),
        simMinutes: world.simMinutes,
        type: 'civic',
        title: `Dispute upheld: ${claimant.name} vs. ${respondent.name}`,
        detail: rulingNote,
        agentIds: [claimant.id, respondent.id, ...(arbiter ? [arbiter.id] : [])],
        locationName: 'Town Hall & Gazette',
      });
      upheld += 1;
    } else {
      const rulingNote = `${arbiter?.name ?? 'Town Council'} dismissed ${claimant.name}'s ${dispute.category.replace(/_/g, ' ')} claim against ${respondent.name} for lack of substantiated evidence.`;
      const disMem = createMemoryNode({
        id: allocId(`mem_dis_${dispute.id}`),
        createdAt: world.simMinutes,
        type: 'observation',
        source: 'dispute',
        description: rulingNote,
        importance: 6,
      });

      nextAgents[claimIdx] = {
        ...claimant,
        reputation: clamp((claimant.reputation ?? 55) - 3, -100, 100),
        memories: addLinkedMemory(claimant, disMem, world.simMinutes, allocId),
      };
      nextAgents[respIdx] = {
        ...respondent,
        reputation: clamp((respondent.reputation ?? 55) + 4, -100, 100),
        memories: addLinkedMemory(respondent, disMem, world.simMinutes, allocId),
      };

      if (dIdx >= 0) {
        nextDisputes[dIdx] = {
          ...dispute,
          status: 'dismissed',
          arbiterId: arbiter?.id,
          arbiterName: arbiter?.name ?? 'Town Council',
          rulingNote,
          restitutionAwarded: 0,
          resolvedDay: currentDay,
        };
      }

      newChr.push({
        id: allocId('chr_rul_no'),
        simMinutes: world.simMinutes,
        type: 'civic',
        title: `Dispute dismissed: ${claimant.name} vs. ${respondent.name}`,
        detail: rulingNote,
        agentIds: [claimant.id, respondent.id, ...(arbiter ? [arbiter.id] : [])],
        locationName: 'Town Hall & Gazette',
      });
      dismissed += 1;
    }
  }

  workingWorld = {
    ...world,
    agents: nextAgents,
    disputes: nextDisputes,
    transactions: [...newTx, ...(world.transactions ?? [])].slice(0, 140),
    chronicle: [...newChr, ...world.chronicle].slice(0, 140),
    stats: {
      ...world.stats,
      disputesResolved: (world.stats.disputesResolved ?? 0) + upheld + dismissed,
      economicTransactions: (world.stats.economicTransactions ?? 0) + newTx.length,
      totalTradeVolume: roundMoney(
        (world.stats.totalTradeVolume ?? 0) + newTx.reduce((s, t) => s + t.amount, 0),
      ),
      beliefRevisions: (world.stats.beliefRevisions ?? 0) + beliefRevs,
    },
  };

  return { world: workingWorld, upheld, dismissed };
}

// ---------------------------------------------------------------------------
// 3. Emergent Political & Economic Coalitions
// ---------------------------------------------------------------------------

const AGENDA_DEFAULT_POLICY: Record<CoalitionAgenda, TownModifierKey> = {
  public_welfare: 'communityClinic',
  merchant_guild: 'marketStipend',
  civic_reform: 'extendedLibrary',
  fiscal_restraint: 'streetLighting',
  labor_rights: 'marketStipend',
};

const OPPOSING_AGENDAS: Partial<Record<CoalitionAgenda, CoalitionAgenda>> = {
  fiscal_restraint: 'public_welfare',
  public_welfare: 'fiscal_restraint',
  merchant_guild: 'labor_rights',
  labor_rights: 'merchant_guild',
};

function inferCoalitionAgenda(agent: AgentState): CoalitionAgenda {
  const worldview = (agent.dossier?.civicWorldview ?? 'pragmatist').toLowerCase();
  if (worldview.includes('fiscal') || worldview.includes('conservative')) return 'fiscal_restraint';
  if (worldview.includes('communit') || worldview.includes('public')) return 'public_welfare';
  if (worldview.includes('reform')) return 'civic_reform';
  const occ = agent.occupation.toLowerCase();
  if (occ.includes('owner') || occ.includes('grocer') || occ.includes('cafe') || occ.includes('baker')) {
    return 'merchant_guild';
  }
  return 'labor_rights';
}

export function formCivicCoalition(
  world: WorldState,
  params: {
    founderId: string;
    name?: string;
    agenda?: CoalitionAgenda;
    targetPolicyKey?: TownModifierKey;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; coalition?: CivicCoalition } {
  const founder = world.agents.find((a) => a.id === params.founderId);
  if (!founder) return { world, ok: false, reason: 'Unknown founder' };

  const activeCoalitions = (world.coalitions ?? []).filter((c) => c.active);
  if (activeCoalitions.length >= 6) {
    return { world, ok: false, reason: 'Smallville already has 6 active civic coalitions' };
  }
  if (activeCoalitions.some((c) => c.leaderId === founder.id)) {
    return { world, ok: false, reason: `${founder.name} already leads an active coalition` };
  }

  const agenda: CoalitionAgenda = params.agenda ?? inferCoalitionAgenda(founder);
  const defaultNameByAgenda: Record<CoalitionAgenda, string> = {
    fiscal_restraint: 'Taxpayers & Balanced Budget Bloc',
    public_welfare: 'Neighborhood Mutual Care Coalition',
    merchant_guild: 'Main Street Trade Alliance',
    labor_rights: 'Smallville Workers & Artisans League',
    civic_reform: 'Open Town Hall Reform Circle',
  };
  const name = params.name?.trim().slice(0, 80) || defaultNameByAgenda[agenda];
  const day = formatSimTime(world.simMinutes).day;

  const coalition: CivicCoalition = {
    id: allocId('coal'),
    name,
    agenda,
    founderId: founder.id,
    leaderId: founder.id,
    memberIds: [founder.id],
    createdDay: day,
    cohesion: 72,
    targetPolicyKey: params.targetPolicyKey ?? AGENDA_DEFAULT_POLICY[agenda],
    active: true,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_coal_new_${founder.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'coalition',
    description: `${founder.name} founded the "${name}" coalition (${agenda.replace(/_/g, ' ')}).`,
    importance: 7,
  });

  const nextAgents = world.agents.map((ag) =>
    ag.id === founder.id
      ? {
          ...ag,
          reputation: clamp((ag.reputation ?? 55) + 3, -100, 100),
          memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
        }
      : ag,
  );

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    coalitions: [coalition, ...(world.coalitions ?? [])].slice(0, 12),
    chronicle: [
      {
        id: allocId('chr_coal'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `Coalition formed: ${name}`,
        detail: `${founder.name} organized residents around a ${agenda.replace(/_/g, ' ')} platform.`,
        agentIds: [founder.id],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
    stats: {
      ...world.stats,
      coalitionsFormed: (world.stats.coalitionsFormed ?? 0) + 1,
    },
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: founder.id,
      authorName: founder.name,
      category: 'civic',
      title: `New Coalition: ${name}`,
      body: `Uniting neighbors around ${agenda.replace(/_/g, ' ')} and practical town priorities.`,
      locationId: 'town_hall',
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: 'Coalition formed', coalition };
}

export function joinCivicCoalition(
  world: WorldState,
  agentId: string,
  coalitionId: string,
  allocId: (prefix: string) => string,
  forceJoin = false,
): { world: WorldState; ok: boolean; reason: string } {
  const agent = world.agents.find((a) => a.id === agentId);
  const coalitions = world.coalitions ?? [];
  const targetIdx = coalitions.findIndex((c) => c.id === coalitionId && c.active);
  if (!agent || targetIdx < 0) return { world, ok: false, reason: 'Coalition not found' };

  const coalition = coalitions[targetIdx];
  if (coalition.memberIds.includes(agentId)) {
    return { world, ok: false, reason: 'Already a member of this coalition' };
  }

  if (!forceJoin) {
    const leaderTrust = agent.socialGraph[coalition.leaderId]?.trust ?? 48;
    const worldview = (agent.dossier?.civicWorldview ?? 'pragmatist').toLowerCase();
    if (
      (coalition.agenda === 'public_welfare' && worldview.includes('fiscal') && leaderTrust < 65) ||
      (coalition.agenda === 'fiscal_restraint' && worldview.includes('communit') && leaderTrust < 65) ||
      leaderTrust < 25
    ) {
      return {
        world: {
          ...world,
          stats: {
            ...world.stats,
            refusalsAndDisagreements: (world.stats.refusalsAndDisagreements ?? 0) + 1,
          },
        },
        ok: false,
        reason: `${agent.name} declined to join ${coalition.name} due to agenda/trust differences`,
      };
    }
  }

  const opposingAgenda = OPPOSING_AGENDAS[coalition.agenda];
  const nextCoalitions = coalitions.map((c, idx) => {
    if (idx === targetIdx) {
      return {
        ...c,
        memberIds: Array.from(new Set([...c.memberIds, agentId])),
        cohesion: clamp(c.cohesion + 3, 20, 100),
      };
    }
    if (opposingAgenda && c.agenda === opposingAgenda && c.memberIds.includes(agentId)) {
      return {
        ...c,
        memberIds: c.memberIds.filter((id) => id !== agentId),
      };
    }
    return c;
  });

  const mem = createMemoryNode({
    id: allocId(`mem_coal_join_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'coalition',
    description: `${agent.name} joined the "${coalition.name}" civic coalition.`,
    importance: 6,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id === agentId) {
      const prevEdge = ag.socialGraph[coalition.leaderId];
      return {
        ...ag,
        socialGraph: prevEdge
          ? {
              ...ag.socialGraph,
              [coalition.leaderId]: {
                ...prevEdge,
                trust: clamp(prevEdge.trust + 4, -100, 100),
                lastUpdatedSimMin: world.simMinutes,
              },
            }
          : ag.socialGraph,
        memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  return {
    ok: true,
    reason: `Joined ${coalition.name}`,
    world: {
      ...world,
      agents: nextAgents,
      coalitions: nextCoalitions,
    },
  };
}

export function getCoalitionVotingBias(
  world: WorldState,
  agentId: string,
  effectKey: TownModifierKey,
  proposerId: string,
): number {
  const active = (world.coalitions ?? []).filter(
    (c) => c.active && c.memberIds.includes(agentId),
  );
  if (active.length === 0) return 0;

  let bias = 0;
  for (const c of active) {
    if (c.targetPolicyKey === effectKey) {
      bias += 0.25;
    }
    if (c.memberIds.includes(proposerId)) {
      bias += 0.14;
    }
    if (
      c.agenda === 'fiscal_restraint' &&
      (effectKey === 'communityClinic' || effectKey === 'marketStipend')
    ) {
      bias -= 0.28;
    }
  }
  return clamp(Number(bias.toFixed(3)), -0.35, 0.35);
}

export function areRivalCoalitionMembers(
  world: WorldState,
  agentAId: string,
  agentBId: string,
): boolean {
  const active = (world.coalitions ?? []).filter((c) => c.active);
  if (active.length < 2) return false;
  const aAgendas = active.filter((c) => c.memberIds.includes(agentAId)).map((c) => c.agenda);
  const bAgendas = active.filter((c) => c.memberIds.includes(agentBId)).map((c) => c.agenda);
  return aAgendas.some((ag) => {
    const opp = OPPOSING_AGENDAS[ag];
    return Boolean(opp && bAgendas.includes(opp));
  });
}

// ---------------------------------------------------------------------------
// 4. Economic Boycotts
// ---------------------------------------------------------------------------

export function callEconomicBoycott(
  world: WorldState,
  params: {
    organizerId: string;
    targetLocationId: string;
    reason?: string;
    durationDays?: number;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; boycott?: EconomicBoycott } {
  const organizer = world.agents.find((a) => a.id === params.organizerId);
  const biz = world.businesses?.[params.targetLocationId];
  if (!organizer || !biz) {
    return { world, ok: false, reason: 'Unknown boycott organizer or target business' };
  }
  if (biz.ownerId === organizer.id) {
    return { world, ok: false, reason: 'Business owners cannot boycott their own venue' };
  }

  const alreadyActive = (world.boycotts ?? []).find(
    (b) => b.active && b.targetLocationId === params.targetLocationId,
  );
  if (alreadyActive) {
    return joinEconomicBoycott(world, organizer.id, alreadyActive.id, allocId);
  }

  const day = formatSimTime(world.simMinutes).day;
  const durationDays = Math.max(2, Math.min(7, Math.round(params.durationDays ?? 4)));
  const cleanReason =
    params.reason?.trim().slice(0, 200) ||
    `Protesting pricing and business practices at ${biz.name}.`;

  const boycott: EconomicBoycott = {
    id: allocId('boy'),
    organizerId: organizer.id,
    organizerName: organizer.name,
    targetLocationId: biz.locationId,
    targetBusinessName: biz.name,
    reason: cleanReason,
    supporterIds: [organizer.id],
    startedDay: day,
    expiresDay: day + durationDays,
    active: true,
  };

  const mem = createMemoryNode({
    id: allocId(`mem_boy_${organizer.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: `${organizer.name} called an economic boycott against ${biz.name}: ${cleanReason}`,
    importance: 7,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id === organizer.id) {
      return { ...ag, memories: addLinkedMemory(ag, mem, world.simMinutes, allocId) };
    }
    if (ag.id === biz.ownerId) {
      return {
        ...ag,
        mood: applyEmotionalAppraisal(ag.mood, ag.drives, -0.15, 0.12),
        memories: addLinkedMemory(ag, mem, world.simMinutes, allocId),
      };
    }
    return ag;
  });

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    boycotts: [boycott, ...(world.boycotts ?? [])].slice(0, 12),
    chronicle: [
      {
        id: allocId('chr_boy'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `${organizer.name} organized a boycott of ${biz.name}`,
        detail: `${cleanReason} (Active through Day ${boycott.expiresDay}).`,
        agentIds: [organizer.id, biz.ownerId].filter(Boolean),
        locationName: biz.name,
      },
      ...world.chronicle,
    ].slice(0, 140),
  };
  nextWorld = {
    ...nextWorld,
    stats: {
      ...nextWorld.stats,
      boycottsActive: (nextWorld.boycotts ?? []).filter((b) => b.active).length,
    },
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: organizer.id,
      authorName: organizer.name,
      category: 'market',
      title: `Consumer Boycott: ${biz.name}`,
      body: cleanReason,
      locationId: 'town_hall',
    },
    allocId,
  );

  return { world: nextWorld, ok: true, reason: `Boycott called against ${biz.name}`, boycott };
}

export function joinEconomicBoycott(
  world: WorldState,
  agentId: string,
  boycottId: string,
  allocId: (prefix: string) => string,
): { world: WorldState; ok: boolean; reason: string; boycott?: EconomicBoycott } {
  const boycotts = world.boycotts ?? [];
  const idx = boycotts.findIndex((b) => b.id === boycottId && b.active);
  const agent = world.agents.find((a) => a.id === agentId);
  if (idx < 0 || !agent) return { world, ok: false, reason: 'Active boycott not found' };

  const b = boycotts[idx];
  const biz = world.businesses?.[b.targetLocationId];
  if (biz?.ownerId === agentId || b.supporterIds.includes(agentId)) {
    return { world, ok: false, reason: 'Resident cannot or already supports this boycott' };
  }

  const updated: EconomicBoycott = {
    ...b,
    supporterIds: [...b.supporterIds, agentId],
  };
  const nextBoycotts = boycotts.map((item, i) => (i === idx ? updated : item));
  const mem = createMemoryNode({
    id: allocId(`mem_boy_join_${agentId}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'civic',
    description: `${agent.name} joined the consumer boycott of ${b.targetBusinessName}.`,
    importance: 5,
  });

  return {
    ok: true,
    reason: `Joined boycott of ${b.targetBusinessName}`,
    boycott: updated,
    world: {
      ...world,
      agents: world.agents.map((ag) =>
        ag.id === agentId
          ? { ...ag, memories: addLinkedMemory(ag, mem, world.simMinutes, allocId) }
          : ag,
      ),
      boycotts: nextBoycotts,
      stats: {
        ...world.stats,
        boycottsActive: nextBoycotts.filter((x) => x.active).length,
      },
    },
  };
}

export function isBusinessBoycottedByAgent(
  world: WorldState,
  agentId: string,
  locationId: string,
): boolean {
  return (world.boycotts ?? []).some(
    (b) => b.active && b.targetLocationId === locationId && b.supporterIds.includes(agentId),
  );
}

export function stepEconomicBoycotts(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  const boycotts = world.boycotts ?? [];
  if (boycotts.length === 0) return world;

  let working: WorldState = {
    ...world,
    boycotts: boycotts.map((b) => (b.active && currentDay > b.expiresDay ? { ...b, active: false } : b)),
  };

  for (const b of working.boycotts ?? []) {
    if (!b.active) continue;
    const biz = working.businesses?.[b.targetLocationId];
    if (!biz) continue;

    let added = 0;
    for (const ag of working.agents) {
      if (added >= 2) break;
      if (ag.id === biz.ownerId || b.supporterIds.includes(ag.id)) continue;
      const orgTrust = ag.socialGraph[b.organizerId]?.trust ?? 45;
      const ownerTrust = ag.socialGraph[biz.ownerId]?.trust ?? 50;
      if (orgTrust >= 65 && ownerTrust <= 35) {
        working = joinEconomicBoycott(working, ag.id, b.id, allocId).world;
        added += 1;
      }
    }
  }

  return {
    ...working,
    stats: {
      ...working.stats,
      boycottsActive: (working.boycotts ?? []).filter((b) => b.active).length,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Dynamic Mayoral Fiscal Governance & Macroeconomic Shocks
// ---------------------------------------------------------------------------

export function stepMayoralGovernance(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  const leadership = world.leadership;
  if (!leadership?.mayorId) return world;
  const mayor = world.agents.find((a) => a.id === leadership.mayorId);
  if (!mayor) return world;

  const treasury = world.townTreasury ?? 350;
  const worldview = (mayor.dossier?.civicWorldview ?? 'pragmatist').toLowerCase();
  let nextTax = leadership.taxRatePct;
  let note: string | null = null;

  if (treasury < 220 && nextTax < 12) {
    nextTax += 1;
    note = `Mayor ${mayor.name} raised the municipal sales tax to ${nextTax}% to stabilize town reserves ($${Math.round(treasury)}).`;
  } else if (
    treasury > 950 &&
    nextTax > 5 &&
    (worldview.includes('fiscal') || leadership.approvalRating < 52)
  ) {
    nextTax -= 1;
    note = `Mayor ${mayor.name} trimmed the municipal sales tax to ${nextTax}% thanks to healthy treasury reserves ($${Math.round(treasury)}).`;
  }

  if (!note || nextTax === leadership.taxRatePct) return world;

  let nextWorld: WorldState = {
    ...world,
    leadership: {
      ...leadership,
      taxRatePct: nextTax,
    },
    chronicle: [
      {
        id: allocId('chr_tax'),
        simMinutes: world.simMinutes,
        type: 'civic' as const,
        title: `Mayor ${mayor.name.split(' ')[0]} adjusted tax rate to ${nextTax}%`,
        detail: note,
        agentIds: [mayor.id],
        locationName: 'Town Hall & Gazette',
      },
      ...world.chronicle,
    ].slice(0, 140),
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: mayor.id,
      authorName: `Mayor ${mayor.name}`,
      category: 'civic',
      title: `Municipal Tax Update: ${nextTax}% (Day ${currentDay})`,
      body: note,
      locationId: 'town_hall',
      createMeme: false,
    },
    allocId,
  );

  return nextWorld;
}

export function triggerTownShock(
  world: WorldState,
  kind: TownShockKind,
  allocId: (prefix: string) => string,
  durationDays = 3,
): { world: WorldState; shock: TownShock } {
  const day = formatSimTime(world.simMinutes).day;
  const endsDay = day + Math.max(1, durationDays);

  const copyByKind: Record<TownShockKind, { title: string; description: string; severity: number }> = {
    supply_shortage: {
      title: 'Regional Supply Bottleneck',
      description: 'Delayed regional deliveries trimmed merchant inventories across Main Street.',
      severity: 0.72,
    },
    cold_snap: {
      title: 'Seasonal Cold Snap',
      description: 'Chilly winds strained outdoor errands and increased clinic demand.',
      severity: 0.65,
    },
    harvest_surplus: {
      title: 'Bountiful Garden Harvest',
      description: 'Surplus Southside produce boosted fresh food inventories across town.',
      severity: 0.6,
    },
    festival_boom: {
      title: 'Smallville Market Revival',
      description: 'Bustling foot traffic lifted spirits and neighborhood socializing.',
      severity: 0.55,
    },
  };

  const info = copyByKind[kind];
  const affectedLocationIds = Object.keys(world.businesses ?? {});
  const shock: TownShock = {
    id: allocId('shk'),
    kind,
    title: info.title,
    description: info.description,
    startedDay: day,
    endsDay,
    severity: info.severity,
    active: true,
    affectedLocationIds,
  };

  let nextBusinesses: Record<string, BusinessState> | undefined = world.businesses
    ? { ...world.businesses }
    : undefined;
  let nextAgents = world.agents;

  if (nextBusinesses && (kind === 'supply_shortage' || kind === 'harvest_surplus')) {
    const updatedBusinesses: Record<string, BusinessState> = {};
    for (const [locId, biz] of Object.entries(nextBusinesses)) {
      const nextStock: BusinessState['stock'] = {};
      for (const [rawKind, entry] of Object.entries(biz.stock)) {
        if (!entry) continue;
        const itemKind = rawKind as ItemKind;
        let nextQty = entry.quantity;
        if (kind === 'supply_shortage' && entry.quantity >= 4) {
          nextQty = Math.max(2, Math.floor(entry.quantity * 0.75));
        } else if (
          kind === 'harvest_surplus' &&
          (itemKind === 'produce' || itemKind === 'groceries' || itemKind === 'meal' || itemKind === 'bread')
        ) {
          nextQty = Math.min(entry.maxStock, entry.quantity + 4);
        }
        nextStock[itemKind] = { ...entry, quantity: nextQty };
      }
      updatedBusinesses[locId] = { ...biz, stock: nextStock };
    }
    nextBusinesses = updatedBusinesses;
  }

  const clinicProtected = Boolean(world.townModifiers?.communityClinic);
  if (kind === 'cold_snap' || kind === 'festival_boom') {
    nextAgents = world.agents.map((ag) => {
      if (kind === 'cold_snap') {
        const drop = clinicProtected ? 2 : 4;
        return {
          ...ag,
          health: clamp((ag.health ?? 94) - drop, 35, 100),
        };
      }
      return {
        ...ag,
        mood: applyEmotionalAppraisal(ag.mood, ag.drives, 0.08, 0.06),
        drives: { ...ag.drives, social: clamp(ag.drives.social + 6, 0, 100) },
      };
    });
  }

  let nextWorld: WorldState = {
    ...world,
    agents: nextAgents,
    ...(nextBusinesses ? { businesses: nextBusinesses } : {}),
    activeShocks: [
      shock,
      ...(world.activeShocks ?? []).map((s) => (s.active ? { ...s, active: false } : s)),
    ].slice(0, 12),
    chronicle: [
      {
        id: allocId('chr_shk'),
        simMinutes: world.simMinutes,
        type: 'world_event' as const,
        title: `${info.title} (Days ${day}–${endsDay})`,
        detail: info.description,
        agentIds: [],
        locationName: 'Smallville',
      },
      ...world.chronicle,
    ].slice(0, 140),
    stats: {
      ...world.stats,
      shocksTriggered: (world.stats.shocksTriggered ?? 0) + 1,
    },
  };

  nextWorld = postPublicNotice(
    nextWorld,
    {
      authorId: 'town_gazette',
      authorName: 'Smallville Gazette',
      category: 'news',
      title: info.title,
      body: info.description,
      locationId: 'town_hall',
      createMeme: false,
    },
    allocId,
  );

  return { world: nextWorld, shock };
}

export function stepTownShocks(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  const updatedShocks = (world.activeShocks ?? []).map((s) =>
    s.active && currentDay > s.endsDay ? { ...s, active: false } : s,
  );
  let working: WorldState = { ...world, activeShocks: updatedShocks };

  const hasActive = updatedShocks.some((s) => s.active);
  if (
    hasActive ||
    currentDay < 6 ||
    currentDay % 6 !== 0 ||
    world.scenarioId === 'paper_valentine'
  ) {
    return working;
  }

  // Deterministic condition-based macro shock selection
  let totalRatio = 0;
  let ratioCount = 0;
  for (const biz of Object.values(working.businesses ?? {})) {
    for (const entry of Object.values(biz.stock)) {
      if (!entry || entry.maxStock <= 0) continue;
      totalRatio += entry.quantity / entry.maxStock;
      ratioCount += 1;
    }
  }
  const avgFill = ratioCount > 0 ? totalRatio / ratioCount : 0.6;
  let kind: TownShockKind = 'harvest_surplus';
  if (avgFill < 0.42) kind = 'supply_shortage';
  else if (working.weather === 'drizzle') kind = 'cold_snap';
  else if ((working.townTreasury ?? 0) >= 600) kind = 'festival_boom';

  working = triggerTownShock(working, kind, allocId, 3).world;
  return working;
}

export function applyDailyPowerAndInstitutionsRollover(
  world: WorldState,
  currentDay: number,
  allocId: (prefix: string) => string,
): WorldState {
  let working = settleMaturingServiceContracts(world, currentDay, allocId).world;
  working = adjudicateOpenDisputes(working, currentDay, allocId).world;
  working = stepEconomicBoycotts(working, currentDay, allocId);
  working = stepMayoralGovernance(working, currentDay, allocId);
  working = stepTownShocks(working, currentDay, allocId);
  return working;
}
