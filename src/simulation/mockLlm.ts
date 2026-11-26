import { COMMITMENT_MAX_MINUTE, COMMITMENT_MIN_MINUTE, generateRuleSubSteps } from './llmJson';
import { formatSimTime, retrieveMemories } from './memory';
import { createScenarioAgents } from './seedAgents';
import type { BdiDecisionResult, ScheduleBlockKind, WorldState } from './types';

export interface MockLlmOptions {
  seed?: number;
  failAgentIds?: string[];
  failKinds?: string[];
  failureRate?: number;
}

export interface MockLlmClient {
  converse: (
    world: WorldState,
    agentAId: string,
    agentBId: string,
    startReason?: string,
  ) => {
    turns: Array<{ speakerId: string; speakerName: string; text: string; privateThought: string }>;
    summaryA: string;
    summaryB: string;
    importanceA: number;
    importanceB: number;
    importance: number;
    reason?: string;
    endedBy?: string;
    planUpdateA?: string;
    planUpdateB?: string;
    sharedAgreement?: {
      day: 'today' | 'tomorrow' | number;
      minuteOfDay: number;
      durationMinutes?: number;
      locationId: string;
      activity: string;
      emoji?: string;
    };
    memeIdsDiscussedA?: string[];
    memeIdsDiscussedB?: string[];
    emotionalShiftA: { deltaValence: number; deltaArousal: number };
    emotionalShiftB: { deltaValence: number; deltaArousal: number };
    tomUpdateA: { deltaTrust: number; deltaAffection: number; inferredGoal: string };
    tomUpdateB: { deltaTrust: number; deltaAffection: number; inferredGoal: string };
  };
  reflect: (
    world: WorldState,
    agentId: string,
  ) => {
    focalQuestions: string[];
    reflections: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
  };
  plan: (
    world: WorldState,
    agentId: string,
  ) => {
    updatedSummary: string;
    blocks: Array<{
      kind: ScheduleBlockKind;
      startMinute: number;
      durationMinutes: number;
      locationId: string;
      objectId?: string;
      activity: string;
      subSteps?: string[];
      emoji: string;
    }>;
  };
  react: (
    world: WorldState,
    agentId: string,
    observation: string,
    partnerId?: string,
  ) => {
    react: boolean;
    reason: string;
    newActivity?: string;
    kind?: ScheduleBlockKind;
    locationId?: string;
    objectId?: string;
    durationMinutes?: number;
    emoji?: string;
    talkTo?: string;
  };
  stepDetail: (
    world: WorldState,
    agentId: string,
    block: { activity: string; kind: ScheduleBlockKind; durationMinutes: number },
  ) => {
    subSteps: string[];
  };
  consolidate: (
    world: WorldState,
    agentId: string,
  ) => {
    consolidatedInsights: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
    prunedMemoryIds: string[];
    socialUpdates: Array<{ targetId: string; inferredGoal: string; deltaTrust: number }>;
  };
  interview: (
    world: WorldState,
    agentId: string,
    question: string,
  ) => {
    answer: string;
    citedMemoryIds: string[];
    observationSummary: string;
  };
  whisper: (
    world: WorldState,
    agentId: string,
    thought: string,
  ) => {
    reactionBubble: string;
    memoryObservation: string;
    importance: number;
    newAction: string;
    targetLocationId: string;
    emoji: string;
    emotionalShift: { deltaValence: number; deltaArousal: number };
  };
  decide: (
    world: WorldState,
    agentId: string,
    forkReason?: string,
  ) => BdiDecisionResult;
}

function createPrng(seed: number): () => number {
  let state = (seed >>> 0) || 1337;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function createMockLlm(options: MockLlmOptions = {}): MockLlmClient {
  const rand = createPrng(options.seed ?? 42);
  const failSet = new Set(options.failAgentIds ?? []);
  const failKindSet = options.failKinds ? new Set(options.failKinds) : null;
  const failRate = options.failureRate ?? 0;

  const routineCache = new Map<string, Map<string, ReturnType<typeof createScenarioAgents>[number]['dailySchedule']>>();
  function getRoutineForAgent(scenarioId: WorldState['scenarioId'], agentId: string) {
    const key = scenarioId ?? 'default';
    let map = routineCache.get(key);
    if (!map) {
      map = new Map(createScenarioAgents(key).map((a) => [a.id, a.dailySchedule]));
      routineCache.set(key, map);
    }
    return map.get(agentId);
  }

  function maybeFail(agentIds: string[], kind: string): void {
    const kindMatches = !failKindSet || failKindSet.has(kind);
    if (kindMatches) {
      for (const id of agentIds) {
        if (failSet.has(id)) {
          throw new Error(`Mock LLM simulated persistent failure for ${id} (${kind}).`);
        }
      }
    }
    if (failRate > 0 && rand() < failRate) {
      throw new Error(`Mock LLM simulated transient failure (${kind}).`);
    }
  }

  return {
    converse(world, agentAId, agentBId, startReason) {
      maybeFail([agentAId, agentBId], 'converse');
      const a = world.agents.find((x) => x.id === agentAId)!;
      const b = world.agents.find((x) => x.id === agentBId)!;
      const aFirst = a.name.split(' ')[0];
      const bFirst = b.name.split(' ')[0];
      const nowInfo = formatSimTime(world.simMinutes);

      // Prefer asymmetric known memes, especially party & mayor in paper replication
      const asymmetricMemes = world.memes.filter(
        (m) => Boolean(m.knownBy[a.id]) !== Boolean(m.knownBy[b.id]),
      );
      const meme =
        asymmetricMemes.find((m) => m.id === 'meme_valentine_party') ??
        asymmetricMemes.find((m) => m.id === 'meme_mayor_race') ??
        asymmetricMemes[0];

      const topicMention = meme ? ` Have you heard: ${meme.topic.slice(0, 72)}?` : '';
      const turnCount = 2 + Math.floor(rand() * 5); // variable 2..6 turns

      const scriptLines: Array<{ speaker: typeof a; text: string; thought: string }> = [
        {
          speaker: a,
          text: `Hi ${bFirst}, how is your day going in Smallville?${meme && meme.knownBy[a.id] ? topicMention : ''}`,
          thought: `Checking in with ${bFirst}${startReason ? ` (${startReason})` : ''}.`,
        },
        {
          speaker: b,
          text: `Good to run into you, ${aFirst}!${meme && meme.knownBy[b.id] ? topicMention : ' Staying busy with my plans around town.'}`,
          thought: `${aFirst} always has thoughtful updates to share.`,
        },
        {
          speaker: a,
          text: `I was thinking of stopping by Hobbs Cafe later when the afternoon slows down.`,
          thought: `Curious whether ${bFirst} is free later too.`,
        },
        {
          speaker: b,
          text: `That sounds warm — let us catch up around Main Street when our schedules align.`,
          thought: `A quiet chat over coffee would be nice.`,
        },
        {
          speaker: a,
          text: `Count me in! Let's keep each other posted on how the afternoon goes.`,
          thought: `Good catching up on neighborly plans.`,
        },
        {
          speaker: b,
          text: `Will do, ${aFirst} — see you later around Smallville!`,
          thought: `Wrapping up smoothly to get back on schedule.`,
        },
      ];

      const turns = scriptLines.slice(0, turnCount).map((entry) => ({
        speakerId: entry.speaker.id,
        speakerName: entry.speaker.name,
        text: entry.text,
        privateThought: entry.thought,
      }));
      const endedBy = turnCount < 6 ? turns[turns.length - 1].speakerId : undefined;

      const memeIdsDiscussedA = meme && meme.knownBy[a.id] ? [meme.id] : [];
      const memeIdsDiscussedB = meme && meme.knownBy[b.id] ? [meme.id] : [];

      let sharedAgreement:
        | {
            day: 'today' | 'tomorrow' | number;
            minuteOfDay: number;
            durationMinutes?: number;
            locationId: string;
            activity: string;
            emoji?: string;
          }
        | undefined;

      const isPaperScenario = (world.scenarioId ?? 'default') === 'paper_valentine';
      if (isPaperScenario && meme?.id === 'meme_valentine_party' && nowInfo.day <= 2 && rand() < 0.65) {
        // Decision-grounded invitation/RSVP to Day 2 17:00 Valentine's party at Hobbs Cafe
        if (nowInfo.day === 1 || nowInfo.minuteOfDay < 1005) {
          sharedAgreement = {
            day: 2,
            minuteOfDay: 1020,
            durationMinutes: 90,
            locationId: 'hobbs_cafe',
            activity: 'Attend Valentine’s Day party at Hobbs Cafe',
            emoji: '🎉',
          };
        }
      } else if (rand() < 0.18) {
        const candidateMin = Math.min(
          COMMITMENT_MAX_MINUTE,
          Math.max(COMMITMENT_MIN_MINUTE, nowInfo.minuteOfDay + 90),
        );
        const useTomorrow = candidateMin <= nowInfo.minuteOfDay || nowInfo.minuteOfDay >= 1230;
        sharedAgreement = {
          day: useTomorrow ? 'tomorrow' : 'today',
          minuteOfDay: useTomorrow ? 630 : candidateMin,
          durationMinutes: 45,
          locationId: 'hobbs_cafe',
          activity: `Coffee catch-up between ${aFirst} and ${bFirst}`,
          emoji: '☕',
        };
      }

      const importanceA = 4 + Math.floor(rand() * 4);
      const importanceB = 4 + Math.floor(rand() * 4);

      return {
        turns,
        summaryA: `${a.name} chatted with ${b.name} about daily life${meme ? ` and mentioned ${meme.topic.slice(0, 64)}` : ''}.`,
        summaryB: `${b.name} spoke with ${a.name} about upcoming Smallville plans${meme ? ` including ${meme.topic.slice(0, 64)}` : ''}.`,
        importanceA,
        importanceB,
        importance: Math.max(importanceA, importanceB),
        reason: startReason,
        endedBy,
        sharedAgreement,
        memeIdsDiscussedA,
        memeIdsDiscussedB,
        emotionalShiftA: { deltaValence: 0.08, deltaArousal: 0.04 },
        emotionalShiftB: { deltaValence: 0.08, deltaArousal: 0.04 },
        tomUpdateA: {
          deltaTrust: 2,
          deltaAffection: 2,
          inferredGoal: b.currently.slice(0, 80),
        },
        tomUpdateB: {
          deltaTrust: 2,
          deltaAffection: 2,
          inferredGoal: a.currently.slice(0, 80),
        },
      };
    },

    reflect(world, agentId) {
      maybeFail([agentId], 'reflect');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const focalQuestions = [
        `What is shaping ${agent.name}'s mood and energy right now?`,
        `Which conversations or community news stood out to ${agent.name}?`,
        `How do ${agent.name}'s current goals align with upcoming plans?`,
      ];

      // 2-step simulation: retrieve top-12 per question strictly from agent's memories (unless ablated)
      const useRetrieval = !world.ablations?.noMemoryRetrieval;
      const evidenceByQ = focalQuestions.map((q) =>
        useRetrieval
          ? retrieveMemories(agent.memories, q, world.simMinutes, 12).map((r) => r.node)
          : agent.memories.slice(0, 10),
      );
      const validPool = Array.from(
        new Map(evidenceByQ.flat().map((m) => [m.id, m])).values(),
      );
      const validIds = validPool.map((m) => m.id);
      const priorRefId = validPool.find((m) => m.type === 'reflection')?.id;

      const reflections: Array<{ insight: string; importance: number; evidenceIds: string[] }> = [];
      if (validIds.length > 0) {
        reflections.push({
          insight: `${agent.name} notices that steady conversations with neighbors strengthen trust around ${agent.goals[0] ?? agent.occupation}.`,
          importance: 8,
          evidenceIds: validIds.slice(0, 3),
        });
      }
      if (validIds.length >= 2) {
        const secondIds = priorRefId
          ? [priorRefId, validIds[0] === priorRefId ? validIds[1] : validIds[0]]
          : validIds.slice(1, 4);
        reflections.push({
          insight: `Balancing daily responsibilities with community gatherings keeps ${agent.name}'s purpose clear.`,
          importance: 7,
          evidenceIds: Array.from(new Set(secondIds)),
        });
      }
      return { focalQuestions, reflections };
    },

    plan(world, agentId) {
      maybeFail([agentId], 'plan');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const timeInfo = formatSimTime(world.simMinutes);
      const routine = getRoutineForAgent(world.scenarioId, agentId) ?? agent.dailySchedule;
      const recurring = routine.filter((b) => !b.oneOff);
      const sourceList = recurring.length > 0 ? recurring : routine;

      const partyMeme = (world.memes ?? []).find((m) => m.id === 'meme_valentine_party');
      const knowsParty = Boolean(partyMeme?.knownBy[agentId]);
      const isPaper = (world.scenarioId ?? 'default') === 'paper_valentine';

      // Build crisp non-overlapping wake-to-sleep skeleton guaranteeing sleep + 2 meals
      const blocks: Array<{
        kind: ScheduleBlockKind;
        startMinute: number;
        durationMinutes: number;
        locationId: string;
        objectId?: string;
        activity: string;
        subSteps?: string[];
        emoji: string;
      }> = [];

      let cursor = 420;
      const cleanSorted = [...sourceList]
        .filter((b) => b.kind !== 'sleep' && b.startMinute >= 420 && b.startMinute < 1320)
        .sort((a, b) => a.startMinute - b.startMinute);

      for (const b of cleanSorted) {
        if (blocks.length >= 6) break;
        // Never smuggle party block in paper scenario unless agent explicitly heard the news
        if (isPaper && !knowsParty && b.locationId === 'hobbs_cafe' && /party|valentine/i.test(b.activity)) {
          continue;
        }
        const start = Math.max(cursor, b.startMinute);
        const end = Math.min(1320, start + Math.min(180, Math.max(45, b.durationMinutes)));
        if (end - start < 45) continue;
        blocks.push({
          kind: b.kind,
          startMinute: start,
          durationMinutes: end - start,
          locationId: b.locationId,
          objectId: b.objectId,
          activity: b.activity,
          subSteps: b.subSteps,
          emoji: b.emoji,
        });
        cursor = end;
      }

      // If in paper_valentine Day 2 and resident heard about the Valentine's party, occasionally decide to plan attending
      if (isPaper && timeInfo.day === 2 && knowsParty && rand() < 0.45) {
        const partySlotStart = Math.max(1020, cursor);
        if (partySlotStart <= 1050) {
          blocks.push({
            kind: 'social',
            startMinute: partySlotStart,
            durationMinutes: 90,
            locationId: 'hobbs_cafe',
            objectId: 'obj_cafe_table',
            activity: 'Attending Valentine’s Day party at Hobbs Cafe',
            emoji: '💝',
          });
          cursor = partySlotStart + 90;
        }
      }

      const sleepStart = Math.max(1320, cursor);
      blocks.push({
        kind: 'sleep',
        startMinute: sleepStart,
        durationMinutes: 1440 - sleepStart,
        locationId: agent.homeLocationId,
        activity: 'Resting and sleeping peacefully at home',
        emoji: '🛏️',
      });

      return {
        updatedSummary: `${agent.occupation} pursuing steady daily craft (${agent.goals[0] ?? 'Smallville life'}).`,
        blocks,
      };
    },

    react(world, agentId, observation, partnerId) {
      maybeFail([agentId], 'reaction');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const partner = partnerId ? world.agents.find((x) => x.id === partnerId) : undefined;
      const shouldReact = Boolean(partner && (agent.socialGraph[partner.id]?.trust ?? 0) >= 70 && rand() < 0.4);
      if (!shouldReact || !partner) {
        return {
          react: false,
          reason: `Noted "${observation.slice(0, 80)}" without interrupting current block.`,
        };
      }
      return {
        react: true,
        reason: `Warm opportunity to check in with ${partner.name}`,
        newActivity: `Brief catch-up with ${partner.name.split(' ')[0]}`,
        kind: 'social',
        locationId: agent.currentLocationId ?? partner.currentLocationId ?? agent.homeLocationId,
        durationMinutes: 30,
        emoji: '💬',
        talkTo: partner.id,
      };
    },

    stepDetail(world, agentId, block) {
      maybeFail([agentId], 'step_detail');
      return {
        subSteps: generateRuleSubSteps(block),
      };
    },

    consolidate(world, agentId) {
      maybeFail([agentId], 'consolidate');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const ev = agent.memories.slice(0, 3).map((m) => m.id);
      const prunable = agent.memories.filter((m) => m.importance <= 4).slice(0, 2).map((m) => m.id);
      const firstEdgeId = Object.keys(agent.socialGraph)[0];
      return {
        consolidatedInsights: [
          {
            insight: `Today deepened ${agent.name}'s sense of belonging in Smallville while pacing energy smoothly.`,
            importance: 8,
            evidenceIds: ev,
          },
        ],
        prunedMemoryIds: prunable,
        socialUpdates: firstEdgeId
          ? [
              {
                targetId: firstEdgeId,
                inferredGoal: 'Continuing neighborly collaboration tomorrow',
                deltaTrust: 1,
              },
            ]
          : [],
      };
    },

    interview(world, agentId, question) {
      maybeFail([agentId], 'interview');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const retrieved = world.ablations?.noMemoryRetrieval
        ? agent.memories.slice(0, 10)
        : retrieveMemories(agent.memories, question, world.simMinutes, 5).map((r) => r.node);
      const cited = retrieved.slice(0, 3).map((m) => m.id);
      const qLower = question.toLowerCase();

      let answer = `As ${agent.occupation}, I’m currently focused on "${agent.currently}".`;
      if (qLower.includes('party') || qLower.includes('valentine')) {
        const partyMem = retrieved.find((m) => /valentine/i.test(m.description));
        answer = partyMem
          ? `Yes, I heard about it: "${partyMem.description}"`
          : `I haven't heard details about a Valentine’s party at Hobbs Cafe yet—mostly busy with ${agent.currently.toLowerCase()}.`;
      } else if (qLower.includes('mayor')) {
        const mayorMem = retrieved.find((m) => /mayor|election|sam moore/i.test(m.description));
        answer = mayorMem
          ? `I heard some talk about town leadership: "${mayorMem.description}"`
          : `I haven't heard anyone running for mayor yet—mostly focused on ${agent.goals[0] ?? agent.occupation}.`;
      } else if (qLower.includes('plan') || qLower.includes('tomorrow') || qLower.includes('tonight')) {
        const upcoming = agent.dailySchedule
          .slice(0, 3)
          .map((b) => `${b.activity}`)
          .join(', ');
        answer = `My goals center on ${agent.goals[0] ?? agent.occupation}, and my upcoming blocks include ${upcoming || agent.currently}.`;
      } else if (qLower.includes('reflect') || qLower.includes('pattern') || qLower.includes('lesson')) {
        const refl = agent.memories.find((m) => m.type === 'reflection' || m.type === 'consolidated');
        answer = refl
          ? `Something I keep coming back to is: "${refl.description}"`
          : `I’m still taking things day by day as ${agent.occupation}.`;
      } else if (retrieved[0]) {
        answer = `Speaking as ${agent.name}, ${agent.occupation}: ${retrieved[0].description}`;
      }

      return {
        answer,
        citedMemoryIds: cited,
        observationSummary: `${agent.name} spoke with the Smallville Gazette reporter about life in town.`,
      };
    },

    whisper(world, agentId, thought) {
      maybeFail([agentId], 'whisper');
      const agent = world.agents.find((x) => x.id === agentId)!;
      return {
        reactionBubble: 'Hmm, that is worth acting on right now.',
        memoryObservation: `${agent.name} reflected on inner thought: ${thought}`,
        importance: 7,
        newAction: agent.currentAction,
        targetLocationId: '',
        emoji: '💭',
        emotionalShift: { deltaValence: 0.05, deltaArousal: 0.05 },
      };
    },

    decide(world, agentId, forkReason) {
      maybeFail([agentId], 'decision');
      const agent = world.agents.find((x) => x.id === agentId)!;
      const reasonLow = (forkReason ?? '').toLowerCase();

      // Respond authentically to unread private letters
      if (reasonLow.includes('private letter')) {
        const recentLetter = (world.letters ?? []).find(
          (l) => l.toAgentId === agentId && l.deliveredAt <= world.simMinutes,
        );
        if (recentLetter) {
          return {
            action: 'send_letter',
            reason: `Replying privately to ${recentLetter.fromName}'s letter.`,
            targetAgentId: recentLetter.fromAgentId,
            letterSubject: `Re: ${recentLetter.subject}`.slice(0, 100),
            letterBody: `Thank you for writing, ${recentLetter.fromName.split(' ')[0]}. Let us follow up directly on this soon.`,
            emoji: '✉️',
          };
        }
      }

      // Active troubling rumor -> fact_check
      if (reasonLow.includes('fact_check') || reasonLow.includes('active rumor')) {
        const activeRumor = (world.rumors ?? []).find((r) => !r.debunked);
        if (activeRumor) {
          return {
            action: 'fact_check',
            reason: `Checking public records regarding "${activeRumor.currentClaim.slice(0, 80)}".`,
            rumorId: activeRumor.id,
            locationId: 'town_hall',
            emoji: '🔎',
          };
        }
      }

      // Defaulted loan, breached contract, or dispute -> file_dispute (or call_boycott if directed)
      if (reasonLow.includes('file_dispute') || reasonLow.includes('defaulted on your') || reasonLow.includes('breached your')) {
        const defaultLoan = (world.loans ?? []).find(
          (l) => l.lenderId === agentId && l.status === 'defaulted',
        );
        const breachedContract = (world.serviceContracts ?? []).find(
          (c) => c.proposerId === agentId && c.status === 'breached',
        );
        const respondentId =
          defaultLoan?.borrowerId ??
          breachedContract?.counterpartyId ??
          Object.entries(agent.socialGraph).find(([, e]) => e.trust < 28)?.[0];
        if (respondentId) {
          return {
            action: 'file_dispute',
            reason: `Filing a formal dispute at Town Hall regarding ${respondentId}.`,
            targetAgentId: respondentId,
            disputeCategory: defaultLoan
              ? 'loan_default'
              : breachedContract
                ? 'contract_breach'
                : 'reputation_harm',
            disputeAmount: defaultLoan?.amountDue ?? 45,
            emoji: '⚖️',
          };
        }
      }

      // Sharp interpersonal conflict -> avoid_person
      if (reasonLow.includes('trust with') || reasonLow.includes('avoid')) {
        const strained = Object.entries(agent.socialGraph).find(([, e]) => e.trust < 28);
        if (strained) {
          return {
            action: 'avoid_person',
            reason: `Keeping distance while trust with ${strained[0]} is strained.`,
            targetAgentId: strained[0],
            emoji: '🚶',
          };
        }
      }

      // Loneliness / isolation -> actively seek out highest-affection neighbor
      if (reasonLow.includes('isolated') || reasonLow.includes('seek out')) {
        const friend = Object.values(agent.socialGraph).sort((a, b) => b.affection - a.affection)[0];
        if (friend) {
          return {
            action: 'seek_person',
            reason: `Seeking out ${friend.targetId} for company and conversation.`,
            targetAgentId: friend.targetId,
            emoji: '💬',
          };
        }
      }

      // Open Genesis trial: enterprising agents occasionally initiate open_action orgs/norms in open_genesis mode
      if (
        world.genesisMode === 'open_genesis' &&
        world.scenarioId !== 'paper_valentine' &&
        (reasonLow.includes('open_action') || (world.simMinutes >= 2880 && rand() < 0.28)) &&
        (world.organizations?.length ?? 0) < 3
      ) {
        const firstName = agent.name.split(' ')[0];
        return {
          action: 'open_action',
          openIntent: `Establish ${firstName}'s Mutual Aid & Artisan Guild to pool voluntary dues for hard times.`,
          reason: `Organizing ${firstName}'s Mutual Aid & Artisan Guild in Smallville.`,
          locationId: agent.currentLocationId ?? 'town_hall',
          emoji: '✨',
        };
      }

      const openProposal = (world.proposals ?? []).find(
        (p) =>
          p.status === 'open' &&
          !p.votesFor.includes(agent.id) &&
          !p.votesAgainst.includes(agent.id),
      );
      if (openProposal && rand() < 0.45) {
        return {
          action: 'vote_proposal',
          reason: `Weighed civic benefits of "${openProposal.title}" (${forkReason ?? 'civic check'}).`,
          proposalId: openProposal.id,
          voteSupport: (agent.wallet ?? 100) >= 60,
          emoji: '🗳️',
        };
      }
      const activeProject = (agent.projects ?? []).find((p) => p.status === 'active');
      if (activeProject) {
        return {
          action: 'advance_project',
          reason: `Focused energy on "${activeProject.title}" (${forkReason ?? 'project focus'}).`,
          locationId: activeProject.targetLocationId,
          activity: `Working on ${activeProject.title}`,
          emoji: '🛠️',
        };
      }
      return {
        action: 'adjust_goal',
        reason: `Staying steady on current priorities (${forkReason ?? 'routine check'}).`,
        activity: agent.currently,
        emoji: '🧭',
      };
    },
  };
}
