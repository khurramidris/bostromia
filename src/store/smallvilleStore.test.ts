import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchedulerConfig, createSchedulerState, enqueueJob } from '../simulation/cognitionScheduler';
import { createInitialWorldState } from '../simulation/engine';
import { createSmallvilleStore } from './smallvilleStore';

test('smallvilleStore throttles continuous tick notifications to <= 4 Hz while updating worldRef every tick', () => {
  const world = createInitialWorldState();
  const scheduler = createSchedulerState(buildSchedulerConfig('balanced'), 1);
  const store = createSmallvilleStore(world, scheduler, {
    tickThrottleMs: 260,
    nowMs: 0,
  });

  let notifications = 0;
  const unsub = store.subscribe(() => {
    notifications += 1;
  });

  // Simulate 1000ms at 10Hz (10 ticks of 100ms)
  let cur = world;
  for (let tick = 1; tick <= 10; tick++) {
    cur = { ...cur, simMinutes: cur.simMinutes + 0.15 };
    store.setWorld(cur, { immediate: false, nowMs: tick * 100 });
  }

  assert.equal(store.worldRef.current.simMinutes, cur.simMinutes);
  assert.ok(
    notifications <= 4,
    `Expected <= 4 Hz reactive notifications over 10 ticks (1s), got ${notifications}`,
  );
  assert.ok(notifications >= 3, `Expected >= 3 periodic notifications in 1s, got ${notifications}`);

  // Discrete immediate updates bypass throttle
  const jumped = { ...cur, simMinutes: cur.simMinutes + 15 };
  store.setWorld(jumped, { immediate: true, nowMs: 1010 });
  assert.equal(store.getSnapshot().world.simMinutes, jumped.simMinutes);

  unsub();
});

test('smallvilleStore tracks queued, running, and failed per-action states cleanly', () => {
  const world = createInitialWorldState();
  let scheduler = createSchedulerState(buildSchedulerConfig('balanced'), 1);
  const store = createSmallvilleStore(world, scheduler, { nowMs: 100 });

  scheduler = enqueueJob(scheduler, {
    kind: 'reflection',
    agentIds: ['isabella'],
    expectedCalls: 2,
    nowMs: 100,
    simMinutes: world.simMinutes,
    isUserAction: true,
  });
  store.setScheduler(scheduler, 100);
  assert.equal(store.getSnapshot().actionStates['reflection:isabella']?.status, 'queued');

  store.setActionFailed('reflection:isabella', 'Upstream timeout', 200);
  assert.equal(store.getSnapshot().actionStates['reflection:isabella']?.status, 'failed');
  assert.equal(store.getSnapshot().actionStates['reflection:isabella']?.error, 'Upstream timeout');

  store.clearActionStatus('reflection:isabella');
  assert.equal(store.getSnapshot().actionStates['reflection:isabella'], undefined);
});
