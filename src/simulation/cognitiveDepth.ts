/**
 * Phase F — Deep Biographical Minds, Bi-Temporal Belief Revision,
 * A-MEM Associative Memory Linking & Single-Model Anti-Homogenization.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { extractKeywords } from './memory';
import type {
  AgentDossier,
  AgentState,
  AgentTemperament,
  BeliefNode,
  BeliefPredicate,
  BeliefProvenance,
  CivicWorldview,
  DecodingProfile,
  FinancialPosture,
  GroundTruthStatus,
  MemoryNode,
  RetrievedMemory,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Derives per-temperament OpenRouter decoding parameters so a single base LLM
 * produces distinct phrasing, risk appetite, and cadence across residents.
 */
export function deriveDecodingProfile(
  stubbornness: number,
  riskTolerance: number,
  ambition: number,
): DecodingProfile {
  const temperature = Number(
    clamp(0.52 + riskTolerance * 0.34 + (1 - stubbornness) * 0.08, 0.45, 0.96).toFixed(2),
  );
  const topP = Number(clamp(0.84 + riskTolerance * 0.1 + ambition * 0.03, 0.82, 0.97).toFixed(2));
  const frequencyPenalty = Number(
    clamp(0.14 + stubbornness * 0.16 + riskTolerance * 0.12, 0.1, 0.45).toFixed(2),
  );
  return { temperature, topP, frequencyPenalty };
}

interface CorePersonaSeed {
  dossier: AgentDossier;
  stubbornness: number;
  riskTolerance: number;
  ambition: number;
}

const CORE_PERSONA_SEEDS: Record<string, CorePersonaSeed> = {
  isabella: {
    dossier: {
      background:
        'Took over Hobbs Cafe after her aunt retired; built a loyal morning crowd by hand-roasting beans and remembering every customer’s regulars.',
      formativeEvents: [
        'Weathered a tough winter slow season two years ago by cutting her own salary before letting staff go.',
        'Turned a rainy town power outage into a candlelit soup night that doubled her regulars.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'communitarian',
      speechStyle: 'Warm, brisk, practical hospitality; uses specific menu details and dislikes empty flattery.',
      privateAgenda: 'Grow Hobbs Cafe into Smallville’s undisputed evening hub without raising coffee prices above $6.',
      redLines: ['Will not tolerate unpaid tabs from repeat defaulters', 'Refuses to cut pastry quality for cheap margins'],
    },
    stubbornness: 0.58,
    riskTolerance: 0.62,
    ambition: 0.82,
  },
  john: {
    dossier: {
      background:
        'Ran Willows Market & Pharmacy for twenty-five years; tracks every wholesale crate down to the penny on paper ledgers.',
      formativeEvents: [
        'Watched a neighboring town’s general store fail from over-extending credit in the 2000s.',
        'Put his son Eddy through music lessons by working 60-hour weeks behind the counter.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'fiscal_conservative',
      speechStyle: 'Measured, blunt, numbers-first; skeptical of grand promises until he sees the balance sheet.',
      privateAgenda: 'Keep municipal taxes low and protect Willows Market’s wholesale margins against pop-up competitors.',
      redLines: ['Opposes unfunded town spending that drains treasury below $300', 'Never lends without clear repayment terms'],
    },
    stubbornness: 0.82,
    riskTolerance: 0.25,
    ambition: 0.55,
  },
  mei: {
    dossier: {
      background:
        'Teaches economics and civic statistics at Oak Hill College; quietly mediates between John’s thrift and Eddy’s artistic idealism.',
      formativeEvents: [
        'Published a regional study on small-town wage stagnation that earned respect at Town Hall.',
        'Learned to stay calm in heated family arguments by asking concrete counterfactual questions.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'pragmatist',
      speechStyle: 'Articulate, inquisitive, gently probing; cites concrete observations rather than abstractions.',
      privateAgenda: 'Encourage Eddy to pair his music ambitions with steady income while pushing evidence-based town policy.',
      redLines: ['Refuses to endorse rumors without two independent witnesses', 'Will not cosign reckless debt'],
    },
    stubbornness: 0.64,
    riskTolerance: 0.36,
    ambition: 0.68,
  },
  eddy: {
    dossier: {
      background:
        'Young composer juggling college coursework, café gigs, and late-night piano sketches; feels boxed in by his father’s ledger mindset.',
      formativeEvents: [
        'Performed an original suite at Johnson Park that drew applause from strangers for the first time.',
        'Once missed a utility bill after buying studio microphones, sparking a lecture from John.',
      ],
      financialPosture: 'spender',
      civicWorldview: 'reformist',
      speechStyle: 'Expressive, impulsive, colloquial; speaks in bursts of enthusiasm and bristles when lectured about money.',
      privateAgenda: 'Fund an independent evening concert series without asking John for bailout money.',
      redLines: ['Refuses to give up composing for a purely clerical job', 'Resents condescending advice'],
    },
    stubbornness: 0.52,
    riskTolerance: 0.78,
    ambition: 0.76,
  },
  klaus: {
    dossier: {
      background:
        'Intense sociology graduate student obsessing over urban gentrification and local inequality; often skips meals while drafting.',
      formativeEvents: [
        'Grew up in a working-class neighborhood priced out by rising rents.',
        'Found his voice in heated campus seminars where he refused to soften his critiques.',
      ],
      financialPosture: 'anxious',
      civicWorldview: 'reformist',
      speechStyle: 'Sharp, analytical, slightly contrarian; challenges comfortable assumptions and dislikes small talk.',
      privateAgenda: 'Document wealth concentration in Smallville and rally support for tenant and clinic protections.',
      redLines: ['Will not rubber-stamp merchant-favoring policies', 'Refuses to stay quiet when low-income residents struggle'],
    },
    stubbornness: 0.84,
    riskTolerance: 0.54,
    ambition: 0.8,
  },
  maria: {
    dossier: {
      background:
        'Physics undergrad balancing lab simulations with indie game prototyping; relies on scholarships and part-time tutoring.',
      formativeEvents: [
        'Built her first simulation engine on a secondhand laptop during winter break.',
        'Learned to guard her study hours fiercely after burning out freshman year.',
      ],
      financialPosture: 'anxious',
      civicWorldview: 'pragmatist',
      speechStyle: 'Direct, dry humor, crisp logic; quick to spot inconsistent claims and call them out.',
      privateAgenda: 'Finish her research project cleanly while keeping her savings buffer above $120.',
      redLines: ['Will not take on unpaid favors during exam or research sprints', 'Rejects vague hand-waving'],
    },
    stubbornness: 0.61,
    riskTolerance: 0.48,
    ambition: 0.74,
  },
  sam: {
    dossier: {
      background:
        'Retired town assessor and civic elder living on South Lane; knows every zoning ordinance and still believes in fiscal discipline.',
      formativeEvents: [
        'Guided Smallville out of a municipal deficit fifteen years ago by auditing every contract.',
        'Lost a close town council race once to a flashier opponent and swore never to pander.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'fiscal_conservative',
      speechStyle: 'Formal, gravelly, principled; speaks with dry authority and pushes back hard on impulsive spending.',
      privateAgenda: 'Win the Mayoral office to enforce balanced budgets, street lighting, and accountable public works.',
      redLines: ['Never supports tax hikes above 9%', 'Refuses backroom favors or crony hiring'],
    },
    stubbornness: 0.88,
    riskTolerance: 0.28,
    ambition: 0.79,
  },
  arthur: {
    dossier: {
      background:
        'Proprietor of The Rose & Crown Pub; hears every secret in town over evening pints and keeps a mental map of everyone’s debts.',
      formativeEvents: [
        'Built the pub’s oak bar himself after returning from ten years working coastal inns.',
        'Learned that gossip is currency—and that lending too freely ruins friendships.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'pragmatist',
      speechStyle: 'Wry, conversational, streetwise; tests people with half-joking questions to see what they hide.',
      privateAgenda: 'Keep evening foot traffic flowing to the pub and broker profitable introductions.',
      redLines: ['Will not tolerate troublemakers driving away regular patrons', 'Distrusts moralizing busybodies'],
    },
    stubbornness: 0.72,
    riskTolerance: 0.58,
    ambition: 0.64,
  },
  abigail: {
    dossier: {
      background:
        'Illustrator and muralist living in Artist Cottages; fiercely protective of independent creative spaces and skeptical of commercial hype.',
      formativeEvents: [
        'Turned down a lucrative corporate branding gig because they demanded she erase local character.',
        'Organized a neighborhood sketch walk that brought estranged neighbors back together.',
      ],
      financialPosture: 'anxious',
      civicWorldview: 'communitarian',
      speechStyle: 'Vivid, candid, observant; notices body language and speaks plainly when she smells insincerity.',
      privateAgenda: 'Secure commissions and community arts patronage without sacrificing her artistic voice.',
      redLines: ['Refuses to work for below-living wages', 'Pushes back against purely profit-driven town decisions'],
    },
    stubbornness: 0.76,
    riskTolerance: 0.65,
    ambition: 0.69,
  },
  rajiv: {
    dossier: {
      background:
        'Painter and printmaker sharing Artist Cottages; balances contemplative studio hours with entrepreneurial side-sales of prints.',
      formativeEvents: [
        'Moved to Smallville after burning out in a big-city design agency.',
        'Sold his first full gallery series by teaming up with local cafés instead of distant brokers.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'pragmatist',
      speechStyle: 'Reflective, unhurried, quietly assertive; asks unexpected angles rather than agreeing quickly.',
      privateAgenda: 'Build a sustainable print-and-craft micro-venture alongside his gallery work.',
      redLines: ['Refuses rushed collaborations with people he doesn’t trust', 'Will not undercut fellow artisans'],
    },
    stubbornness: 0.55,
    riskTolerance: 0.66,
    ambition: 0.71,
  },
  wolfgang: {
    dossier: {
      background:
        'Disciplined chemistry student and dawn runner; approaches training, lab schedules, and personal budgets with stoic precision.',
      formativeEvents: [
        'Recovered from a knee injury through strict daily discipline when doctors doubted he’d run again.',
        'Avoided student debt by working summer shifts and living simply.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'fiscal_conservative',
      speechStyle: 'Concise, stoic, matter-of-fact; rarely flatters and respects action over talk.',
      privateAgenda: 'Maintain peak health and savings while completing his lab thesis ahead of schedule.',
      redLines: ['Refuses chaotic last-minute schedule changes', 'Will not lend money to reckless spenders'],
    },
    stubbornness: 0.79,
    riskTolerance: 0.34,
    ambition: 0.73,
  },
  hailey: {
    dossier: {
      background:
        'Investigative reporter for the Smallville Gazette; lives for uncovering real stories behind town budgets, elections, and rumors.',
      formativeEvents: [
        'Broke a story on a botched road-repair bid that saved the town hundreds of dollars.',
        'Had a source lie to her once—now she cross-checks every claim relentlessly.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'reformist',
      speechStyle: 'Crisp, probing, skeptical; follows every answer with a pointed "why" or "who benefits?"',
      privateAgenda: 'Uncover hidden coalitions, financial pressures, and election maneuvers for the Gazette.',
      redLines: ['Refuses to bury uncomfortable facts for friends', 'Never takes a politician’s promise at face value'],
    },
    stubbornness: 0.74,
    riskTolerance: 0.69,
    ambition: 0.85,
  },
  elena: {
    dossier: {
      background:
        'Community physician running Smallville Clinic & Greenhouse; left a rushed metropolitan hospital to practice personal, preventive medicine.',
      formativeEvents: [
        'Treated an entire winter flu wave single-handedly when regional supply shipments lagged.',
        'Saw firsthand how unaffordable medical bills keep working neighbors from seeking care early.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'communitarian',
      speechStyle: 'Calm, authoritative, empathetic yet firm; refuses to sugarcoat health or civic neglect.',
      privateAgenda: 'Secure permanent public clinic subsidies and keep medicine shelves stocked through seasonal outbreaks.',
      redLines: ['Will not turn away a sick neighbor in distress', 'Opposes budget cuts to public health or green spaces'],
    },
    stubbornness: 0.71,
    riskTolerance: 0.42,
    ambition: 0.77,
  },
  mateo: {
    dossier: {
      background:
        'Artisan baker who wakes at 4:30 AM to fire Oakridge Bakery’s stone ovens; proud of his craft and hungry to expand wholesale routes.',
      formativeEvents: [
        'Apprenticed under a strict master baker who threw out any loaf with an uneven crumb.',
        'Took a small loan to buy his brick oven and paid every cent back early.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'pragmatist',
      speechStyle: 'Energetic, proud, candid; talks in tactile craft metaphors and negotiates prices firmly.',
      privateAgenda: 'Expand wholesale bread supply to Hobbs Cafe and Willows Market while defending bakery wages.',
      redLines: ['Refuses to sell stale loaves', 'Will not accept below-cost wholesale contracts'],
    },
    stubbornness: 0.67,
    riskTolerance: 0.61,
    ambition: 0.81,
  },
  clara: {
    dossier: {
      background:
        'Head archivist at Harvey Oak Library; keeper of Smallville’s civic records and quiet mentor to young writers and researchers.',
      formativeEvents: [
        'Rescued a century of flood-damaged town ledgers and indexed every household history.',
        'Successfully defended library evening hours against an earlier austerity cut.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'communitarian',
      speechStyle: 'Thoughtful, exact, quietly iron-willed; remembers past precedents and cites them calmly.',
      privateAgenda: 'Expand evening library access and protect public literacy spaces from budget squeezes.',
      redLines: ['Opposes closing public commons early', 'Calls out historical revisionism immediately'],
    },
    stubbornness: 0.73,
    riskTolerance: 0.31,
    ambition: 0.62,
  },
  devon: {
    dossier: {
      background:
        'Master carpenter and furniture maker at Willow Workshop; judges people by craftsmanship, punctuality, and keeping their word.',
      formativeEvents: [
        'Built the cedar timber framing for three cottages after a summer storm.',
        'Got stiffed once by an out-of-town buyer and now demands upfront deposits on big jobs.',
      ],
      financialPosture: 'frugal',
      civicWorldview: 'pragmatist',
      speechStyle: 'Gruff, direct, practical; short sentences, zero patience for excuses or bureaucratic jargon.',
      privateAgenda: 'Win the South Lane street-lantern carpentry contract and grow workshop capital.',
      redLines: ['Never forgives broken contracts lightly', 'Refuses shoddy shortcuts'],
    },
    stubbornness: 0.86,
    riskTolerance: 0.44,
    ambition: 0.72,
  },
  priya: {
    dossier: {
      background:
        'Urban agronomist stewarding the Community Garden; passionate about local food resilience and fair farm-gate produce prices.',
      formativeEvents: [
        'Turned a vacant weed lot beside Willows Creek into productive heirloom beds in one season.',
        'Clashed with wholesalers who tried to buy her harvest for pennies during peak summer.',
      ],
      financialPosture: 'balanced',
      civicWorldview: 'communitarian',
      speechStyle: 'Grounded, passionate, observant; bridges science with practical neighborhood care.',
      privateAgenda: 'Establish a Market Stipend cooperative so fresh local produce stays affordable and profitable.',
      redLines: ['Refuses predatory wholesale pricing', 'Defends the Community Garden against commercialization'],
    },
    stubbornness: 0.69,
    riskTolerance: 0.56,
    ambition: 0.75,
  },
  lucas: {
    dossier: {
      background:
        'Environmental science student mapping creek water quality and weather cycles; idealistic but impatient with slow town committees.',
      formativeEvents: [
        'Detected runoff anomalies in Willows Creek and forced an upstream cleanup.',
        'Works odd shifts to pay his own rent after refusing family bailouts.',
      ],
      financialPosture: 'anxious',
      civicWorldview: 'reformist',
      speechStyle: 'Earnest, quick-talking, data-minded; pushes urgently for action when others stall.',
      privateAgenda: 'Turn his creek data into funded town action while achieving financial self-sufficiency.',
      redLines: ['Will not ignore ecological neglect for short-term profit', 'Resists paternalistic dismissal'],
    },
    stubbornness: 0.63,
    riskTolerance: 0.71,
    ambition: 0.74,
  },
};

const POSTURES: FinancialPosture[] = ['frugal', 'balanced', 'spender', 'anxious'];
const WORLDVIEWS: CivicWorldview[] = [
  'fiscal_conservative',
  'communitarian',
  'pragmatist',
  'reformist',
];
const SPEECH_STYLES = [
  'Crisp, skeptical, and economical with words; dislikes vague small talk.',
  'Warm yet opinionated; grounds arguments in everyday household realities.',
  'Direct, blunt, and pragmatic; negotiates firmly when money is on the line.',
  'Curious and conversational, but stubborn once a personal boundary is crossed.',
  'Measured and cautious; asks clarifying questions before trusting anyone.',
];
const PRIVATE_AGENDAS = [
  'Build an emergency savings cushion of at least $250 and avoid falling behind on rent.',
  'Earn a senior promotion and launch an independent weekend micro-stall.',
  'Push town leadership toward practical neighborhood improvements without wasteful taxes.',
  'Strengthen ties inside their club and build enough reputation to influence town petitions.',
  'Negotiate fairer hourly pay while keeping daily living expenses strictly under control.',
];

export function buildDossierAndTemperamentForAgent(
  agent: Pick<AgentState, 'id' | 'name' | 'occupation' | 'traits' | 'goals'>,
): { dossier: AgentDossier; temperament: AgentTemperament } {
  const core = CORE_PERSONA_SEEDS[agent.id];
  if (core) {
    return {
      dossier: {
        ...core.dossier,
        formativeEvents: [...core.dossier.formativeEvents],
        redLines: [...core.dossier.redLines],
      },
      temperament: {
        stubbornness: core.stubbornness,
        riskTolerance: core.riskTolerance,
        ambition: core.ambition,
        decoding: deriveDecodingProfile(core.stubbornness, core.riskTolerance, core.ambition),
      },
    };
  }

  const h1 = deterministicHash(`${agent.id}:stubborn`);
  const h2 = deterministicHash(`${agent.id}:risk`);
  const h3 = deterministicHash(`${agent.id}:ambition`);
  const h4 = deterministicHash(`${agent.id}:posture`);
  const h5 = deterministicHash(`${agent.id}:worldview`);
  const h6 = deterministicHash(`${agent.id}:style`);

  const stubbornness = Number((0.35 + h1 * 0.55).toFixed(2));
  const riskTolerance = Number((0.2 + h2 * 0.65).toFixed(2));
  const ambition = Number((0.35 + h3 * 0.55).toFixed(2));
  const financialPosture = POSTURES[Math.floor(h4 * POSTURES.length) % POSTURES.length];
  const civicWorldview = WORLDVIEWS[Math.floor(h5 * WORLDVIEWS.length) % WORLDVIEWS.length];
  const speechStyle = SPEECH_STYLES[Math.floor(h6 * SPEECH_STYLES.length) % SPEECH_STYLES.length];
  const privateAgenda =
    PRIVATE_AGENDAS[Math.floor(deterministicHash(`${agent.id}:agenda`) * PRIVATE_AGENDAS.length)];

  return {
    dossier: {
      background: `${agent.name} settled in Smallville working as a ${agent.occupation}, balancing rent, local ties, and personal ambitions.`,
      formativeEvents: [
        `Took pride in mastering early shifts as a ${agent.occupation} without relying on handouts.`,
        `Learned from past neighborhood disagreements to verify rumors before committing trust.`,
      ],
      financialPosture,
      civicWorldview,
      speechStyle,
      privateAgenda,
      redLines: [
        financialPosture === 'frugal'
          ? 'Refuses risky loans or overpriced impulse purchases'
          : 'Refuses disrespectful treatment or broken promises',
        civicWorldview === 'fiscal_conservative'
          ? 'Opposes reckless municipal spending'
          : 'Refuses to ignore struggling neighbors',
      ],
    },
    temperament: {
      stubbornness,
      riskTolerance,
      ambition,
      decoding: deriveDecodingProfile(stubbornness, riskTolerance, ambition),
    },
  };
}

/**
 * A-MEM Semantic Domain Tagging: assigns concise structured tags to any memory text.
 */
const DOMAIN_TAG_PATTERNS: Array<[string, RegExp]> = [
  ['finance', /\b(wallet|paid|wage|rent|price|treasury|budget|tax|cost|salary|money|\$\d)/i],
  ['loan', /\b(loan|borrow|lent|repay|repaid|default|debt|credit|owed)\b/i],
  ['venture', /\b(venture|stall|startup|micro-venture|launched|shop|market)\b/i],
  ['civic', /\b(election|mayor|vote|voted|ballot|proposal|petition|policy|council|town hall)\b/i],
  ['health', /\b(clinic|cold|sick|illness|medicine|health|doctor|recovery|treated)\b/i],
  ['housing', /\b(rent|lease|moved|cottage|roommate|household|housing|home)\b/i],
  ['career', /\b(hired|job|laid off|promotion|promoted|senior|master|shift|employer)\b/i],
  ['social', /\b(gossip|rumor|trust|promised|agreed|refused|disagreed|club|gathering|party)\b/i],
];

export function extractMemoryTags(description: string, source?: string): string[] {
  const tags = new Set<string>();
  if (source) tags.add(source);
  for (const [tag, rx] of DOMAIN_TAG_PATTERNS) {
    if (rx.test(description)) tags.add(tag);
  }
  return Array.from(tags).slice(0, 6);
}

/**
 * A-MEM Associative Linking: links a new memory node to up to `maxLinks` semantically
 * related prior memories via keyword + tag overlap, enabling 1-hop associative retrieval.
 */
export function attachAssociativeLinks(
  newNode: MemoryNode,
  existingMemories: readonly MemoryNode[],
  maxLinks = 3,
): { linkedNode: MemoryNode; updatedExisting: MemoryNode[] } {
  const tags =
    newNode.tags && newNode.tags.length > 0
      ? newNode.tags
      : extractMemoryTags(newNode.description, newNode.source);
  const newTokens = new Set([...newNode.keywords, ...tags]);

  const candidates: Array<{ id: string; score: number }> = [];
  const scanLimit = Math.min(existingMemories.length, 60);
  for (let i = 0; i < scanLimit; i++) {
    const prev = existingMemories[i];
    if (prev.id === newNode.id) continue;
    let overlap = 0;
    for (const kw of prev.keywords) {
      if (newTokens.has(kw)) overlap += 1;
    }
    for (const t of prev.tags ?? []) {
      if (newTokens.has(t)) overlap += 0.75;
    }
    if (overlap >= 2) {
      candidates.push({ id: prev.id, score: overlap + prev.importance * 0.08 });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const pickedIds = candidates.slice(0, maxLinks).map((c) => c.id);
  const pickedSet = new Set(pickedIds);

  const linkedNode: MemoryNode = {
    ...newNode,
    tags,
    linkedMemoryIds: pickedIds.length > 0 ? pickedIds : newNode.linkedMemoryIds,
  };

  if (pickedSet.size === 0) {
    return { linkedNode, updatedExisting: existingMemories as MemoryNode[] };
  }

  const updatedExisting = existingMemories.map((m) => {
    if (!pickedSet.has(m.id)) return m;
    const prevLinks = m.linkedMemoryIds ?? [];
    if (prevLinks.includes(newNode.id)) return m;
    return {
      ...m,
      linkedMemoryIds: [newNode.id, ...prevLinks].slice(0, 5),
    };
  });

  return { linkedNode, updatedExisting };
}

/**
 * Expands top retrieved memories by 1 associative hop through `linkedMemoryIds`
 * so causal precursors (e.g., an earlier promise or loan) accompany the latest event.
 */
export function expandAssociativeRetrieval(
  retrieved: RetrievedMemory[],
  allMemories: readonly MemoryNode[],
  extraCap = 3,
): RetrievedMemory[] {
  if (retrieved.length === 0 || extraCap <= 0) return retrieved;
  const presentIds = new Set(retrieved.map((r) => r.node.id));
  const byId = new Map(allMemories.map((m) => [m.id, m]));
  const extras: RetrievedMemory[] = [];

  for (const item of retrieved) {
    for (const linkId of item.node.linkedMemoryIds ?? []) {
      if (extras.length >= extraCap) break;
      if (presentIds.has(linkId)) continue;
      const target = byId.get(linkId);
      if (!target) continue;
      presentIds.add(linkId);
      extras.push({
        node: target,
        score: item.score * 0.82,
        recencyScore: item.recencyScore,
        importanceScore: target.importance / 10,
        relevanceScore: item.relevanceScore * 0.85,
        usedEmbedding: item.usedEmbedding,
      });
    }
    if (extras.length >= extraCap) break;
  }

  return extras.length > 0 ? [...retrieved, ...extras] : retrieved;
}

/**
 * Bi-Temporal Belief Graph Upsert & Contradiction Revision (Graphiti-inspired):
 * Supersedes any active belief matching (subjectId, predicate) when a new claim arrives,
 * stamping `invalidatedAtSimMin` and `supersededById` instead of silently letting contradictions coexist.
 */
export function upsertBelief(
  beliefs: readonly BeliefNode[] | undefined,
  params: {
    subjectId: string;
    predicate: BeliefPredicate;
    claim: string;
    confidence?: number;
    sourceMemoryId?: string;
    provenance?: BeliefProvenance;
    sourceAgentId?: string;
    hopCount?: number;
    groundTruthStatus?: GroundTruthStatus;
  },
  simMinutes: number,
  allocId: (prefix: string) => string,
  maxBeliefs = 48,
): { beliefs: BeliefNode[]; revised: boolean; beliefId: string } {
  const existing = beliefs ? [...beliefs] : [];
  const normalizedClaim = params.claim.trim();
  const confidence = Number(clamp(params.confidence ?? 0.72, 0.1, 1).toFixed(2));

  // If an identical active belief already exists, reinforce its confidence without duplicating
  const duplicateIdx = existing.findIndex(
    (b) =>
      b.invalidatedAtSimMin === undefined &&
      b.subjectId === params.subjectId &&
      b.predicate === params.predicate &&
      b.claim.toLowerCase() === normalizedClaim.toLowerCase(),
  );
  if (duplicateIdx >= 0) {
    const prev = existing[duplicateIdx];
    existing[duplicateIdx] = {
      ...prev,
      confidence: Number(clamp(Math.max(prev.confidence, confidence) + 0.05, 0.1, 1).toFixed(2)),
      sourceMemoryId: params.sourceMemoryId ?? prev.sourceMemoryId,
      ...(params.provenance ? { provenance: params.provenance } : {}),
      ...(params.sourceAgentId ? { sourceAgentId: params.sourceAgentId } : {}),
      ...(params.hopCount !== undefined ? { hopCount: params.hopCount } : {}),
      ...(params.groundTruthStatus ? { groundTruthStatus: params.groundTruthStatus } : {}),
    };
    return { beliefs: existing, revised: false, beliefId: prev.id };
  }

  const newId = allocId('bel');
  let revised = false;

  const updated = existing.map((b) => {
    if (
      b.invalidatedAtSimMin === undefined &&
      b.subjectId === params.subjectId &&
      b.predicate === params.predicate
    ) {
      revised = true;
      return {
        ...b,
        invalidatedAtSimMin: simMinutes,
        supersededById: newId,
      };
    }
    return b;
  });

  const created: BeliefNode = {
    id: newId,
    subjectId: params.subjectId,
    predicate: params.predicate,
    claim: normalizedClaim,
    confidence,
    validFromSimMin: simMinutes,
    sourceMemoryId: params.sourceMemoryId,
    ...(params.provenance ? { provenance: params.provenance } : {}),
    ...(params.sourceAgentId ? { sourceAgentId: params.sourceAgentId } : {}),
    ...(params.hopCount !== undefined ? { hopCount: params.hopCount } : {}),
    ...(params.groundTruthStatus ? { groundTruthStatus: params.groundTruthStatus } : {}),
  };

  // Retain all active beliefs + most recent superseded history within cap
  const combined = [created, ...updated];
  if (combined.length > maxBeliefs) {
    const active = combined.filter((b) => b.invalidatedAtSimMin === undefined);
    const superseded = combined
      .filter((b) => b.invalidatedAtSimMin !== undefined)
      .sort((a, b) => (b.invalidatedAtSimMin ?? 0) - (a.invalidatedAtSimMin ?? 0));
    const room = Math.max(8, maxBeliefs - active.length);
    return {
      beliefs: [...active, ...superseded.slice(0, room)],
      revised,
      beliefId: newId,
    };
  }

  return { beliefs: combined, revised, beliefId: newId };
}

/**
 * Trust-Gated Receptivity (anti-sycophancy safeguard):
 * A stubborn resident hearing a claim from a low-trust speaker resists adopting it
 * instead of blindly echoing the speaker's framing.
 */
export function applyTrustGatedBeliefUpdate(
  agent: AgentState,
  speakerId: string,
  params: {
    subjectId: string;
    predicate: BeliefPredicate;
    claim: string;
    confidence?: number;
    sourceMemoryId?: string;
    provenance?: BeliefProvenance;
    sourceAgentId?: string;
    hopCount?: number;
    groundTruthStatus?: GroundTruthStatus;
  },
  simMinutes: number,
  allocId: (prefix: string) => string,
): { agent: AgentState; accepted: boolean; revised: boolean } {
  const edge = agent.socialGraph[speakerId];
  const trust = edge?.trust ?? 40;
  const stubbornness = agent.temperament?.stubbornness ?? 0.55;

  // Reject unverified claims from low-trust peers when stubbornness is moderate/high
  if (speakerId !== agent.id && trust < 25 && stubbornness >= 0.5) {
    return { agent, accepted: false, revised: false };
  }

  const trustWeight = speakerId === agent.id ? 1 : clamp((trust + 100) / 200, 0.25, 1);
  const adjustedConfidence = (params.confidence ?? 0.72) * (0.65 + 0.35 * trustWeight);

  const res = upsertBelief(
    agent.beliefs,
    {
      ...params,
      confidence: adjustedConfidence,
      provenance: params.provenance ?? (speakerId === agent.id ? 'firsthand' : 'hearsay'),
      sourceAgentId: params.sourceAgentId ?? speakerId,
      hopCount: params.hopCount ?? (speakerId === agent.id ? 0 : 1),
    },
    simMinutes,
    allocId,
  );
  return {
    agent: { ...agent, beliefs: res.beliefs },
    accepted: true,
    revised: res.revised,
  };
}

export function getActiveBeliefs(
  beliefs: readonly BeliefNode[] | undefined,
  focusSubjectIds?: readonly string[],
  limit = 8,
): BeliefNode[] {
  if (!beliefs || beliefs.length === 0) return [];
  const focusSet = focusSubjectIds ? new Set(focusSubjectIds) : null;
  const active = beliefs.filter((b) => b.invalidatedAtSimMin === undefined);
  active.sort((a, b) => {
    const aFocus = focusSet?.has(a.subjectId) ? 1 : 0;
    const bFocus = focusSet?.has(b.subjectId) ? 1 : 0;
    if (aFocus !== bFocus) return bFocus - aFocus;
    return b.validFromSimMin - a.validFromSimMin || b.confidence - a.confidence;
  });
  return active.slice(0, limit);
}

/**
 * Seeds initial bi-temporal beliefs for a resident from their dossier, employment, and top social ties.
 */
export function createInitialBeliefsForAgent(
  agent: AgentState,
  allAgents: readonly AgentState[],
  simMinutes: number,
  allocId: (prefix: string) => string,
): BeliefNode[] {
  let beliefs: BeliefNode[] = [];
  const dossier = agent.dossier ?? buildDossierAndTemperamentForAgent(agent).dossier;
  const agentNameById = new Map(allAgents.map((a) => [a.id, a.name]));

  // 1. Personal civic stance belief
  const stanceLabel: Record<CivicWorldview, string> = {
    fiscal_conservative: 'Town spending must stay frugal and taxes kept low.',
    communitarian: 'Public commons, clinic subsidies, and neighborhood solidarity come first.',
    pragmatist: 'Policies should be judged by measurable local results rather than ideology.',
    reformist: 'Smallville needs bold civic reform, transparency, and fair opportunity.',
  };
  beliefs = upsertBelief(
    beliefs,
    {
      subjectId: 'town_policy',
      predicate: 'policy_stance',
      claim: stanceLabel[dossier.civicWorldview],
      confidence: 0.85,
      sourceMemoryId: agent.memories[0]?.id,
    },
    simMinutes,
    allocId,
  ).beliefs;

  // 2. Self solvency / work belief
  beliefs = upsertBelief(
    beliefs,
    {
      subjectId: agent.id,
      predicate: 'solvency',
      claim:
        (agent.wallet ?? 120) >= 180
          ? `Financially steady ($${Math.round(agent.wallet ?? 120)}) as ${agent.occupation}.`
          : `Watching household budget carefully ($${Math.round(agent.wallet ?? 120)}) as ${agent.occupation}.`,
      confidence: 0.9,
      sourceMemoryId: agent.memories[0]?.id,
    },
    simMinutes,
    allocId,
  ).beliefs;

  // 3. Top 2 social trustworthiness beliefs
  const topPeers = Object.values(agent.socialGraph)
    .sort((a, b) => b.familiarity - a.familiarity)
    .slice(0, 2);
  for (const edge of topPeers) {
    const targetName = agentNameById.get(edge.targetId) ?? edge.targetId;
    const trustDesc =
      edge.trust >= 70
        ? `${targetName} is dependable and trustworthy (${edge.roleLabel}).`
        : edge.trust >= 45
          ? `${targetName} is a familiar acquaintance (${edge.roleLabel}), still proving reliability.`
          : `${targetName} should be approached cautiously (${edge.roleLabel}).`;
    beliefs = upsertBelief(
      beliefs,
      {
        subjectId: edge.targetId,
        predicate: 'trustworthiness',
        claim: trustDesc,
        confidence: Number(clamp(0.55 + edge.familiarity / 220, 0.55, 0.95).toFixed(2)),
        sourceMemoryId: agent.memories[0]?.id,
      },
      simMinutes,
      allocId,
    ).beliefs;
  }

  return beliefs;
}

/**
 * Hydrates Phase F biographical dossiers, temperaments, decoding profiles,
 * associative memory tags, and initial bi-temporal beliefs across all residents.
 */
export function hydrateCognitiveDepth(
  agents: AgentState[],
  simMinutes: number,
  allocId: (prefix: string) => string,
): AgentState[] {
  return agents.map((ag) => {
    const built =
      !ag.dossier || !ag.temperament ? buildDossierAndTemperamentForAgent(ag) : null;
    const dossier = ag.dossier ?? built!.dossier;
    const temperament = ag.temperament ?? built!.temperament;

    const taggedMemories = ag.memories.map((m) =>
      m.tags && m.tags.length > 0
        ? m
        : {
            ...m,
            keywords: m.keywords.length > 0 ? m.keywords : extractKeywords(m.description),
            tags: extractMemoryTags(m.description, m.source),
          },
    );

    const withBase: AgentState = {
      ...ag,
      dossier,
      temperament,
      memories: taggedMemories,
    };

    const beliefs =
      Array.isArray(ag.beliefs) && ag.beliefs.length > 0
        ? ag.beliefs
        : createInitialBeliefsForAgent(withBase, agents, simMinutes, allocId);

    return {
      ...withBase,
      beliefs,
    };
  });
}
