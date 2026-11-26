import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState } from './engine';
import { validateWorld } from './validateWorld';

test('validateWorld reports zero issues on initial seeded world', () => {
  const world = createInitialWorldState();
  const issues = validateWorld(world);
  assert.deepEqual(issues, []);
});

test('validateWorld catches broken relationships, cross-building objects, and duplicate memory IDs', () => {
  const world = createInitialWorldState();
  const mutated = {
    ...world,
    agents: world.agents.map((ag, idx) =>
      idx === 0
        ? {
            ...ag,
            relationships: { ...ag.relationships, ghost_resident: 'Imaginary friend' },
            memories: [ag.memories[0], { ...ag.memories[0] }, ...ag.memories.slice(1)],
            dailySchedule: [
              {
                ...ag.dailySchedule[0],
                locationId: 'hobbs_cafe',
                objectId: 'obj_clinic_bed', // belongs to smallville_clinic
              },
              ...ag.dailySchedule.slice(1),
            ],
          }
        : ag,
    ),
  };

  const issues = validateWorld(mutated);
  assert.ok(issues.some((i) => i.category === 'unknown_relationship'));
  assert.ok(issues.some((i) => i.category === 'duplicate_memory_id'));
  assert.ok(issues.some((i) => i.category === 'invalid_schedule_object'));
});

test('validateWorld accepts null outdoors location and flags unknown location or invalid day/kind', () => {
  const world = createInitialWorldState();
  const broken = {
    ...world,
    agents: world.agents.map((ag, idx) =>
      idx === 0
        ? {
            ...ag,
            currentLocationId: 'ghost_zone',
            dailySchedule: [
              { ...ag.dailySchedule[0], day: 0, kind: 'flying' as unknown as 'work' },
              ...ag.dailySchedule.slice(1),
            ],
          }
        : idx === 1
          ? { ...ag, currentLocationId: null }
          : ag,
    ),
  };

  const issues = validateWorld(broken);
  assert.ok(issues.some((i) => i.category === 'invalid_location' && i.agentId === world.agents[0].id));
  assert.ok(!issues.some((i) => i.agentId === world.agents[1].id && i.category === 'invalid_location'));
  assert.ok(issues.some((i) => i.category === 'invalid_schedule_block'));
});
