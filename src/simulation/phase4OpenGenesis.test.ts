import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBdiDecisionResult } from './autonomy';
import { runCounterfactualComparison } from './counterfactualLab';
import { createInitialWorldState, stepWorldState } from './engine';
import { makeIdAllocator } from './ids';
import { normalizeBdiDecisionPayload, normalizeOpenActionOps } from './llmJson';
import {
  applyArbitratedOpenAction,
  compileOfflineOpenAction,
  executeAtomicOp,
  stepEmergentOrganizationsAndNorms,
} from './openGenesis';
import { validateWorld } from './validateWorld';
import type { WorldState } from './types';

function totalOpenWorldMoney(world: WorldState): number {
  const wallets = world.agents.reduce((s, a) => s + (a.wallet ?? 0), 0);
  const biz = Object.values(world.businesses ?? {}).reduce((s, b) => s + b.treasury, 0);
  const treasury = world.townTreasury ?? 0;
  const escrow = (world.serviceContracts ?? [])
    .filter((c) => c.status === 'active')
    .reduce((s, c) => s + c.escrowHeld, 0);
  const orgPools = (world.organizations ?? [])
    .filter((o) => o.active)
    .reduce((s, o) => s + o.treasury, 0);
  return Math.round((wallets + biz + treasury + escrow + orgPools) * 100) / 100;
}

test('Phase 4 Open Genesis: conserved organizations, pooled payouts, custom assets & dues keep total money invariant', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 10000);
  const startMoney = totalOpenWorldMoney(world);

  // 1. Isabella creates an autonomous mutual aid guild with $40 initial pool and $5 daily dues
  const createRes = executeAtomicOp(
    world,
    'isabella',
    {
      op: 'create_org',
      name: 'Smallville Mutual Aid Fund',
      charter: 'Pool neighborhood dues to cover emergency clinic bills and hard times.',
      roleTitle: 'Treasurer',
      initialContribution: 40,
      duesAmount: 5,
      headquartersLocationId: 'hobbs_cafe',
    },
    alloc.next,
  );
  assert.equal(createRes.ok, true);
  assert.equal(totalOpenWorldMoney(createRes.world), startMoney);
  const orgId = createRes.world.organizations![0].id;

  // 2. Clara joins with $15 contribution
  const joinRes = executeAtomicOp(
    createRes.world,
    'clara',
    { op: 'join_org', orgId, roleTitle: 'Steward', contribution: 15 },
    alloc.next,
  );
  assert.equal(joinRes.ok, true);
  assert.equal(totalOpenWorldMoney(joinRes.world), startMoney);
  assert.equal(joinRes.world.organizations![0].treasury, 55);

  // 3. Reject overdraft org payout ($500 > $55 pool) and non-member payout (john)
  const overPayout = executeAtomicOp(
    joinRes.world,
    'isabella',
    { op: 'org_payout', orgId, toAgentId: 'eddy', amount: 500, reason: 'Excess payout' },
    alloc.next,
  );
  assert.equal(overPayout.ok, false);

  const nonMemberPayout = executeAtomicOp(
    overPayout.world,
    'john',
    { op: 'org_payout', orgId, toAgentId: 'john', amount: 20, reason: 'Unauthorized' },
    alloc.next,
  );
  assert.equal(nonMemberPayout.ok, false);

  // 4. Valid payout ($25) from org pool to Eddy conserves total money
  const payoutRes = executeAtomicOp(
    nonMemberPayout.world,
    'isabella',
    { op: 'org_payout', orgId, toAgentId: 'eddy', amount: 25, reason: 'Emergency stipend' },
    alloc.next,
  );
  assert.equal(payoutRes.ok, true);
  assert.equal(totalOpenWorldMoney(payoutRes.world), startMoney);
  assert.equal(payoutRes.world.organizations![0].treasury, 30);

  // 5. Daily dues rollover collects from solvent members strictly into org pool
  const duesWorld = stepEmergentOrganizationsAndNorms(payoutRes.world, 2, alloc.next);
  assert.equal(totalOpenWorldMoney(duesWorld), startMoney);
  assert.ok(duesWorld.organizations![0].treasury >= 35);

  // 6. Custom Asset creation & trade conserves cash
  const assetRes = executeAtomicOp(
    duesWorld,
    'clara',
    {
      op: 'create_asset',
      name: 'Southside Gazette Issue #1',
      description: 'Independent neighborhood newsletter by Clara.',
      unitValue: 8,
      quantity: 3,
      organizationId: orgId,
    },
    alloc.next,
  );
  assert.equal(assetRes.ok, true);
  const assetId = assetRes.world.customAssets![0].id;
  const tradeRes = executeAtomicOp(
    assetRes.world,
    'clara',
    { op: 'trade_asset', assetId, buyerId: 'sam', price: 8 },
    alloc.next,
  );
  assert.equal(tradeRes.ok, true);
  assert.equal(totalOpenWorldMoney(tradeRes.world), startMoney);
  assert.equal(tradeRes.world.stats.customAssetsTraded, 1);
});

test('Phase 4 Emergent Free-Text Norms, social sanctions & organic diffusion evolve norm strength', () => {
  const world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 10400);

  const pRes = executeAtomicOp(
    world,
    'elena',
    { op: 'propose_norm', statement: 'Always share harvest surplus before winter cold snaps.' },
    alloc.next,
  );
  assert.equal(pRes.ok, true);
  const normId = pRes.world.emergentNorms![0].id;
  assert.equal(pRes.world.emergentNorms![0].strength, 55);

  const adoptRes = executeAtomicOp(
    pRes.world,
    'maria',
    { op: 'adopt_or_challenge_norm', normId, adopt: true },
    alloc.next,
  );
  assert.equal(adoptRes.ok, true);
  assert.equal(adoptRes.world.emergentNorms![0].strength, 60);

  const eddyRepBefore = adoptRes.world.agents.find((a) => a.id === 'eddy')!.reputation ?? 55;
  const sanctionRes = executeAtomicOp(
    adoptRes.world,
    'elena',
    { op: 'sanction_norm', normId, targetAgentId: 'eddy', reason: 'Hoarded scarce stock' },
    alloc.next,
  );
  assert.equal(sanctionRes.ok, true);
  assert.equal(sanctionRes.world.emergentNorms![0].sanctionsCount, 1);
  assert.equal(
    sanctionRes.world.agents.find((a) => a.id === 'eddy')!.reputation,
    eddyRepBefore - 4,
  );

  // Organic diffusion spreads to trusting neighbors
  const diffused = stepEmergentOrganizationsAndNorms(sanctionRes.world, 2, alloc.next);
  assert.ok(diffused.emergentNorms![0].adopterIds.length >= 2);
});

test('Phase 4 Offline Conservation Arbiter, open_action BDI normalizer & validateWorld cleanly pass', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq + 10800);
  const startMoney = totalOpenWorldMoney(world);

  // Sanitizer drops invalid/negative ops and keeps conserved valid ops
  const sanitized = normalizeOpenActionOps(
    [
      { op: 'transfer_cash', fromId: 'isabella', toId: 'sam', amount: -50, note: 'Bad negative' },
      { op: 'propose_norm', statement: 'Share bakery leftovers every evening.' },
      { op: 'invented_hack_op', magicCash: 9999 },
    ],
    new Set(world.agents.map((a) => a.id)),
    new Set(world.locations.map((l) => l.id)),
  );
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].op, 'propose_norm');

  const intent = 'Found the Oak Hill Artisans Credit Circle to back local craftspeople.';
  const compiled = compileOfflineOpenAction(world, 'arthur', intent);
  assert.equal(compiled[0]?.op, 'create_org');

  const arbRes = applyArbitratedOpenAction(world, 'arthur', intent, compiled, alloc.next);
  assert.equal(arbRes.appliedCount, 1);
  assert.equal(totalOpenWorldMoney(arbRes.world), startMoney);

  // Also test full BDI open_action path
  const dec = normalizeBdiDecisionPayload(
    {
      action: 'open_action',
      reason: 'Start a neighborhood tool-lending norm.',
      openIntent: 'Adopt a shared tool-lending norm across North Ridge.',
    },
    new Set(world.locations.map((l) => l.id)),
  );
  assert.equal(dec.action, 'open_action');
  const patchSchedule = (
    sched: WorldState['agents'][number]['dailySchedule'],
    blk: WorldState['agents'][number]['dailySchedule'][number],
  ) => [blk, ...sched.slice(0, 6)];

  const afterBdi = applyBdiDecisionResult(arbRes.world, 'sam', dec, alloc.next, patchSchedule, {
    deferUntilArrival: false,
  });
  const stepped = stepWorldState(afterBdi, 5).nextState;
  assert.deepEqual(validateWorld(stepped), []);
});

test('Phase 4 Counterfactual Society Lab compares Structured Polis vs Open Genesis deterministically', () => {
  const comparison = runCounterfactualComparison(
    [
      { id: 'polis', label: 'Structured Polis', genesisMode: 'structured_polis' },
      { id: 'genesis', label: 'Open Genesis', genesisMode: 'open_genesis' },
    ],
    { days: 3, seed: 42, speed: 5 },
  );

  assert.equal(comparison.runs.length, 2);
  assert.equal(comparison.deltasFromBaseline.length, 1);
  assert.equal(comparison.runs[0].validationIssues, 0);
  assert.equal(comparison.runs[1].validationIssues, 0);
  assert.equal(comparison.runs[0].orgsCount, 0);
  assert.ok(comparison.runs[1].orgsCount >= 1 || comparison.runs[1].openActionsArbitrated >= 1);
});
