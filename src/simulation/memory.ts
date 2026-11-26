import {
  DEFAULT_MEMORY_CAP,
  type AgentState,
  type MemoryNode,
  type MemorySource,
  type MemoryType,
  type RetrievalWeights,
  type RetrievedMemory,
  type WorldState,
} from './types';

export const REFLECTION_THRESHOLD = 31;

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  recency: 1.0,
  importance: 1.0,
  relevance: 1.0,
  decayFactor: 0.995,
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'about',
  'into',
  'that',
  'this',
  'it',
  'its',
  'she',
  'he',
  'they',
  'them',
  'their',
  'her',
  'his',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'as',
  'so',
  'very',
  'just',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function extractKeywords(text: string): string[] {
  return Array.from(new Set(tokenize(text)));
}

/**
 * Matches a word or multi-word phrase on whole token boundaries rather than raw substrings,
 * preventing e.g. "run" from matching inside "brunch".
 */
export function containsWholeWordOrPhrase(text: string, phrase: string): boolean {
  const textTokens = text.toLowerCase().match(/[a-z0-9]+/g);
  const phraseTokens = phrase.toLowerCase().match(/[a-z0-9]+/g);
  if (!textTokens || !phraseTokens || phraseTokens.length === 0) return false;
  if (phraseTokens.length > textTokens.length) return false;

  for (let i = 0; i <= textTokens.length - phraseTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (textTokens[i + j] !== phraseTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export function getShortFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1 && /^(dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)$/i.test(parts[0])) {
    return parts[1];
  }
  return parts[0] ?? fullName;
}

/**
 * Stanford Smallville Recency Score:
 * Exponential decay over hours elapsed since last access (0.995^hours).
 */
export function computeRecencyScore(
  lastAccessedMin: number,
  currentSimMin: number,
  decayFactor = DEFAULT_RETRIEVAL_WEIGHTS.decayFactor,
): number {
  const hoursElapsed = Math.max(0, (currentSimMin - lastAccessedMin) / 60);
  return Math.pow(decayFactor, hoursElapsed);
}

/**
 * Normalized Importance Score (poignancy 1..10 mapped to 0..1).
 */
export function computeImportanceScore(importance: number): number {
  const clamped = Math.max(1, Math.min(10, importance));
  return clamped / 10;
}

/**
 * Cosine similarity between two dense embedding vectors clamped to [0, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-8) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Lexical cosine / overlap relevance between query and memory description/keywords.
 */
export function computeLexicalRelevance(
  query: string,
  memory: Pick<MemoryNode, 'description' | 'keywords'>,
): number {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) return 0;

  const memTokens = new Set([
    ...tokenize(memory.description),
    ...memory.keywords.map((k) => k.toLowerCase()),
  ]);

  if (memTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (memTokens.has(token)) {
      overlap += 1;
    } else {
      for (const mToken of memTokens) {
        if (
          token.length >= 4 &&
          mToken.length >= 4 &&
          (mToken.startsWith(token.slice(0, 4)) || token.startsWith(mToken.slice(0, 4)))
        ) {
          overlap += 0.65;
          break;
        }
      }
    }
  }

  const denom = Math.sqrt(queryTokens.length * Math.min(memTokens.size, 12));
  return Math.min(1, overlap / Math.max(1, denom));
}

/**
 * Direct relevance score helper for unit evaluation / single candidate checks.
 */
export function computeRelevanceScore(
  query: string,
  memory: Pick<MemoryNode, 'description' | 'keywords' | 'embedding'>,
  queryEmbedding?: number[],
): { score: number; usedEmbedding: boolean } {
  const lexical = computeLexicalRelevance(query, memory);
  if (
    queryEmbedding &&
    queryEmbedding.length > 0 &&
    memory.embedding &&
    memory.embedding.length === queryEmbedding.length
  ) {
    const dense = cosineSimilarity(queryEmbedding, memory.embedding);
    return {
      score: Math.min(1, dense * 0.8 + lexical * 0.2),
      usedEmbedding: true,
    };
  }
  return { score: lexical, usedEmbedding: false };
}

/**
 * Min-max normalizes a list of numbers into [0, 1], returning 0.5 if all equal (> 0).
 */
function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-6) {
    return values.map(() => (max > 0 ? 0.5 : 0));
  }
  return values.map((v) => (v - min) / (max - min));
}

/**
 * Zero-quota BM25-IDF + Entity Boost scorer across a resident's memory stream.
 * Gives rare entities (people, businesses, projects, proposals, financial events)
 * significantly stronger weight than generic daily verbs without needing external API calls.
 */
export function computeBm25EntityScores(
  memories: Array<Pick<MemoryNode, 'description' | 'keywords'>>,
  query: string,
): number[] {
  const n = memories.length;
  if (n === 0) return [];
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) return new Array<number>(n).fill(0);

  // Detect capitalized entity terms in raw query (proper names, places, projects)
  const rawEntityMatches = query.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const entityTokens = new Set(rawEntityMatches.map((w) => w.toLowerCase()));

  const docTokenLists = memories.map((m) => [
    ...tokenize(m.description),
    ...m.keywords.map((k) => k.toLowerCase()),
  ]);
  const avgDocLen =
    docTokenLists.reduce((sum, toks) => sum + toks.length, 0) / Math.max(1, n);

  const df = new Map<string, number>();
  for (const toks of docTokenLists) {
    const uniq = new Set(toks);
    for (const t of uniq) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const k1 = 1.2;
  const b = 0.75;
  const rawScores = new Array<number>(n).fill(0);
  let maxScore = 0;

  for (let i = 0; i < n; i++) {
    const toks = docTokenLists[i];
    if (toks.length === 0) continue;
    const tfMap = new Map<string, number>();
    for (const t of toks) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }

    let score = 0;
    for (const qt of queryTokens) {
      let tf = tfMap.get(qt) ?? 0;
      if (tf === 0 && qt.length >= 4) {
        // Prefix stem fallback
        const prefix = qt.slice(0, 4);
        for (const [docTok, cnt] of tfMap.entries()) {
          if (docTok.length >= 4 && (docTok.startsWith(prefix) || qt.startsWith(docTok.slice(0, 4)))) {
            tf = cnt * 0.6;
            break;
          }
        }
      }
      if (tf <= 0) continue;

      const docFreq = df.get(qt) ?? 1;
      const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
      const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * toks.length) / Math.max(1, avgDocLen)));
      const entityMultiplier = entityTokens.has(qt) ? 1.45 : 1.0;
      score += idf * normTf * entityMultiplier;
    }

    rawScores[i] = score;
    if (score > maxScore) maxScore = score;
  }

  if (maxScore <= 1e-6) return rawScores;
  return rawScores.map((s) => Math.min(1, s / maxScore));
}

/**
 * Hybrid Memory Retrieval Function:
 * Uses dense cosine similarity ONLY when queryEmbedding is present AND >= 90%
 * of candidate memories share matching-dimension embeddings. Otherwise uses zero-quota
 * BM25-IDF + Entity Boost blended with lexical overlap so retrieval is crisp and API-free.
 */
export function retrieveMemories(
  memories: MemoryNode[],
  query: string,
  currentSimMin: number,
  topK = 8,
  weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
  queryEmbedding?: number[],
): RetrievedMemory[] {
  if (memories.length === 0) return [];

  const rawRecency = memories.map((m) =>
    computeRecencyScore(m.lastAccessed, currentSimMin, weights.decayFactor),
  );
  const rawImportance = memories.map((m) => computeImportanceScore(m.importance));
  const lexicalScores = memories.map((m) => computeLexicalRelevance(query, m));
  const bm25Scores = computeBm25EntityScores(memories, query);
  const hybridLocalScores = lexicalScores.map((lex, i) =>
    Math.min(1, bm25Scores[i] * 0.7 + lex * 0.3),
  );

  const queryDim = queryEmbedding?.length ?? 0;
  const embeddedIndices: number[] = [];
  const rawDenseCosines: number[] = [];

  if (queryDim > 0 && queryEmbedding) {
    for (let i = 0; i < memories.length; i++) {
      const emb = memories[i].embedding;
      if (emb && emb.length === queryDim) {
        embeddedIndices.push(i);
        rawDenseCosines.push(cosineSimilarity(queryEmbedding, emb));
      }
    }
  }

  const coverage = embeddedIndices.length / memories.length;
  const useDense = queryDim > 0 && coverage >= 0.9;

  const rawRelevance = new Array<number>(memories.length);
  const usedEmbeddingFlags = new Array<boolean>(memories.length).fill(false);

  if (useDense) {
    const scaledDense = minMaxNormalize(rawDenseCosines);
    const scaledDenseByIdx = new Map<number, number>();
    embeddedIndices.forEach((memIdx, denseIdx) => {
      scaledDenseByIdx.set(memIdx, scaledDense[denseIdx]);
    });
    for (let i = 0; i < memories.length; i++) {
      const scaled = scaledDenseByIdx.get(i);
      if (scaled !== undefined) {
        rawRelevance[i] = Math.min(1, scaled * 0.8 + hybridLocalScores[i] * 0.2);
        usedEmbeddingFlags[i] = true;
      } else {
        rawRelevance[i] = Math.min(1, hybridLocalScores[i] * 0.2);
      }
    }
  } else {
    for (let i = 0; i < memories.length; i++) {
      rawRelevance[i] = hybridLocalScores[i];
    }
  }

  const normRecency = minMaxNormalize(rawRecency);
  const normImportance = minMaxNormalize(rawImportance);
  const normRelevance = minMaxNormalize(rawRelevance);

  const scored: RetrievedMemory[] = memories.map((node, i) => {
    const r = normRecency[i];
    const imp = normImportance[i];
    const rel = normRelevance[i];
    const score =
      weights.recency * r + weights.importance * imp + weights.relevance * rel;
    return {
      node,
      score,
      recencyScore: rawRecency[i],
      importanceScore: rawImportance[i],
      relevanceScore: rawRelevance[i],
      usedEmbedding: usedEmbeddingFlags[i],
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Updates lastAccessed cleanly on retrieved/prompt-cited memories.
 */
export function markAccessed(
  world: WorldState,
  agentId: string,
  memoryIds: string[],
  simMinutes: number,
): WorldState {
  if (memoryIds.length === 0) return world;
  const targetIds = new Set(memoryIds);
  let mutated = false;
  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== agentId) return ag;
    let agentMutated = false;
    const nextMemories = ag.memories.map((m) => {
      if (!targetIds.has(m.id)) return m;
      const nextAccessed = Math.max(m.lastAccessed, simMinutes);
      if (nextAccessed === m.lastAccessed) return m;
      agentMutated = true;
      return { ...m, lastAccessed: nextAccessed };
    });
    if (!agentMutated) return ag;
    mutated = true;
    return { ...ag, memories: nextMemories };
  });
  return mutated ? { ...world, agents: nextAgents } : world;
}

export type ImportanceMemoryKind =
  | 'arrival'
  | 'routine_perception'
  | 'known_person'
  | 'broadcast'
  | 'plan'
  | 'conversation'
  | 'reflection'
  | 'consolidated';

const IMPORTANCE_BASE_BY_KIND: Record<ImportanceMemoryKind, number> = {
  arrival: 2,
  routine_perception: 2,
  known_person: 4,
  plan: 6,
  reflection: 7,
  broadcast: 8,
  consolidated: 8,
  conversation: 5,
};

const EMERGENCY_SALIENT_WORDS = [
  'fire',
  'hurt',
  'injured',
  'injury',
  'accident',
  'hospital',
  'emergency',
  'death',
  'stolen',
  'missing',
  'fight',
];

const SOCIAL_SALIENT_WORDS = [
  'proposal',
  'award',
  'election',
  'mayor',
  'invitation',
  'invite',
  'party',
  'wedding',
  'announcement',
  'storm',
];

function computeRecentSimilarity(
  description: string,
  recentMemories: MemoryNode[],
  newEmbedding?: number[],
): number {
  const windowMems = recentMemories.slice(0, 15);
  if (windowMems.length === 0) return 0.5;
  const candTokens = new Set(tokenize(description));
  let maxSimilarity = 0;

  for (const mem of windowMems) {
    if (
      newEmbedding &&
      newEmbedding.length > 0 &&
      mem.embedding &&
      mem.embedding.length === newEmbedding.length
    ) {
      const sim = cosineSimilarity(newEmbedding, mem.embedding);
      if (sim > maxSimilarity) maxSimilarity = sim;
    } else if (candTokens.size > 0) {
      const memTokens = new Set([...tokenize(mem.description), ...mem.keywords]);
      let overlap = 0;
      for (const tok of candTokens) {
        if (memTokens.has(tok)) overlap += 1;
      }
      const union = new Set([...candTokens, ...memTokens]).size;
      const jaccard = union > 0 ? overlap / union : 0;
      if (jaccard > maxSimilarity) maxSimilarity = jaccard;
    }
  }
  return maxSimilarity;
}

/**
 * Calibrated 1..10 importance scorer across memory kinds, novelty, and salient words.
 */
export function scoreImportance(params: {
  kind: ImportanceMemoryKind;
  description: string;
  recentMemories: MemoryNode[];
  participantRating?: number;
  newEmbedding?: number[];
}): number {
  const { kind, description, recentMemories, participantRating, newEmbedding } = params;
  const base =
    kind === 'conversation' && participantRating !== undefined
      ? Math.max(1, Math.min(10, Math.round(participantRating)))
      : IMPORTANCE_BASE_BY_KIND[kind];

  const maxSim = computeRecentSimilarity(description, recentMemories, newEmbedding);
  const novelty = Math.max(0, Math.min(1, 1 - maxSim));
  const noveltyBonus =
    kind === 'arrival' || kind === 'routine_perception'
      ? novelty >= 0.45
        ? 1
        : 0
      : Math.round(novelty * 2);

  let emergencyHits = 0;
  for (const word of EMERGENCY_SALIENT_WORDS) {
    if (containsWholeWordOrPhrase(description, word)) emergencyHits += 1;
  }
  let socialHits = 0;
  for (const word of SOCIAL_SALIENT_WORDS) {
    if (containsWholeWordOrPhrase(description, word)) socialHits += 1;
  }

  let salientBonus = 0;
  if (emergencyHits > 0) {
    salientBonus = emergencyHits >= 2 ? 6 : 5;
  } else if (socialHits > 0) {
    salientBonus = socialHits >= 2 ? 4 : 3;
  }

  return Math.max(1, Math.min(10, Math.round(base + noveltyBonus + salientBonus)));
}

/**
 * Dynamic Novelty / Surprise Scoring helper (retained for compatibility/tests).
 */
export function computeMemorySurpriseScore(
  description: string,
  recentMemories: MemoryNode[],
  newEmbedding?: number[],
): number {
  const windowMems = recentMemories.slice(0, 15);
  if (windowMems.length === 0) return 6;
  const maxSimilarity = computeRecentSimilarity(description, windowMems, newEmbedding);
  const novelty = Math.max(0, Math.min(1, 1 - maxSimilarity));
  return Math.max(4, Math.min(7, Math.round(4 + novelty * 3)));
}

export function inferMemorySource(mem: Pick<MemoryNode, 'id' | 'type' | 'source'>): MemorySource {
  if (mem.source) return mem.source;
  if (mem.type === 'consolidated') return 'summary';
  if (mem.type === 'reflection') return 'reflection';
  if (mem.type === 'plan') return 'plan';
  if (mem.id.startsWith('perc_') || mem.id.startsWith('mem_') || mem.id.startsWith('urge_')) {
    return 'perception';
  }
  if (mem.id.startsWith('conv_') || mem.id.startsWith('int_')) return 'conversation';
  if (mem.id.startsWith('bcast_')) return 'broadcast';
  if (mem.id.startsWith('react_')) return 'reaction';
  if (mem.id.startsWith('cons_')) return 'summary';
  return 'seed';
}

export function createMemoryNode(params: {
  id: string;
  createdAt: number;
  type: MemoryType;
  source?: MemorySource;
  description: string;
  importance: number;
  evidenceIds?: string[];
  embedding?: number[];
  timesCited?: number;
  pinnedFixedBlockId?: string;
}): MemoryNode {
  return {
    id: params.id,
    createdAt: params.createdAt,
    lastAccessed: params.createdAt,
    type: params.type,
    source: params.source ?? inferMemorySource({ id: params.id, type: params.type }),
    description: params.description,
    importance: Math.max(1, Math.min(10, Math.round(params.importance))),
    keywords: extractKeywords(params.description),
    evidenceIds: params.evidenceIds,
    embedding: params.embedding,
    timesCited: params.timesCited,
    pinnedFixedBlockId: params.pinnedFixedBlockId,
  };
}

/**
 * Phase 4 Retention & Safe Forgetting:
 * - Hard-protects importance >= 8 memories younger than 7 sim days.
 * - Ranks evictable memories by importance/10 + 0.5*recency + typeBonus + 0.1*timesCited.
 * - Before evicting routine observations >= 24 sim hours old, compresses each sim day
 *   into one rule-based 'consolidated' summary memory citing their evicted IDs.
 */
export function compactMemories(
  memories: MemoryNode[],
  maxTotal = DEFAULT_MEMORY_CAP,
  currentSimMin?: number,
  makeId?: (prefix: string) => string,
): MemoryNode[] {
  if (memories.length <= maxTotal) return memories;

  const refSimMin =
    currentSimMin ??
    memories.reduce((mx, m) => Math.max(mx, m.createdAt, m.lastAccessed), 0);
  const sevenDaysMin = 7 * 1440;
  const oneDayMin = 24 * 60;

  const isHardProtected = (m: MemoryNode) =>
    m.importance >= 8 && Math.max(0, refSimMin - m.createdAt) < sevenDaysMin;

  const scoreRetain = (m: MemoryNode) => {
    const recency = computeRecencyScore(m.lastAccessed, refSimMin);
    const typeBonus =
      m.type === 'reflection'
        ? 0.3
        : m.type === 'consolidated'
          ? 0.5
          : m.type === 'plan' && m.pinnedFixedBlockId
            ? 1.0
            : 0;
    const citationBonus = 0.1 * (m.timesCited ?? 0);
    return m.importance / 10 + 0.5 * recency + typeBonus + citationBonus;
  };

  const hardProtected: MemoryNode[] = [];
  const evictableCandidates: MemoryNode[] = [];
  for (const m of memories) {
    if (isHardProtected(m)) {
      hardProtected.push(m);
    } else {
      evictableCandidates.push(m);
    }
  }

  const sortedCandidates = [...evictableCandidates].sort(
    (a, b) => scoreRetain(b) - scoreRetain(a) || b.createdAt - a.createdAt,
  );

  let remainingSlots = Math.max(0, maxTotal - hardProtected.length);
  let kept = sortedCandidates.slice(0, remainingSlots);
  let evicted = sortedCandidates.slice(remainingSlots);

  const oldRoutineEvicted = evicted.filter(
    (m) =>
      (m.type === 'observation' || m.type === 'plan' || m.type === 'reflection') &&
      Math.max(0, refSimMin - m.createdAt) >= oneDayMin,
  );

  const summaries: MemoryNode[] = [];
  if (oldRoutineEvicted.length > 0) {
    const byDay = new Map<number, MemoryNode[]>();
    for (const m of oldRoutineEvicted) {
      const dayNum = Math.floor(Math.max(0, m.createdAt) / 1440) + 1;
      const arr = byDay.get(dayNum);
      if (arr) arr.push(m);
      else byDay.set(dayNum, [m]);
    }

    // Merge into existing cons_day summary nodes in `kept` first so repeated compactions don't spawn extra summary nodes per day
    const existingDayIdx = new Map<number, number>();
    for (let i = 0; i < kept.length; i++) {
      const km = kept[i];
      if (km.type === 'consolidated' && km.description.startsWith('Day ')) {
        const match = /^Day (\d+) summary/.exec(km.description);
        if (match) {
          existingDayIdx.set(Number(match[1]), i);
        }
      }
    }

    const newDays: Array<[number, MemoryNode[]]> = [];
    for (const [dayNum, group] of Array.from(byDay.entries()).sort((a, b) => a[0] - b[0])) {
      const existingIdx = existingDayIdx.get(dayNum);
      if (existingIdx !== undefined) {
        const existing = kept[existingIdx];
        const mergedIds = Array.from(
          new Set([...(existing.evidenceIds ?? []), ...group.map((g) => g.id)]),
        );
        const maxCreated = Math.max(
          existing.createdAt,
          group.reduce((mx, x) => Math.max(mx, x.createdAt), 0),
        );
        const maxAccessed = Math.max(
          existing.lastAccessed,
          group.reduce((mx, x) => Math.max(mx, x.lastAccessed), 0),
        );
        kept[existingIdx] = {
          ...existing,
          createdAt: maxCreated,
          lastAccessed: maxAccessed,
          evidenceIds: mergedIds,
        };
      } else {
        newDays.push([dayNum, group]);
      }
    }

    // Reserve slots for brand-new daily consolidated summaries so total stays <= maxTotal
    const summaryCount = newDays.length;
    if (hardProtected.length + kept.length + summaryCount > maxTotal && kept.length > 0) {
      const trim = Math.min(
        kept.length,
        hardProtected.length + kept.length + summaryCount - maxTotal,
      );
      const trimmedOut = kept.slice(kept.length - trim);
      kept = kept.slice(0, kept.length - trim);
      for (const t of trimmedOut) {
        if (
          (t.type === 'observation' || t.type === 'plan' || t.type === 'reflection') &&
          Math.max(0, refSimMin - t.createdAt) >= oneDayMin
        ) {
          const dayNum = Math.floor(Math.max(0, t.createdAt) / 1440) + 1;
          const pair = newDays.find(([d]) => d === dayNum);
          if (pair) {
            pair[1].push(t);
          } else {
            const existingIdx = existingDayIdx.get(dayNum);
            if (existingIdx !== undefined && existingIdx < kept.length) {
              const existing = kept[existingIdx];
              kept[existingIdx] = {
                ...existing,
                evidenceIds: Array.from(new Set([...(existing.evidenceIds ?? []), t.id])),
              };
            }
          }
        }
      }
    }

    for (const [dayNum, group] of newDays) {
      const maxCreated = group.reduce((mx, x) => Math.max(mx, x.createdAt), 0);
      const maxAccessed = group.reduce((mx, x) => Math.max(mx, x.lastAccessed), 0);
      const snippets = Array.from(
        new Set(group.map((x) => x.description.replace(/\s+/g, ' ').trim())),
      )
        .slice(0, 3)
        .map((s) => (s.length > 72 ? `${s.slice(0, 69)}...` : s))
        .join(' | ');
      const summaryId = makeId
        ? makeId('cons_day')
        : `cons_day_${dayNum}_${group[0].id}`;
      summaries.push({
        ...createMemoryNode({
          id: summaryId,
          createdAt: maxCreated,
          type: 'consolidated',
          description: `Day ${dayNum} summary (${group.length} observations): ${snippets}`,
          importance: 6,
          evidenceIds: group.map((g) => g.id),
        }),
        lastAccessed: maxAccessed,
      });
    }
  }

  return [...hardProtected, ...kept, ...summaries]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(maxTotal, hardProtected.length));
}

export function shouldTriggerReflection(
  agent: Pick<AgentState, 'importanceAccumulator' | 'isThinking'>,
  threshold = REFLECTION_THRESHOLD,
): boolean {
  return !agent.isThinking && agent.importanceAccumulator >= threshold;
}

export function formatSimTime(simMinutes: number): {
  day: number;
  minuteOfDay: number;
  hour24: number;
  hour12: number;
  minute: number;
  ampm: 'AM' | 'PM';
  timeLabel: string;
  fullLabel: string;
} {
  const safeMin = Math.max(0, Math.floor(simMinutes));
  const day = Math.floor(safeMin / 1440) + 1;
  const minuteOfDay = safeMin % 1440;
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const ampm: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minStr = String(minute).padStart(2, '0');
  const timeLabel = `${hour12}:${minStr} ${ampm}`;
  return {
    day,
    minuteOfDay,
    hour24,
    hour12,
    minute,
    ampm,
    timeLabel,
    fullLabel: `Day ${day} · ${timeLabel}`,
  };
}
