import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState, stepWorldState } from './engine';
import { makeIdAllocator } from './ids';

test('makeIdAllocator yields monotonically increasing deterministic IDs without randomness', () => {
  const alloc = makeIdAllocator(10);
  assert.equal(alloc.next('mem_isabella'), 'mem_isabella_10');
  assert.equal(alloc.next('perc agent'), 'perc_agent_11');
  assert.equal(alloc.seq(), 12);
});

test('running 3 simulated days creates zero duplicate memory IDs across all 18 residents', () => {
  let world = createInitialWorldState();
  const steps = 3 * 1440; // 1 sim-minute steps across 3 full days
  for (let i = 0; i < steps; i++) {
    world = stepWorldState(world, 1).nextState;
  }

  let totalMemories = 0;
  for (const agent of world.agents) {
    const seen = new Set<string>();
    for (const mem of agent.memories) {
      totalMemories += 1;
      assert.ok(!seen.has(mem.id), `Duplicate memory ID "${mem.id}" found on agent ${agent.id}`);
      seen.add(mem.id);
    }
  }
  assert.ok(totalMemories > 200, 'Expected substantial memory accumulation over 3 days');
});
