import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyBdiDecisionResult, detectBdiDecisionFork } from './autonomy';
import { applyAutonomousDecision, createInitialWorldState, stepWorldState } from './engine';
import { makeIdAllocator } from './ids';
import {
  normalizeBdiDecisionPayload,
  normalizeCompressedScenePayload,
} from './llmJson';
import { retrieveMemories } from './memory';
import type { MemoryNode } from './types';

describe('Phase C — Local BM25+Entity Retrieval, BDI Decision Forks & Compressed Scene Normalizers', () => {
  it('ranks rare-entity matching memories above generic overlap using zero-quota BM25-IDF + Entity Boost', () => {
    const now = 600;
    const memories: MemoryNode[] = [
      {
        id: 'm1',
        createdAt: now - 10,
        lastAccessed: now - 10,
        type: 'observation',
        description: 'Walked down Main Street during a quiet afternoon walk in town.',
        importance: 5,
        keywords: ['walked', 'main', 'street', 'quiet', 'afternoon', 'walk', 'town'],
      },
      {
        id: 'm2',
        createdAt: now - 10,
        lastAccessed: now - 10,
        type: 'observation',
        description: 'Spoke with Elena Vasquez about solar lantern wiring near Oakridge Bakery.',
        importance: 5,
        keywords: ['spoke', 'elena', 'vasquez', 'solar', 'lantern', 'wiring', 'oakridge', 'bakery'],
      },
      {
        id: 'm3',
        createdAt: now - 10,
        lastAccessed: now - 10,
        type: 'observation',
        description: 'Walked past the park bench during a pleasant town morning.',
        importance: 5,
        keywords: ['walked', 'park', 'bench', 'pleasant', 'town', 'morning'],
      },
    ];

    const ranked = retrieveMemories(memories, 'Elena Vasquez lantern wiring', now, 3);
    assert.equal(ranked[0].node.id, 'm2', 'BM25 + entity boost should rank rare proper-noun match #1');
    assert.ok(ranked[0].relevanceScore > ranked[1].relevanceScore);
  });

  it('detects BDI decision forks when residents face open proposals or budget pressure and applies real world mutations', () => {
    const world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const agent = world.agents.find((a) => a.id === 'isabella')!;

    // Trigger fork via low wallet (< $30)
    const pressuredWorld = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === agent.id ? { ...a, wallet: 25, lastDecisionSimMin: -999 } : a,
      ),
    };
    const fork = detectBdiDecisionFork(
      pressuredWorld,
      pressuredWorld.agents.find((a) => a.id === agent.id)!,
    );
    assert.ok(fork, 'Resident with low wallet should trigger a BDI decision fork');

    // Apply autonomous vote_proposal decision
    const openProp = world.proposals!.find(
      (p) => p.status === 'open' && !p.votesFor.includes(agent.id) && !p.votesAgainst.includes(agent.id),
    )!;
    const afterVote = applyAutonomousDecision(world, agent.id, {
      action: 'vote_proposal',
      reason: 'Supporting neighborhood lighting improves evening business.',
      proposalId: openProp.id,
      voteSupport: true,
    });
    const updatedProp = afterVote.proposals!.find((p) => p.id === openProp.id)!;
    assert.ok(updatedProp.votesFor.includes(agent.id));
    assert.ok((afterVote.stats.bdiDecisions ?? 0) >= 1);

    // Apply autonomous post_notice decision
    const beforeNotices = afterVote.notices!.length;
    const afterNotice = applyBdiDecisionResult(
      afterVote,
      agent.id,
      {
        action: 'post_notice',
        reason: 'Announce fresh roasted beans for neighbors.',
        noticeTitle: 'Fresh Espresso Roast Today',
        noticeBody: 'Stop by Hobbs Cafe before noon for fresh espresso.',
        noticeCategory: 'market',
      },
      alloc.next,
      (sched, blk) => [...sched, blk],
    );
    assert.equal(afterNotice.notices!.length, beforeNotices + 1);
    assert.equal(afterNotice.notices![0].title, 'Fresh Espresso Roast Today');
  });

  it('normalizes compressed multi-party scene payloads and BDI decision payloads defensively', () => {
    const participants = [
      { id: 'isabella', name: 'Isabella Rodriguez' },
      { id: 'maria', name: 'Maria Lopez' },
      { id: 'klaus', name: 'Klaus Mueller' },
    ];
    const scene = normalizeCompressedScenePayload(
      {
        turns: [
          { speakerId: 'isabella', spokenLine: 'Morning both of you!', privateThought: 'Glad they stopped by.' },
          { speakerId: 'maria', spokenLine: 'Morning Isabella!', privateThought: 'Coffee smells great.' },
          { speakerId: 'klaus', spokenLine: 'Have you seen the town proposal?', privateThought: 'Curious what they think.' },
        ],
        summaryByAgent: {
          isabella: { summary: 'Chatted with Maria and Klaus.', importance: 7 },
          maria: { summary: 'Enjoyed coffee and caught up with Isabella and Klaus.', importance: 15 },
        },
        tomUpdates: [
          { fromId: 'maria', targetId: 'klaus', deltaTrust: 99, deltaAffection: -50, inferredGoal: 'Pass library bill' },
        ],
        gossipUpdates: [
          { speakerId: 'klaus', listenerId: 'maria', aboutAgentId: 'sam', deltaTrust: 99, deltaAffection: -50, claim: 'Sam is campaigning earnestly.' },
        ],
        memeIdsDiscussed: ['meme_mayor_race', 'invalid_meme'],
      },
      participants,
      new Set(['meme_mayor_race']),
    );

    assert.equal(scene.turns.length, 3);
    assert.equal(scene.summaryByAgent.maria.importance, 10, 'Importance should clamp to 10');
    assert.equal(scene.tomUpdates[0].deltaTrust, 15, 'Trust delta should clamp to +15');
    assert.equal(scene.tomUpdates[0].deltaAffection, -15, 'Affection delta should clamp to -15');
    assert.equal(scene.gossipUpdates[0].deltaTrust, 12, 'Gossip trust delta should clamp to +12');
    assert.equal(scene.gossipUpdates[0].deltaAffection, -12, 'Gossip affection delta should clamp to -12');
    assert.deepEqual(scene.memeIdsDiscussed, ['meme_mayor_race']);

    const decision = normalizeBdiDecisionPayload({
      action: 'adjust_goal',
      reason: 'Want to save more cash for community projects.',
      newGoal: 'Save $200 in personal reserves by Sunday',
    });
    assert.equal(decision.action, 'adjust_goal');
    assert.equal(decision.newGoal, 'Save $200 in personal reserves by Sunday');
  });

  it('grounds BDI buy_item (including non-edible goods) and deferred civic votes upon physical arrival', () => {
    let world = createInitialWorldState();
    const mariaStart = world.agents.find((a) => a.id === 'maria')!;
    const craftPrice = world.businesses!.willow_workshop!.stock.craft_goods!.price;

    // Place Maria at home (not at willow_workshop) with sufficient wallet, Day 1 10:00 AM
    world = {
      ...world,
      simMinutes: 600,
      agents: world.agents.map((a) =>
        a.id === 'maria'
          ? {
              ...a,
              currentLocationId: a.homeLocationId,
              wallet: 150,
              goods: {},
            }
          : a,
      ),
    };

    // 1. buy_item for non-edible craft_goods while away must defer and attach pendingAction
    world = applyAutonomousDecision(
      world,
      'maria',
      {
        action: 'buy_item',
        reason: 'Buying crafted woodwork supplies for studio desk.',
        locationId: 'willow_workshop',
        itemKind: 'craft_goods',
        durationMinutes: 45,
      },
      { deferUntilArrival: true },
    );
    const mariaBeforeArrival = world.agents.find((a) => a.id === 'maria')!;
    assert.equal(mariaBeforeArrival.wallet, 150, 'Wallet must not be debited before physical arrival');
    assert.equal(mariaBeforeArrival.goods?.craft_goods ?? 0, 0);

    // Step world until Maria walks to Willow Workshop and executes pending purchase on arrival
    for (let i = 0; i < 60; i++) {
      world = stepWorldState(world, 1).nextState;
      const m = world.agents.find((a) => a.id === 'maria')!;
      if ((m.goods?.craft_goods ?? 0) > 0) break;
    }
    const mariaAfterArrival = world.agents.find((a) => a.id === 'maria')!;
    assert.equal(mariaAfterArrival.currentLocationId, 'willow_workshop');
    assert.equal(mariaAfterArrival.goods?.craft_goods, 1, 'Non-edible craft_goods should be purchased upon arrival');
    assert.equal(mariaAfterArrival.wallet, 150 - craftPrice);

    // 2. vote_proposal with deferUntilArrival while away from Town Hall defers vote until arrival
    const openProp = world.proposals!.find((p) => p.status === 'open')!;
    world = applyAutonomousDecision(
      world,
      'isabella',
      {
        action: 'vote_proposal',
        reason: 'Walking to Town Hall to cast civic ballot.',
        proposalId: openProp.id,
        voteSupport: true,
        durationMinutes: 45,
      },
      { deferUntilArrival: true },
    );
    assert.equal(
      world.proposals!.find((p) => p.id === openProp.id)!.votesFor.includes('isabella'),
      false,
      'Civic vote must not execute remotely before arriving at Town Hall',
    );
    for (let i = 0; i < 60; i++) {
      world = stepWorldState(world, 1).nextState;
      if (world.proposals!.find((p) => p.id === openProp.id)!.votesFor.includes('isabella')) break;
    }
    assert.equal(
      world.proposals!.find((p) => p.id === openProp.id)!.votesFor.includes('isabella'),
      true,
      'Civic vote should execute once Isabella reaches Town Hall',
    );
    assert.ok(mariaStart.id === 'maria');
  });
});
