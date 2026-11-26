import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSchedulerConfig,
  createSchedulerState,
  enqueueTriggers,
} from './cognitionScheduler';
import { createInitialWorldState, stepWorldState } from './engine';
import { findPath } from './pathfinding';
import {
  getTierCounts,
  scaleWorldPopulation,
  setAgentCognitionTier,
} from './scaleGenerator';
import { buildSpatialGrid } from './spatialIndex';
import { validateWorld } from './validateWorld';

test('Phase E: SpatialHashGrid queryRadius matches brute-force Euclidean search exactly', () => {
  const world = scaleWorldPopulation(createInitialWorldState(), 100, 77);
  const grid = buildSpatialGrid(world.agents, 6);
  const radius = 5;

  for (let i = 0; i < world.agents.length; i += 7) {
    const a = world.agents[i];
    const fromGrid = grid.queryRadius(a.x, a.y, radius).map((r) => r.index);
    const brute: number[] = [];
    for (let j = 0; j < world.agents.length; j++) {
      const b = world.agents[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist <= radius) brute.push(j);
    }
    assert.deepEqual(fromGrid, brute, `SpatialHashGrid mismatch for agent index ${i}`);
  }
});

test('Phase E: findPath deterministic route cache returns identical cloned arrays', () => {
  const world = createInitialWorldState();
  const a = world.agents[0];
  const b = world.agents[1];

  const first = findPath(
    world.tiles,
    Math.round(a.x),
    Math.round(a.y),
    Math.round(b.x),
    Math.round(b.y),
  );
  const second = findPath(
    world.tiles,
    Math.round(a.x),
    Math.round(a.y),
    Math.round(b.x),
    Math.round(b.y),
  );

  assert.deepEqual(first, second);
  assert.notEqual(
    first,
    second,
    'Cached route must return a fresh clone so caller mutations cannot corrupt cache',
  );
  if (first.length > 0) {
    first.pop();
    const third = findPath(
      world.tiles,
      Math.round(a.x),
      Math.round(a.y),
      Math.round(b.x),
      Math.round(b.y),
    );
    assert.deepEqual(third, second);
  }
});

test('Phase E: scaleWorldPopulation scales 18 -> 36 -> 60 -> 100 -> 18 with zero validation issues', () => {
  let world = createInitialWorldState();
  assert.equal(world.agents.length, 18);
  assert.equal(validateWorld(world).length, 0);

  for (const target of [36, 60, 100, 36, 18]) {
    world = scaleWorldPopulation(world, target, 101);
    assert.equal(world.agents.length, target);
    const issues = validateWorld(world);
    assert.equal(
      issues.length,
      0,
      `Expected 0 validation issues at population=${target}, got: ${issues.map((i) => i.message).join('; ')}`,
    );
  }

  // Verify tier promotion/demotion works cleanly
  const promoted = setAgentCognitionTier(world, world.agents[0].id, 'ambient');
  assert.equal(promoted.agents[0].tier, 'ambient');
  const counts = getTierCounts(promoted.agents);
  assert.equal(counts.ambient, 1);
  assert.equal(counts.focal, 17);
});

test('Phase E: 100-resident simulation steps cleanly over multiple hours without errors', () => {
  let world = scaleWorldPopulation(createInitialWorldState(), 100, 42);
  const startMs = Date.now();
  for (let i = 0; i < 120; i++) {
    const res = stepWorldState(world, 3); // 360 sim minutes (6 sim hours)
    world = res.nextState;
  }
  const elapsedMs = Date.now() - startMs;
  assert.equal(world.agents.length, 100);
  assert.equal(validateWorld(world).length, 0);
  assert.ok(elapsedMs < 8000, `Expected 100-agent 6h simulation under 8s, took ${elapsedMs}ms`);
});

test('Phase E: cognitionScheduler suppresses background LLM jobs for ambient residents', () => {
  const scaled = scaleWorldPopulation(createInitialWorldState(), 60, 19);
  const focalAgent = scaled.agents.find((a) => (a.tier ?? 'focal') === 'focal')!;
  const ambientAgents = scaled.agents.filter((a) => a.tier === 'ambient');
  assert.ok(ambientAgents.length >= 20);

  const cfg = buildSchedulerConfig('balanced');
  const sched = createSchedulerState(cfg, scaled.day);

  const afterAmbient = enqueueTriggers(
    sched,
    scaled,
    {
      reflectionAgentIds: [ambientAgents[0].id],
      conversationPairs: [[ambientAgents[0].id, ambientAgents[1].id]],
      morningPlanAgentIds: [ambientAgents[0].id],
      reactionTriggers: [
        {
          agentId: ambientAgents[0].id,
          observation: 'Saw a neighbor pass by',
        },
      ],
      decisionTriggers: [
        {
          agentId: ambientAgents[0].id,
          forkReason: 'ambient fork',
          urgency: 0.8,
        },
      ],
      stepDetailRequests: [],
    },
    1000,
  );
  assert.equal(
    afterAmbient.queue.length,
    0,
    'Ambient residents must enqueue zero background LLM jobs',
  );

  const afterFocal = enqueueTriggers(
    sched,
    scaled,
    {
      reflectionAgentIds: [focalAgent.id],
      conversationPairs: [],
      morningPlanAgentIds: [],
      reactionTriggers: [],
      decisionTriggers: [],
      stepDetailRequests: [],
    },
    1000,
  );
  assert.equal(
    afterFocal.queue.length,
    1,
    'Focal residents should still enqueue background LLM jobs normally',
  );
});

test('Phase 0 regression: scaled procedural residents regenerate Day-2 schedules on midnight rollover (no Day-2 coma)', () => {
  let world = scaleWorldPopulation(createInitialWorldState(), 36, 77);
  // Step from Day 1 09:00 (540) to Day 2 10:30 (1440 + 630 = 2070) -> 1530 sim minutes
  for (let i = 0; i < 306; i++) {
    world = stepWorldState(world, 5).nextState;
  }

  assert.equal(world.day, 2);
  const procedural = world.agents.filter((a) => a.isProcedural);
  assert.equal(procedural.length, 18);
  for (const ag of procedural) {
    const day2Blocks = ag.dailySchedule.filter((b) => b.day === 2);
    assert.ok(day2Blocks.length >= 5, `${ag.id} must have full Day-2 schedule blocks, got ${day2Blocks.length}`);
    assert.ok(
      day2Blocks.some((b) => b.kind === 'work'),
      `${ag.id} must have a Day-2 work block instead of sleeping permanently`,
    );
    assert.equal(
      /sleeping/i.test(ag.currentAction),
      false,
      `${ag.id} should be awake at Day 2 10:30, got "${ag.currentAction}"`,
    );
  }
  assert.equal(validateWorld(world).length, 0);
});
