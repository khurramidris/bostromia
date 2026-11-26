import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBdiDecisionResult,
  detectBdiDecisionFork,
  isHighStakesEncounter,
  sendPrivateLetter,
} from './autonomy';
import {
  buildSchedulerConfig,
  createSchedulerState,
  enqueueTriggers,
} from './cognitionScheduler';
import {
  applyAutonomousDecision,
  createInitialWorldState,
  stepWorldState,
} from './engine';
import { makeIdAllocator } from './ids';
import {
  advanceAmbitionFromAction,
  evaluateIntentStackExecutiveTrigger,
  hydrateIntentStackForAgent,
  syncAgentCommitments,
} from './intentStack';
import type { ScheduleBlock } from './types';
import { validateWorld } from './validateWorld';

test('Phase 1 Intent Stack: hydrates ambitions, syncs missed commitments, and advances ambition progress', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq ?? 1);

  const isabella = world.agents.find((a) => a.id === 'isabella')!;
  assert.ok(
    isabella.intentStack && isabella.intentStack.ambitions.length >= 2,
    'Initial world residents must hydrate multi-day ambitions in intentStack',
  );

  // Add a past-due commitment at Town Hall while Isabella is at Hobbs Cafe -> syncAgentCommitments marks it missed
  const withCommitment = {
    ...isabella,
    currentLocationId: 'hobbs_cafe',
    intentStack: {
      ...isabella.intentStack!,
      commitments: [
        {
          id: 'cmt_past_test',
          title: 'Meet John at Town Hall',
          withAgentId: 'john',
          locationId: 'town_hall',
          dueDay: 1,
          dueMinute: 480,
          urgency: 0.85,
          status: 'pending' as const,
          source: 'conversation' as const,
        },
      ],
    },
  };
  const synced = syncAgentCommitments(withCommitment, { ...world, simMinutes: 540 });
  assert.equal(synced.intentStack!.commitments[0].status, 'missed');

  // Advancing economic action boosts economic ambition progress and records new ambition when provided
  const econBefore =
    synced.intentStack!.ambitions.find((a) => a.domain === 'economic')?.progress ?? 0;
  const nextStack = advanceAmbitionFromAction(
    synced,
    'work_shift',
    'Expand evening roast supplies',
    560,
    alloc.next,
  );
  const econAfter = nextStack.ambitions.find((a) => a.domain === 'economic')?.progress ?? 0;
  assert.ok(econAfter >= econBefore + 12, 'Matching domain ambition progress must advance');
  assert.ok(
    nextStack.ambitions.some((a) => a.title === 'Expand evening roast supplies'),
    'New ambition title should be added to stack',
  );

  // Hydrate an agent stripped of intentStack safely
  const bare = hydrateIntentStackForAgent(
    { ...isabella, intentStack: undefined },
    540,
    alloc.next,
  );
  assert.ok(bare.intentStack && bare.intentStack.ambitions.length >= 1);
});

test('Phase 1 Executive Triggers: unread private letters & approaching commitments fire, while legacy_schedule suppresses continuation forks', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq ?? 1);
  world = { ...world, simMinutes: 660 }; // 11:00 AM

  // Send a letter from John to Isabella at 660 (delivers at 685)
  const sent = sendPrivateLetter(
    world,
    {
      fromAgentId: 'john',
      toAgentId: 'isabella',
      subject: 'Wholesale coffee shipment',
      body: 'Supplier rates changed; let us talk before Friday.',
    },
    alloc.next,
  );
  assert.equal(sent.ok, true);
  assert.equal((sent.world.stats.lettersSent ?? 0) >= 1, true);

  // At 670 (in transit), Isabella has not received it yet
  const beforeDelivery = { ...sent.world, simMinutes: 670 };
  const isabellaBefore = beforeDelivery.agents.find((a) => a.id === 'isabella')!;
  assert.equal(isabellaBefore.memories.some((m) => m.source === 'letter'), false);

  // Step past delivery time (685+) -> recipient reads letter into linked episodic memory
  let steppedWorld = { ...sent.world, simMinutes: 684 };
  for (let i = 0; i < 4; i++) {
    steppedWorld = stepWorldState(steppedWorld, 1).nextState;
  }
  const isabellaAfter = steppedWorld.agents.find((a) => a.id === 'isabella')!;
  assert.ok(
    isabellaAfter.memories.some((m) => m.source === 'letter' && m.description.includes('Wholesale coffee shipment')),
    'Delivered private letter should enter recipient memory with source=letter',
  );
  const johnAfter = steppedWorld.agents.find((a) => a.id === 'john')!;
  assert.ok(johnAfter.memories.some((m) => m.source === 'letter'));
  const klausAfter = steppedWorld.agents.find((a) => a.id === 'klaus')!;
  assert.equal(
    klausAfter.memories.some((m) => m.description.includes('Wholesale coffee shipment')),
    false,
    'Private letters must not leak to unrelated third parties',
  );

  // Trigger executive fork for unread/recent letter
  const trigger = evaluateIntentStackExecutiveTrigger(
    { ...steppedWorld, simMinutes: 700 },
    { ...isabellaAfter, lastDecisionSimMin: -999 },
  );
  assert.ok(trigger && trigger.forkReason.toLowerCase().includes('private letter'));

  // Legacy schedule ablation suppresses continuous ambition continuation fallback when no shocks exist
  const calmWorld = {
    ...world,
    autonomyMode: 'legacy_schedule' as const,
    proposals: [],
    petitions: [],
    letters: [],
    simMinutes: 660,
  };
  const calmAgent = {
    ...calmWorld.agents.find((a) => a.id === 'isabella')!,
    lastDecisionSimMin: -999,
    memories: [],
    beliefs: [],
    projects: [],
    wallet: 200,
    drives: { energy: 90, hunger: 90, social: 90, purpose: 90 },
  };
  assert.equal(evaluateIntentStackExecutiveTrigger(calmWorld, calmAgent), null);
});

test('Phase 1 Embodied Social Agency: seek_person tracks moving target to System-2 visit, and avoid_person suppresses encounters & relocates', () => {
  let world = createInitialWorldState();
  const alloc = makeIdAllocator(world.idSeq ?? 1);
  world = { ...world, simMinutes: 600 }; // Day 1 10:00 AM

  // Place Isabella at Hobbs Cafe and Klaus at Harvey Library, then have Isabella seek Klaus
  const cafeLoc = world.locations.find((l) => l.id === 'hobbs_cafe')!;
  const libLoc = world.locations.find((l) => l.id === 'harvey_library')!;
  const parkLoc = world.locations.find((l) => l.id === 'johnson_park')!;

  world = {
    ...world,
    agents: world.agents.map((a) => {
      if (a.id === 'isabella') {
        return {
          ...a,
          x: cafeLoc.doorX,
          y: cafeLoc.doorY - 2,
          path: [],
          currentLocationId: 'hobbs_cafe',
          lastConversedAt: {},
        };
      }
      if (a.id === 'klaus') {
        return {
          ...a,
          x: libLoc.doorX,
          y: libLoc.doorY - 2,
          path: [],
          currentLocationId: 'harvey_library',
          lastConversedAt: {},
        };
      }
      return a;
    }),
  };

  world = applyAutonomousDecision(
    world,
    'isabella',
    {
      action: 'seek_person',
      reason: 'Discuss community research partnership with Klaus.',
      targetAgentId: 'klaus',
      durationMinutes: 60,
    },
    { deferUntilArrival: true },
  );

  // Move Klaus while Isabella is en route (simulating a moving target!)
  world = {
    ...world,
    agents: world.agents.map((a) =>
      a.id === 'klaus'
        ? { ...a, x: parkLoc.doorX, y: parkLoc.doorY - 1, currentLocationId: 'johnson_park', path: [] }
        : a,
    ),
  };

  let intentionalVisitReason: string | undefined;
  for (let i = 0; i < 80; i++) {
    const stepped = stepWorldState(world, 1);
    world = stepped.nextState;
    const match = stepped.triggers.conversationPairs.find(
      ([a, b]) => (a === 'isabella' && b === 'klaus') || (a === 'klaus' && b === 'isabella'),
    );
    if (match) {
      intentionalVisitReason = stepped.triggers.conversationReasons?.[`${match[0]}:${match[1]}`];
      break;
    }
  }
  assert.ok(
    intentionalVisitReason && /^Intentional visit:/i.test(intentionalVisitReason),
    `Expected moving seek_person to trigger Intentional visit encounter, got "${intentionalVisitReason}"`,
  );
  assert.ok((world.stats.socialSeeksCompleted ?? 0) >= 1);

  // Now test avoid_person: place John and Eddy side-by-side at Hobbs Cafe; John avoids Eddy
  let avoidWorld = {
    ...createInitialWorldState(),
    simMinutes: 650,
  };
  avoidWorld = {
    ...avoidWorld,
    agents: avoidWorld.agents.map((a) => {
      if (a.id === 'john') {
        return {
          ...a,
          x: cafeLoc.doorX,
          y: cafeLoc.doorY - 2,
          path: [],
          currentLocationId: 'hobbs_cafe',
          lastConversedAt: {},
        };
      }
      if (a.id === 'eddy') {
        return {
          ...a,
          x: cafeLoc.doorX + 1,
          y: cafeLoc.doorY - 2,
          path: [],
          currentLocationId: 'hobbs_cafe',
          lastConversedAt: {},
        };
      }
      return a;
    }),
  };

  avoidWorld = applyBdiDecisionResult(
    avoidWorld,
    'john',
    {
      action: 'avoid_person',
      reason: 'Stepping away while tension with Eddy cools down.',
      targetAgentId: 'eddy',
      durationMinutes: 60,
    },
    alloc.next,
    (sched: ScheduleBlock[], blk: ScheduleBlock) => [...sched, blk],
  );

  const steppedAvoid = stepWorldState(avoidWorld, 1);
  const talkedDespiteAvoid = steppedAvoid.triggers.conversationPairs.some(
    ([a, b]) => (a === 'john' && b === 'eddy') || (a === 'eddy' && b === 'john'),
  );
  assert.equal(talkedDespiteAvoid, false, 'avoid_person must suppress encounters between avoider & avoided peer');
  const johnAvoiding = steppedAvoid.nextState.agents.find((a) => a.id === 'john')!;
  assert.ok(johnAvoiding.path.length > 0 || johnAvoiding.currentLocationId !== 'hobbs_cafe');
  assert.equal(validateWorld(steppedAvoid.nextState).length, 0);
});

test('Phase 1 Hybrid Conversations: high-stakes encounters escalate out of compressed mode to turn-by-turn private context', () => {
  let world = {
    ...createInitialWorldState(),
    compressedConversations: true,
  };

  // Make John distrust Eddy (< 35) -> high-stakes
  world = {
    ...world,
    agents: world.agents.map((a) =>
      a.id === 'john'
        ? {
            ...a,
            socialGraph: {
              ...a.socialGraph,
              eddy: { ...a.socialGraph.eddy!, trust: 22 },
            },
          }
        : a,
    ),
  };

  assert.equal(isHighStakesEncounter(world, 'john', 'eddy'), true);
  assert.equal(
    isHighStakesEncounter(world, 'isabella', 'maria', 'Intentional visit: Urgent news'),
    true,
  );

  const sched = createSchedulerState(buildSchedulerConfig('balanced'), 1);
  const enqueued = enqueueTriggers(
    sched,
    world,
    {
      conversationPairs: [
        ['john', 'eddy'],
        ['isabella', 'maria'],
      ],
      conversationReasons: {
        'john:eddy': 'High-tension budget dispute',
        'isabella:maria': 'Casual coffee chat',
      },
      groupParticipantsByPair: {
        'isabella:maria': ['isabella', 'maria', 'klaus'],
      },
      reflectionAgentIds: [],
      morningPlanAgentIds: [],
      reactionTriggers: [],
      stepDetailRequests: [],
    },
    1000,
  );

  const johnEddyJob = enqueued.queue.find(
    (j) => j.kind === 'conversation' && j.agentIds.includes('john') && j.agentIds.includes('eddy'),
  )!;
  assert.equal(
    johnEddyJob.compressed,
    false,
    'High-stakes dyadic encounter must escalate to turn-by-turn private calls (compressed=false)',
  );
  assert.equal(johnEddyJob.expectedCalls, 4);

  // High-stakes group scene sets privateGroup = true
  const enqueuedHighGroup = enqueueTriggers(
    sched,
    world,
    {
      conversationPairs: [['john', 'eddy']],
      conversationReasons: { 'john:eddy': 'Intentional visit: settle loan' },
      groupParticipantsByPair: { 'john:eddy': ['john', 'eddy', 'mei'] },
      reflectionAgentIds: [],
      morningPlanAgentIds: [],
      reactionTriggers: [],
      stepDetailRequests: [],
    },
    2000,
  );
  const grpJob = enqueuedHighGroup.queue[0];
  assert.equal(grpJob.privateGroup, true);
  assert.ok(grpJob.expectedCalls >= 4);
});
