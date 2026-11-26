import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState, stepWorldState } from './engine';
import {
  buildSchedulerConfig,
  createSchedulerState,
  dispatchEligibleJobs,
  enqueueJob,
  enqueueTriggers,
  getBasePriority,
} from './cognitionScheduler';
import { stepAgentDrives } from './psychology';
import { stepCareerProgression } from './contractsAndLife';
import { castCivicVote } from './socialFabric';
import { detectBdiDecisionFork } from './autonomy';
import { executeConsumeItemAction, executeWorkShiftTick } from './worldEconomy';

test('Part A1: quiet sleep hours suppress midnight roommate encounters and drop stale night conversations', () => {
  const base = createInitialWorldState('default');
  // Place two roommates side by side at 01:30 AM (minuteOfDay = 90)
  const day2NightMin = 1440 + 90;
  const a0 = base.agents[0];
  const a1 = base.agents[1];
  const world = {
    ...base,
    simMinutes: day2NightMin,
    agents: base.agents.map((ag, idx) =>
      idx === 0
        ? { ...ag, x: 10, y: 10, path: [], currentLocationId: a0.homeLocationId, lastConversedAt: {} }
        : idx === 1
          ? { ...ag, x: 11, y: 10, path: [], currentLocationId: a0.homeLocationId, lastConversedAt: {} }
          : ag,
    ),
  };

  const stepped = stepWorldState(world, 1);
  assert.equal(stepped.triggers.conversationPairs.length, 0, 'No System-2 conversations during 01:30 AM sleep hours');

  // Scheduler also drops queued non-user conversations during sleep hours
  let sched = createSchedulerState(buildSchedulerConfig('balanced'), 2);
  sched = enqueueJob(sched, {
    kind: 'conversation',
    agentIds: [a0.id, a1.id],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: day2NightMin,
  });
  const dispatched = dispatchEligibleJobs(sched, world, 1500);
  assert.equal(dispatched.jobsToStart.length, 0);
  assert.equal(dispatched.state.queue.length, 0, 'Stale overnight conversation should be pruned');
});

test('Part A1: scheduler reserves daily budget for BDI decisions and prioritizes decision over conversation', () => {
  const world = {
    ...createInitialWorldState('default'),
    simMinutes: 600, // 10:00 AM
    compressedConversations: false,
  };
  let sched = createSchedulerState(buildSchedulerConfig('balanced'), 1);
  // Balanced preset has maxCallsPerSimDay >= 60; set callsToday to 79% of cap
  const dayCap = sched.config.maxCallsPerSimDay ?? 140;
  sched = { ...sched, callsToday: Math.floor(dayCap * 0.79) };

  const a0 = world.agents[0];
  const a1 = world.agents[1];
  const worldNear = {
    ...world,
    agents: world.agents.map((ag, idx) =>
      idx === 0
        ? { ...ag, x: 20, y: 20, path: [], currentLocationId: 'hobbs_cafe' }
        : idx === 1
          ? { ...ag, x: 21, y: 20, path: [], currentLocationId: 'hobbs_cafe' }
          : ag,
    ),
  };

  sched = enqueueJob(sched, {
    kind: 'conversation',
    agentIds: [a0.id, a1.id],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: world.simMinutes,
  });
  sched = enqueueJob(sched, {
    kind: 'decision',
    agentIds: [world.agents[2].id],
    expectedCalls: 1,
    nowMs: 1000,
    simMinutes: world.simMinutes,
    forkReason: 'Civic ballot open',
  });

  const decJob = sched.queue.find((j) => j.kind === 'decision')!;
  const convJob = sched.queue.find((j) => j.kind === 'conversation')!;
  assert.ok(getBasePriority(decJob) > getBasePriority(convJob), 'Decision base priority exceeds conversation');

  const dispatched = dispatchEligibleJobs(sched, worldNear, 2000);
  assert.equal(dispatched.jobsToStart.length, 1);
  assert.equal(dispatched.jobsToStart[0].kind, 'decision', 'Conversation is held back past 78% cap while decision runs');

  // Routine forks still enqueue up to 80% of daily cap
  const schedWithRoutine = enqueueTriggers(
    { ...createSchedulerState(buildSchedulerConfig('balanced'), 1), callsToday: Math.floor(dayCap * 0.5) },
    worldNear,
    {
      conversationPairs: [],
      reflectionAgentIds: [],
      morningPlanAgentIds: [],
      reactionTriggers: [],
      stepDetailRequests: [],
      decisionTriggers: [{ agentId: world.agents[2].id, forkReason: 'Civic vote', urgency: 0.75 }],
    },
    3000,
  );
  assert.equal(
    schedWithRoutine.queue.some((j) => j.kind === 'decision'),
    true,
    'Routine BDI forks enqueue at 50% daily budget',
  );
});

test('Part A2: overnight basal hunger drain is gentle and breakfast restores vitality; empty pantry falls back to home staples', () => {
  const startDrives = { energy: 30, hunger: 65, social: 60, purpose: 60 };
  // 8 hours of sleep (480 sim-min)
  const afterSleep = stepAgentDrives(
    startDrives,
    {
      minuteOfDay: 120,
      locationCategory: 'home',
      weather: 'clear',
      isMoving: false,
      isAtDestination: true,
      isResting: true,
      isEatingMeal: false,
      isAtHome: true,
    },
    480,
  );
  assert.ok(afterSleep.hunger >= 50, `Expected gentle overnight hunger drain, got ${afterSleep.hunger}`);

  // 40-min breakfast at home
  const afterBreakfast = stepAgentDrives(
    { ...afterSleep, hunger: 45 },
    {
      minuteOfDay: 410,
      locationCategory: 'home',
      weather: 'clear',
      isMoving: false,
      isAtDestination: true,
      isResting: false,
      isEatingMeal: true,
      isAtHome: true,
    },
    40,
  );
  assert.ok(afterBreakfast.hunger >= 65, `Expected breakfast to restore >= 20 hunger, got ${afterBreakfast.hunger}`);

  // Empty pantry fallback at home for hungry resident
  const base = createInitialWorldState('default');
  const hungryHomeWorld = {
    ...base,
    agents: base.agents.map((ag, idx) =>
      idx === 0
        ? { ...ag, currentLocationId: ag.homeLocationId, goods: {}, drives: { ...ag.drives, hunger: 30 } }
        : ag,
    ),
  };
  const consumed = executeConsumeItemAction(hungryHomeWorld, base.agents[0].id);
  assert.ok(consumed.consumed, 'Hungry resident at home with empty pantry eats basic staples');
  assert.ok(consumed.world.agents[0].drives.hunger >= 45);
});

test('Part A2: career promotion prevents Week-1 freshman master inflation while allowing earned practitioner promotions', () => {
  const base = createInitialWorldState('default');
  let idSeq = 1;
  const alloc = (p: string) => `${p}_${idSeq++}`;

  // Work shift skill gain is modest (+0.18 instead of +0.6)
  const workWorld = {
    ...base,
    agents: base.agents.map((ag, idx) =>
      idx === 0 ? { ...ag, currentLocationId: ag.employerLocationId ?? 'hobbs_cafe' } : ag,
    ),
  };
  const beforeSkill = Object.values(workWorld.agents[0].skills ?? {})[0] ?? 50;
  const shiftRes = executeWorkShiftTick(workWorld, workWorld.agents[0].id, 1, alloc);
  const afterSkill = Object.values(shiftRes.world.agents[0].skills ?? {})[0] ?? 50;
  assert.ok(afterSkill - beforeSkill <= 0.25, `Work skill gain should be calibrated, got +${afterSkill - beforeSkill}`);

  // Young student (age 20) with senior tier and high skill 95 but 0 completed projects cannot become master
  const youngSeniorWorld = {
    ...base,
    agents: base.agents.map((ag, idx) =>
      idx === 0
        ? { ...ag, age: 20, careerTier: 'senior' as const, skills: { research: 95 }, projects: [] }
        : ag,
    ),
  };
  const promoYoung = stepCareerProgression(youngSeniorWorld, alloc);
  assert.equal(promoYoung.world.agents[0].careerTier, 'senior', 'Young student without completed project stays senior');
});

test('Part A3: civic quorum is 25% (5 for 18 agents) and fiscal conservatives oppose costly proposals', () => {
  const base = createInitialWorldState('default');
  let idSeq = 1;
  const alloc = (p: string) => `${p}_${idSeq++}`;

  const costlyProposal = {
    id: 'prop_costly',
    title: 'Grand Pavilion Renovation',
    description: 'Expensive municipal upgrade',
    proposerId: base.agents[0].id,
    proposerName: base.agents[0].name,
    createdAt: base.simMinutes,
    cost: 120,
    effectKey: 'streetLighting' as const,
    votesFor: [base.agents[0].id, base.agents[1].id, base.agents[2].id, base.agents[3].id],
    votesAgainst: [],
    status: 'open' as const,
  };

  // Agent 5 as fiscal conservative with frugal posture votes Against automatically when supportOverride is undefined
  const conservativeWorld = {
    ...base,
    townTreasury: 500,
    proposals: [costlyProposal],
    agents: base.agents.map((ag, idx) =>
      idx === 5
        ? {
            ...ag,
            currently: 'Auditing shop ledger',
            goals: ['Protect town reserves from overspending'],
            socialGraph: {
              ...ag.socialGraph,
              [base.agents[0].id]: {
                targetId: base.agents[0].id,
                roleLabel: 'neighbor',
                inferredGoal: 'civic project',
                trust: 45,
                affection: 42,
                familiarity: 35,
                lastUpdatedSimMin: base.simMinutes,
              },
            },
            dossier: {
              ...(ag.dossier ?? {
                background: '',
                formativeEvents: [],
                speechStyle: '',
                privateAgenda: '',
                redLines: [],
                financialPosture: 'frugal' as const,
                civicWorldview: 'fiscal_conservative' as const,
              }),
              financialPosture: 'frugal' as const,
              civicWorldview: 'fiscal_conservative' as const,
            },
            temperament: {
              ...(ag.temperament ?? {
                riskTolerance: 0.3,
                ambition: 0.5,
                stubbornness: 0.8,
                decoding: { temperature: 0.7, topP: 0.9, frequencyPenalty: 0.2 },
              }),
              stubbornness: 0.8,
            },
          }
        : ag,
    ),
  };

  const voteCon = castCivicVote(conservativeWorld, base.agents[5].id, 'prop_costly', undefined, alloc);
  assert.equal(voteCon.voted, true);
  assert.equal(voteCon.world.proposals![0].votesAgainst.includes(base.agents[5].id), true, 'Fiscal conservative opposes costly proposal');

  // 5th supporting vote reaches 25% quorum (ceil(18 * 0.25) = 5) and enacts proposal
  const votePass = castCivicVote(voteCon.world, base.agents[6].id, 'prop_costly', true, alloc);
  assert.equal(votePass.enacted?.status, 'passed', '5th vote enacts proposal under 25% quorum');
});

test('Part A3: BDI fork detector fires for clinic health, civic proposals, and upcoming club gatherings', () => {
  const base = createInitialWorldState('default');
  const daytime = 1440 + 11 * 60; // Day 2, 11:00 AM

  // Health fork mentions clinic
  const sickWorld = {
    ...base,
    simMinutes: daytime,
    agents: base.agents.map((ag, idx) =>
      idx === 0 ? { ...ag, illness: 'mild_cold' as const, health: 58, lastDecisionSimMin: -500 } : ag,
    ),
  };
  const sickFork = detectBdiDecisionFork(sickWorld, sickWorld.agents[0]);
  assert.ok(sickFork && sickFork.forkReason.toLowerCase().includes('clinic'));

  // Upcoming club meeting fork fires 1 hour before meeting
  const club = base.clubs?.[0];
  if (club && club.memberIds.length > 0) {
    const memberId = club.memberIds[0];
    const meetingSimMin = club.meetingWeekday * 1440 + (club.meetingHour - 1) * 60;
    const clubWorld = {
      ...base,
      simMinutes: meetingSimMin,
      proposals: [],
      petitions: [],
      agents: base.agents.map((ag) =>
        ag.id === memberId
          ? {
              ...ag,
              wallet: 140,
              health: 100,
              illness: 'none' as const,
              currentLocationId: ag.homeLocationId === club.locationId ? 'johnson_park' : ag.homeLocationId,
              lastDecisionSimMin: -500,
            }
          : ag,
      ),
    };
    const member = clubWorld.agents.find((a) => a.id === memberId)!;
    const clubFork = detectBdiDecisionFork(clubWorld, member);
    assert.ok(clubFork && clubFork.forkReason.includes(club.name), 'Club meeting fork triggers before scheduled gathering');
  }
});
