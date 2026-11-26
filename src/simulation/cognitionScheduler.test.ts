import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchedulerConfig,
  computeEffectivePriority,
  computeTimeDilationRate,
  createSchedulerState,
  dispatchEligibleJobs,
  enqueueJob,
  enqueueTriggers,
  markJobFailed,
} from './cognitionScheduler';
import { CONVERSATION_RADIUS_TILES, createInitialWorldState } from './engine';

test('cognitionScheduler never schedules two concurrent jobs for the same resident', () => {
  const baseWorld = createInitialWorldState();
  const isabella = baseWorld.agents.find((a) => a.id === 'isabella')!;
  const world = {
    ...baseWorld,
    agents: baseWorld.agents.map((ag) => {
      if (ag.id === 'isabella') {
        return { ...ag, importanceAccumulator: baseWorld.reflectionThreshold + 10 };
      }
      if (ag.id === 'maria') {
        return {
          ...ag,
          x: isabella.x + 1,
          y: isabella.y,
          currentLocationId: isabella.currentLocationId,
        };
      }
      return ag;
    }),
  };
  let state = createSchedulerState(buildSchedulerConfig('balanced'), 1);

  state = enqueueJob(state, {
    kind: 'reflection',
    agentIds: ['isabella'],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: world.simMinutes,
  });
  state = enqueueJob(state, {
    kind: 'conversation',
    agentIds: ['isabella', 'maria'],
    expectedCalls: 3,
    nowMs: 1000,
    simMinutes: world.simMinutes,
  });

  const { jobsToStart, state: after } = dispatchEligibleJobs(state, world, 1000);
  // Conversation outranks reflection (60 vs 40); Isabella must NOT also run reflection in parallel
  assert.equal(jobsToStart.length, 1);
  assert.equal(jobsToStart[0].kind, 'conversation');
  assert.equal(after.inFlight.length, 1);
});

test('computeTimeDilationRate slows sim clock cleanly when due work exceeds free lanes or RPM headroom', () => {
  const baseWorld = createInitialWorldState();
  const isabella = baseWorld.agents.find((a) => a.id === 'isabella')!;
  const klaus = baseWorld.agents.find((a) => a.id === 'klaus')!;
  const maria = baseWorld.agents.find((a) => a.id === 'maria')!;
  const world = {
    ...baseWorld,
    agents: baseWorld.agents.map((ag) => {
      if (ag.id === 'maria') return { ...ag, x: isabella.x + 1, y: isabella.y };
      if (ag.id === 'tom') return { ...ag, x: klaus.x + 1, y: klaus.y };
      return ag;
    }),
  };

  let state = createSchedulerState(
    buildSchedulerConfig('balanced', { maxConcurrent: 2, maxCallsPerMinute: 20, timeDilation: true }),
    1,
  );
  // 2 jobs in flight (0 free lanes) + 1 queued valid conversation => dueJobs = 3, rate = 0.1
  state = {
    ...state,
    inFlight: [
      {
        id: 'j1',
        kind: 'conversation',
        agentIds: ['isabella', 'maria'],
        expectedCalls: 3,
        enqueuedAtMs: 0,
        enqueuedAtSim: world.simMinutes,
        attempts: 0,
      },
      {
        id: 'j2',
        kind: 'morning_plan',
        agentIds: ['clara'],
        expectedCalls: 1,
        enqueuedAtMs: 0,
        enqueuedAtSim: world.simMinutes,
        attempts: 0,
      },
    ],
    queue: [
      {
        id: 'j3',
        kind: 'conversation',
        agentIds: ['klaus', 'tom'],
        expectedCalls: 3,
        enqueuedAtMs: 0,
        enqueuedAtSim: world.simMinutes,
        attempts: 0,
      },
    ],
  };

  const slowedRate = computeTimeDilationRate(world, state, 1000);
  assert.equal(slowedRate, 0.1);

  const disabled = computeTimeDilationRate(
    world,
    { ...state, config: { ...state.config, timeDilation: false } },
    1000,
  );
  assert.equal(disabled, 1);
});

test('cognitionScheduler prioritizes morning plans over conversations over reflections and applies +1/simMin aging', () => {
  const world = createInitialWorldState();
  let state = createSchedulerState(buildSchedulerConfig('balanced'), 2);

  state = enqueueJob(state, {
    kind: 'reflection',
    agentIds: ['maria'],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: 1440 + 300,
  });
  state = enqueueJob(state, {
    kind: 'morning_plan',
    agentIds: ['klaus'],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: 1440 + 360,
  });

  const reflJob = state.queue[0];
  const planJob = state.queue[1];
  const pReflAt360 = computeEffectivePriority(reflJob, state, 1440 + 360);
  const pPlanAt360 = computeEffectivePriority(planJob, state, 1440 + 360);
  assert.equal(pReflAt360, 40 + 60);
  assert.equal(pPlanAt360, 100);

  // After waiting another 20 sim minutes, aging pushes reflection priority to 120 > 100
  const pReflAt380 = computeEffectivePriority(reflJob, state, 1440 + 380);
  assert.equal(pReflAt380, 120);
});

test('cognitionScheduler applies exponential backoff and triggers fallback morning plan after 3 failures', () => {
  const baseWorld = createInitialWorldState();
  const worldDay2 = { ...baseWorld, simMinutes: 1440 + 6 * 60, day: 2 };
  let state = createSchedulerState(buildSchedulerConfig('balanced'), 2);

  state = enqueueJob(state, {
    kind: 'morning_plan',
    agentIds: ['isabella'],
    expectedCalls: 1,
    nowMs: 0,
    simMinutes: worldDay2.simMinutes,
    isMorningPlan: true,
  });

  // Attempt 1 fails at 4s -> 15s backoff (retry >= 19s)
  const d1 = dispatchEligibleJobs(state, worldDay2, 0);
  assert.equal(d1.jobsToStart.length, 1);
  const f1 = markJobFailed(d1.state, d1.jobsToStart[0], 4000, worldDay2.simMinutes, 'err 1');
  assert.equal(f1.shouldApplyFallbackPlan, false);
  assert.equal(f1.state.failuresByKey['morning_plan:isabella'].nextRetryAtMs, 19_000);

  // Enqueue again at 5s -> blocked by backoff
  let s2 = enqueueJob(f1.state, {
    kind: 'morning_plan',
    agentIds: ['isabella'],
    expectedCalls: 1,
    nowMs: 5000,
    simMinutes: worldDay2.simMinutes,
    isMorningPlan: true,
  });
  assert.equal(dispatchEligibleJobs(s2, worldDay2, 10_000).jobsToStart.length, 0);

  // At 20s -> retry allowed, Attempt 2 fails -> 30s backoff (nextRetryAtMs = 50s)
  const d2 = dispatchEligibleJobs(s2, worldDay2, 20_000);
  assert.equal(d2.jobsToStart.length, 1);
  const f2 = markJobFailed(d2.state, d2.jobsToStart[0], 20_000, worldDay2.simMinutes, 'err 2');
  assert.equal(f2.state.failuresByKey['morning_plan:isabella'].nextRetryAtMs, 50_000);

  // Attempt 3 at 51s fails -> shouldApplyFallbackPlan = true
  const s3 = enqueueJob(f2.state, {
    kind: 'morning_plan',
    agentIds: ['isabella'],
    expectedCalls: 1,
    nowMs: 51_000,
    simMinutes: worldDay2.simMinutes,
    isMorningPlan: true,
  });
  const d3 = dispatchEligibleJobs(s3, worldDay2, 51_000);
  const f3 = markJobFailed(d3.state, d3.jobsToStart[0], 51_000, worldDay2.simMinutes, 'err 3');
  assert.equal(f3.shouldApplyFallbackPlan, true);
  assert.equal(f3.state.failedMorningPlanDayByAgent.isabella, 2);
});

test('cognitionScheduler respects maxCallsPerMinute across sliding window', () => {
  const world = createInitialWorldState();
  let state = createSchedulerState(
    buildSchedulerConfig('balanced', { maxCallsPerMinute: 4, maxConcurrent: 4 }),
    1,
  );

  // Queue 6 single-call jobs for distinct residents
  for (const agent of world.agents.slice(0, 6)) {
    state = enqueueJob(state, {
      kind: 'consolidation',
      agentIds: [agent.id],
      expectedCalls: 1,
      nowMs: 1000,
      simMinutes: world.simMinutes,
    });
  }

  const d1 = dispatchEligibleJobs(state, world, 1000);
  assert.equal(d1.jobsToStart.length, 4);

  // Even after clearing inFlight, no more calls start until 60s window expires
  const clearedState = { ...d1.state, inFlight: [] };
  const d2 = dispatchEligibleJobs(clearedState, world, 20_000);
  assert.equal(d2.jobsToStart.length, 0);

  const d3 = dispatchEligibleJobs(clearedState, world, 62_000);
  assert.equal(d3.jobsToStart.length, 2);
});

test('cognitionScheduler drops stale conversation pairs that walked out of range', () => {
  const baseWorld = createInitialWorldState();
  const farApartWorld = {
    ...baseWorld,
    agents: baseWorld.agents.map((ag) => {
      if (ag.id === 'isabella') return { ...ag, x: 5, y: 5 };
      if (ag.id === 'maria') return { ...ag, x: 5 + CONVERSATION_RADIUS_TILES + 10, y: 5 };
      return ag;
    }),
  };

  let state = createSchedulerState(buildSchedulerConfig('balanced'), 1);
  state = enqueueJob(state, {
    kind: 'conversation',
    agentIds: ['isabella', 'maria'],
    expectedCalls: 3,
    nowMs: 1000,
    simMinutes: farApartWorld.simMinutes,
  });

  const { jobsToStart, state: after } = dispatchEligibleJobs(state, farApartWorld, 2000);
  assert.equal(jobsToStart.length, 0);
  assert.equal(after.queue.length, 0, 'Out-of-range auto conversation pair should be evicted');
});

test('overnight sleep consolidation queues ALL 18 residents regardless of selected UI resident', () => {
  const baseWorld = createInitialWorldState();
  const nightWorld = {
    ...baseWorld,
    simMinutes: 22 * 60 + 40, // 10:40 PM Day 1
  };

  const state = enqueueTriggers(
    createSchedulerState(buildSchedulerConfig('balanced'), 1),
    nightWorld,
    {
      conversationPairs: [],
      reflectionAgentIds: [],
      morningPlanAgentIds: [],
      reactionTriggers: [],
      stepDetailRequests: [],
    },
    10_000,
  );

  const consJobs = state.queue.filter((j) => j.kind === 'consolidation');
  assert.equal(consJobs.length, nightWorld.agents.length);
});
