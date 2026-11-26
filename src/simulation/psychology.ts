import type { AgentDrives, LocationCategory, MoodState, SocialEdge, WeatherCondition } from './types';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function computeMoodLabel(
  valence: number,
  arousal: number,
  drives: AgentDrives,
): string {
  if (drives.energy < 18) return 'Exhausted';
  if (drives.hunger < 20) return 'Hungry';
  if (drives.social < 20 && valence < 0.1) return 'Lonely';

  if (valence >= 0.35) {
    return arousal >= 0.58 ? 'Energized' : 'Warm';
  }
  if (valence >= 0.05) {
    return arousal >= 0.58 ? 'Engaged' : 'Content';
  }
  if (valence <= -0.3) {
    return arousal >= 0.55 ? 'Frustrated' : 'Dejected';
  }
  return arousal >= 0.55 ? 'Restless' : 'Pensive';
}

/**
 * Updates biological & psychological homeostatic drives over deltaSimMinutes.
 * Grounded in circadian alertness, meal locations, social interaction, and craft engagement.
 */
export function stepAgentDrives(
  drives: AgentDrives,
  params: {
    minuteOfDay: number;
    locationCategory?: LocationCategory;
    weather?: WeatherCondition;
    isMoving: boolean;
    isAtDestination: boolean;
    isResting: boolean;
    isEatingMeal?: boolean;
    isAtHome?: boolean;
  },
  deltaSimMinutes: number,
): AgentDrives {
  const {
    minuteOfDay,
    locationCategory,
    weather,
    isMoving,
    isAtDestination,
    isResting,
    isEatingMeal = false,
    isAtHome = false,
  } = params;
  const dt = Math.max(0, deltaSimMinutes);

  // Circadian alertness curve: afternoon dip (~14:30), late-night sleepiness (>22:00)
  const isNight = minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60;
  const drizzleOutdoors = weather === 'drizzle' && (!locationCategory || locationCategory === 'park');
  const energyDrainRate = isResting
    ? -0.38 // Restores ~22 energy per simulated hour of rest/sleep
    : isNight
      ? 0.095
      : isMoving
        ? 0.065 + (drizzleOutdoors ? 0.015 : 0)
        : 0.04 + (drizzleOutdoors ? 0.012 : 0);

  // Meals restore hunger during explicit meal blocks; overnight sleep burns calories at a lower basal rate
  const isFoodVenue =
    isAtHome ||
    locationCategory === 'cafe' ||
    locationCategory === 'pub' ||
    locationCategory === 'home';
  const hungerDrainRate = isResting ? 0.018 : isMoving ? 0.052 : 0.042;
  let hungerDelta = -hungerDrainRate * dt;
  let energyBonus = 0;
  if (isAtDestination && isEatingMeal && isFoodVenue) {
    hungerDelta = isAtHome || locationCategory === 'home' ? 0.55 * dt : 0.62 * dt;
    if (locationCategory === 'cafe') energyBonus = 0.06 * dt;
  }

  // Social need decays slowly while alone, boosted in social venues (cafe/pub/park on nice weather)
  const socialDelta =
    isAtDestination &&
    (locationCategory === 'cafe' ||
      locationCategory === 'pub' ||
      (locationCategory === 'park' && weather !== 'drizzle'))
      ? 0.08 * dt
      : -0.045 * dt;

  // Purpose / autonomy grows when actively working at college, civic, shop, studio, cafe, pub
  const isCraftVenue =
    isAtDestination &&
    (locationCategory === 'college' ||
      locationCategory === 'civic' ||
      locationCategory === 'shop' ||
      locationCategory === 'cafe' ||
      locationCategory === 'pub' ||
      (locationCategory === 'park' && weather !== 'drizzle'));
  const purposeDelta = isCraftVenue ? 0.06 * dt : -0.025 * dt;

  return {
    energy: clamp(drives.energy - energyDrainRate * dt + energyBonus, 0, 100),
    hunger: clamp(drives.hunger + hungerDelta, 0, 100),
    social: clamp(drives.social + socialDelta, 0, 100),
    purpose: clamp(drives.purpose + purposeDelta, 0, 100),
  };
}

/**
 * Exponentially relaxes PAD mood toward baseline temperament, biased by unmet drives.
 */
export function stepMoodState(
  mood: MoodState,
  baseline: { valence: number; arousal: number },
  drives: AgentDrives,
  deltaSimMinutes: number,
): MoodState {
  const relaxRate = Math.min(1, deltaSimMinutes * 0.008);
  let targetValence = baseline.valence;
  let targetArousal = baseline.arousal;

  if (drives.hunger < 25) targetValence -= 0.25;
  if (drives.energy < 25) {
    targetValence -= 0.2;
    targetArousal -= 0.22;
  }
  if (drives.social < 25) targetValence -= 0.18;
  if (drives.purpose > 75) targetValence += 0.12;

  const nextValence = clamp(
    mood.valence + (targetValence - mood.valence) * relaxRate,
    -1,
    1,
  );
  const nextArousal = clamp(
    mood.arousal + (targetArousal - mood.arousal) * relaxRate,
    0,
    1,
  );

  return {
    valence: nextValence,
    arousal: nextArousal,
    label: computeMoodLabel(nextValence, nextArousal, drives),
  };
}

export function applyEmotionalAppraisal(
  mood: MoodState,
  drives: AgentDrives,
  deltaValence: number,
  deltaArousal: number,
): MoodState {
  const valence = clamp(mood.valence + deltaValence, -1, 1);
  const arousal = clamp(mood.arousal + deltaArousal, 0, 1);
  return {
    valence,
    arousal,
    label: computeMoodLabel(valence, arousal, drives),
  };
}

export function detectUrgentDrive(
  drives: AgentDrives,
): { drive: keyof AgentDrives; level: number; urgeText: string } | null {
  const checks: Array<{ drive: keyof AgentDrives; level: number; urgeText: string }> = [
    {
      drive: 'energy',
      level: drives.energy,
      urgeText: 'feeling quite tired and needing rest or a strong espresso',
    },
    {
      drive: 'hunger',
      level: drives.hunger,
      urgeText: 'getting hungry and wanting a proper meal or pastry',
    },
    {
      drive: 'social',
      level: drives.social,
      urgeText: 'craving friendly conversation with neighbors',
    },
    {
      drive: 'purpose',
      level: drives.purpose,
      urgeText: 'wanting to focus on meaningful creative or community work',
    },
  ];
  checks.sort((a, b) => a.level - b.level);
  const lowest = checks[0];
  return lowest.level < 28 ? lowest : null;
}

export function updateSocialEdge(
  existing: SocialEdge | undefined,
  params: {
    targetId: string;
    roleLabel?: string;
    deltaTrust: number;
    deltaAffection: number;
    deltaFamiliarity: number;
    inferredGoal?: string;
    simMinutes: number;
  },
): SocialEdge {
  const base: SocialEdge = existing ?? {
    targetId: params.targetId,
    roleLabel: params.roleLabel ?? 'Smallville neighbor',
    trust: 10,
    affection: 10,
    familiarity: 15,
    inferredGoal: 'Going about their day in Smallville',
    lastUpdatedSimMin: params.simMinutes,
  };

  return {
    ...base,
    roleLabel: params.roleLabel ?? base.roleLabel,
    trust: clamp(Math.round(base.trust + params.deltaTrust), -100, 100),
    affection: clamp(Math.round(base.affection + params.deltaAffection), -100, 100),
    familiarity: clamp(Math.round(base.familiarity + params.deltaFamiliarity), 0, 100),
    inferredGoal: params.inferredGoal?.trim() ? params.inferredGoal.trim() : base.inferredGoal,
    lastUpdatedSimMin: params.simMinutes,
  };
}

export interface EncounterSalienceResult {
  score: number;
  shouldUseSystem2: boolean;
  reason: string;
}

/**
 * Dual-Process Encounter Gating (Kahneman System 1 vs System 2):
 * Evaluates whether two nearby residents have high social novelty, unmet social drive,
 * asymmetric meme/rumor to share, or low schedule rush—reserving expensive LLM turns
 * for genuinely meaningful interactions while allowing fast System-1 nods/greetings.
 */
export function evaluateEncounterSalience(params: {
  agentA: {
    id: string;
    name?: string;
    currently?: string;
    goals?: string[];
    drives: AgentDrives;
    mood: MoodState;
    path: Array<{ x: number; y: number }>;
    lastConversedAt: Record<string, number>;
    socialGraph: Record<string, SocialEdge>;
  };
  agentB: {
    id: string;
    name?: string;
    currently?: string;
    goals?: string[];
    drives: AgentDrives;
    mood: MoodState;
    path: Array<{ x: number; y: number }>;
    lastConversedAt: Record<string, number>;
    socialGraph: Record<string, SocialEdge>;
  };
  memes: Array<{
    topic: string;
    knownBy: Record<string, unknown>;
  }>;
  simMinutes: number;
  disableDualProcessGate?: boolean;
}): EncounterSalienceResult {
  const { agentA, agentB, memes, simMinutes, disableDualProcessGate = false } = params;

  const lastTalk = Math.max(
    agentA.lastConversedAt[agentB.id] ?? -999,
    agentB.lastConversedAt[agentA.id] ?? -999,
  );
  const minsSinceTalk = simMinutes - lastTalk;
  if (minsSinceTalk < 45) {
    return { score: 0, shouldUseSystem2: false, reason: 'cooldown' };
  }

  if (disableDualProcessGate) {
    return {
      score: 1,
      shouldUseSystem2: true,
      reason: 'System-2 gate ablated (all eligible encounters escalate)',
    };
  }

  // Tired/rushing residents crossing paths quickly in the street give a System-1 greeting
  const bothWalking = agentA.path.length > 3 && agentB.path.length > 3;
  const eitherExhausted = agentA.drives.energy < 22 || agentB.drives.energy < 22;

  let score = 0;
  const reasons: string[] = [];

  // Information asymmetry: one resident knows a town meme the other hasn't heard
  const asymmetricMemeAtoB = memes.find(
    (m) => Boolean(m.knownBy[agentA.id]) && !m.knownBy[agentB.id],
  );
  const asymmetricMemeBtoA = memes.find(
    (m) => Boolean(m.knownBy[agentB.id]) && !m.knownBy[agentA.id],
  );
  const sharedNews = asymmetricMemeAtoB ?? asymmetricMemeBtoA;
  if (sharedNews) {
    score += 0.35;
    reasons.push(`wants to share news about ${sharedNews.topic}`);
  }

  const partnerBFirst = agentB.name?.split(' ')[0]?.toLowerCase() ?? '';
  const partnerAFirst = agentA.name?.split(' ')[0]?.toLowerCase() ?? '';
  const aGoalsText = [agentA.currently ?? '', ...(agentA.goals ?? [])].join(' ').toLowerCase();
  const bGoalsText = [agentB.currently ?? '', ...(agentB.goals ?? [])].join(' ').toLowerCase();
  const aMentionsB =
    partnerBFirst.length >= 3 &&
    (aGoalsText.includes(partnerBFirst) || aGoalsText.includes('invite neighbors'));
  const bMentionsA =
    partnerAFirst.length >= 3 &&
    (bGoalsText.includes(partnerAFirst) || bGoalsText.includes('invite neighbors'));
  if (aMentionsB || bMentionsA) {
    score += 0.25;
    reasons.push('shared goal or intention involving partner');
  }

  if (lastTalk < 0) {
    score += 0.35;
    reasons.push('first encounter');
  } else if (minsSinceTalk >= 150) {
    score += 0.35;
    reasons.push('overdue catch-up');
  }

  // Social need / leisure context
  if (agentA.drives.social < 62 || agentB.drives.social < 62) {
    score += 0.22;
    reasons.push('social need');
  }
  if (!bothWalking) {
    score += 0.2;
    reasons.push('stationary venue');
  }
  const edge = agentA.socialGraph[agentB.id] ?? agentB.socialGraph[agentA.id];
  if (edge && (edge.affection >= 75 || edge.trust >= 80)) {
    score += 0.15;
    reasons.push('close rapport');
  }

  if (bothWalking) score -= 0.28;
  if (eitherExhausted) score -= 0.25;

  const clamped = Math.max(0, Math.min(1, score));
  return {
    score: clamped,
    shouldUseSystem2: clamped >= 0.55,
    reason: reasons.length > 0 ? reasons.join(' + ') : 'passing encounter',
  };
}

export function buildSystem1Greeting(
  speakerName: string,
  listenerName: string,
  minuteOfDay: number,
  drives: AgentDrives,
): string {
  const otherFirst = listenerName.split(' ')[0];
  if (drives.energy < 28) {
    return `Hey ${otherFirst} — heading home to catch my breath!`;
  }
  if (drives.hunger < 30) {
    return `Hi ${otherFirst}, grabbing a quick bite at the cafe!`;
  }
  if (minuteOfDay < 12 * 60) {
    return `Good morning, ${otherFirst}! Catch you later on Main Street.`;
  }
  if (minuteOfDay < 17 * 60) {
    return `Afternoon, ${otherFirst} — hope your day is going well!`;
  }
  return `Evening, ${otherFirst}! See you around Smallville.`;
}

