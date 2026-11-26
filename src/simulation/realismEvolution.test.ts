/**
 * Deterministic unit test suite for Phases F, G, H, and I:
 * - Phase F: Biographical dossiers, per-temperament OpenRouter decoding spread,
 *   bi-temporal belief superseding, trust-gated belief receptivity, and A-MEM associative linking.
 * - Phase G: Bilateral peer loans (trust/risk refusal, repayment, default grudge & belief revision),
 *   grassroots citizen petitions (worldview gating + quorum escalation to CivicProposal),
 *   resident-founded micro-ventures (startup cost, notice board post, foot-traffic sales),
 *   and BDI action dispatch for propose_loan, launch_venture, sign_petition.
 * - Phase H: Housing rent & rent-strain shared household relocation, career tier promotions.
 * - Phase I: Quantitative collapse diagnostics (Distinct-2 lexical diversity, mood std-dev,
 *   trust polarization, collapse risk classification), lossless v5 -> v6 save migration,
 *   and 18 -> 100 -> 18 scaling integrity with hydrated dossiers, beliefs, housing & careers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWorldState } from '../services/worldStore';
import { applyBdiDecisionResult, detectBdiDecisionFork } from './autonomy';
import {
  applyTrustGatedBeliefUpdate,
  attachAssociativeLinks,
  expandAssociativeRetrieval,
  getActiveBeliefs,
  upsertBelief,
} from './cognitiveDepth';
import {
  applyNegotiatedDeal,
  issueBilateralLoan,
  launchMicroVenture,
  runAmbientSurrogateCycle,
  settleMaturingLoans,
  signCitizenPetition,
  stepCareerProgression,
  stepHousingAndHouseholds,
  stepMicroVentures,
} from './contractsAndLife';
import {
  computeDiversitySnapshot,
  computeLexicalDiversity,
  computeMoodStdDev,
  computeTrustPolarization,
} from './diversityMetrics';
import {
  applyConsolidationResult,
  applyConversationResult,
  applyReflectionResult,
  createInitialWorldState,
  stepWorldState,
} from './engine';
import { openTownElection, stepTownElection } from './institutions';
import {
  normalizeBdiDecisionPayload,
  normalizeBeliefUpdates,
  normalizeNegotiatedDeal,
} from './llmJson';
import { createMemoryNode } from './memory';
import { scaleWorldPopulation } from './scaleGenerator';
import { WORLD_SCHEMA_VERSION, type RetrievedMemory, type ScheduleBlock } from './types';
import { validateWorld } from './validateWorld';

function makeCounterAlloc() {
  let seq = 1;
  return (prefix: string) => `${prefix}_${seq++}`;
}

test('Phase F: all 18 core residents have distinct biographical dossiers, beliefs, and decoding temperature spread', () => {
  const world = createInitialWorldState();
  assert.equal(world.agents.length, 18);

  const backgrounds = new Set<string>();
  const temps: number[] = [];

  for (const agent of world.agents) {
    assert.ok(agent.dossier, `${agent.name} should have a biographical dossier`);
    assert.ok(agent.dossier.background.length > 30);
    assert.ok(agent.dossier.redLines.length >= 2);
    assert.ok(agent.temperament, `${agent.name} should have a temperament`);
    assert.ok(agent.beliefs && agent.beliefs.length >= 2, `${agent.name} should have seeded beliefs`);

    backgrounds.add(agent.dossier.background);
    temps.push(agent.temperament.decoding.temperature);
  }

  assert.equal(backgrounds.size, 18, 'every core resident must have a distinct background');
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  assert.ok(
    maxTemp - minTemp >= 0.14,
    `expected meaningful OpenRouter temperature spread across residents, got ${minTemp}..${maxTemp}`,
  );
});

test('Phase F: bi-temporal belief graph supersedes contradictory claims and tracks history', () => {
  const alloc = makeCounterAlloc();
  const initial = upsertBelief(
    [],
    {
      subjectId: 'arthur',
      predicate: 'trustworthiness',
      claim: 'Arthur keeps his promises at the pub.',
      confidence: 0.78,
      sourceMemoryId: 'mem_1',
    },
    600,
    alloc,
  );
  assert.equal(initial.revised, false);
  assert.equal(initial.beliefs.length, 1);

  const revised = upsertBelief(
    initial.beliefs,
    {
      subjectId: 'arthur',
      predicate: 'trustworthiness',
      claim: 'Arthur broke his word on a supply agreement.',
      confidence: 0.92,
      sourceMemoryId: 'mem_2',
    },
    1850,
    alloc,
  );
  assert.equal(revised.revised, true);
  assert.equal(revised.beliefs.length, 2);

  const active = getActiveBeliefs(revised.beliefs);
  assert.equal(active.length, 1);
  assert.match(active[0].claim, /broke his word/i);

  const superseded = revised.beliefs.find((b) => b.invalidatedAtSimMin !== undefined);
  assert.ok(superseded, 'prior belief should be marked superseded');
  assert.equal(superseded.invalidatedAtSimMin, 1850);
  assert.equal(superseded.supersededById, active[0].id);
});

test('Phase F: trust-gated belief receptivity rejects claims from low-trust peers for stubborn residents', () => {
  const world = createInitialWorldState();
  const alloc = makeCounterAlloc();
  const sam = world.agents.find((a) => a.id === 'sam')!;
  assert.ok((sam.temperament?.stubbornness ?? 0) >= 0.8);

  const lowTrustSam = {
    ...sam,
    socialGraph: {
      ...sam.socialGraph,
      klaus: {
        targetId: 'klaus',
        roleLabel: 'Skeptical critic',
        trust: 14,
        affection: 20,
        familiarity: 35,
        inferredGoal: 'Challenging town spending',
        lastUpdatedSimMin: world.simMinutes,
      },
    },
  };

  const rejected = applyTrustGatedBeliefUpdate(
    lowTrustSam,
    'klaus',
    {
      subjectId: 'town_policy',
      predicate: 'policy_stance',
      claim: 'Smallville should double municipal spending immediately.',
      confidence: 0.8,
    },
    world.simMinutes,
    alloc,
  );
  assert.equal(rejected.accepted, false);

  const trustedSam = {
    ...sam,
    socialGraph: {
      ...sam.socialGraph,
      john: {
        targetId: 'john',
        roleLabel: 'Trusted merchant',
        trust: 82,
        affection: 70,
        familiarity: 75,
        inferredGoal: 'Balanced town budgets',
        lastUpdatedSimMin: world.simMinutes,
      },
    },
  };

  const accepted = applyTrustGatedBeliefUpdate(
    trustedSam,
    'john',
    {
      subjectId: 'town_policy',
      predicate: 'policy_stance',
      claim: 'Wholesale shipping prices rose this week so town projects need firm budgets.',
      confidence: 0.8,
    },
    world.simMinutes,
    alloc,
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.revised, true);
});

test('Phase F: A-MEM associative linking connects related memories and expands retrieval by 1 hop', () => {
  const m1 = createMemoryNode({
    id: 'm_loan_1',
    createdAt: 500,
    type: 'observation',
    source: 'contract',
    description: 'John Lin lent $60 to Eddy Lin for studio microphone rent due Day 4.',
    importance: 7,
  });
  const m2 = createMemoryNode({
    id: 'm_loan_2',
    createdAt: 1900,
    type: 'observation',
    source: 'contract',
    description: 'Eddy Lin repaid the $60 loan to John Lin on Day 4 after his music shift.',
    importance: 8,
  });

  const { linkedNode, updatedExisting } = attachAssociativeLinks(m2, [m1]);
  assert.ok(linkedNode.linkedMemoryIds?.includes('m_loan_1'));
  assert.ok(updatedExisting[0].linkedMemoryIds?.includes('m_loan_2'));

  const all = [linkedNode, ...updatedExisting];
  const primaryRetrieved: RetrievedMemory[] = [
    {
      node: linkedNode,
      score: 0.9,
      recencyScore: 0.95,
      importanceScore: 0.8,
      relevanceScore: 0.9,
      usedEmbedding: false,
    },
  ];
  const expanded = expandAssociativeRetrieval(primaryRetrieved, all, 2);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[1].node.id, 'm_loan_1');
});

test('Phase G: bilateral peer loans enforce trust refusal, settle repayments, and penalize defaults with belief revision', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();

  // Make John frugal + low trust toward Eddy -> should refuse
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'john') {
        return {
          ...a,
          wallet: 350,
          socialGraph: {
            ...a.socialGraph,
            eddy: {
              ...(a.socialGraph.eddy ?? {
                targetId: 'eddy',
                roleLabel: 'Son',
                affection: 50,
                familiarity: 80,
                inferredGoal: 'Music',
                lastUpdatedSimMin: world.simMinutes,
              }),
              trust: 22,
            },
          },
        };
      }
      return a;
    }),
  };

  const refused = issueBilateralLoan(world, 'john', 'eddy', 50, 2, alloc);
  assert.equal(refused.ok, false);
  assert.ok((refused.world.stats.refusalsAndDisagreements ?? 0) >= 1);

  // Raise trust -> loan approved and wallets updated
  world = {
    ...refused.world,
    agents: refused.world.agents.map((a) => {
      if (a.id === 'john') {
        return {
          ...a,
          wallet: 350,
          socialGraph: {
            ...a.socialGraph,
            eddy: { ...a.socialGraph.eddy, trust: 78 },
          },
        };
      }
      if (a.id === 'eddy') return { ...a, wallet: 30 };
      return a;
    }),
  };

  const approved = issueBilateralLoan(world, 'john', 'eddy', 50, 2, alloc);
  assert.equal(approved.ok, true);
  assert.ok(approved.loan);
  const eddyAfterLoan = approved.world.agents.find((a) => a.id === 'eddy')!;
  const johnAfterLoan = approved.world.agents.find((a) => a.id === 'john')!;
  assert.equal(eddyAfterLoan.wallet, 80);
  assert.equal(johnAfterLoan.wallet, 300);

  // Case A: Solvent repayment on dueDay
  const repaidRes = settleMaturingLoans(approved.world, approved.loan!.dueDay, alloc);
  assert.equal(repaidRes.repaid, 1);
  assert.equal(repaidRes.defaulted, 0);
  assert.equal(repaidRes.world.loans![0].status, 'repaid');

  // Case B: Insolvent default -> trust slashed & belief revised
  const brokeWorld = {
    ...approved.world,
    agents: approved.world.agents.map((a) => (a.id === 'eddy' ? { ...a, wallet: 5 } : a)),
  };
  const defaultedRes = settleMaturingLoans(brokeWorld, approved.loan!.dueDay, alloc);
  assert.equal(defaultedRes.defaulted, 1);
  assert.equal(defaultedRes.world.loans![0].status, 'defaulted');

  const johnAfterDefault = defaultedRes.world.agents.find((a) => a.id === 'john')!;
  assert.ok(johnAfterDefault.socialGraph.eddy.trust < 55, 'lender trust must drop sharply on default');
  const activeJohnBelief = getActiveBeliefs(johnAfterDefault.beliefs, ['eddy']).find(
    (b) => b.subjectId === 'eddy' && b.predicate === 'trustworthiness',
  );
  assert.ok(activeJohnBelief && /defaulted/i.test(activeJohnBelief.claim));
});

test('Phase G: grassroots citizen petitions respect ideological pushback and escalate to formal CivicProposal at quorum', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();
  const pet = world.petitions![0];
  assert.equal(pet.status, 'gathering');

  // Fiscal conservative Sam with low sponsor trust should decline clinic subsidy petition
  world = {
    ...world,
    agents: world.agents.map((a) =>
      a.id === 'sam'
        ? {
            ...a,
            wallet: 260,
            socialGraph: {
              ...a.socialGraph,
              [pet.sponsorId]: {
                targetId: pet.sponsorId,
                roleLabel: 'Neighbor',
                trust: 45,
                affection: 45,
                familiarity: 40,
                inferredGoal: 'Civic spending',
                lastUpdatedSimMin: world.simMinutes,
              },
            },
          }
        : a,
    ),
  };

  const declined = signCitizenPetition(world, 'sam', pet.id, alloc, false);
  assert.equal(declined.signed, false);

  // Gather enough signatures to hit quorum -> escalates onto formal proposals ballot
  const proposalsBefore = (declined.world.proposals ?? []).length;
  let working = declined.world;
  let escalated = false;
  for (const ag of working.agents) {
    if (pet.signerIds.includes(ag.id)) continue;
    const res = signCitizenPetition(working, ag.id, pet.id, alloc, true);
    working = res.world;
    if (res.escalated) {
      escalated = true;
      break;
    }
  }
  assert.equal(escalated, true);
  assert.equal(working.petitions!.find((p) => p.id === pet.id)?.status, 'escalated');
  assert.ok((working.proposals ?? []).length >= proposalsBefore);
  assert.ok((working.stats.petitionsEscalated ?? 0) >= 1);
});

test('Phase G: resident micro-ventures launch with startup capital, post notices, and settle live foot-traffic sales', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();
  world = {
    ...world,
    agents: world.agents.map((a) => (a.id === 'rajiv' ? { ...a, wallet: 260 } : a)),
  };

  const launched = launchMicroVenture(world, 'rajiv', alloc, 'Rajiv Fine Print Stall');
  assert.equal(launched.ok, true);
  assert.ok(launched.venture);
  assert.equal(launched.venture!.name, 'Rajiv Fine Print Stall');
  assert.equal(launched.world.agents.find((a) => a.id === 'rajiv')!.wallet, 170);
  assert.ok(
    (launched.world.notices ?? []).some((n) => n.title.includes('Rajiv Fine Print Stall')),
    'launching a micro-venture should post a public notice',
  );

  // Place a solvent passerby at the venture location and step sales
  const vLoc = launched.venture!.locationId;
  const withBuyer = {
    ...launched.world,
    agents: launched.world.agents.map((a) =>
      a.id === 'isabella' ? { ...a, currentLocationId: vLoc, wallet: 200 } : a,
    ),
  };
  const afterSale = stepMicroVentures(withBuyer, alloc);
  const updatedVenture = afterSale.ventures!.find((v) => v.id === launched.venture!.id)!;
  assert.equal(updatedVenture.revenue, updatedVenture.unitPrice);
  assert.equal(updatedVenture.stock, 7);
});

test('Phase G: BDI decision executor dispatches propose_loan, launch_venture, and sign_petition', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'rajiv') return { ...a, wallet: 260 };
      if (a.id === 'isabella') return { ...a, wallet: 300 };
      return a;
    }),
  };

  const noopPatch = (sched: ScheduleBlock[]) => sched;
  const afterVenture = applyBdiDecisionResult(
    world,
    'rajiv',
    {
      action: 'launch_venture',
      reason: 'Ready to sell prints directly to neighbors.',
      ventureName: 'Cottage Woodblock Press',
    },
    alloc,
    noopPatch,
  );
  assert.ok(afterVenture.ventures!.some((v) => v.name === 'Cottage Woodblock Press'));

  const petId = afterVenture.petitions![0].id;
  const afterPet = applyBdiDecisionResult(
    afterVenture,
    'isabella',
    {
      action: 'sign_petition',
      reason: 'Supporting neighborhood clinic access.',
      petitionId: petId,
    },
    alloc,
    noopPatch,
  );
  assert.ok(afterPet.petitions!.find((p) => p.id === petId)!.signerIds.includes('isabella'));
});

test('Phase H: housing rent strain moves renters into shared households and skill mastery triggers career promotions', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();

  // Put Klaus under rent strain as a renter with a trusted peer (Maria)
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'klaus') {
        return {
          ...a,
          housingStatus: 'renter' as const,
          monthlyRent: 40,
          wallet: 28,
          socialGraph: {
            ...a.socialGraph,
            maria: {
              ...(a.socialGraph.maria ?? {
                targetId: 'maria',
                roleLabel: 'Classmate',
                affection: 65,
                familiarity: 75,
                inferredGoal: 'Research',
                lastUpdatedSimMin: world.simMinutes,
              }),
              trust: 76,
            },
          },
          careerTier: 'apprentice' as const,
          wagePerHour: 14,
          skills: { ...a.skills, research: 64 },
        };
      }
      return a;
    }),
  };

  const housed = stepHousingAndHouseholds(world, 3, alloc);
  assert.ok(housed.moves >= 1);
  const klausHoused = housed.world.agents.find((a) => a.id === 'klaus')!;
  assert.equal(klausHoused.housingStatus, 'shared');
  assert.equal(klausHoused.monthlyRent, 20);
  assert.ok(klausHoused.householdPartnerIds?.includes('maria'));

  const promoted = stepCareerProgression(housed.world, alloc);
  assert.ok(promoted.promotions >= 1);
  const klausPromoted = promoted.world.agents.find((a) => a.id === 'klaus')!;
  assert.equal(klausPromoted.careerTier, 'practitioner');
  assert.equal(klausPromoted.wagePerHour, 16);
});

test('Phase I: diversity diagnostics distinguish varied conversations from repetitive persona-collapse loops', () => {
  const world = createInitialWorldState();
  const baseline = computeDiversitySnapshot(world);
  assert.ok(baseline.lexicalDiversity >= 0.4);
  assert.ok(computeMoodStdDev(world.agents) >= 0);
  assert.ok(computeTrustPolarization(world.agents) > 0);

  // Repetitive sycophantic dialogue + flat uniform trust/mood => collapse_risk
  const repetitiveConvs = Array.from({ length: 8 }, (_, idx) => ({
    id: `c_rep_${idx}`,
    simMinutes: 500 + idx * 10,
    startedAt: 500 + idx * 10,
    locationId: 'hobbs_cafe',
    locationName: 'Hobbs Cafe',
    participantIds: ['isabella', 'john'],
    participantNames: ['Isabella Rodriguez', 'John Lin'],
    summary: 'Agreed politely.',
    turns: [
      {
        speakerId: 'isabella',
        speakerName: 'Isabella Rodriguez',
        text: 'That is a wonderful idea I completely agree with you today.',
      },
      {
        speakerId: 'john',
        speakerName: 'John Lin',
        text: 'That is a wonderful idea I completely agree with you today.',
      },
    ],
  }));

  const collapsedLex = computeLexicalDiversity(repetitiveConvs);
  assert.ok(collapsedLex < 0.35, `expected low Distinct-2 for repetitive text, got ${collapsedLex}`);

  const flatWorld = {
    ...world,
    conversations: repetitiveConvs,
    agents: world.agents.map((a) => ({
      ...a,
      mood: { valence: 0.2, arousal: 0.2, label: 'content' as const },
      socialGraph: Object.fromEntries(
        Object.entries(a.socialGraph).map(([k, v]) => [k, { ...v, trust: 60 }]),
      ),
    })),
  };
  const collapsedSnap = computeDiversitySnapshot(flatWorld);
  assert.equal(collapsedSnap.collapseRiskLevel, 'collapse_risk');
});

test('Phase I: schema v6 lossless migration hydrates v5 saves and 18 -> 100 -> 18 scaling preserves world validity', () => {
  const world = createInitialWorldState();

  // Strip Phase F-I fields to simulate a legacy schema v5 save
  const legacyV5 = {
    ...world,
    schemaVersion: 5,
    loans: undefined,
    petitions: undefined,
    ventures: undefined,
    diversityHistory: undefined,
    agents: world.agents.map((a) => {
      const copy = { ...a } as Record<string, unknown>;
      delete copy.dossier;
      delete copy.temperament;
      delete copy.beliefs;
      delete copy.housingStatus;
      delete copy.careerTier;
      return copy;
    }),
  };

  const migRes = migrateWorldState(legacyV5);
  assert.ok(migRes.world, 'v5 save must migrate cleanly');
  const migrated = migRes.world!;
  assert.equal(migrated.schemaVersion, WORLD_SCHEMA_VERSION);
  assert.ok(migrated.agents.every((a) => a.dossier && a.temperament && a.beliefs?.length));
  assert.ok(migrated.agents.every((a) => a.housingStatus && a.careerTier));
  assert.ok(Array.isArray(migrated.petitions) && migrated.petitions.length > 0);
  assert.ok(Array.isArray(migrated.diversityHistory) && migrated.diversityHistory.length > 0);

  // Scale 18 -> 100 -> 18 and verify zero world validation issues
  const scaledUp = scaleWorldPopulation(migrated, 100);
  assert.equal(scaledUp.agents.length, 100);
  assert.ok(
    scaledUp.agents.every((a) => a.dossier && a.temperament && a.beliefs && a.housingStatus && a.careerTier),
    'all procedural citizens must receive cognitive dossiers, beliefs, housing & career tiers',
  );
  assert.equal(validateWorld(scaledUp).length, 0);

  const scaledDown = scaleWorldPopulation(scaledUp, 18);
  assert.equal(scaledDown.agents.length, 18);
  assert.equal(validateWorld(scaledDown).length, 0);
});

test('Autonomy Overhaul: zero deterministic hijacking of focal agents (midnight surrogate, proximity civic voting, and election polling)', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();

  // Give focal agents extreme cash (poor borrower + flush lender + flush entrepreneur) and put Isabella inside Town Hall
  world = {
    ...world,
    simMinutes: 10 * 60 - 1, // 09:59 so a 1-min step crosses 10:00 (20-min boundary)
    agents: world.agents.map((a) => {
      if (a.id === 'eddy') return { ...a, tier: 'focal' as const, wallet: 15 };
      if (a.id === 'john') return { ...a, tier: 'focal' as const, wallet: 500 };
      if (a.id === 'rajiv') return { ...a, tier: 'focal' as const, wallet: 450 };
      if (a.id === 'isabella') {
        return { ...a, tier: 'focal' as const, currentLocationId: 'town_hall', path: [] };
      }
      return { ...a, tier: 'focal' as const };
    }),
  };

  // 1. Midnight surrogate cycle MUST leave focal agents completely untouched
  const afterSurrogate = runAmbientSurrogateCycle(world, alloc);
  assert.equal((afterSurrogate.loans ?? []).length, 0, 'focal agents must not be forced into midnight surrogate loans');
  assert.equal((afterSurrogate.ventures ?? []).length, 0, 'focal agents must not have surrogate ventures auto-launched');
  assert.equal(
    afterSurrogate.petitions![0].signerIds.length,
    world.petitions![0].signerIds.length,
    'focal agents must not have petitions auto-signed by surrogate cycle',
  );

  // 2. Proximity civic voting in stepWorldState MUST NOT auto-vote for focal agents at Town Hall
  const stepped = stepWorldState(world, 1);
  const openProp = stepped.nextState.proposals![0];
  assert.equal(
    openProp.votesFor.includes('isabella') || openProp.votesAgainst.includes('isabella'),
    false,
    'focal agent standing in Town Hall must not be auto-voted on a timer',
  );

  // 3. stepTownElection MUST NOT auto-cast election ballots for focal agents during polling hours
  const openedElection = openTownElection(world, alloc);
  const afterPollTick = stepTownElection(openedElection, alloc);
  assert.equal(
    afterPollTick.election!.votersCast.length,
    0,
    'focal agents must cast election ballots autonomously, not via stepTownElection timer',
  );
});

test('Autonomy Overhaul: shock-driven & opportunity-driven detectBdiDecisionFork triggers and 90-min cooldown', () => {
  const alloc = makeCounterAlloc();
  const baseWorld = createInitialWorldState();
  const baseSim = 14 * 60; // 14:00 daytime

  // 1. Health shock
  const sickAgent = {
    ...baseWorld.agents[0],
    illness: 'mild_cold' as const,
    health: 52,
    lastDecisionSimMin: -999,
  };
  const healthFork = detectBdiDecisionFork({ ...baseWorld, simMinutes: baseSim }, sickAgent);
  assert.ok(healthFork && healthFork.urgency >= 0.9, 'illness should trigger high-urgency health shock fork');

  // 2. Cooldown respects 90 sim-min (blocks at 60 min, fires at 95 min)
  const blockedCooldown = detectBdiDecisionFork(
    { ...baseWorld, simMinutes: baseSim },
    { ...sickAgent, lastDecisionSimMin: baseSim - 60 },
  );
  assert.equal(blockedCooldown, null, 'cooldown should prevent re-firing before 90 sim-min');
  const clearedCooldown = detectBdiDecisionFork(
    { ...baseWorld, simMinutes: baseSim },
    { ...sickAgent, lastDecisionSimMin: baseSim - 95 },
  );
  assert.ok(clearedCooldown, 'fork should re-fire after 90 sim-min');

  // 3. Betrayal / defaulted loan shock
  const lender = { ...baseWorld.agents.find((a) => a.id === 'john')!, wallet: 200, lastDecisionSimMin: -999 };
  const betrayalWorld = {
    ...baseWorld,
    simMinutes: baseSim,
    loans: [
      {
        id: 'loan_def_1',
        lenderId: 'john',
        borrowerId: 'eddy',
        principal: 60,
        interestPct: 5,
        amountDue: 63,
        issuedDay: 1,
        dueDay: 1,
        status: 'defaulted' as const,
        resolvedDay: 1,
      },
    ],
  };
  const betrayalFork = detectBdiDecisionFork(betrayalWorld, lender);
  assert.ok(betrayalFork && /defaulted/i.test(betrayalFork.forkReason));

  // 4. Open election voting fork for unvoted focal agent
  const votingWorld = openTownElection({ ...baseWorld, simMinutes: baseSim }, alloc);
  const voter = { ...votingWorld.agents.find((a) => a.id === 'isabella')!, wallet: 150, lastDecisionSimMin: -999 };
  const electionFork = detectBdiDecisionFork(votingWorld, voter);
  assert.ok(electionFork && /vote_election/i.test(electionFork.forkReason));
});

test('Autonomy Overhaul: BDI executor wires real transfer_money, custom launch_venture, start_petition, declare_candidacy, and vote_election', () => {
  const alloc = makeCounterAlloc();
  const noopPatch = (sched: ScheduleBlock[]) => sched;
  let world = createInitialWorldState();
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'john') return { ...a, wallet: 300 };
      if (a.id === 'eddy') return { ...a, wallet: 25 };
      if (a.id === 'rajiv') return { ...a, wallet: 280 };
      return a;
    }),
  };

  // 1. Real peer cash transfer
  const afterTransfer = applyBdiDecisionResult(
    world,
    'john',
    {
      action: 'transfer_money',
      reason: 'Helping Eddy cover studio rent this week.',
      targetAgentId: 'eddy',
      transferAmount: 40,
    },
    alloc,
    noopPatch,
  );
  assert.equal(afterTransfer.agents.find((a) => a.id === 'john')!.wallet, 260);
  assert.equal(afterTransfer.agents.find((a) => a.id === 'eddy')!.wallet, 65);
  assert.ok(
    (afterTransfer.transactions ?? []).some((t) => t.kind === 'transfer' && t.fromId === 'john' && t.toId === 'eddy' && t.amount === 40),
  );

  // 2. Custom LLM-chosen venture locationId + itemKind
  const afterVenture = applyBdiDecisionResult(
    afterTransfer,
    'rajiv',
    {
      action: 'launch_venture',
      reason: 'Opening a rare book & print table by the park.',
      ventureName: 'Oak Park Folio Table',
      locationId: 'johnson_park',
      itemKind: 'book',
    },
    alloc,
    noopPatch,
  );
  const createdVenture = afterVenture.ventures!.find((v) => v.name === 'Oak Park Folio Table');
  assert.ok(createdVenture);
  assert.equal(createdVenture.locationId, 'johnson_park');
  assert.equal(createdVenture.itemKind, 'book');

  // 3. Resident starts a brand-new grassroots petition
  const petCountBefore = (afterVenture.petitions ?? []).length;
  const afterStartPet = applyBdiDecisionResult(
    afterVenture,
    'maria',
    {
      action: 'start_petition',
      reason: 'Students need late evening library access for exam prep.',
      petitionTitle: 'Keep Oak Hill Library Open Until 10 PM',
      petitionDescription: 'Extend evening reading room hours.',
      petitionEffect: 'extendedLibrary',
    },
    alloc,
    noopPatch,
  );
  assert.equal((afterStartPet.petitions ?? []).length, petCountBefore + 1);
  assert.ok(afterStartPet.petitions!.some((p) => p.title === 'Keep Oak Hill Library Open Until 10 PM' && p.sponsorId === 'maria'));

  // 4. Organic Mayoral candidacy & LLM-selected election vote
  const afterCandidacy = applyBdiDecisionResult(
    afterStartPet,
    'klaus',
    {
      action: 'declare_candidacy',
      reason: 'Running to champion independent research and affordable rents.',
      platform: 'Protect renters and expand public learning spaces.',
    },
    alloc,
    noopPatch,
  );
  assert.ok(afterCandidacy.election!.candidates.some((c) => c.agentId === 'klaus'));

  // Opening polls preserves Klaus's organic candidacy
  const pollsOpen = openTownElection(afterCandidacy, alloc);
  assert.ok(pollsOpen.election!.candidates.some((c) => c.agentId === 'klaus'));

  // Maria votes specifically for Klaus
  const afterVote = applyBdiDecisionResult(
    pollsOpen,
    'maria',
    {
      action: 'vote_election',
      reason: 'Backing Klaus on renter protections and library funding.',
      candidateId: 'klaus',
    },
    alloc,
    noopPatch,
  );
  const klausVotes = afterVote.election!.candidates.find((c) => c.agentId === 'klaus')!.votes;
  assert.equal(klausVotes, 1);
  assert.ok(afterVote.election!.votersCast.includes('maria'));
});

test('Autonomy Overhaul: conversations apply trust-gated LLM belief updates and execute negotiated bilateral deals', () => {
  let world = createInitialWorldState();
  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'sam') {
        return {
          ...a,
          socialGraph: {
            ...a.socialGraph,
            klaus: {
              targetId: 'klaus',
              roleLabel: 'Critic',
              trust: 15,
              affection: 20,
              familiarity: 35,
              inferredGoal: 'Debate',
              lastUpdatedSimMin: world.simMinutes,
            },
          },
        };
      }
      if (a.id === 'isabella') return { ...a, wallet: 250 };
      if (a.id === 'eddy') return { ...a, wallet: 20 };
      return a;
    }),
  };

  // Case 1: Stubborn low-trust Sam resists Klaus's belief claim, while dialogue refusal increments disagreements
  const afterConflict = applyConversationResult(world, {
    agentAId: 'sam',
    agentBId: 'klaus',
    turns: [
      { speakerId: 'klaus', speakerName: 'Klaus Mueller', text: 'You should back our new clinic tax.' },
      { speakerId: 'sam', speakerName: 'Sam Moore', text: 'Not a chance, our budget cannot absorb that.' },
    ],
    summaryA: 'Sam pushed back against Klaus on municipal spending.',
    summaryB: 'Klaus argued with Sam over the clinic proposal.',
    beliefUpdatesA: [
      {
        subjectId: 'town_policy',
        predicate: 'policy_stance',
        claim: 'Town should double taxes for clinic expansion.',
        confidence: 0.78,
      },
    ],
    bilateralDeal: {
      kind: 'refusal',
      proposerId: 'klaus',
      responderId: 'sam',
      accepted: false,
      note: 'Sam refused to endorse the clinic spending push.',
    },
  });
  const samBeliefs = getActiveBeliefs(afterConflict.agents.find((a) => a.id === 'sam')!.beliefs);
  assert.equal(
    samBeliefs.some((b) => /double taxes/i.test(b.claim)),
    false,
    'stubborn low-trust Sam must reject Klaus external belief claim',
  );
  assert.ok((afterConflict.stats.refusalsAndDisagreements ?? 0) >= 1);

  // Case 2: Negotiated peer transfer inside dialogue moves real cash
  const afterDeal = applyConversationResult(afterConflict, {
    agentAId: 'isabella',
    agentBId: 'eddy',
    turns: [
      { speakerId: 'eddy', speakerName: 'Eddy Lin', text: 'Could you spot me $30 for strings until Friday?' },
      { speakerId: 'isabella', speakerName: 'Isabella Rodriguez', text: 'Sure thing Eddy, here is $30.' },
    ],
    summaryA: 'Isabella handed Eddy $30 to help with music supplies.',
    summaryB: 'Eddy received $30 from Isabella for music supplies.',
    bilateralDeal: {
      kind: 'transfer',
      proposerId: 'isabella',
      responderId: 'eddy',
      accepted: true,
      amount: 30,
      note: 'Music supplies support agreed at Hobbs Cafe',
    },
  });
  assert.equal(afterDeal.agents.find((a) => a.id === 'isabella')!.wallet, 220);
  assert.equal(afterDeal.agents.find((a) => a.id === 'eddy')!.wallet, 50);

  // Verify normalizers accept valid payloads and drop invalid ones
  assert.equal(
    normalizeBeliefUpdates([
      { subjectId: 'town', predicate: 'world_fact', claim: 'Cafe opens early on weekends', confidence: 0.85 },
      { subjectId: 'town', predicate: 'invalid_pred', claim: 'Dropped' },
    ]).length,
    1,
  );
  const normDeal = normalizeNegotiatedDeal(
    { kind: 'loan', proposerId: 'eddy', responderId: 'john', accepted: true, amount: 45, note: 'Short bridge loan' },
    new Set(['eddy', 'john']),
  );
  assert.ok(normDeal && normDeal.amount === 45);
  const normDecision = normalizeBdiDecisionPayload({
    action: 'declare_candidacy',
    reason: 'Step up for neighborhood stewardship',
    platform: 'Support local shops and public parks.',
    candidateId: 'klaus',
    transferAmount: 35,
  });
  assert.equal(normDecision.action, 'declare_candidacy');
  assert.equal(normDecision.platform, 'Support local shops and public parks.');
  assert.equal(normDecision.transferAmount, 35);
});

test('Phase 0 regressions: unique declined-deal memory IDs, symmetric households, A-MEM reflection/consolidation links, and cumulative conversation metrics', () => {
  const alloc = makeCounterAlloc();
  let world = createInitialWorldState();

  // 1. Declined negotiated deal must allocate distinct memory IDs across proposer & responder
  const afterRefusal = applyNegotiatedDeal(
    world,
    {
      kind: 'refusal',
      proposerId: 'klaus',
      responderId: 'sam',
      accepted: false,
      note: 'Sam declined the budget proposal.',
    },
    alloc,
  ).world;
  const klausMemId = afterRefusal.agents.find((a) => a.id === 'klaus')!.memories[0].id;
  const samMemId = afterRefusal.agents.find((a) => a.id === 'sam')!.memories[0].id;
  assert.notEqual(klausMemId, samMemId, 'Proposer and responder must receive distinct memory IDs');
  assert.equal(validateWorld(afterRefusal).length, 0);

  // 2. Shared household move-in symmetrically updates host & upgrade clears both sides
  const strainedWorld = {
    ...afterRefusal,
    agents: afterRefusal.agents.map((a) =>
      a.id === 'klaus'
        ? {
            ...a,
            housingStatus: 'renter' as const,
            monthlyRent: 40,
            wallet: 20,
            socialGraph: {
              ...a.socialGraph,
              maria: {
                ...(a.socialGraph.maria ?? {
                  targetId: 'maria',
                  roleLabel: 'Classmate',
                  affection: 65,
                  familiarity: 75,
                  inferredGoal: 'Research',
                  lastUpdatedSimMin: afterRefusal.simMinutes,
                }),
                trust: 80,
              },
            },
          }
        : a,
    ),
  };
  const movedIn = stepHousingAndHouseholds(strainedWorld, 3, alloc).world;
  const mariaAfterMove = movedIn.agents.find((a) => a.id === 'maria')!;
  assert.ok(
    mariaAfterMove.householdPartnerIds?.includes('klaus'),
    'Host householdPartnerIds must symmetrically include mover',
  );
  assert.ok(
    mariaAfterMove.memories.some((m) => m.description.includes('Klaus')),
    'Host must receive a memory of the shared household',
  );

  const richKlausWorld = {
    ...movedIn,
    agents: movedIn.agents.map((a) => (a.id === 'klaus' ? { ...a, wallet: 450 } : a)),
  };
  const upgraded = stepHousingAndHouseholds(richKlausWorld, 6, alloc).world;
  const klausUp = upgraded.agents.find((a) => a.id === 'klaus')!;
  const mariaUp = upgraded.agents.find((a) => a.id === 'maria')!;
  assert.equal(klausUp.housingStatus, 'renter');
  assert.equal((klausUp.householdPartnerIds ?? []).length, 0);
  assert.equal(mariaUp.householdPartnerIds?.includes('klaus') ?? false, false);

  // 3. Reflection & consolidation attach A-MEM associative links and apply beliefUpdates
  const reflWorld = applyReflectionResult(
    upgraded,
    'isabella',
    [
      {
        insight: 'Morning coffee demand at Hobbs Cafe stays strong when pastry stock is fresh.',
        importance: 8,
        evidenceIds: [],
      },
    ],
    [],
    [
      {
        subjectId: 'hobbs_cafe',
        predicate: 'world_fact',
        claim: 'Fresh pastries boost morning cafe coffee traffic.',
        confidence: 0.85,
      },
    ],
  );
  const isabellaRefl = reflWorld.agents.find((a) => a.id === 'isabella')!;
  const reflNode = isabellaRefl.memories.find((m) => m.type === 'reflection')!;
  assert.ok((reflNode.linkedMemoryIds?.length ?? 0) > 0, 'Reflection node must attach A-MEM links');
  assert.ok(
    getActiveBeliefs(isabellaRefl.beliefs, ['hobbs_cafe']).some((b) =>
      b.claim.includes('Fresh pastries boost morning cafe'),
    ),
  );

  const consWorld = applyConsolidationResult(reflWorld, 'isabella', {
    consolidatedInsights: [
      {
        insight: 'Hobbs Cafe regulars appreciate steady morning hospitality.',
        importance: 8,
        evidenceIds: [],
      },
    ],
    beliefUpdates: [
      {
        subjectId: 'hobbs_cafe',
        predicate: 'world_fact',
        claim: 'Evening acoustic nights grow Hobbs Cafe community ties.',
        confidence: 0.88,
      },
    ],
  });
  const isabellaCons = consWorld.agents.find((a) => a.id === 'isabella')!;
  const consNode = isabellaCons.memories.find((m) => m.type === 'consolidated')!;
  assert.ok((consNode.linkedMemoryIds?.length ?? 0) > 0, 'Consolidated node must attach A-MEM links');
  assert.ok(
    getActiveBeliefs(isabellaCons.beliefs, ['hobbs_cafe']).some((b) =>
      b.claim.includes('Evening acoustic nights'),
    ),
  );

  // 4. Diversity metrics refusalDisagreementRate uses cumulative conversationsTotal
  const baseDiv = computeDiversitySnapshot({
    ...consWorld,
    conversations: consWorld.conversations.slice(0, 2),
    stats: { ...consWorld.stats, refusalsAndDisagreements: 10, conversationsTotal: 2 },
  });
  const highConvDiv = computeDiversitySnapshot({
    ...consWorld,
    conversations: consWorld.conversations.slice(0, 2),
    stats: { ...consWorld.stats, refusalsAndDisagreements: 10, conversationsTotal: 200 },
  });
  assert.ok(
    highConvDiv.refusalDisagreementRate < baseDiv.refusalDisagreementRate,
    `Cumulative conversationsTotal should keep refusal rate bounded (${highConvDiv.refusalDisagreementRate} < ${baseDiv.refusalDisagreementRate})`,
  );
});

