import type {
  AtomicWorldOp,
  BdiDecisionResult,
  BeliefPredicate,
  CoalitionAgenda,
  CulturalNormKey,
  DisputeCategory,
  ExtractedBeliefUpdate,
  ItemKind,
  NegotiatedDeal,
  NoticeCategory,
  ScheduleBlock,
  ScheduleBlockKind,
  ServiceContractKind,
  TownModifierKey,
  WorldActionKind,
} from './types';

export const COMMITMENT_MIN_MINUTE = 360; // 06:00
export const COMMITMENT_MAX_MINUTE = 1350; // 22:30

const VALID_SCHEDULE_KINDS: ReadonlySet<ScheduleBlockKind> = new Set([
  'sleep',
  'meal',
  'work',
  'social',
  'errand',
  'leisure',
  'rest',
  'travel',
]);

function normalizeScheduleKind(val: unknown, fallback: ScheduleBlockKind = 'work'): ScheduleBlockKind {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase() as ScheduleBlockKind;
    if (VALID_SCHEDULE_KINDS.has(lower)) return lower;
  }
  return fallback;
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(val, min, max, fallback));
}

function cleanString(val: unknown, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function cleanStringArray(val: unknown, maxItems = 12): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Extracts and parses a JSON object from LLM output, resilient to <think> blocks,
 * markdown fences, or brief wrapper prose around the JSON payload.
 */
export function safeParseJson<T>(rawText: string | undefined): T {
  const stripped = (rawText ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!stripped) {
    throw new Error('LLM returned an empty JSON response.');
  }

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const startIdx = stripped.indexOf('{');
    if (startIdx >= 0) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = startIdx; i < stripped.length; i++) {
        const ch = stripped[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              const candidate = stripped.slice(startIdx, i + 1);
              return JSON.parse(candidate) as T;
            }
          }
        }
      }
      const lastBrace = stripped.lastIndexOf('}');
      if (lastBrace > startIdx) {
        return JSON.parse(stripped.slice(startIdx, lastBrace + 1)) as T;
      }
    }
    throw new Error('Could not parse valid JSON object from LLM response.');
  }
}

export function normalizeEmotionalShift(
  raw: unknown,
): { deltaValence: number; deltaArousal: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    deltaValence: clampNumber(obj.deltaValence, -0.3, 0.3, 0),
    deltaArousal: clampNumber(obj.deltaArousal, -0.3, 0.3, 0),
  };
}

export function normalizeTomUpdate(
  raw: unknown,
): { deltaTrust: number; deltaAffection: number; inferredGoal: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const inferredGoal = cleanString(obj.inferredGoal);
  if (!inferredGoal) return undefined;
  return {
    deltaTrust: clampInt(obj.deltaTrust, -15, 15, 0),
    deltaAffection: clampInt(obj.deltaAffection, -15, 15, 0),
    inferredGoal,
  };
}

function normalizeCommitmentDay(val: unknown): number | 'today' | 'tomorrow' | undefined {
  if (val === 'today' || val === 'tomorrow') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === 'today' || trimmed === 'tomorrow') return trimmed;
  }
  const num = typeof val === 'number' ? val : Number(val);
  if (Number.isInteger(num) && num >= 1) return num;
  return undefined;
}

export function normalizeCommitment(raw: unknown):
  | {
      day?: number | 'today' | 'tomorrow';
      minuteOfDay: number;
      durationMinutes: number;
      locationId: string;
      objectId?: string;
      activity: string;
      emoji?: string;
    }
  | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const locationId = cleanString(obj.locationId);
  const activity = cleanString(obj.activity);
  const minuteNum = typeof obj.minuteOfDay === 'number' ? obj.minuteOfDay : Number(obj.minuteOfDay);
  if (!locationId || !activity || !Number.isFinite(minuteNum)) {
    return undefined;
  }
  const objectId = cleanString(obj.objectId);
  const emoji = cleanString(obj.emoji);
  const day = normalizeCommitmentDay(obj.day);
  return {
    ...(day !== undefined ? { day } : {}),
    minuteOfDay: clampInt(minuteNum, COMMITMENT_MIN_MINUTE, COMMITMENT_MAX_MINUTE, 1020),
    durationMinutes: clampInt(obj.durationMinutes, 30, 240, 60),
    locationId,
    objectId: objectId || undefined,
    activity,
    emoji: emoji || '📅',
  };
}

export function normalizeConverseTurnPayload(
  raw: unknown,
  fallbackSpokenLine: string,
): {
  spokenLine: string;
  privateThought: string;
  endConversation: boolean;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    spokenLine: cleanString(obj.spokenLine, fallbackSpokenLine),
    privateThought: cleanString(obj.privateThought, ''),
    endConversation: obj.endConversation === true,
  };
}

const VALID_BELIEF_PREDICATES: ReadonlySet<BeliefPredicate> = new Set([
  'trustworthiness',
  'solvency',
  'job_status',
  'policy_stance',
  'obligation',
  'reputation',
  'world_fact',
]);

const VALID_DEAL_KINDS: ReadonlySet<NegotiatedDeal['kind']> = new Set([
  'loan',
  'transfer',
  'petition_support',
  'service_contract',
  'coalition_invite',
  'refusal',
]);

const VALID_TOWN_MODIFIER_KEYS: ReadonlySet<TownModifierKey> = new Set([
  'streetLighting',
  'marketStipend',
  'extendedLibrary',
  'communityClinic',
]);

export function normalizeBeliefUpdates(raw: unknown): ExtractedBeliefUpdate[] {
  if (!Array.isArray(raw)) return [];
  const results: ExtractedBeliefUpdate[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const subjectId = cleanString(obj.subjectId);
    const rawPred = cleanString(obj.predicate).toLowerCase() as BeliefPredicate;
    const claim = cleanString(obj.claim);
    if (!subjectId || !claim || !VALID_BELIEF_PREDICATES.has(rawPred)) continue;
    results.push({
      subjectId: subjectId.slice(0, 80),
      predicate: rawPred,
      claim: claim.slice(0, 220),
      confidence:
        obj.confidence !== undefined
          ? clampNumber(obj.confidence, 0.2, 0.98, 0.72)
          : undefined,
    });
  }
  return results;
}

export function normalizeNegotiatedDeal(
  raw: unknown,
  validAgentIds?: ReadonlySet<string>,
): NegotiatedDeal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawKind = cleanString(obj.kind).toLowerCase() as NegotiatedDeal['kind'];
  if (!VALID_DEAL_KINDS.has(rawKind)) return undefined;
  const proposerId = cleanString(obj.proposerId);
  const responderId = cleanString(obj.responderId);
  const note = cleanString(obj.note);
  if (!proposerId || !responderId || proposerId === responderId || !note) return undefined;
  if (validAgentIds && (!validAgentIds.has(proposerId) || !validAgentIds.has(responderId))) {
    return undefined;
  }
  const accepted = rawKind === 'refusal' ? false : obj.accepted === true;
  const amount =
    obj.amount !== undefined && Number.isFinite(Number(obj.amount))
      ? clampInt(obj.amount, 5, 250, 30)
      : undefined;
  const petitionId = cleanString(obj.petitionId) || undefined;
  const rawContractKind = cleanString(obj.contractKind).toLowerCase() as ServiceContractKind;
  const contractKind = VALID_CONTRACT_KINDS.has(rawContractKind) ? rawContractKind : undefined;
  const coalitionId = cleanString(obj.coalitionId) || undefined;
  return {
    kind: rawKind,
    proposerId,
    responderId,
    accepted,
    ...(amount !== undefined ? { amount } : {}),
    ...(petitionId ? { petitionId } : {}),
    ...(contractKind ? { contractKind } : {}),
    ...(coalitionId ? { coalitionId } : {}),
    note: note.slice(0, 220),
  };
}

export function normalizeConverseWrapupPayload(
  raw: unknown,
  fallbackSummary: string,
  validMemeIds?: ReadonlySet<string>,
  validAgentIds?: ReadonlySet<string>,
): {
  summary: string;
  importance: number;
  planUpdate?: string;
  emotionalShift?: { deltaValence: number; deltaArousal: number };
  tomUpdate?: { deltaTrust: number; deltaAffection: number; inferredGoal: string };
  beliefUpdates: ExtractedBeliefUpdate[];
  bilateralDeal?: NegotiatedDeal;
  memeIdsDiscussed: string[];
  newNews: Array<{ topic: string; keywords: string[] }>;
  sharedAgreement?: {
    day?: number | 'today' | 'tomorrow';
    minuteOfDay: number;
    durationMinutes: number;
    locationId: string;
    objectId?: string;
    activity: string;
    emoji?: string;
  };
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const planUpdate = cleanString(obj.planUpdate);
  const rawMemes = cleanStringArray(obj.memeIdsDiscussed, 12);
  const memeIdsDiscussed = validMemeIds
    ? rawMemes.filter((id) => validMemeIds.has(id))
    : rawMemes;

  const rawNews = Array.isArray(obj.newNews) ? obj.newNews : [];
  const newNews = rawNews
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const n = item as Record<string, unknown>;
      const topic = cleanString(n.topic);
      if (!topic) return null;
      const keywords = cleanStringArray(n.keywords, 8).map((k) => k.toLowerCase());
      return { topic, keywords };
    })
    .filter((x): x is { topic: string; keywords: string[] } => x !== null)
    .slice(0, 3);

  return {
    summary: cleanString(obj.summary, fallbackSummary),
    importance: clampInt(obj.importance, 1, 10, 5),
    ...(planUpdate ? { planUpdate } : {}),
    emotionalShift: normalizeEmotionalShift(obj.emotionalShift),
    tomUpdate: normalizeTomUpdate(obj.tomUpdate),
    beliefUpdates: normalizeBeliefUpdates(obj.beliefUpdates),
    bilateralDeal: normalizeNegotiatedDeal(obj.bilateralDeal, validAgentIds),
    memeIdsDiscussed,
    newNews,
    sharedAgreement: normalizeCommitment(obj.sharedAgreement),
  };
}

export function normalizeReflectionQuestionsPayload(
  raw: unknown,
  agentName = 'Resident',
): { focalQuestions: string[] } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cleaned = cleanStringArray(obj.focalQuestions, 3);
  if (cleaned.length > 0) {
    return { focalQuestions: cleaned };
  }
  return {
    focalQuestions: [
      `What patterns have shaped ${agentName}'s day and priorities?`,
      `Which conversations or neighborhood relationships need follow-up?`,
      `How are ${agentName}'s energy, goals, and upcoming plans aligned?`,
    ],
  };
}

export function filterValidReflectionEvidence<
  T extends { insight: string; importance: number; evidenceIds: string[] },
>(reflections: T[], validEvidenceIds: ReadonlySet<string>): T[] {
  return reflections
    .map((r) => ({
      ...r,
      evidenceIds: Array.from(new Set(r.evidenceIds.filter((id) => validEvidenceIds.has(id)))),
    }))
    .filter((r) => r.evidenceIds.length > 0)
    .slice(0, 5);
}

export function normalizeReflectionPayload(
  raw: unknown,
  validEvidenceIds?: ReadonlySet<string>,
): {
  focalQuestions: string[];
  reflections: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const focalQuestions = cleanStringArray(obj.focalQuestions, 5);
  const rawReflections = Array.isArray(obj.reflections) ? obj.reflections : [];
  const baseReflections = rawReflections
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const insight = cleanString(r.insight);
      if (!insight) return null;
      return {
        insight,
        importance: clampInt(r.importance, 1, 10, 8),
        evidenceIds: cleanStringArray(r.evidenceIds, 8),
      };
    })
    .filter((x): x is { insight: string; importance: number; evidenceIds: string[] } => x !== null)
    .slice(0, 5);

  const reflections = validEvidenceIds
    ? filterValidReflectionEvidence(baseReflections, validEvidenceIds)
    : baseReflections;

  return { focalQuestions, reflections };
}

export function normalizePlanPayload(
  raw: unknown,
  fallbackLocationId: string,
  defaultStartMinute: number,
): {
  updatedSummary: string;
  blocks: Array<{
    startMinute: number;
    durationMinutes: number;
    locationId: string;
    objectId?: string;
    activity: string;
    kind: ScheduleBlockKind;
    subSteps?: string[];
    emoji: string;
  }>;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const updatedSummary = cleanString(obj.updatedSummary, 'Continuing daily routine in Smallville.');
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];

  let rollingMinute = defaultStartMinute;
  const blocks = rawBlocks
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const b = item as Record<string, unknown>;
      const activity = cleanString(b.activity);
      if (!activity) return null;
      const startMinute = clampInt(b.startMinute, 0, 1430, rollingMinute);
      const durationMinutes = clampInt(b.durationMinutes, 30, 240, 60);
      rollingMinute = Math.min(1380, startMinute + durationMinutes);
      const locationId = cleanString(b.locationId, fallbackLocationId);
      const objectId = cleanString(b.objectId);
      const subSteps = cleanStringArray(b.subSteps, 4);
      const kind = normalizeScheduleKind(b.kind, 'work');
      return {
        startMinute,
        durationMinutes,
        locationId,
        objectId: objectId || undefined,
        activity,
        kind,
        subSteps: subSteps.length > 0 ? subSteps : undefined,
        emoji: cleanString(b.emoji, '📅'),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 8);

  return { updatedSummary, blocks };
}

export function normalizeInterviewPayload(
  raw: unknown,
  agentName: string,
): {
  answer: string;
  citedMemoryIds: string[];
  observationSummary: string;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    answer: cleanString(obj.answer, `I'm taking the day one step at a time here in Smallville.`),
    citedMemoryIds: cleanStringArray(obj.citedMemoryIds, 8),
    observationSummary: cleanString(
      obj.observationSummary,
      `${agentName} answered questions from the Smallville Gazette reporter.`,
    ),
  };
}

export function normalizeWhisperPayload(
  raw: unknown,
  agentName: string,
  fallbackAction: string,
): {
  reactionBubble: string;
  memoryObservation: string;
  importance: number;
  newAction: string;
  targetLocationId: string;
  emoji: string;
  emotionalShift?: { deltaValence: number; deltaArousal: number };
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    reactionBubble: cleanString(obj.reactionBubble, 'Wait—let me think about that.'),
    memoryObservation: cleanString(
      obj.memoryObservation,
      `${agentName} paused to reflect on a sudden inner thought.`,
    ),
    importance: clampInt(obj.importance, 1, 10, 7),
    newAction: cleanString(obj.newAction, fallbackAction),
    targetLocationId: cleanString(obj.targetLocationId),
    emoji: cleanString(obj.emoji, '💭'),
    emotionalShift: normalizeEmotionalShift(obj.emotionalShift),
  };
}

export function normalizeConsolidationPayload(raw: unknown): {
  consolidatedInsights: Array<{ insight: string; importance: number; evidenceIds: string[] }>;
  prunedMemoryIds: string[];
  socialUpdates: Array<{ targetId: string; inferredGoal: string; deltaTrust?: number }>;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawInsights = Array.isArray(obj.consolidatedInsights) ? obj.consolidatedInsights : [];
  const consolidatedInsights = rawInsights
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const insight = cleanString(r.insight);
      if (!insight) return null;
      return {
        insight,
        importance: clampInt(r.importance, 1, 10, 8),
        evidenceIds: cleanStringArray(r.evidenceIds, 8),
      };
    })
    .filter((x): x is { insight: string; importance: number; evidenceIds: string[] } => x !== null)
    .slice(0, 4);

  const prunedMemoryIds = cleanStringArray(obj.prunedMemoryIds, 6);

  const rawSocial = Array.isArray(obj.socialUpdates) ? obj.socialUpdates : [];
  const socialUpdates = rawSocial
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const s = item as Record<string, unknown>;
      const targetId = cleanString(s.targetId);
      const inferredGoal = cleanString(s.inferredGoal);
      if (!targetId || !inferredGoal) return null;
      return {
        targetId,
        inferredGoal,
        deltaTrust:
          s.deltaTrust !== undefined ? clampInt(s.deltaTrust, -10, 10, 0) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 4);

  return { consolidatedInsights, prunedMemoryIds, socialUpdates };
}

export interface NormalizedReaction {
  react: boolean;
  reason: string;
  newActivity?: string;
  kind?: ScheduleBlockKind;
  locationId?: string;
  objectId?: string;
  durationMinutes?: number;
  emoji?: string;
  talkTo?: string;
}

export function normalizeReactionPayload(raw: unknown): NormalizedReaction {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const react = obj.react === true;
  const reason = cleanString(obj.reason, react ? 'Responded to notable observation.' : 'Continuing current plan.');
  const newActivity = cleanString(obj.newActivity);
  const locationId = cleanString(obj.locationId);
  const objectId = cleanString(obj.objectId);
  const talkTo = cleanString(obj.talkTo);
  const emoji = cleanString(obj.emoji);
  return {
    react,
    reason,
    ...(newActivity ? { newActivity } : {}),
    ...(obj.kind !== undefined ? { kind: normalizeScheduleKind(obj.kind, 'social') } : {}),
    ...(locationId ? { locationId } : {}),
    ...(objectId ? { objectId } : {}),
    ...(obj.durationMinutes !== undefined
      ? { durationMinutes: clampInt(obj.durationMinutes, 30, 180, 60) }
      : {}),
    ...(emoji ? { emoji } : {}),
    ...(talkTo ? { talkTo } : {}),
  };
}

export function generateRuleSubSteps(block: {
  activity: string;
  kind: ScheduleBlockKind;
  durationMinutes: number;
}): string[] {
  const stepCount = block.durationMinutes >= 120 ? 4 : 3;
  const shortAct = block.activity.length > 48 ? `${block.activity.slice(0, 45)}...` : block.activity;
  switch (block.kind) {
    case 'meal':
      return [
        `Settling in and ordering or preparing meal`,
        `Enjoying ${shortAct.toLowerCase()}`,
        `Clearing plates and winding down`,
      ].slice(0, stepCount);
    case 'sleep':
    case 'rest':
      return [
        `Settling quietly at home`,
        `Resting steadily to recover energy`,
        `Checking time before the next block`,
      ].slice(0, stepCount);
    case 'social':
      return [
        `Arriving and greeting neighbors warmly`,
        `Engaging in ${shortAct.toLowerCase()}`,
        `Wrapping up conversation and sharing goodbyes`,
      ].slice(0, stepCount);
    case 'errand':
      return [
        `Gathering list and heading to counter`,
        `Completing ${shortAct.toLowerCase()}`,
        `Packing items and preparing to depart`,
      ].slice(0, stepCount);
    case 'leisure':
      return [
        `Stepping into the space unhurriedly`,
        `Spending quiet time on ${shortAct.toLowerCase()}`,
        `Wrapping up refreshed`,
      ].slice(0, stepCount);
    default:
      return [
        `Setting up tools and materials`,
        `Focused stretch on ${shortAct.toLowerCase()}`,
        `Checking progress mid-block`,
        `Tidying workspace before wrapping up`,
      ].slice(0, stepCount);
  }
}

export function normalizeStepDetailPayload(
  raw: unknown,
  fallbackBlock: { activity: string; kind: ScheduleBlockKind; durationMinutes: number },
): { subSteps: string[] } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const subSteps = cleanStringArray(obj.subSteps, 5);
  if (subSteps.length >= 3) {
    return { subSteps };
  }
  return { subSteps: generateRuleSubSteps(fallbackBlock) };
}

export function normalizeInterviewJudgePayload(raw: unknown): {
  score: number;
  rationale: string;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    score: clampInt(obj.score, 1, 5, 3),
    rationale: cleanString(obj.rationale, 'Evaluated against resident memories, plans, and persona.'),
  };
}

/**
 * Validates and repairs generated schedule blocks for a given day:
 * - Resolves invalid locations/objects to safe valid fallbacks
 * - Resolves overlaps and clamps blocks inside [0, 1440]
 * - Preserves every fixed block on `day` (re-inserting any dropped fixed block)
 * - For morning plans, enforces sleep + >= 2 meal blocks and 5..8 wake-to-sleep structure
 */
export function validateAndRepairPlanBlocks(params: {
  day: number;
  isMorningPlan: boolean;
  homeLocationId: string;
  homeBedObjectId?: string;
  defaultFoodLocationId?: string;
  validLocationIds: ReadonlySet<string>;
  objectLocationById: ReadonlyMap<string, string>;
  defaultObjectByLocation: ReadonlyMap<string, string>;
  fixedBlocksToday: ScheduleBlock[];
  candidateBlocks: ScheduleBlock[];
}): ScheduleBlock[] {
  const {
    day,
    isMorningPlan,
    homeLocationId,
    homeBedObjectId,
    defaultFoodLocationId = 'hobbs_cafe',
    validLocationIds,
    objectLocationById,
    defaultObjectByLocation,
    fixedBlocksToday,
    candidateBlocks,
  } = params;

  const sanitizeBlock = (b: ScheduleBlock): ScheduleBlock => {
    const locId = validLocationIds.has(b.locationId) ? b.locationId : homeLocationId;
    const objMatches = b.objectId && objectLocationById.get(b.objectId) === locId;
    const objId = objMatches
      ? b.objectId
      : b.kind === 'sleep' && locId === homeLocationId && homeBedObjectId
        ? homeBedObjectId
        : defaultObjectByLocation.get(locId);
    const start = Math.max(0, Math.min(1425, Math.round(b.startMinute)));
    const maxDur = Math.max(15, 1440 - start);
    const duration = Math.max(15, Math.min(maxDur, Math.round(b.durationMinutes)));
    const subSteps =
      b.subSteps && b.subSteps.length > 0
        ? b.subSteps
        : generateRuleSubSteps({ activity: b.activity, kind: b.kind, durationMinutes: duration });
    return {
      ...b,
      day,
      locationId: locId,
      objectId: objId,
      startMinute: start,
      durationMinutes: duration,
      subSteps,
    };
  };

  // Start with all fixed commitments anchored on today
  const fixedSanitized = fixedBlocksToday
    .map((f) => sanitizeBlock({ ...f, fixed: true }))
    .sort((a, b) => a.startMinute - b.startMinute);

  const nonFixed = candidateBlocks
    .filter((b) => !b.fixed)
    .map(sanitizeBlock)
    .sort((a, b) => a.startMinute - b.startMinute);

  const combined: ScheduleBlock[] = [...fixedSanitized];

  const fitsWithoutOverlap = (candStart: number, candEnd: number) =>
    !combined.some((ex) => ex.startMinute < candEnd && ex.startMinute + ex.durationMinutes > candStart);

  const tryPlaceBlock = (blk: ScheduleBlock): boolean => {
    let start = Math.max(0, Math.min(1425, blk.startMinute));
    let end = Math.min(1440, start + blk.durationMinutes);
    if (end - start < 15) return false;

    if (fitsWithoutOverlap(start, end)) {
      combined.push({ ...blk, startMinute: start, durationMinutes: end - start });
      return true;
    }

    // Try trimming against next blocking interval or shifting into nearest open gap
    const blockers = combined
      .filter((ex) => ex.startMinute < end && ex.startMinute + ex.durationMinutes > start)
      .sort((a, b) => a.startMinute - b.startMinute);
    if (blockers.length > 0 && blockers[0].startMinute - start >= 30) {
      end = blockers[0].startMinute;
      combined.push({ ...blk, startMinute: start, durationMinutes: end - start });
      return true;
    }
    const lastEnd = blockers[blockers.length - 1]
      ? blockers[blockers.length - 1].startMinute + blockers[blockers.length - 1].durationMinutes
      : start;
    const shiftedStart = lastEnd;
    const shiftedEnd = Math.min(1440, shiftedStart + Math.min(blk.durationMinutes, 120));
    if (shiftedEnd - shiftedStart >= 30 && fitsWithoutOverlap(shiftedStart, shiftedEnd)) {
      combined.push({
        ...blk,
        startMinute: shiftedStart,
        durationMinutes: shiftedEnd - shiftedStart,
      });
      return true;
    }
    return false;
  };

  for (const cand of nonFixed) {
    tryPlaceBlock(cand);
  }

  if (isMorningPlan) {
    // Ensure sleep block exists at night (or early morning)
    const hasSleep = combined.some((b) => b.kind === 'sleep');
    if (!hasSleep) {
      const latestEnd = combined.reduce(
        (mx, b) => Math.max(mx, b.startMinute + b.durationMinutes),
        420,
      );
      const sleepStart = Math.max(1320, Math.min(1410, latestEnd));
      const sleepDur = Math.max(30, 1440 - sleepStart);
      if (fitsWithoutOverlap(sleepStart, sleepStart + sleepDur)) {
        combined.push(
          sanitizeBlock({
            id: `repair_sleep_${day}`,
            day,
            kind: 'sleep',
            startMinute: sleepStart,
            durationMinutes: sleepDur,
            locationId: homeLocationId,
            objectId: homeBedObjectId,
            activity: 'Sleeping peacefully at home',
            emoji: '🛏️',
            source: 'morning_plan',
          }),
        );
      } else {
        // Guarantee a wake/early sleep anchor if late evening already filled
        const earlySleepStart = 0;
        const firstStart = combined.reduce((mn, b) => Math.min(mn, b.startMinute), 420);
        if (firstStart >= 60 && fitsWithoutOverlap(0, Math.min(390, firstStart))) {
          combined.push(
            sanitizeBlock({
              id: `repair_sleep_${day}`,
              day,
              kind: 'sleep',
              startMinute: earlySleepStart,
              durationMinutes: Math.min(390, firstStart),
              locationId: homeLocationId,
              objectId: homeBedObjectId,
              activity: 'Sleeping peacefully at home',
              emoji: '🛏️',
              source: 'morning_plan',
            }),
          );
        }
      }
    }

    // Ensure at least 2 meal blocks (breakfast + dinner/lunch)
    const mealCount = () => combined.filter((b) => b.kind === 'meal').length;
    if (mealCount() < 2) {
      const fallbackMeals: Array<{ start: number; dur: number; loc: string; act: string; emoji: string }> = [
        { start: 420, dur: 45, loc: homeLocationId, act: 'Morning breakfast and warm tea at home', emoji: '🍳' },
        { start: 1140, dur: 60, loc: validLocationIds.has(defaultFoodLocationId) ? defaultFoodLocationId : homeLocationId, act: 'Evening supper and warm tea', emoji: '🍲' },
        { start: 720, dur: 60, loc: validLocationIds.has(defaultFoodLocationId) ? defaultFoodLocationId : homeLocationId, act: 'Midday lunch break', emoji: '🥪' },
      ];
      for (const fm of fallbackMeals) {
        if (mealCount() >= 2) break;
        const mealBlock = sanitizeBlock({
          id: `repair_meal_${day}_${fm.start}`,
          day,
          kind: 'meal',
          startMinute: fm.start,
          durationMinutes: fm.dur,
          locationId: fm.loc,
          activity: fm.act,
          emoji: fm.emoji,
          source: 'morning_plan',
        });
        if (!tryPlaceBlock(mealBlock)) {
          // Find any non-fixed block during meal window and split 45 min for a meal
          const victimIdx = combined.findIndex(
            (b) => !b.fixed && b.kind !== 'sleep' && b.kind !== 'meal' && b.durationMinutes >= 90,
          );
          if (victimIdx >= 0) {
            const v = combined[victimIdx];
            const splitDur = 45;
            combined[victimIdx] = {
              ...v,
              durationMinutes: v.durationMinutes - splitDur,
            };
            combined.push({
              ...mealBlock,
              startMinute: v.startMinute + v.durationMinutes - splitDur,
              durationMinutes: splitDur,
            });
          }
        }
      }
    }
  }

  return combined.sort((a, b) => a.startMinute - b.startMinute);
}

const VALID_WORLD_ACTIONS: ReadonlySet<WorldActionKind> = new Set([
  'work_shift',
  'buy_item',
  'consume_item',
  'advance_project',
  'post_notice',
  'vote_proposal',
  'transfer_money',
  'propose_loan',
  'launch_venture',
  'sign_petition',
  'start_petition',
  'declare_candidacy',
  'vote_election',
  'socialize',
  'rest',
  'adjust_goal',
  'seek_person',
  'avoid_person',
  'send_letter',
  'propose_contract',
  'file_dispute',
  'form_coalition',
  'join_coalition',
  'call_boycott',
  'spread_rumor',
  'fact_check',
  'endorse_norm',
  'open_action',
]);

export function normalizeOpenActionOps(
  rawOps: unknown,
  validAgentIds?: ReadonlySet<string>,
  validLocationIds?: ReadonlySet<string>,
): AtomicWorldOp[] {
  if (!Array.isArray(rawOps)) return [];
  const ops: AtomicWorldOp[] = [];
  const hasAgent = (id: string) => Boolean(id) && (!validAgentIds || validAgentIds.has(id));
  const hasLoc = (id: string) => Boolean(id) && (!validLocationIds || validLocationIds.has(id));
  const positiveInt = (val: unknown, max: number): number => {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n) || Math.round(n) <= 0) return 0;
    return Math.min(max, Math.round(n));
  };

  for (const item of rawOps.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const kind = cleanString(o.op).toLowerCase();

    switch (kind) {
      case 'transfer_cash': {
        const fromId = cleanString(o.fromId);
        const toId = cleanString(o.toId);
        const amount = positiveInt(o.amount, 250);
        if (hasAgent(fromId) && hasAgent(toId) && fromId !== toId && amount > 0) {
          ops.push({
            op: 'transfer_cash',
            fromId,
            toId,
            amount,
            note: cleanString(o.note, 'Direct agreement payment').slice(0, 140),
          });
        }
        break;
      }
      case 'create_org': {
        const name = cleanString(o.name).slice(0, 80);
        const charter = cleanString(o.charter).slice(0, 220);
        const hq = cleanString(o.headquartersLocationId);
        if (name && charter) {
          ops.push({
            op: 'create_org',
            name,
            charter,
            ...(cleanString(o.roleTitle) ? { roleTitle: cleanString(o.roleTitle).slice(0, 40) } : {}),
            ...(o.initialContribution !== undefined
              ? { initialContribution: clampInt(o.initialContribution, 0, 150, 0) }
              : {}),
            ...(o.duesAmount !== undefined ? { duesAmount: clampInt(o.duesAmount, 0, 40, 0) } : {}),
            ...(hasLoc(hq) ? { headquartersLocationId: hq } : {}),
            ...(cleanString(o.rule) ? { rule: cleanString(o.rule).slice(0, 160) } : {}),
          });
        }
        break;
      }
      case 'join_org': {
        const orgId = cleanString(o.orgId);
        if (orgId) {
          ops.push({
            op: 'join_org',
            orgId,
            ...(cleanString(o.roleTitle) ? { roleTitle: cleanString(o.roleTitle).slice(0, 40) } : {}),
            ...(o.contribution !== undefined
              ? { contribution: clampInt(o.contribution, 0, 150, 0) }
              : {}),
          });
        }
        break;
      }
      case 'org_contribute': {
        const orgId = cleanString(o.orgId);
        const amount = positiveInt(o.amount, 150);
        if (orgId && amount > 0) {
          ops.push({
            op: 'org_contribute',
            orgId,
            amount,
            ...(cleanString(o.note) ? { note: cleanString(o.note).slice(0, 120) } : {}),
          });
        }
        break;
      }
      case 'org_payout': {
        const orgId = cleanString(o.orgId);
        const toAgentId = cleanString(o.toAgentId);
        const amount = positiveInt(o.amount, 250);
        if (orgId && hasAgent(toAgentId) && amount > 0) {
          ops.push({
            op: 'org_payout',
            orgId,
            toAgentId,
            amount,
            reason: cleanString(o.reason, 'Organization disbursement').slice(0, 140),
          });
        }
        break;
      }
      case 'propose_norm': {
        const statement = cleanString(o.statement).slice(0, 180);
        if (statement.length >= 8) {
          ops.push({ op: 'propose_norm', statement });
        }
        break;
      }
      case 'adopt_or_challenge_norm': {
        const normId = cleanString(o.normId);
        if (normId) {
          ops.push({
            op: 'adopt_or_challenge_norm',
            normId,
            adopt: o.adopt !== false,
          });
        }
        break;
      }
      case 'sanction_norm': {
        const normId = cleanString(o.normId);
        const targetAgentId = cleanString(o.targetAgentId);
        if (normId && hasAgent(targetAgentId)) {
          ops.push({
            op: 'sanction_norm',
            normId,
            targetAgentId,
            reason: cleanString(o.reason, 'Violated community norm').slice(0, 140),
          });
        }
        break;
      }
      case 'create_asset': {
        const name = cleanString(o.name).slice(0, 80);
        const unitValue = positiveInt(o.unitValue ?? 5, 100);
        if (name && unitValue > 0) {
          ops.push({
            op: 'create_asset',
            name,
            description: cleanString(o.description, name).slice(0, 180),
            unitValue,
            ...(o.quantity !== undefined ? { quantity: clampInt(o.quantity, 1, 20, 1) } : {}),
            ...(cleanString(o.organizationId) ? { organizationId: cleanString(o.organizationId) } : {}),
          });
        }
        break;
      }
      case 'trade_asset': {
        const assetId = cleanString(o.assetId);
        const buyerId = cleanString(o.buyerId);
        const price = positiveInt(o.price, 200);
        if (assetId && hasAgent(buyerId) && price > 0) {
          ops.push({ op: 'trade_asset', assetId, buyerId, price });
        }
        break;
      }
      case 'publish_record': {
        const title = cleanString(o.title).slice(0, 110);
        const body = cleanString(o.body).slice(0, 340);
        const loc = cleanString(o.locationId);
        if (title && body) {
          ops.push({
            op: 'publish_record',
            title,
            body,
            ...(hasLoc(loc) ? { locationId: loc } : {}),
          });
        }
        break;
      }
      case 'shift_relation': {
        const targetAgentId = cleanString(o.targetAgentId);
        if (hasAgent(targetAgentId)) {
          ops.push({
            op: 'shift_relation',
            targetAgentId,
            deltaTrust: clampInt(o.deltaTrust, -16, 16, 0),
            deltaAffection: clampInt(o.deltaAffection, -16, 16, 0),
            reason: cleanString(o.reason, 'Interpersonal shift').slice(0, 120),
          });
        }
        break;
      }
    }
  }
  return ops;
}

const VALID_NORM_KEYS: ReadonlySet<CulturalNormKey> = new Set([
  'debt_honor',
  'fair_pricing',
  'mutual_aid',
  'civic_duty',
  'truthfulness',
]);

const VALID_CONTRACT_KINDS: ReadonlySet<ServiceContractKind> = new Set([
  'supply_delivery',
  'labor_pact',
  'patronage',
  'political_pact',
]);

const VALID_DISPUTE_CATEGORIES: ReadonlySet<DisputeCategory> = new Set([
  'loan_default',
  'contract_breach',
  'unfair_layoff',
  'reputation_harm',
]);

const VALID_COALITION_AGENDAS: ReadonlySet<CoalitionAgenda> = new Set([
  'fiscal_restraint',
  'public_welfare',
  'merchant_guild',
  'labor_rights',
  'civic_reform',
]);

const VALID_ITEM_KINDS = new Set([
  'coffee',
  'pastry',
  'bread',
  'meal',
  'groceries',
  'produce',
  'medicine',
  'craft_goods',
  'book',
  'flowers',
  'drink',
]);

const VALID_NOTICE_CATEGORIES = new Set(['news', 'market', 'civic', 'event', 'job']);

export interface NormalizedGossipItem {
  speakerId: string;
  listenerId: string;
  aboutAgentId: string;
  deltaTrust: number;
  deltaAffection: number;
  claim: string;
}

export function normalizeGossipUpdates(
  raw: unknown,
  validAgentIds?: Set<string>,
  defaultSpeakerId?: string,
  defaultListenerId?: string,
): NormalizedGossipItem[] {
  if (!Array.isArray(raw)) return [];
  const results: NormalizedGossipItem[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const speakerId = cleanString(obj.speakerId, defaultSpeakerId ?? '');
    const listenerId = cleanString(obj.listenerId, defaultListenerId ?? '');
    const aboutAgentId = cleanString(obj.aboutAgentId);
    const claim = cleanString(obj.claim);
    if (!speakerId || !listenerId || !aboutAgentId || !claim) continue;
    if (speakerId === listenerId || aboutAgentId === speakerId || aboutAgentId === listenerId) continue;
    if (
      validAgentIds &&
      (!validAgentIds.has(speakerId) ||
        !validAgentIds.has(listenerId) ||
        !validAgentIds.has(aboutAgentId))
    ) {
      continue;
    }
    results.push({
      speakerId,
      listenerId,
      aboutAgentId,
      deltaTrust: clampInt(obj.deltaTrust, -12, 12, 0),
      deltaAffection: clampInt(obj.deltaAffection, -12, 12, 0),
      claim: claim.slice(0, 200),
    });
  }
  return results;
}

export interface NormalizedCompressedScenePayload {
  turns: Array<{ speakerId: string; speakerName: string; text: string; privateThought?: string }>;
  summaryByAgent: Record<string, { summary: string; importance: number; planUpdate?: string }>;
  emotionalShiftByAgent: Record<string, { deltaValence: number; deltaArousal: number }>;
  tomUpdates: Array<{
    fromId: string;
    targetId: string;
    deltaTrust: number;
    deltaAffection: number;
    inferredGoal: string;
  }>;
  beliefUpdatesByAgent: Record<string, ExtractedBeliefUpdate[]>;
  bilateralDeal?: NegotiatedDeal;
  gossipUpdates: NormalizedGossipItem[];
  memeIdsDiscussed: string[];
  newNews: Array<{ topic: string; keywords: string[] }>;
  sharedAgreement?: ReturnType<typeof normalizeCommitment>;
}

export function normalizeCompressedScenePayload(
  raw: unknown,
  participants: Array<{ id: string; name: string }>,
  validMemeIds?: Set<string>,
  validAllAgentIds?: Set<string>,
): NormalizedCompressedScenePayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const partById = new Map(participants.map((p) => [p.id, p]));
  const partIds = new Set(participants.map((p) => p.id));

  const rawTurns = Array.isArray(obj.turns) ? obj.turns : [];
  const turns: Array<{ speakerId: string; speakerName: string; text: string; privateThought?: string }> = [];
  for (const item of rawTurns.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const speakerId = cleanString(t.speakerId);
    const part = partById.get(speakerId);
    const text = cleanString(t.text ?? t.spokenLine);
    if (!part || !text) continue;
    const privateThought = cleanString(t.privateThought);
    turns.push({
      speakerId: part.id,
      speakerName: part.name,
      text: text.slice(0, 320),
      ...(privateThought ? { privateThought: privateThought.slice(0, 220) } : {}),
    });
  }

  if (turns.length < 2 && participants.length >= 2) {
    turns.push(
      {
        speakerId: participants[0].id,
        speakerName: participants[0].name,
        text: `Good to run into you here, ${participants[1].name.split(' ')[0]}.`,
      },
      {
        speakerId: participants[1].id,
        speakerName: participants[1].name,
        text: `Likewise, ${participants[0].name.split(' ')[0]} — keeping busy today.`,
      },
    );
  }

  const summaryByAgent: Record<string, { summary: string; importance: number; planUpdate?: string }> = {};
  const rawSummaries =
    obj.summaryByAgent && typeof obj.summaryByAgent === 'object'
      ? (obj.summaryByAgent as Record<string, unknown>)
      : {};
  const fallbackSummary = `${participants.map((p) => p.name.split(' ')[0]).join(', ')} caught up on daily life and town happenings.`;

  for (const p of participants) {
    const entry = rawSummaries[p.id];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      summaryByAgent[p.id] = {
        summary: cleanString(e.summary, fallbackSummary).slice(0, 260),
        importance: clampInt(e.importance, 1, 10, 5),
        planUpdate: cleanString(e.planUpdate) || undefined,
      };
    } else {
      summaryByAgent[p.id] = { summary: fallbackSummary, importance: 5 };
    }
  }

  const emotionalShiftByAgent: Record<string, { deltaValence: number; deltaArousal: number }> = {};
  const rawShifts =
    obj.emotionalShiftByAgent && typeof obj.emotionalShiftByAgent === 'object'
      ? (obj.emotionalShiftByAgent as Record<string, unknown>)
      : {};
  for (const p of participants) {
    const shift = normalizeEmotionalShift(rawShifts[p.id]);
    if (shift) emotionalShiftByAgent[p.id] = shift;
  }

  const tomUpdates: NormalizedCompressedScenePayload['tomUpdates'] = [];
  if (Array.isArray(obj.tomUpdates)) {
    for (const item of obj.tomUpdates.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      const fromId = cleanString(t.fromId);
      const targetId = cleanString(t.targetId);
      const norm = normalizeTomUpdate(t);
      if (partIds.has(fromId) && partIds.has(targetId) && fromId !== targetId && norm) {
        tomUpdates.push({ fromId, targetId, ...norm });
      }
    }
  }

  const memeIdsDiscussed = cleanStringArray(obj.memeIdsDiscussed, 10).filter(
    (id) => !validMemeIds || validMemeIds.has(id),
  );

  const newNews: Array<{ topic: string; keywords: string[] }> = [];
  if (Array.isArray(obj.newNews)) {
    for (const item of obj.newNews.slice(0, 3)) {
      if (!item || typeof item !== 'object') continue;
      const n = item as Record<string, unknown>;
      const topic = cleanString(n.topic);
      if (topic) {
        newNews.push({ topic: topic.slice(0, 140), keywords: cleanStringArray(n.keywords, 6) });
      }
    }
  }

  const beliefUpdatesByAgent: Record<string, ExtractedBeliefUpdate[]> = {};
  const rawBeliefMap =
    obj.beliefUpdatesByAgent && typeof obj.beliefUpdatesByAgent === 'object'
      ? (obj.beliefUpdatesByAgent as Record<string, unknown>)
      : {};
  for (const p of participants) {
    const list = normalizeBeliefUpdates(rawBeliefMap[p.id]);
    if (list.length > 0) beliefUpdatesByAgent[p.id] = list;
  }

  return {
    turns,
    summaryByAgent,
    emotionalShiftByAgent,
    tomUpdates,
    beliefUpdatesByAgent,
    bilateralDeal: normalizeNegotiatedDeal(obj.bilateralDeal, partIds),
    gossipUpdates: normalizeGossipUpdates(obj.gossipUpdates, validAllAgentIds),
    memeIdsDiscussed,
    newNews,
    sharedAgreement: normalizeCommitment(obj.sharedAgreement),
  };
}

export function normalizeBdiDecisionPayload(
  raw: unknown,
  validLocationIds?: Set<string>,
  validObjectIds?: Set<string>,
): BdiDecisionResult {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawAction = cleanString(obj.action, 'advance_project').toLowerCase() as WorldActionKind;
  const action: WorldActionKind = VALID_WORLD_ACTIONS.has(rawAction)
    ? rawAction
    : 'advance_project';

  const rawLoc = cleanString(obj.locationId);
  const locationId =
    rawLoc && (!validLocationIds || validLocationIds.has(rawLoc)) ? rawLoc : undefined;
  const rawObj = cleanString(obj.objectId);
  const objectId =
    rawObj && (!validObjectIds || validObjectIds.has(rawObj)) ? rawObj : undefined;

  const rawItem = cleanString(obj.itemKind).toLowerCase();
  const itemKind = VALID_ITEM_KINDS.has(rawItem) ? (rawItem as ItemKind) : undefined;

  const rawCat = cleanString(obj.noticeCategory).toLowerCase();
  const noticeCategory = VALID_NOTICE_CATEGORIES.has(rawCat)
    ? (rawCat as NoticeCategory)
    : undefined;

  const rawPetEffect = cleanString(obj.petitionEffect);
  const petitionEffect = VALID_TOWN_MODIFIER_KEYS.has(rawPetEffect as TownModifierKey)
    ? (rawPetEffect as TownModifierKey)
    : undefined;

  const rawContractKind = cleanString(obj.contractKind).toLowerCase() as ServiceContractKind;
  const contractKind = VALID_CONTRACT_KINDS.has(rawContractKind) ? rawContractKind : undefined;

  const rawDisputeCat = cleanString(obj.disputeCategory).toLowerCase() as DisputeCategory;
  const disputeCategory = VALID_DISPUTE_CATEGORIES.has(rawDisputeCat) ? rawDisputeCat : undefined;

  const rawAgenda = cleanString(obj.coalitionAgenda).toLowerCase() as CoalitionAgenda;
  const coalitionAgenda = VALID_COALITION_AGENDAS.has(rawAgenda) ? rawAgenda : undefined;

  const rawBoycottLoc = cleanString(obj.boycottLocationId);
  const boycottLocationId =
    rawBoycottLoc && (!validLocationIds || validLocationIds.has(rawBoycottLoc))
      ? rawBoycottLoc
      : undefined;

  const rawNormKey = cleanString(obj.normKey).toLowerCase() as CulturalNormKey;
  const normKey = VALID_NORM_KEYS.has(rawNormKey) ? rawNormKey : undefined;

  return {
    action,
    reason: cleanString(obj.reason, 'Making a grounded autonomous adjustment for the day.').slice(
      0,
      260,
    ),
    locationId,
    objectId,
    activity: cleanString(obj.activity) ? cleanString(obj.activity).slice(0, 140) : undefined,
    emoji: cleanString(obj.emoji) ? cleanString(obj.emoji).slice(0, 8) : undefined,
    durationMinutes:
      obj.durationMinutes !== undefined ? clampInt(obj.durationMinutes, 30, 120, 55) : undefined,
    itemKind,
    targetAgentId: cleanString(obj.targetAgentId) || undefined,
    proposalId: cleanString(obj.proposalId) || undefined,
    voteSupport: typeof obj.voteSupport === 'boolean' ? obj.voteSupport : undefined,
    noticeTitle: cleanString(obj.noticeTitle) ? cleanString(obj.noticeTitle).slice(0, 110) : undefined,
    noticeBody: cleanString(obj.noticeBody) ? cleanString(obj.noticeBody).slice(0, 340) : undefined,
    noticeCategory,
    newGoal: cleanString(obj.newGoal) ? cleanString(obj.newGoal).slice(0, 140) : undefined,
    loanAmount:
      obj.loanAmount !== undefined ? clampInt(obj.loanAmount, 20, 200, 50) : undefined,
    transferAmount:
      obj.transferAmount !== undefined ? clampInt(obj.transferAmount, 5, 250, 25) : undefined,
    ventureName: cleanString(obj.ventureName) ? cleanString(obj.ventureName).slice(0, 80) : undefined,
    petitionId: cleanString(obj.petitionId) || undefined,
    petitionTitle: cleanString(obj.petitionTitle)
      ? cleanString(obj.petitionTitle).slice(0, 110)
      : undefined,
    petitionDescription: cleanString(obj.petitionDescription)
      ? cleanString(obj.petitionDescription).slice(0, 260)
      : undefined,
    petitionEffect,
    platform: cleanString(obj.platform) ? cleanString(obj.platform).slice(0, 200) : undefined,
    candidateId: cleanString(obj.candidateId) || undefined,
    letterSubject: cleanString(obj.letterSubject)
      ? cleanString(obj.letterSubject).slice(0, 110)
      : undefined,
    letterBody: cleanString(obj.letterBody)
      ? cleanString(obj.letterBody).slice(0, 340)
      : undefined,
    ambitionTitle: cleanString(obj.ambitionTitle)
      ? cleanString(obj.ambitionTitle).slice(0, 140)
      : undefined,
    contractKind,
    contractTerms: cleanString(obj.contractTerms)
      ? cleanString(obj.contractTerms).slice(0, 220)
      : undefined,
    contractAmount:
      obj.contractAmount !== undefined ? clampInt(obj.contractAmount, 15, 180, 40) : undefined,
    disputeCategory,
    disputeClaim: cleanString(obj.disputeClaim)
      ? cleanString(obj.disputeClaim).slice(0, 220)
      : undefined,
    disputeAmount:
      obj.disputeAmount !== undefined ? clampInt(obj.disputeAmount, 0, 250, 35) : undefined,
    coalitionId: cleanString(obj.coalitionId) || undefined,
    coalitionName: cleanString(obj.coalitionName)
      ? cleanString(obj.coalitionName).slice(0, 80)
      : undefined,
    coalitionAgenda,
    boycottLocationId,
    boycottReason: cleanString(obj.boycottReason)
      ? cleanString(obj.boycottReason).slice(0, 200)
      : undefined,
    rumorId: cleanString(obj.rumorId) || undefined,
    rumorClaim: cleanString(obj.rumorClaim) ? cleanString(obj.rumorClaim).slice(0, 220) : undefined,
    isDeceptive: typeof obj.isDeceptive === 'boolean' ? obj.isDeceptive : undefined,
    normKey,
    openIntent: cleanString(obj.openIntent) ? cleanString(obj.openIntent).slice(0, 220) : undefined,
    openOps: obj.openOps !== undefined ? normalizeOpenActionOps(obj.openOps, undefined, validLocationIds) : undefined,
  };
}

