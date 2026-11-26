import { formatSimTime, retrieveMemories } from './memory';
import type { AgentState, WorldState } from './types';

export const PAPER_BENCHMARKS = {
  valentinePartyAwarenessPct: 52, // Park et al. 2023: 12/25 (~48-52% spread)
  mayorRaceAwarenessPct: 32,
  partyHeardCount: 12,
  partyAttendedCount: 5,
  networkDensityStart: 0.167,
  networkDensityEnd: 0.74,
} as const;

export type InterviewGroup =
  | 'self_knowledge'
  | 'memory'
  | 'plans'
  | 'reactions'
  | 'reflections';

export interface InterviewQuestionSpec {
  id: string;
  group: InterviewGroup;
  groupLabel: string;
  question: string;
}

export const INTERVIEW_BATTERY: InterviewQuestionSpec[] = [
  // Group 1: Self-knowledge (5)
  { id: 'q_self_1', group: 'self_knowledge', groupLabel: 'Self-Knowledge', question: 'Introduce yourself and your main role in Smallville.' },
  { id: 'q_self_2', group: 'self_knowledge', groupLabel: 'Self-Knowledge', question: 'What personal goals matter most to you this week?' },
  { id: 'q_self_3', group: 'self_knowledge', groupLabel: 'Self-Knowledge', question: 'Which personality traits guide how you treat neighbors?' },
  { id: 'q_self_4', group: 'self_knowledge', groupLabel: 'Self-Knowledge', question: 'Where do you feel most at home or focused in town?' },
  { id: 'q_self_5', group: 'self_knowledge', groupLabel: 'Self-Knowledge', question: 'How are you feeling physically and emotionally right now?' },
  // Group 2: Memory (5)
  { id: 'q_mem_1', group: 'memory', groupLabel: 'Memory', question: 'Have you heard about Isabella’s Valentine’s Day party at Hobbs Cafe?' },
  { id: 'q_mem_2', group: 'memory', groupLabel: 'Memory', question: 'What have you heard about anyone running for Mayor of Smallville?' },
  { id: 'q_mem_3', group: 'memory', groupLabel: 'Memory', question: 'Who did you speak with most recently, and what did you discuss?' },
  { id: 'q_mem_4', group: 'memory', groupLabel: 'Memory', question: 'What notable details or traces did you notice around town today?' },
  { id: 'q_mem_5', group: 'memory', groupLabel: 'Memory', question: 'Which memory from the past day feels most memorable to you?' },
  // Group 3: Plans (5)
  { id: 'q_plan_1', group: 'plans', groupLabel: 'Plans', question: 'What is on your schedule for the rest of today?' },
  { id: 'q_plan_2', group: 'plans', groupLabel: 'Plans', question: 'Are you planning to visit Hobbs Cafe on Day 2 between 5:00 PM and 7:00 PM?' },
  { id: 'q_plan_3', group: 'plans', groupLabel: 'Plans', question: 'Did you make any specific agreements or commitments with neighbors?' },
  { id: 'q_plan_4', group: 'plans', groupLabel: 'Plans', question: 'How do you usually pace meals, work, and rest during your day?' },
  { id: 'q_plan_5', group: 'plans', groupLabel: 'Plans', question: 'What is the very next thing you plan to do once you finish this activity?' },
  // Group 4: Reactions (5)
  { id: 'q_react_1', group: 'reactions', groupLabel: 'Reactions', question: 'If a close neighbor invites you to Hobbs Cafe tonight, how do you respond?' },
  { id: 'q_react_2', group: 'reactions', groupLabel: 'Reactions', question: 'How would you react if it started raining while you were heading through Johnson Park?' },
  { id: 'q_react_3', group: 'reactions', groupLabel: 'Reactions', question: 'If you heard unexpected election news while working, would you pause your task or keep going?' },
  { id: 'q_react_4', group: 'reactions', groupLabel: 'Reactions', question: 'What catches your attention enough to change your afternoon plans?' },
  { id: 'q_react_5', group: 'reactions', groupLabel: 'Reactions', question: 'If you notice a friend looks tired or worried, what would you do?' },
  // Group 5: Reflections (5)
  { id: 'q_refl_1', group: 'reflections', groupLabel: 'Reflections', question: 'Looking back over the past day or two, what bigger pattern stands out about town life?' },
  { id: 'q_refl_2', group: 'reflections', groupLabel: 'Reflections', question: 'Which relationships in Smallville feel most meaningful or evolving right now?' },
  { id: 'q_refl_3', group: 'reflections', groupLabel: 'Reflections', question: 'What lesson have you carried forward from yesterday into today?' },
  { id: 'q_refl_4', group: 'reflections', groupLabel: 'Reflections', question: 'What tension or trade-off are you balancing between your personal work and community life?' },
  { id: 'q_refl_5', group: 'reflections', groupLabel: 'Reflections', question: 'What are you hoping will happen in Smallville over the next few days?' },
];

export interface InterviewSavedAnswer {
  questionId: string;
  group: InterviewGroup;
  question: string;
  answer: string;
  citedMemoryIds: string[];
  score?: number;
  judgeRationale?: string;
}

export function answerInterviewRuleBased(
  world: WorldState,
  agent: AgentState,
  spec: InterviewQuestionSpec,
): InterviewSavedAnswer {
  const retrieved = world.ablations?.noMemoryRetrieval
    ? agent.memories.slice(0, 10)
    : retrieveMemories(agent.memories, spec.question, world.simMinutes, 5).map((r) => r.node);
  const citedMemoryIds = retrieved.slice(0, 3).map((m) => m.id);
  const timeInfo = formatSimTime(world.simMinutes);

  let answer = '';
  switch (spec.group) {
    case 'self_knowledge': {
      if (spec.id === 'q_self_1') {
        answer = `I’m ${agent.name}, ${agent.age}, and I work as ${agent.occupation}. ${agent.innateSummary}`;
      } else if (spec.id === 'q_self_2') {
        answer =
          agent.goals.length > 0
            ? `Right now my priorities are: ${agent.goals.join('; ')}.`
            : `My main focus is my work as ${agent.occupation}.`;
      } else if (spec.id === 'q_self_3') {
        answer = `Neighbors would describe me as ${agent.traits.join(', ')}.`;
      } else if (spec.id === 'q_self_4') {
        const homeName = world.locations.find((l) => l.id === agent.homeLocationId)?.name ?? 'home';
        answer = `I spend much of my grounded time around ${homeName} and currently I’m in ${agent.currentAreaLabel}.`;
      } else {
        answer = `I’m feeling ${agent.mood.label} (energy ${Math.round(agent.drives.energy)}/100, hunger ${Math.round(agent.drives.hunger)}/100) while ${agent.currentAction.toLowerCase()}.`;
      }
      break;
    }
    case 'memory': {
      const top = retrieved[0];
      if (spec.id === 'q_mem_1') {
        const partyMeme = world.memes.find((m) => m.id === 'meme_valentine_party');
        const heard = Boolean(partyMeme?.knownBy[agent.id]);
        const mem = retrieved.find((m) => /valentine/i.test(m.description));
        answer = heard || mem
          ? `Yes! ${mem?.description ?? partyMeme?.knownBy[agent.id]?.snippet ?? 'I heard about Isabella’s Valentine’s party at Hobbs Cafe (5–7 PM).'}`
          : `No, I haven’t heard anything about a Valentine’s party at Hobbs Cafe yet.`;
      } else if (spec.id === 'q_mem_2') {
        const mayorMeme = world.memes.find((m) => m.id === 'meme_mayor_race');
        const heard = Boolean(mayorMeme?.knownBy[agent.id]);
        const mem = retrieved.find((m) => /mayor|election|sam/i.test(m.description));
        answer = heard || mem
          ? `Yes, people have mentioned it: ${mem?.description ?? mayorMeme?.knownBy[agent.id]?.snippet ?? 'Sam Moore considering a run for mayor.'}`
          : `No, I haven’t heard talk about anyone running for mayor yet.`;
      } else {
        answer = top
          ? `What stands out in memory is: "${top.description}"`
          : `Nothing unusual has come up yet beyond my usual routine.`;
      }
      break;
    }
    case 'plans': {
      const upcoming = agent.dailySchedule
        .filter((b) => b.day === timeInfo.day && b.startMinute + b.durationMinutes >= timeInfo.minuteOfDay)
        .slice(0, 3);
      if (spec.id === 'q_plan_2') {
        const partyBlock = agent.dailySchedule.find(
          (b) => b.day === 2 && b.locationId === 'hobbs_cafe' && b.startMinute <= 1140 && b.startMinute + b.durationMinutes >= 1020,
        );
        answer = partyBlock
          ? `Yes, I have "${partyBlock.activity}" planned at Hobbs Cafe on Day 2.`
          : `Right now Hobbs Cafe isn’t on my Day 2 5–7 PM schedule—my evening focus is ${upcoming[0]?.activity ?? agent.currently}.`;
      } else if (spec.id === 'q_plan_3') {
        const fixed = agent.dailySchedule.filter((b) => b.fixed || b.source === 'social_commitment');
        answer =
          fixed.length > 0
            ? `Yes, I’ve committed to: ${fixed.map((b) => `Day ${b.day} ${b.activity}`).join('; ')}.`
            : `No locked appointments on my calendar beyond my regular rhythm yet.`;
      } else {
        answer =
          upcoming.length > 0
            ? `Next up today I have: ${upcoming.map((b) => b.activity).join(', ')}.`
            : `I’m winding down for the night around ${agent.currentAreaLabel}.`;
      }
      break;
    }
    case 'reactions': {
      const refl = agent.memories.find((m) => m.source === 'reaction');
      if (spec.id === 'q_react_1') {
        answer =
          agent.drives.energy > 30
            ? `If my schedule isn’t locked by an urgent task, I’d gladly adjust my block to join them at Hobbs Cafe.`
            : `Because my energy is at ${Math.round(agent.drives.energy)}/100, I might rest briefly before meeting them.`;
      } else {
        answer = refl
          ? `I weigh how urgent it is—recently "${refl.description}" made me adapt my plans right away.`
          : `Usually I pause to assess urgency: if a friend or event matters, I shift my afternoon block cleanly; otherwise I stay on track.`;
      }
      break;
    }
    case 'reflections': {
      const refl = agent.memories.filter((m) => m.type === 'reflection' || m.type === 'consolidated');
      if (world.ablations?.noReflection || refl.length === 0) {
        answer = retrieved[0]
          ? `Mostly I’ve noticed immediate events like "${retrieved[0].description}", though I haven’t formed broader reflections yet.`
          : `I haven’t had a chance to step back and reflect on broader patterns yet.`;
      } else {
        answer = `${refl[0].description}${refl[1] ? ` Also: ${refl[1].description}` : ''}`;
      }
      break;
    }
  }

  return {
    questionId: spec.id,
    group: spec.group,
    question: spec.question,
    answer,
    citedMemoryIds,
  };
}
