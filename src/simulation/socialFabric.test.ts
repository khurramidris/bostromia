import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyGroupSceneResult, createInitialWorldState } from './engine';
import { makeIdAllocator } from './ids';
import {
  applyAmbientOverhearing,
  applyGossipUpdates,
  castCivicVote,
  createCivicProposal,
  getCivicQuorum,
  postPublicNotice,
  scanNoticeBoardForAgent,
} from './socialFabric';

describe('Phase B — Notice Board, Civic Governance, Gossip, Overhearing & Group Scenes', () => {
  it('posts public notices and lets residents read them asynchronously when visiting public hubs', () => {
    let world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const initialCount = world.notices?.length ?? 0;

    world = postPublicNotice(
      world,
      {
        authorId: 'isabella',
        authorName: 'Isabella Rodriguez',
        category: 'event',
        title: 'Harvest Acoustic Night',
        body: 'Live music and cider at Hobbs Cafe this Friday at 6 PM.',
        locationId: 'hobbs_cafe',
      },
      alloc.next,
    );

    assert.equal(world.notices!.length, initialCount + 1);
    const created = world.notices![0];
    assert.equal(created.title, 'Harvest Acoustic Night');

    // Place stationary Maria at Hobbs Cafe so she discovers the notice asynchronously
    world = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'maria' ? { ...a, currentLocationId: 'hobbs_cafe', path: [] } : a,
      ),
    };

    const { world: afterScan, readNotice } = scanNoticeBoardForAgent(world, 'maria', alloc.next);
    assert.ok(readNotice, 'Visiting a public hub should let a resident read an unread notice');
    assert.equal(readNotice.title, 'Harvest Acoustic Night');
    const maria = afterScan.agents.find((a) => a.id === 'maria')!;
    assert.ok(
      maria.memories.some((m) => m.description.includes('Harvest Acoustic Night')),
      'Reading a notice should store a memory node',
    );
    assert.ok(
      afterScan.notices![0].readByAgentIds.includes('maria'),
      'Notice should track that Maria read it so she does not re-read endlessly',
    );
  });

  it('creates civic proposals, collects resident votes, and enacts town modifiers on quorum pass', () => {
    let world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const initialTreasury = world.townTreasury ?? 650;

    world = createCivicProposal(
      world,
      {
        proposerId: 'citizen_observer',
        proposerName: 'Community Council',
        title: 'Install Solar Street Lanterns',
        description: 'Add warm solar lamps along Main Street pathways.',
        cost: 150,
        effectKey: 'streetLighting',
      },
      alloc.next,
    );

    const proposal = world.proposals![0];
    assert.equal(proposal.status, 'open');

    const quorum = getCivicQuorum(world.agents.length);
    const voters = world.agents.slice(0, quorum).map((a) => a.id);
    for (const vid of voters) {
      const res = castCivicVote(world, vid, proposal.id, true, alloc.next);
      assert.equal(res.voted, true);
      world = res.world;
    }

    const resolved = world.proposals!.find((p) => p.id === proposal.id)!;
    assert.equal(resolved.status, 'passed');
    assert.equal(world.townModifiers?.streetLighting, true);
    assert.equal(world.townTreasury, initialTreasury - 150);
    assert.ok((world.stats.civicVotesCast ?? 0) >= quorum);
  });

  it('propagates trust-weighted third-party gossip and updates subject community reputation', () => {
    const world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    const listener = world.agents.find((a) => a.id === 'maria')!;
    const speaker = world.agents.find((a) => a.id === 'isabella')!;
    const subject = world.agents.find((a) => a.id === 'klaus')!;

    const beforeTrust = listener.socialGraph[subject.id]?.trust ?? 0;
    const { world: afterGossip, appliedCount } = applyGossipUpdates(
      world,
      [
        {
          speakerId: speaker.id,
          listenerId: listener.id,
          aboutAgentId: subject.id,
          deltaTrust: 10,
          deltaAffection: 8,
          claim: 'Klaus spent hours helping repair the community reading tables.',
        },
      ],
      alloc.next,
    );

    assert.equal(appliedCount, 1);
    const updatedListener = afterGossip.agents.find((a) => a.id === listener.id)!;
    const afterTrust = updatedListener.socialGraph[subject.id]?.trust ?? 0;
    assert.ok(afterTrust > beforeTrust, 'Positive gossip from a trusted speaker should raise listener trust');
    assert.ok(
      updatedListener.memories.some((m) => m.source === 'gossip'),
      'Gossip should create a gossip-sourced memory',
    );
    assert.ok((afterGossip.stats.gossipUpdatesApplied ?? 0) >= 1);
  });

  it('lets nearby non-participant residents in the same room overhear conversations', () => {
    let world = createInitialWorldState();
    const alloc = makeIdAllocator(world.idSeq ?? 1);
    // Place stationary Isabella, Maria, and Klaus in the same room (hobbs_cafe)
    world = {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'isabella' || a.id === 'maria' || a.id === 'klaus'
          ? { ...a, currentLocationId: 'hobbs_cafe', path: [], x: 35, y: 20 }
          : a,
      ),
    };

    const { world: afterOverhear, overheardByIds } = applyAmbientOverhearing(
      world,
      {
        participantIds: ['isabella', 'maria'],
        locationId: 'hobbs_cafe',
        locationName: 'Hobbs Cafe',
        summary: 'Isabella and Maria discussed organizing a weekend farmers market.',
        sampleLine: 'We should organize a weekend farmers market at the square.',
        discussedMemeIds: [],
      },
      alloc.next,
    );

    assert.ok(overheardByIds.includes('klaus'), 'Klaus in the same room should overhear the dialogue');
    const klaus = afterOverhear.agents.find((a) => a.id === 'klaus')!;
    assert.ok(
      klaus.memories.some((m) => m.source === 'overheard'),
      'Overhearing should add an overheard memory node',
    );
  });

  it('applies 3-resident multi-party group scenes updating all participants and group stats', () => {
    let world = createInitialWorldState();
    const ids = ['isabella', 'maria', 'klaus'];
    world = {
      ...world,
      agents: world.agents.map((a) =>
        ids.includes(a.id) ? { ...a, currentLocationId: 'hobbs_cafe', path: [], x: 35, y: 20 } : a,
      ),
    };

    const next = applyGroupSceneResult(world, {
      participantIds: ids,
      turns: [
        { speakerId: 'isabella', speakerName: 'Isabella Rodriguez', text: 'Welcome everyone, fresh coffee is on.' },
        { speakerId: 'maria', speakerName: 'Maria Lopez', text: 'Thanks Isabella! Klaus and I were comparing study notes.' },
        { speakerId: 'klaus', speakerName: 'Klaus Mueller', text: 'We should also vote on the library extension proposal.' },
      ],
      summaryByAgent: {
        isabella: { summary: 'Isabella hosted Maria and Klaus for a group chat at Hobbs Cafe.', importance: 6 },
        maria: { summary: 'Maria chatted with Isabella and Klaus about studies and the library proposal.', importance: 6 },
        klaus: { summary: 'Klaus discussed civic proposals with Isabella and Maria over coffee.', importance: 7 },
      },
      emotionalShiftByAgent: {
        isabella: { deltaValence: 0.1, deltaArousal: 0.05 },
        maria: { deltaValence: 0.1, deltaArousal: 0.05 },
        klaus: { deltaValence: 0.1, deltaArousal: 0.05 },
      },
      tomUpdates: [
        { fromId: 'maria', targetId: 'klaus', deltaTrust: 3, deltaAffection: 2, inferredGoal: 'Support library hours' },
      ],
      gossipUpdates: [],
      memeIdsDiscussed: [],
      newNews: [],
    });

    assert.equal(next.conversations.length, 1);
    assert.deepEqual(next.conversations[0].participantIds, ids);
    assert.equal(next.conversations[0].isGroup, true);
    assert.equal(next.stats.compressedScenes, 1);
    for (const id of ids) {
      const ag = next.agents.find((a) => a.id === id)!;
      assert.equal(ag.isThinking, false);
      assert.equal(ag.inConversationWith, undefined);
      assert.ok(ag.memories.some((m) => m.source === 'conversation'));
    }
  });
});
