import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState, stepWorldState } from './engine';
import { issueBilateralLoan, settleMaturingLoans } from './contractsAndLife';
import { computeDiversitySnapshot } from './diversityMetrics';
import {
  createInitialCulturalNorms,
  createOrSpreadRumor,
  endorseCulturalNorm,
  evaluateClaimVeracity,
  factCheckRumor,
  getNormComplianceModifier,
  propagateRumorHop,
  stepCulturalNorms,
} from './epistemicCulture';
import { makeIdAllocator } from './ids';
import { normalizeBdiDecisionPayload } from './llmJson';
import { applyGossipUpdates } from './socialFabric';
import { applyBdiDecisionResult, isHighStakesEncounter } from './autonomy';
import { validateWorld } from './validateWorld';
import type { WorldState } from './types';

test('Phase 3 Ground-Truth vs Subjective Beliefs: deceptive rumors distort & split believers from stubborn skeptics', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 9000);

  // Set clear trust & stubbornness boundaries:
  // Maria trusts Eddy (trust 75) -> will believe the deceptive rumor
  // Sam has low trust in Eddy (trust 18) & high stubbornness (0.82) -> will reject as skeptic
  world = {
    ...world,
    agents: world.agents.map((ag) => {
      if (ag.id === 'maria') {
        return {
          ...ag,
          socialGraph: {
            ...ag.socialGraph,
            eddy: {
              ...(ag.socialGraph['eddy'] ?? {
                targetId: 'eddy',
                roleLabel: 'Neighbor',
                trust: 75,
                affection: 65,
                familiarity: 50,
                inferredGoal: 'Composing',
                lastUpdatedSimMin: world.simMinutes,
              }),
              trust: 75,
            },
          },
          temperament: ag.temperament ? { ...ag.temperament, stubbornness: 0.35 } : undefined,
        };
      }
      if (ag.id === 'sam') {
        return {
          ...ag,
          socialGraph: {
            ...ag.socialGraph,
            eddy: {
              ...(ag.socialGraph['eddy'] ?? {
                targetId: 'eddy',
                roleLabel: 'Neighbor',
                trust: 18,
                affection: 25,
                familiarity: 40,
                inferredGoal: 'Composing',
                lastUpdatedSimMin: world.simMinutes,
              }),
              trust: 18,
            },
          },
          temperament: ag.temperament ? { ...ag.temperament, stubbornness: 0.82 } : undefined,
        };
      }
      return ag;
    }),
  };

  // Eddy fabricates a deceptive rumor claiming Isabella is tight on cash / insolvent
  assert.equal(
    evaluateClaimVeracity(world, {
      claim: 'Isabella is tight on cash and cannot cover payroll.',
      subjectAgentId: 'isabella',
      isDeceptive: true,
    }),
    'false',
  );

  const created = createOrSpreadRumor(
    world,
    {
      speakerId: 'eddy',
      targetAgentId: 'maria',
      subjectAgentId: 'isabella',
      claim: 'Isabella has been tight on cash and might not cover Hobbs Cafe payroll.',
      isDeceptive: true,
    },
    alloc.next,
  );
  assert.equal(created.ok, true);
  assert.equal(created.rumor?.isDeceptive, true);
  assert.equal(created.rumor?.veracity, 'false');
  assert.equal(created.rumor?.hopCount, 1);
  // Deceiver does not fool themselves; trusting Maria becomes a believer & claim mutates
  assert.ok(!created.rumor?.believerIds.includes('eddy'));
  assert.ok(created.rumor?.believerIds.includes('maria'));
  assert.notEqual(created.rumor?.currentClaim, created.rumor?.originalClaim);

  const maria = created.world.agents.find((a) => a.id === 'maria')!;
  const falseBelief = maria.beliefs?.find(
    (b) => b.invalidatedAtSimMin === undefined && b.subjectId === 'isabella' && b.groundTruthStatus === 'false',
  );
  assert.ok(falseBelief, 'Believing listener should hold a belief annotated with groundTruthStatus=false');
  assert.equal(falseBelief?.provenance, 'deception');
  assert.equal(falseBelief?.sourceAgentId, 'eddy');
  assert.equal(falseBelief?.hopCount, 1);

  // Sam hears it from Eddy -> rejects it due to low trust + stubbornness
  const hop2 = propagateRumorHop(created.world, created.rumor!.id, 'eddy', 'sam', alloc.next);
  assert.equal(hop2.propagated, true);
  assert.equal(hop2.believed, false);
  const updatedRumor = hop2.world.rumors!.find((r) => r.id === created.rumor!.id)!;
  assert.ok(updatedRumor.skepticIds.includes('sam'));

  // Diversity snapshot reports falseBeliefRate > 0 and activeRumorsCount >= 1
  const div = computeDiversitySnapshot(hop2.world);
  assert.ok((div.falseBeliefRate ?? 0) > 0);
  assert.ok((div.activeRumorsCount ?? 0) >= 1);
});

test('Phase 3 Fact-Checking: debunks deceptive smears, exposes deceivers, and confirms true whistleblowing', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 9500);

  // Part A: Debunk deceptive smear against Isabella
  const isabellaRepBefore = world.agents.find((a) => a.id === 'isabella')!.reputation ?? 55;
  const eddyRepBefore = world.agents.find((a) => a.id === 'eddy')!.reputation ?? 55;

  const smear = createOrSpreadRumor(
    world,
    {
      speakerId: 'eddy',
      targetAgentId: 'maria',
      subjectAgentId: 'isabella',
      claim: 'Isabella is bankrupt and closing Hobbs Cafe.',
      isDeceptive: true,
    },
    alloc.next,
  );
  assert.equal(smear.ok, true);

  const debunkRes = factCheckRumor(smear.world, 'sam', smear.rumor!.id, alloc.next);
  assert.equal(debunkRes.ok, true);
  assert.equal(debunkRes.debunked, true);
  assert.equal(debunkRes.verifiedTrue, false);

  const debunkedRumor = debunkRes.world.rumors!.find((r) => r.id === smear.rumor!.id)!;
  assert.equal(debunkedRumor.debunked, true);
  assert.equal(debunkedRumor.debunkedByAgentId, 'sam');

  const eddyAfter = debunkRes.world.agents.find((a) => a.id === 'eddy')!;
  const isabellaAfter = debunkRes.world.agents.find((a) => a.id === 'isabella')!;
  const mariaAfter = debunkRes.world.agents.find((a) => a.id === 'maria')!;

  assert.ok((eddyAfter.reputation ?? 55) <= eddyRepBefore - 14);
  assert.ok((isabellaAfter.reputation ?? 55) >= isabellaRepBefore + 8);
  assert.equal(debunkRes.world.stats.rumorsDebunked, 1);
  assert.equal(debunkRes.world.stats.deceptionsExposed, 1);

  const mariaCorrected = mariaAfter.beliefs?.find(
    (b) => b.invalidatedAtSimMin === undefined && b.subjectId === 'isabella' && b.predicate === 'reputation',
  );
  assert.equal(mariaCorrected?.provenance, 'public_record');
  assert.equal(mariaCorrected?.groundTruthStatus, 'verified');

  // Part B: Verify a TRUE whistleblower rumor about an actual defaulted loan
  const funded: WorldState = {
    ...debunkRes.world,
    agents: debunkRes.world.agents.map((a) => {
      if (a.id === 'john') return { ...a, wallet: 260 };
      if (a.id === 'wolfgang') return { ...a, wallet: 20 };
      return a;
    }),
  };
  const loaned = issueBilateralLoan(funded, 'john', 'wolfgang', 60, 1, alloc.next, true);
  assert.equal(loaned.ok, true);
  const preDefault: WorldState = {
    ...loaned.world,
    agents: loaned.world.agents.map((a) => (a.id === 'wolfgang' ? { ...a, wallet: 25 } : a)),
  };
  const settled = settleMaturingLoans(preDefault, 2, alloc.next);
  assert.equal(settled.defaulted, 1);

  const trueRumor = createOrSpreadRumor(
    settled.world,
    {
      speakerId: 'john',
      targetAgentId: 'clara',
      subjectAgentId: 'wolfgang',
      claim: 'Wolfgang defaulted on a bilateral debt agreement.',
      isDeceptive: false,
    },
    alloc.next,
  );
  assert.equal(trueRumor.rumor?.veracity, 'true');

  const johnRepBefore = trueRumor.world.agents.find((a) => a.id === 'john')!.reputation ?? 55;
  const verRes = factCheckRumor(trueRumor.world, 'sam', trueRumor.rumor!.id, alloc.next);
  assert.equal(verRes.ok, true);
  assert.equal(verRes.debunked, false);
  assert.equal(verRes.verifiedTrue, true);
  assert.ok((verRes.world.agents.find((a) => a.id === 'john')!.reputation ?? 55) >= johnRepBefore + 5);
});

test('Phase 3 Cultural Norms: endorseCulturalNorm, compliance modifiers & daily evolution respond to ground truth', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 9700);
  const initialNorms = createInitialCulturalNorms(1);
  assert.equal(initialNorms.length, 5);

  const truthBefore = world.culturalNorms!.find((n) => n.key === 'truthfulness')!.strength;
  const endorsed = endorseCulturalNorm(world, 'clara', 'truthfulness', alloc.next);
  assert.equal(endorsed.ok, true);
  const truthAfter = endorsed.world.culturalNorms!.find((n) => n.key === 'truthfulness')!.strength;
  assert.equal(truthAfter, truthBefore + 5);
  assert.ok(
    getNormComplianceModifier(endorsed.world, 'clara', 'truthfulness') >
      getNormComplianceModifier(endorsed.world, 'john', 'truthfulness'),
  );

  // Add a loan default -> stepCulturalNorms reduces debt_honor complianceRate & strength
  const withDefault: WorldState = {
    ...endorsed.world,
    loans: [
      {
        id: 'loan_mock_def',
        lenderId: 'sam',
        borrowerId: 'wolfgang',
        principal: 50,
        interestPct: 8,
        amountDue: 54,
        issuedDay: 1,
        dueDay: 2,
        status: 'defaulted',
        resolvedDay: 2,
      },
    ],
  };
  const debtBefore = withDefault.culturalNorms!.find((n) => n.key === 'debt_honor')!.strength;
  const stepped = stepCulturalNorms(withDefault, 2);
  const debtAfter = stepped.culturalNorms!.find((n) => n.key === 'debt_honor')!;
  assert.ok(debtAfter.strength < debtBefore);
  assert.equal(debtAfter.complianceRate, 0);
});

test('Phase 3 End-to-End: gossip bridges into rumors, escalates encounters, runs BDI actions & passes validateWorld', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 9900);

  const gossipRes = applyGossipUpdates(
    world,
    [
      {
        speakerId: 'john',
        listenerId: 'maria',
        aboutAgentId: 'eddy',
        deltaTrust: -8,
        deltaAffection: -4,
        claim: 'Eddy has been struggling with unpaid bills.',
      },
    ],
    alloc.next,
  );
  assert.equal(gossipRes.appliedCount, 1);
  assert.ok((gossipRes.world.rumors ?? []).some((r) => r.subjectAgentId === 'eddy'));

  // Active rumor escalates encounter between subject (eddy) and believer (maria)
  assert.equal(
    isHighStakesEncounter(gossipRes.world, 'eddy', 'maria', 'ambient encounter'),
    true,
  );

  const patchSchedule = (
    sched: WorldState['agents'][number]['dailySchedule'],
    blk: WorldState['agents'][number]['dailySchedule'][number],
  ) => [blk, ...sched.slice(0, 6)];

  // Normalize & apply spread_rumor, endorse_norm, and fact_check
  const decSpread = normalizeBdiDecisionPayload(
    {
      action: 'spread_rumor',
      reason: 'Warn neighbor Maria.',
      targetAgentId: 'maria',
      rumorClaim: 'Town hall may raise market fees soon.',
      isDeceptive: true,
    },
    new Set(gossipRes.world.locations.map((l) => l.id)),
  );
  assert.equal(decSpread.action, 'spread_rumor');
  assert.equal(decSpread.isDeceptive, true);

  let w = applyBdiDecisionResult(gossipRes.world, 'eddy', decSpread, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });

  const decNorm = normalizeBdiDecisionPayload(
    {
      action: 'endorse_norm',
      reason: 'Champion civic duty.',
      normKey: 'civic_duty',
    },
    new Set(w.locations.map((l) => l.id)),
  );
  w = applyBdiDecisionResult(w, 'sam', decNorm, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });
  assert.equal(w.stats.normEndorsements, 1);

  const decFact = normalizeBdiDecisionPayload(
    {
      action: 'fact_check',
      reason: 'Verify town hall record.',
      rumorId: w.rumors?.[0]?.id,
    },
    new Set(w.locations.map((l) => l.id)),
  );
  w = applyBdiDecisionResult(w, 'clara', decFact, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });
  assert.ok((w.stats.rumorsDebunked ?? 0) >= 1);

  const stepped = stepWorldState(w, 5).nextState;
  assert.deepEqual(validateWorld(stepped), []);
});
