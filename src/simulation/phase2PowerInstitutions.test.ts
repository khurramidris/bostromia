import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState, stepWorldState } from './engine';
import { issueBilateralLoan, settleMaturingLoans } from './contractsAndLife';
import { makeIdAllocator } from './ids';
import { castElectionVote, rebalanceMarketPrices } from './institutions';
import { normalizeBdiDecisionPayload } from './llmJson';
import {
  adjudicateOpenDisputes,
  callEconomicBoycott,
  createServiceContract,
  fileCivicDispute,
  formCivicCoalition,
  joinCivicCoalition,
  settleMaturingServiceContracts,
  stepMayoralGovernance,
  triggerTownShock,
} from './powerAndInstitutions';
import { castCivicVote, createCivicProposal } from './socialFabric';
import { applyBdiDecisionResult, isHighStakesEncounter } from './autonomy';
import { validateWorld } from './validateWorld';
import { executePurchaseAction, findNearestOpenFoodVenue } from './worldEconomy';
import type { WorldState } from './types';

function totalWorldMoney(world: WorldState): number {
  const wallets = world.agents.reduce((s, a) => s + (a.wallet ?? 0), 0);
  const biz = Object.values(world.businesses ?? {}).reduce((s, b) => s + b.treasury, 0);
  const treasury = world.townTreasury ?? 0;
  const escrow = (world.serviceContracts ?? [])
    .filter((c) => c.status === 'active')
    .reduce((s, c) => s + c.escrowHeld, 0);
  return Math.round((wallets + biz + treasury + escrow) * 100) / 100;
}

test('Phase 2 Service Contracts conserve money across escrow creation, fulfillment, and breach', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 5000);
  const startTotal = totalWorldMoney(world);

  // 1. Create & fulfill patronage contract between Isabella & Priya
  const cRes = createServiceContract(
    world,
    {
      proposerId: 'isabella',
      counterpartyId: 'priya',
      kind: 'patronage',
      terms: 'Deliver daily fresh herbs for Hobbs Cafe',
      agreedAmount: 45,
      durationDays: 2,
      bypassTrustGate: true,
    },
    alloc.next,
  );
  assert.equal(cRes.ok, true);
  assert.equal(totalWorldMoney(cRes.world), startTotal, 'Escrow deduction must conserve total dollars');
  assert.equal(cRes.world.stats.serviceContractsCreated, 1);

  const fulRes = settleMaturingServiceContracts(cRes.world, 3, alloc.next);
  assert.equal(fulRes.fulfilled, 1);
  assert.equal(fulRes.breached, 0);
  assert.equal(totalWorldMoney(fulRes.world), startTotal, 'Escrow release must conserve total dollars');
  assert.equal(fulRes.world.serviceContracts?.[0]?.status, 'fulfilled');

  // 2. Create & breach contract when mutual trust is ruptured (< 22)
  const wLowTrust: WorldState = {
    ...fulRes.world,
    agents: fulRes.world.agents.map((a) =>
      a.id === 'wolfgang'
        ? {
            ...a,
            socialGraph: {
              ...a.socialGraph,
              arthur: {
                ...(a.socialGraph['arthur'] ?? {
                  targetId: 'arthur',
                  roleLabel: 'Neighbor',
                  trust: 10,
                  affection: 20,
                  familiarity: 30,
                  inferredGoal: 'Strained',
                  lastUpdatedSimMin: fulRes.world.simMinutes,
                }),
                trust: 12,
              },
            },
          }
        : a,
    ),
  };
  const brCreate = createServiceContract(
    wLowTrust,
    {
      proposerId: 'arthur',
      counterpartyId: 'wolfgang',
      kind: 'supply_delivery',
      terms: 'Reserve carpentry hardware order',
      agreedAmount: 35,
      durationDays: 1,
      bypassTrustGate: true,
    },
    alloc.next,
  );
  assert.equal(brCreate.ok, true);
  assert.equal(totalWorldMoney(brCreate.world), startTotal);

  const brSettle = settleMaturingServiceContracts(brCreate.world, 2, alloc.next);
  assert.equal(brSettle.breached, 1);
  assert.equal(brSettle.fulfilled, 0);
  assert.equal(totalWorldMoney(brSettle.world), startTotal, 'Escrow refund on breach must conserve total dollars');
  assert.equal(brSettle.world.serviceContracts?.[0]?.status, 'breached');
});

test('Phase 2 Civic Disputes & Arbitration uphold defaulted loans with restitution and dismiss unfounded claims', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 6000);
  const startTotal = totalWorldMoney(world);

  // Give Sam spare liquidity and Wolfgang exact low wallet so he defaults on maturity, then enough later to test partial/full restitution
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'sam') return { ...a, wallet: 260 };
      if (a.id === 'wolfgang') return { ...a, wallet: 10 };
      return a;
    }),
  };
  const moneyAfterSeed = totalWorldMoney(world);

  const loanRes = issueBilateralLoan(world, 'sam', 'wolfgang', 60, 1, alloc.next, true);
  assert.equal(loanRes.ok, true);
  assert.equal(totalWorldMoney(loanRes.world), moneyAfterSeed);

  // Wolfgang spends down so wallet < amountDue ($65), forcing default at Day 2
  const preDefault: WorldState = {
    ...loanRes.world,
    agents: loanRes.world.agents.map((a) => (a.id === 'wolfgang' ? { ...a, wallet: 30 } : a)),
  };
  const settled = settleMaturingLoans(preDefault, 2, alloc.next);
  assert.equal(settled.defaulted, 1);

  // Sam files dispute against Wolfgang
  const filed = fileCivicDispute(
    settled.world,
    {
      claimantId: 'sam',
      respondentId: 'wolfgang',
      category: 'loan_default',
      claimSummary: 'Unpaid bilateral loan after maturity.',
      claimedAmount: 65,
    },
    alloc.next,
  );
  assert.equal(filed.ok, true);

  // Give Wolfgang modest cash ($55) before arbitration to verify conserved restitution ($40 awarded leaving $15 floor)
  const preHearing: WorldState = {
    ...filed.world,
    agents: filed.world.agents.map((a) => (a.id === 'wolfgang' ? { ...a, wallet: 55 } : a)),
  };
  const preHearingMoney = totalWorldMoney(preHearing);
  const samBefore = preHearing.agents.find((a) => a.id === 'sam')!.wallet!;

  const ruled = adjudicateOpenDisputes(preHearing, 3, alloc.next);
  assert.equal(ruled.upheld, 1);
  assert.equal(ruled.dismissed, 0);
  assert.equal(totalWorldMoney(ruled.world), preHearingMoney, 'Arbitration restitution must conserve total dollars');
  const samAfter = ruled.world.agents.find((a) => a.id === 'sam')!.wallet!;
  assert.equal(samAfter, samBefore + 40);
  assert.equal(ruled.world.disputes?.[0]?.status, 'upheld');

  // Unfounded claim by Eddy against Isabella -> dismissed
  const bogus = fileCivicDispute(
    ruled.world,
    {
      claimantId: 'eddy',
      respondentId: 'isabella',
      category: 'contract_breach',
      claimSummary: 'Unfounded claim with no breached contract.',
      claimedAmount: 50,
    },
    alloc.next,
  );
  assert.equal(bogus.ok, true);
  const bogusRuled = adjudicateOpenDisputes(bogus.world, 4, alloc.next);
  assert.equal(bogusRuled.dismissed, 1);
  assert.equal(bogusRuled.world.disputes?.[0]?.status, 'dismissed');
  assert.ok(totalWorldMoney(bogusRuled.world) > 0 && startTotal > 0);
});

test('Phase 2 Coalitions & Boycotts drive voting blocs, rival encounter escalation, and consumer commerce diversion', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 7000);

  const coalA = formCivicCoalition(
    world,
    {
      founderId: 'elena',
      name: 'Southside Care Bloc',
      agenda: 'public_welfare',
      targetPolicyKey: 'communityClinic',
    },
    alloc.next,
  );
  assert.equal(coalA.ok, true);
  const coalB = formCivicCoalition(
    coalA.world,
    {
      founderId: 'john',
      name: 'Balanced Ledger Bloc',
      agenda: 'fiscal_restraint',
    },
    alloc.next,
  );
  assert.equal(coalB.ok, true);

  const joined = joinCivicCoalition(coalB.world, 'maria', coalA.coalition!.id, alloc.next, true);
  assert.equal(joined.ok, true);

  // Rival coalitions trigger high-stakes escalation
  assert.equal(
    isHighStakesEncounter(joined.world, 'maria', 'john', 'chance meeting'),
    true,
    'Rival coalition members should escalate to private high-stakes encounter',
  );

  // Coalition aligns election vote preference
  const openEl = {
    ...joined.world.election!,
    status: 'voting' as const,
  };
  const voteWorld = { ...joined.world, election: openEl };
  const elVote = castElectionVote(voteWorld, 'maria', alloc.next);
  assert.ok(elVote.votedForId);

  // Coalition biases civic proposal voting in favor of its targetPolicyKey
  const propWorld = createCivicProposal(
    joined.world,
    {
      proposerId: 'elena',
      proposerName: 'Dr. Elena Vance',
      title: 'Expand Clinic Subsidy',
      description: 'Public care expansion',
      cost: 80,
      effectKey: 'communityClinic',
    },
    alloc.next,
  );
  const propId = propWorld.proposals![0].id;
  const civicVoteRes = castCivicVote(propWorld, 'maria', propId, undefined, alloc.next);
  assert.equal(civicVoteRes.voted, true);
  assert.ok(civicVoteRes.world.proposals!.find((p) => p.id === propId)!.votesFor.includes('maria'));

  // Consumer boycott blocks executePurchaseAction at target business & diverts findNearestOpenFoodVenue
  const boycottRes = callEconomicBoycott(
    civicVoteRes.world,
    {
      organizerId: 'maria',
      targetLocationId: 'hobbs_cafe',
      reason: 'Fair cafe pricing protest',
      durationDays: 3,
    },
    alloc.next,
  );
  assert.equal(boycottRes.ok, true);

  // Advance clock to 10:00 AM so businesses are open
  const daytimeWorld: WorldState = { ...boycottRes.world, simMinutes: 600 };
  const blockedPurchase = executePurchaseAction(
    daytimeWorld,
    'maria',
    'hobbs_cafe',
    'coffee',
    true,
    alloc.next,
  );
  assert.equal(blockedPurchase.ok, false);
  assert.equal(blockedPurchase.reason, 'boycotted_by_buyer');

  const maria = daytimeWorld.agents.find((a) => a.id === 'maria')!;
  const divertedVenue = findNearestOpenFoodVenue(daytimeWorld, maria);
  assert.notEqual(divertedVenue.locationId, 'hobbs_cafe');
});

test('Phase 2 Dynamic Fiscal Governance, Town Shocks & arrival-grounded BDI Phase 2 actions pass validateWorld', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 8000);

  // Dynamic mayoral governance lowers tax when treasury is flush and mayor is fiscal conservative (Sam)
  const flushWorld: WorldState = {
    ...world,
    townTreasury: 1100,
    leadership: {
      mayorId: 'sam',
      mayorName: 'Sam Moore',
      electedDay: 1,
      termEndsDay: 8,
      taxRatePct: 8,
      approvalRating: 58,
    },
  };
  const taxedWorld = stepMayoralGovernance(flushWorld, 3, alloc.next);
  assert.equal(taxedWorld.leadership?.taxRatePct, 7);

  // Supply shortage shock trims stock and boosts scarcity pricing
  const prevCoffeePrice = taxedWorld.businesses!['hobbs_cafe'].stock.coffee!.price;
  const shocked = triggerTownShock(taxedWorld, 'supply_shortage', alloc.next, 3);
  assert.equal(shocked.shock.kind, 'supply_shortage');
  const priced = rebalanceMarketPrices({
    ...shocked.world,
    businesses: {
      ...shocked.world.businesses!,
      hobbs_cafe: {
        ...shocked.world.businesses!['hobbs_cafe'],
        stock: {
          ...shocked.world.businesses!['hobbs_cafe'].stock,
          coffee: {
            ...shocked.world.businesses!['hobbs_cafe'].stock.coffee!,
            quantity: 12,
            maxStock: 36,
          },
        },
      },
    },
  });
  assert.ok(priced.businesses!['hobbs_cafe'].stock.coffee!.price >= prevCoffeePrice + 1);

  // BDI normalizer + arrival-grounded execution across new Phase 2 verbs
  const patchSchedule = (sched: WorldState['agents'][number]['dailySchedule'], blk: WorldState['agents'][number]['dailySchedule'][number]) => [
    blk,
    ...sched.slice(0, 6),
  ];

  const decCoal = normalizeBdiDecisionPayload(
    {
      action: 'form_coalition',
      reason: 'Unite neighbors for clinic funding.',
      coalitionName: 'Clinic Advocates',
      coalitionAgenda: 'public_welfare',
    },
    new Set(priced.locations.map((l) => l.id)),
  );
  assert.equal(decCoal.action, 'form_coalition');
  assert.equal(decCoal.coalitionAgenda, 'public_welfare');

  let bdiWorld = applyBdiDecisionResult(priced, 'elena', decCoal, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });
  assert.ok((bdiWorld.coalitions ?? []).some((c) => c.name === 'Clinic Advocates'));

  const decBoycott = normalizeBdiDecisionPayload(
    {
      action: 'call_boycott',
      reason: 'Protest high pub prices.',
      boycottLocationId: 'rose_crown_pub',
      boycottReason: 'Overpriced drinks',
    },
    new Set(priced.locations.map((l) => l.id)),
  );
  bdiWorld = applyBdiDecisionResult(bdiWorld, 'clara', decBoycott, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });
  assert.ok((bdiWorld.boycotts ?? []).some((b) => b.targetLocationId === 'rose_crown_pub'));

  // Run a short simulation step & validateWorld -> 0 issues
  const stepped = stepWorldState(bdiWorld, 5).nextState;
  const issues = validateWorld(stepped);
  assert.deepEqual(issues, []);
});
