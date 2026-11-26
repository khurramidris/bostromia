import test from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless } from './headless';

test('2-day baseline headless run completes quickly (< 10s) and returns all daily & end-of-run metrics', () => {
  const start = Date.now();
  const res = runHeadless({
    days: 2,
    speed: 1,
    latencyMs: 4000,
    mode: 'baseline',
    seed: 42,
  });
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 10_000, `Expected 2-day run < 10s, took ${elapsedMs}ms`);
  assert.equal(res.perDay.length, 2);
  assert.equal(res.endOfRun.duplicateMemoryIds, 0);
  assert.ok(res.perDay[0].perceptionEvents > 0);
});

test('Phase 1 scheduler (4 days, 1x, 4s latency, Balanced) hits conversations, morning plans, sleep consolidation, and reflection caps', () => {
  const res = runHeadless({
    days: 4,
    speed: 1,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    seed: 42,
  });

  assert.equal(res.endOfRun.duplicateMemoryIds, 0);
  assert.ok(res.endOfRun.maxConcurrentObserved <= 3);
  assert.ok(res.endOfRun.maxCallsPerMinuteObserved <= 20);

  const avgConvs = res.perDay.reduce((s, d) => s + d.conversations, 0) / res.perDay.length;
  assert.ok(avgConvs >= 40, `Expected >= 40 conversations/day at 1x, got ${avgConvs.toFixed(1)}`);

  for (const d of res.perDay) {
    assert.ok(
      d.reflections <= 54,
      `Day ${d.day} reflections=${d.reflections} exceeded 3/resident/day (54 max)`,
    );
    if (d.day >= 2) {
      assert.equal(
        d.morningPlansCount,
        18,
        `Day ${d.day} expected 18/18 morning plans, got ${d.morningPlansCount}`,
      );
      const minOfDay = (d.lastMorningPlanSimMin ?? 9999) % 1440;
      assert.ok(
        minOfDay < 8 * 60,
        `Day ${d.day} last morning plan landed at ${d.lastMorningPlanTimeLabel}, expected before 08:00`,
      );
      assert.ok(
        d.consolidations >= 16,
        `Day ${d.day} expected >= 16 consolidations, got ${d.consolidations}`,
      );
    }
  }
});

test('Phase 1 scheduler at 5x speed with time dilation keeps >= 20 conversations/day and morning plans before 08:00', () => {
  const res = runHeadless({
    days: 4,
    speed: 5,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    seed: 42,
  });

  const avgConvs = res.perDay.reduce((s, d) => s + d.conversations, 0) / res.perDay.length;
  assert.ok(avgConvs >= 20, `Expected >= 20 conversations/day at 5x, got ${avgConvs.toFixed(1)}`);

  for (const d of res.perDay.filter((x) => x.day >= 2)) {
    assert.equal(d.morningPlansCount, 18);
    const minOfDay = (d.lastMorningPlanSimMin ?? 9999) % 1440;
    assert.ok(
      minOfDay < 8 * 60,
      `5x Day ${d.day} last morning plan landed at ${d.lastMorningPlanTimeLabel}`,
    );
  }
});

test('Phase 1 scheduler isolates persistent failure: first resident fails, other 17 plan cleanly and failing resident gets fallback after 3 attempts', () => {
  const res = runHeadless({
    days: 4,
    speed: 1,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    failAgentIds: ['isabella'],
    failKinds: ['plan'],
    seed: 42,
  });

  for (const d of res.perDay.filter((x) => x.day >= 2)) {
    assert.ok(
      d.morningPlansCount >= 17,
      `Day ${d.day} expected >= 17 morning plans when 1 resident fails, got ${d.morningPlansCount}`,
    );
    assert.ok(
      d.failedCalls <= 3,
      `Day ${d.day} expected <= 3 failed plan calls from failing resident, got ${d.failedCalls}`,
    );
  }
});

test('Phase 3 acceptance: LLM-off 4-day headless run keeps >=17/18 home at 03:00, 0 repeated detours, 0 wall talks, 0 Day-2 party blocks, 0 validation issues', () => {
  const res = runHeadless({
    days: 4,
    speed: 1,
    latencyMs: 0,
    mode: 'llm_off',
    seed: 42,
  });

  assert.ok(
    res.endOfRun.residentsHomeAt0300ByNight.length >= 3,
    `Expected at least 3 nights checked, got ${res.endOfRun.residentsHomeAt0300ByNight.length}`,
  );
  for (const night of res.endOfRun.residentsHomeAt0300ByNight) {
    assert.ok(
      night.count >= 17,
      `Night of Day ${night.day} had only ${night.count}/${night.total} residents at home at 03:00`,
    );
  }
  assert.equal(res.endOfRun.repeatedDetours, 0);
  assert.equal(res.endOfRun.wallCrossingConversations, 0);
  assert.equal(res.endOfRun.day2PartyBlockCount, 0);
  assert.equal(res.endOfRun.validationIssuesCount, 0);
});

test('Phase 4-5 acceptance: 7-day fake-LLM run meets memory noise/cap/survival, save byte limit, and conversation turn/call bounds', () => {
  const res = runHeadless({
    days: 7,
    speed: 1,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    seed: 42,
  });

  assert.ok(
    res.endOfRun.perceptionShare <= 0.5,
    `Expected perceptionShare <= 0.5, got ${(res.endOfRun.perceptionShare * 100).toFixed(1)}%`,
  );
  assert.ok(
    res.endOfRun.observationsPerResidentPerDay <= 30,
    `Expected <= 30 observations/resident/day, got ${res.endOfRun.observationsPerResidentPerDay.toFixed(1)}`,
  );
  assert.equal(res.endOfRun.allSeedImp8Survived, true);
  assert.equal(res.endOfRun.duplicateMemoryIds, 0);
  for (const [agId, count] of Object.entries(res.endOfRun.memoriesPerResident)) {
    assert.ok(count <= 300, `${agId} exceeded 300 memory cap with ${count} memories`);
  }
  assert.ok(
    res.endOfRun.estimatedSaveBytes < 5_000_000,
    `Expected save bytes < 5MB, got ${res.endOfRun.estimatedSaveBytes}`,
  );
  assert.ok(res.endOfRun.avgCallsPerConv <= 8, `Expected avgCallsPerConv <= 8, got ${res.endOfRun.avgCallsPerConv}`);
  assert.ok(res.endOfRun.maxCallsPerConv <= 8, `Expected maxCallsPerConv <= 8, got ${res.endOfRun.maxCallsPerConv}`);
  assert.equal(res.endOfRun.pastAgreementsCount, 0);
  assert.equal(res.endOfRun.day2PartyBlockCount, 0);
  assert.equal(res.endOfRun.wallCrossingConversations, 0);
  assert.equal(res.endOfRun.validationIssuesCount, 0);
});

test('Phase 6 calibration: 4-day 1x run hits 1.5-3.0 reflections/resident/day, 100% meal+sleep morning plans, 0 lost commitments, <= 4 reactions/day', () => {
  const res = runHeadless({
    days: 4,
    speed: 1,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    seed: 42,
  });

  const reflRate = res.endOfRun.reflectionsPerResidentPerDay;
  assert.ok(
    reflRate >= 1.5 && reflRate <= 3.0,
    `Expected reflectionsPerResidentPerDay in [1.5, 3.0], got ${reflRate}`,
  );
  assert.equal(res.endOfRun.morningPlansWithMealsAndSleep, res.endOfRun.morningPlansTotal);
  assert.equal(res.endOfRun.commitmentsLostToReplan, 0);
  assert.ok(res.endOfRun.maxReactionsPerResidentPerDay <= 4);
});

test('Phase 7 paper_valentine: llm_off keeps party attendance <= 1 while fake-LLM spread achieves > 1 attendance, higher density, and respects ablations', () => {
  const offRun = runHeadless({
    days: 2,
    speed: 1,
    latencyMs: 0,
    mode: 'llm_off',
    scenario: 'paper_valentine',
    seed: 42,
  });
  assert.ok(
    offRun.endOfRun.partySummary.attendedDecisionCount <= 1,
    `With LLM off, decision-grounded party attendance should be <= 1 (Isabella only), got ${offRun.endOfRun.partySummary.attendedDecisionCount}`,
  );
  assert.equal(offRun.endOfRun.partySummary.invitedCount, 0);

  const paperRun = runHeadless({
    days: 2,
    speed: 1,
    latencyMs: 4000,
    mode: 'scheduler',
    preset: 'balanced',
    scenario: 'paper_valentine',
    seed: 42,
  });
  assert.ok(
    paperRun.endOfRun.partySummary.invitedCount >= 3,
    `Expected >= 3 residents invited to Valentine party via gossip, got ${paperRun.endOfRun.partySummary.invitedCount}`,
  );
  assert.ok(
    paperRun.endOfRun.partySummary.attendedDecisionCount > 1,
    `Expected decision-grounded party attendance > 1 with LLM dialogue/agreements, got ${paperRun.endOfRun.partySummary.attendedDecisionCount}`,
  );
  assert.ok(
    paperRun.endOfRun.finalNetworkDensity >= paperRun.endOfRun.initialNetworkDensity,
    'Network density must grow or hold from conversations',
  );
  assert.ok(paperRun.awarenessTimeline.length >= 24);

  const ablatedNoReflect = runHeadless({
    days: 2,
    speed: 2,
    latencyMs: 3000,
    mode: 'scheduler',
    preset: 'balanced',
    scenario: 'paper_valentine',
    ablations: { noReflection: true },
    seed: 42,
  });
  assert.equal(ablatedNoReflect.endOfRun.reflectionsTotal, 0);
});

