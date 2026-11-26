export type MemoryType = 'observation' | 'reflection' | 'plan' | 'consolidated';

export const DEFAULT_MEMORY_CAP = 300;

export type MemorySource =
  | 'seed'
  | 'perception'
  | 'conversation'
  | 'reflection'
  | 'broadcast'
  | 'summary'
  | 'plan'
  | 'reaction'
  | 'economy'
  | 'notice'
  | 'civic'
  | 'gossip'
  | 'overheard'
  | 'decision'
  | 'health'
  | 'election'
  | 'club'
  | 'belief'
  | 'contract'
  | 'housing'
  | 'venture'
  | 'career'
  | 'letter'
  | 'dispute'
  | 'coalition'
  | 'rumor'
  | 'norm'
  | 'genesis';

export interface MemoryNode {
  id: string;
  createdAt: number; // simulated minutes since Day 1 00:00
  lastAccessed: number;
  type: MemoryType;
  source?: MemorySource;
  description: string;
  importance: number; // 1..10 poignancy score
  keywords: string[];
  evidenceIds?: string[]; // cited source memories for reflections/consolidations
  embedding?: number[]; // optional dense semantic vector
  timesCited?: number;
  pinnedFixedBlockId?: string;
  // Phase F: A-MEM associative Zettelkasten links & semantic domain tags
  tags?: string[];
  linkedMemoryIds?: string[];
}

export interface RetrievedMemory {
  node: MemoryNode;
  score: number;
  recencyScore: number;
  importanceScore: number;
  relevanceScore: number;
  usedEmbedding: boolean;
}

export interface RetrievalWeights {
  recency: number;
  importance: number;
  relevance: number;
  decayFactor: number;
}

export interface AgentDrives {
  energy: number; // 0..100 (circadian + sleep)
  hunger: number; // 0..100 (meals & coffee)
  social: number; // 0..100 (meaningful connection)
  purpose: number; // 0..100 (autonomy & craft)
}

export interface MoodState {
  valence: number; // -1.0 (distressed) .. +1.0 (joyful)
  arousal: number; // 0.0 (calm/drowsy) .. 1.0 (energized/agitated)
  label: string;
}

export interface SocialEdge {
  targetId: string;
  roleLabel: string;
  trust: number; // -100..+100
  affection: number; // -100..+100
  familiarity: number; // 0..100
  inferredGoal: string; // Theory of Mind: what I believe this person wants/feels right now
  lastUpdatedSimMin: number;
}

export type ItemKind =
  | 'coffee'
  | 'pastry'
  | 'bread'
  | 'meal'
  | 'groceries'
  | 'produce'
  | 'medicine'
  | 'craft_goods'
  | 'book'
  | 'flowers'
  | 'drink';

export interface BusinessStockEntry {
  quantity: number;
  price: number;
  maxStock: number;
  wholesaleCost: number;
}

export interface BusinessState {
  locationId: string;
  name: string;
  category: LocationCategory;
  ownerId: string;
  employeeIds: string[];
  openHour: number; // 0..23
  closeHour: number; // 1..24
  openOnWeekends: boolean;
  treasury: number;
  dailyRevenue: number;
  dailyExpenses: number;
  wagePerHour: number;
  stock: Partial<Record<ItemKind, BusinessStockEntry>>;
  produces?: ItemKind[];
  supplierLocationId?: string;
  lastRestockSimMin?: number;
}

export interface EconomicTransaction {
  id: string;
  simMinutes: number;
  kind:
    | 'purchase'
    | 'wage'
    | 'restock'
    | 'upkeep'
    | 'transfer'
    | 'tax'
    | 'civic_grant'
    | 'loan'
    | 'repayment'
    | 'rent'
    | 'venture_sale';
  fromId: string; // agentId, business locationId, or 'town_treasury'
  toId: string;
  amount: number;
  itemKind?: ItemKind;
  quantity?: number;
  note: string;
}

export interface AgentProject {
  id: string;
  title: string;
  category: 'craft' | 'civic' | 'research' | 'business' | 'creative';
  progress: number; // 0..100
  targetLocationId: string;
  collaboratorIds: string[];
  status: 'active' | 'completed' | 'abandoned';
  startedAtSimMin: number;
  completedAtSimMin?: number;
}

export type NoticeCategory = 'news' | 'market' | 'civic' | 'event' | 'job';

export interface NoticeItem {
  id: string;
  authorId: string; // agentId or 'citizen_observer'
  authorName: string;
  category: NoticeCategory;
  title: string;
  body: string;
  locationId: string;
  createdAt: number;
  readByAgentIds: string[];
  memeId?: string;
}

export type TownModifierKey =
  | 'streetLighting'
  | 'marketStipend'
  | 'extendedLibrary'
  | 'communityClinic';

export interface TownModifiers {
  streetLighting: boolean;
  marketStipend: boolean;
  extendedLibrary: boolean;
  communityClinic: boolean;
}

export interface CivicProposal {
  id: string;
  title: string;
  description: string;
  proposerId: string;
  proposerName: string;
  cost: number;
  effectKey: TownModifierKey;
  votesFor: string[];
  votesAgainst: string[];
  status: 'open' | 'passed' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
}

export type AgentTier = 'focal' | 'active' | 'ambient';

export type IllnessKind = 'none' | 'mild_cold' | 'fatigued';

export interface JobPosting {
  id: string;
  locationId: string;
  businessName: string;
  roleTitle: string;
  wagePerHour: number;
  createdAt: number;
  status: 'open' | 'filled' | 'closed';
  hiredAgentId?: string;
}

export interface SocialClub {
  id: string;
  name: string;
  category: 'civic' | 'arts' | 'commerce' | 'garden';
  locationId: string;
  meetingWeekday: number; // 0=Mon..6=Sun
  meetingHour: number;
  memberIds: string[];
  description: string;
}

export interface ElectionCandidate {
  agentId: string;
  name: string;
  platform: string;
  votes: number;
}

export interface TownElection {
  cycleNumber: number;
  status: 'campaigning' | 'voting' | 'completed';
  electionDay: number;
  candidates: ElectionCandidate[];
  votersCast: string[];
  winnerId?: string;
  winnerName?: string;
}

export interface TownLeadership {
  mayorId: string | null;
  mayorName: string | null;
  electedDay: number;
  termEndsDay: number;
  taxRatePct: number;
  approvalRating: number; // 0..100
}

export interface MacroEconomySnapshot {
  day: number;
  simMinutes: number;
  tradeVolume: number;
  avgWealth: number;
  giniIndex: number; // 0..1
  employmentRatePct: number; // 0..100
  priceIndex: number; // 1.00 = baseline
  townTreasury: number;
  populationCount: number;
  sickCount: number;
}

export interface GossipUpdate {
  speakerId: string;
  listenerId: string;
  aboutAgentId: string;
  deltaTrust: number;
  deltaAffection: number;
  claim: string;
}

export type FinancialPosture = 'frugal' | 'balanced' | 'spender' | 'anxious';

export type CivicWorldview =
  | 'fiscal_conservative'
  | 'communitarian'
  | 'pragmatist'
  | 'reformist';

export interface DecodingProfile {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
}

export interface AgentTemperament {
  stubbornness: number; // 0..1 (higher resists RLHF consensus / persuasion)
  riskTolerance: number; // 0..1
  ambition: number; // 0..1
  decoding: DecodingProfile;
}

export interface AgentDossier {
  background: string;
  formativeEvents: string[];
  financialPosture: FinancialPosture;
  civicWorldview: CivicWorldview;
  speechStyle: string;
  privateAgenda: string;
  redLines: string[];
}

export type BeliefPredicate =
  | 'trustworthiness'
  | 'solvency'
  | 'job_status'
  | 'policy_stance'
  | 'obligation'
  | 'reputation'
  | 'world_fact';

export type BeliefProvenance =
  | 'firsthand'
  | 'hearsay'
  | 'rumor'
  | 'public_record'
  | 'deception';

export type GroundTruthStatus = 'verified' | 'false' | 'unverifiable';

export interface BeliefNode {
  id: string;
  subjectId: string;
  predicate: BeliefPredicate;
  claim: string;
  confidence: number; // 0..1
  validFromSimMin: number;
  invalidatedAtSimMin?: number;
  supersededById?: string;
  sourceMemoryId?: string;
  provenance?: BeliefProvenance;
  sourceAgentId?: string;
  hopCount?: number;
  groundTruthStatus?: GroundTruthStatus;
}

export interface LoanContract {
  id: string;
  lenderId: string;
  borrowerId: string;
  principal: number;
  interestPct: number;
  amountDue: number;
  issuedDay: number;
  dueDay: number;
  status: 'active' | 'repaid' | 'defaulted';
  resolvedDay?: number;
}

export interface CitizenPetition {
  id: string;
  title: string;
  description: string;
  effectKey: TownModifierKey;
  sponsorId: string;
  sponsorName: string;
  signerIds: string[];
  targetSignatures: number;
  status: 'gathering' | 'escalated' | 'expired';
  createdAt: number;
  escalatedProposalId?: string;
}

export interface MicroVenture {
  id: string;
  founderId: string;
  founderName: string;
  name: string;
  locationId: string;
  itemKind: ItemKind;
  unitPrice: number;
  stock: number;
  revenue: number;
  openedDay: number;
  active: boolean;
}

export type HousingStatus = 'owner' | 'renter' | 'shared';

export type CareerTier = 'apprentice' | 'practitioner' | 'senior' | 'master';

export type CollapseRiskLevel = 'healthy' | 'narrowing' | 'collapse_risk';

export interface DiversitySnapshot {
  day: number;
  simMinutes: number;
  lexicalDiversity: number; // 0..1 Distinct-2 bigram ratio
  moodStdDev: number; // 0..1 PAD valence spread
  trustPolarization: number; // 0..1 asymmetric trust spread
  refusalDisagreementRate: number; // 0..1
  activeContractsCount: number;
  loanDefaultRate: number; // 0..1
  householdMobilityEvents: number;
  beliefRevisionCount: number;
  collapseRiskLevel: CollapseRiskLevel;
  falseBeliefRate?: number; // 0..1
  activeRumorsCount?: number;
  normCohesionAvg?: number; // 0..100
}

export interface ExtractedBeliefUpdate {
  subjectId: string;
  predicate: BeliefPredicate;
  claim: string;
  confidence?: number;
  speakerId?: string;
}

export interface NegotiatedDeal {
  kind: 'loan' | 'transfer' | 'petition_support' | 'service_contract' | 'coalition_invite' | 'refusal';
  proposerId: string;
  responderId: string;
  accepted: boolean;
  amount?: number;
  petitionId?: string;
  contractKind?: ServiceContractKind;
  coalitionId?: string;
  note: string;
}

export type ServiceContractKind = 'supply_delivery' | 'labor_pact' | 'patronage' | 'political_pact';

export interface ServiceContract {
  id: string;
  kind: ServiceContractKind;
  proposerId: string;
  counterpartyId: string;
  terms: string;
  escrowHeld: number;
  agreedAmount: number;
  createdDay: number;
  dueDay: number;
  status: 'active' | 'fulfilled' | 'breached' | 'disputed';
  locationId?: string;
  itemKind?: ItemKind;
  resolvedDay?: number;
}

export type DisputeCategory = 'loan_default' | 'contract_breach' | 'unfair_layoff' | 'reputation_harm';

export interface CivicDispute {
  id: string;
  claimantId: string;
  claimantName: string;
  respondentId: string;
  respondentName: string;
  category: DisputeCategory;
  claimSummary: string;
  claimedAmount: number;
  filedDay: number;
  status: 'open' | 'upheld' | 'dismissed' | 'settled';
  arbiterId?: string;
  arbiterName?: string;
  rulingNote?: string;
  restitutionAwarded?: number;
  resolvedDay?: number;
  relatedLoanId?: string;
  relatedContractId?: string;
}

export type CoalitionAgenda =
  | 'fiscal_restraint'
  | 'public_welfare'
  | 'merchant_guild'
  | 'labor_rights'
  | 'civic_reform';

export interface CivicCoalition {
  id: string;
  name: string;
  agenda: CoalitionAgenda;
  founderId: string;
  leaderId: string;
  memberIds: string[];
  createdDay: number;
  cohesion: number;
  targetPolicyKey?: TownModifierKey;
  active: boolean;
}

export interface EconomicBoycott {
  id: string;
  organizerId: string;
  organizerName: string;
  targetLocationId: string;
  targetBusinessName: string;
  reason: string;
  supporterIds: string[];
  startedDay: number;
  expiresDay: number;
  active: boolean;
}

export type TownShockKind = 'supply_shortage' | 'cold_snap' | 'harvest_surplus' | 'festival_boom';

export interface TownShock {
  id: string;
  kind: TownShockKind;
  title: string;
  description: string;
  startedDay: number;
  endsDay: number;
  severity: number;
  active: boolean;
  affectedLocationIds?: string[];
}

export type RumorVeracity = 'true' | 'distorted' | 'false';

export interface TownRumor {
  id: string;
  originAgentId: string;
  originName: string;
  subjectAgentId?: string;
  subjectLocationId?: string;
  originalClaim: string;
  currentClaim: string;
  isDeceptive: boolean;
  veracity: RumorVeracity;
  hopCount: number;
  createdAt: number;
  believerIds: string[];
  skepticIds: string[];
  debunked: boolean;
  debunkedByAgentId?: string;
  debunkedAt?: number;
  lastMutatedAt?: number;
}

export type CulturalNormKey =
  | 'debt_honor'
  | 'fair_pricing'
  | 'mutual_aid'
  | 'civic_duty'
  | 'truthfulness';

export interface CulturalNorm {
  id: string;
  key: CulturalNormKey;
  title: string;
  description: string;
  strength: number; // 0..100
  complianceRate: number; // 0..1
  violationsCount: number;
  endorsementsCount: number;
  championIds: string[];
  lastUpdatedDay: number;
}

export type GenesisMode = 'structured_polis' | 'open_genesis';

export interface EmergentOrganization {
  id: string;
  name: string;
  charter: string;
  founderId: string;
  leaderId: string;
  memberRoles: Record<string, string>;
  treasury: number;
  duesAmount: number;
  rules: string[];
  headquartersLocationId?: string;
  createdDay: number;
  active: boolean;
}

export interface EmergentNorm {
  id: string;
  statement: string;
  originAgentId: string;
  originName: string;
  adopterIds: string[];
  challengerIds: string[];
  strength: number; // 0..100
  sanctionsCount: number;
  createdDay: number;
  active: boolean;
}

export interface CustomAsset {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  ownerId: string;
  unitValue: number;
  quantity: number;
  organizationId?: string;
  createdDay: number;
}

export type AtomicWorldOp =
  | { op: 'transfer_cash'; fromId: string; toId: string; amount: number; note: string }
  | {
      op: 'create_org';
      name: string;
      charter: string;
      roleTitle?: string;
      initialContribution?: number;
      duesAmount?: number;
      headquartersLocationId?: string;
      rule?: string;
    }
  | { op: 'join_org'; orgId: string; roleTitle?: string; contribution?: number }
  | { op: 'org_contribute'; orgId: string; amount: number; note?: string }
  | { op: 'org_payout'; orgId: string; toAgentId: string; amount: number; reason: string }
  | { op: 'propose_norm'; statement: string }
  | { op: 'adopt_or_challenge_norm'; normId: string; adopt: boolean }
  | { op: 'sanction_norm'; normId: string; targetAgentId: string; reason: string }
  | {
      op: 'create_asset';
      name: string;
      description: string;
      unitValue: number;
      quantity?: number;
      organizationId?: string;
    }
  | { op: 'trade_asset'; assetId: string; buyerId: string; price: number }
  | { op: 'publish_record'; title: string; body: string; locationId?: string }
  | {
      op: 'shift_relation';
      targetAgentId: string;
      deltaTrust: number;
      deltaAffection: number;
      reason: string;
    };

export interface ArbitratedActionRecord {
  id: string;
  simMinutes: number;
  actorId: string;
  actorName: string;
  intent: string;
  narrative: string;
  appliedOpsCount: number;
  rejectedOpsCount: number;
  summaries: string[];
}

export type WorldActionKind =
  | 'work_shift'
  | 'buy_item'
  | 'consume_item'
  | 'advance_project'
  | 'post_notice'
  | 'vote_proposal'
  | 'transfer_money'
  | 'socialize'
  | 'rest'
  | 'adjust_goal'
  | 'propose_loan'
  | 'launch_venture'
  | 'sign_petition'
  | 'start_petition'
  | 'declare_candidacy'
  | 'vote_election'
  | 'seek_person'
  | 'avoid_person'
  | 'send_letter'
  | 'propose_contract'
  | 'file_dispute'
  | 'form_coalition'
  | 'join_coalition'
  | 'call_boycott'
  | 'spread_rumor'
  | 'fact_check'
  | 'endorse_norm'
  | 'open_action';

export type AutonomyMode = 'intent_driven' | 'legacy_schedule';

export interface AgentAmbition {
  id: string;
  title: string;
  domain: 'economic' | 'social' | 'civic' | 'craft' | 'personal';
  priority: number; // 0..1
  progress: number; // 0..100
  createdAt: number;
  status: 'active' | 'achieved' | 'abandoned';
  targetAgentId?: string;
  targetLocationId?: string;
}

export interface AgentCommitment {
  id: string;
  title: string;
  withAgentId?: string;
  locationId: string;
  dueDay: number;
  dueMinute: number;
  urgency: number; // 0..1
  status: 'pending' | 'fulfilled' | 'missed';
  source: 'conversation' | 'letter' | 'civic' | 'self';
}

export interface ActiveSocialTarget {
  mode: 'seek' | 'avoid';
  targetAgentId: string;
  reason: string;
  expiresAtSimMin: number;
  lastRetargetSimMin?: number;
}

export interface AgentIntentStack {
  ambitions: AgentAmbition[];
  commitments: AgentCommitment[];
  lastExecutiveDecisionSimMin?: number;
  lastCompletedBlockId?: string;
}

export interface PrivateLetter {
  id: string;
  fromAgentId: string;
  fromName: string;
  toAgentId: string;
  toName: string;
  subject: string;
  body: string;
  sentAt: number;
  deliveredAt: number;
  readAt?: number;
  replyToLetterId?: string;
}

export interface BdiDecisionResult {
  action: WorldActionKind;
  reason: string;
  locationId?: string;
  objectId?: string;
  activity?: string;
  emoji?: string;
  durationMinutes?: number;
  itemKind?: ItemKind;
  targetAgentId?: string;
  proposalId?: string;
  voteSupport?: boolean;
  noticeTitle?: string;
  noticeBody?: string;
  noticeCategory?: NoticeCategory;
  newGoal?: string;
  loanAmount?: number;
  transferAmount?: number;
  ventureName?: string;
  petitionId?: string;
  petitionTitle?: string;
  petitionDescription?: string;
  petitionEffect?: TownModifierKey;
  platform?: string;
  candidateId?: string;
  letterSubject?: string;
  letterBody?: string;
  ambitionTitle?: string;
  contractKind?: ServiceContractKind;
  contractTerms?: string;
  contractAmount?: number;
  disputeCategory?: DisputeCategory;
  disputeClaim?: string;
  disputeAmount?: number;
  coalitionId?: string;
  coalitionName?: string;
  coalitionAgenda?: CoalitionAgenda;
  boycottLocationId?: string;
  boycottReason?: string;
  rumorId?: string;
  rumorClaim?: string;
  isDeceptive?: boolean;
  normKey?: CulturalNormKey;
  openIntent?: string;
  openOps?: AtomicWorldOp[];
}

export type ScheduleSource =
  | 'seed'
  | 'drive_interrupt'
  | 'social_commitment'
  | 'morning_plan'
  | 'llm_replan'
  | 'bdi_decision';

export type ScheduleBlockKind =
  | 'sleep'
  | 'meal'
  | 'work'
  | 'social'
  | 'errand'
  | 'leisure'
  | 'rest'
  | 'travel';

export interface PendingBdiAction {
  action: WorldActionKind;
  targetLocationId: string;
  reason: string;
  itemKind?: ItemKind;
  targetAgentId?: string;
  proposalId?: string;
  voteSupport?: boolean;
  noticeTitle?: string;
  noticeBody?: string;
  noticeCategory?: NoticeCategory;
  loanAmount?: number;
  transferAmount?: number;
  ventureName?: string;
  petitionId?: string;
  petitionTitle?: string;
  petitionDescription?: string;
  petitionEffect?: TownModifierKey;
  platform?: string;
  candidateId?: string;
  letterSubject?: string;
  letterBody?: string;
  ambitionTitle?: string;
  contractKind?: ServiceContractKind;
  contractTerms?: string;
  contractAmount?: number;
  disputeCategory?: DisputeCategory;
  disputeClaim?: string;
  disputeAmount?: number;
  coalitionId?: string;
  coalitionName?: string;
  coalitionAgenda?: CoalitionAgenda;
  boycottLocationId?: string;
  boycottReason?: string;
  rumorId?: string;
  rumorClaim?: string;
  isDeceptive?: boolean;
  normKey?: CulturalNormKey;
  openIntent?: string;
  openOps?: AtomicWorldOp[];
  executed?: boolean;
}

export interface ScheduleBlock {
  id: string;
  day: number;
  kind: ScheduleBlockKind;
  startMinute: number; // 0..1439 within day
  durationMinutes: number;
  locationId: string;
  objectId?: string;
  activity: string;
  subSteps?: string[];
  emoji: string;
  source?: ScheduleSource;
  fixed?: boolean;
  oneOff?: boolean;
  pendingAction?: PendingBdiAction;
}

export interface ScheduleCommitment {
  day?: number | 'today' | 'tomorrow';
  minuteOfDay: number; // COMMITMENT_MIN_MINUTE..COMMITMENT_MAX_MINUTE
  durationMinutes: number;
  locationId: string;
  objectId?: string;
  activity: string;
  emoji?: string;
}

export type WeatherCondition = 'clear' | 'breeze' | 'drizzle';

export type TileKind =
  | 'grass'
  | 'road'
  | 'path'
  | 'water'
  | 'bridge'
  | 'floor_wood'
  | 'floor_tile'
  | 'floor_stone'
  | 'wall'
  | 'door'
  | 'tree'
  | 'flower';

export type LocationCategory =
  | 'home'
  | 'cafe'
  | 'park'
  | 'college'
  | 'civic'
  | 'shop'
  | 'pub';

export interface LocationZone {
  id: string;
  name: string;
  shortName: string;
  district?: 'North Ridge' | 'Main Street' | 'Southside Creek';
  category: LocationCategory;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  roofColor: string;
  accentColor: string;
  description: string;
}

export interface WorldObject {
  id: string;
  name: string;
  locationId: string;
  tileX: number;
  tileY: number;
  kind:
    | 'bed'
    | 'desk'
    | 'stove'
    | 'counter'
    | 'table'
    | 'bookshelf'
    | 'piano'
    | 'bench'
    | 'fountain'
    | 'easel'
    | 'podium'
    | 'bar'
    | 'register'
    | 'oven'
    | 'workbench'
    | 'garden'
    | 'archive'
    | 'medical';
  state: string;
  defaultState: string;
  persistentNote?: string; // Durable consequence left after use
  lastActorName?: string;
  occupiedByAgentId?: string;
  lastUpdatedSimMin?: number;
  emoji: string;
}

export interface AgentAppearance {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  accessory?: 'glasses' | 'hat' | 'apron' | 'scarf' | 'beret';
}

export interface SpeechBubble {
  text: string;
  speakerName: string;
  expiresAtSimMin: number;
}

export interface QueuedSpeechBubble extends SpeechBubble {
  showAtSimMin: number;
}

export interface ActiveStayObservation {
  zoneId: string;
  memoryId: string;
  peerIdsSeen: string[];
  traceKeysSeen: string[];
}

export interface AgentState {
  id: string;
  name: string;
  age: number;
  occupation: string;
  homeLocationId: string;
  traits: string[];
  goals: string[];
  innateSummary: string;
  currently: string;
  appearance: AgentAppearance;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  path: Array<{ x: number; y: number }>;
  facing: 'up' | 'down' | 'left' | 'right';
  currentLocationId: string | null;
  currentAreaLabel?: string;
  currentObjectId?: string;
  currentAction: string;
  currentSubStep?: string;
  actionEmoji: string;
  activeScheduleId?: string;
  speechBubble?: SpeechBubble;
  speechBubbleQueue?: QueuedSpeechBubble[];
  drives: AgentDrives;
  mood: MoodState;
  baselineMood: { valence: number; arousal: number };
  inventory: string[];
  // Phase A+B+C: Real Economic, Skill, Project & Reputation State
  wallet?: number;
  dailyExpenses?: number;
  employerLocationId?: string;
  wagePerHour?: number;
  goods?: Partial<Record<ItemKind, number>>;
  skills?: Record<string, number>;
  projects?: AgentProject[];
  reputation?: number; // -100..+100 community standing
  lastWorkTickSimMin?: number;
  lastUpkeepDay?: number;
  lastDecisionSimMin?: number;
  // Phase D+E: Health, Clubs, Multi-Tier Fidelity & Procedural Scale
  tier?: AgentTier;
  isProcedural?: boolean;
  health?: number; // 0..100
  illness?: IllnessKind;
  lastClinicVisitSimMin?: number;
  clubIds?: string[];
  // Phase F+G+H: Biographical Depth, Bi-Temporal Belief Graph, Housing & Career Mobility
  dossier?: AgentDossier;
  temperament?: AgentTemperament;
  beliefs?: BeliefNode[];
  housingStatus?: HousingStatus;
  monthlyRent?: number;
  householdPartnerIds?: string[];
  careerTier?: CareerTier;
  promotionsCount?: number;
  intentStack?: AgentIntentStack;
  socialTarget?: ActiveSocialTarget;
  memories: MemoryNode[];
  importanceAccumulator: number;
  dailySchedule: ScheduleBlock[];
  relationships: Record<string, string>;
  socialGraph: Record<string, SocialEdge>;
  lastConversedAt: Record<string, number>;
  activeStayObservation?: ActiveStayObservation;
  lastPerceivedSignatureByZone?: Record<string, string>;
  lastDriveInterruptSimMin?: number;
  lastBreakfastScheduledNightDay?: number;
  lastReplannedDay?: number;
  nextRoamSimMin?: number;
  isThinking: boolean;
  inConversationWith?: string;
  conversationStartedAtSim?: number;
}

export interface ConversationTurn {
  speakerId: string;
  speakerName: string;
  text: string;
  privateThought?: string;
}

export interface ConversationAgreement {
  day: number;
  minuteOfDay: number;
  durationMinutes?: number;
  locationId: string;
  locationName?: string;
  objectId?: string;
  activity: string;
}

export interface ConversationRecord {
  id: string;
  simMinutes: number;
  locationId: string;
  locationName: string;
  participantIds: string[];
  participantNames: string[];
  turns: ConversationTurn[];
  summary: string;
  reason?: string;
  endedBy?: string;
  agreement?: ConversationAgreement;
  isGroup?: boolean;
  compressed?: boolean;
  overheardByIds?: string[];
  gossipUpdates?: GossipUpdate[];
}

export type ChronicleEventType =
  | 'conversation'
  | 'reflection'
  | 'consolidation'
  | 'plan'
  | 'reaction'
  | 'world_event'
  | 'whisper'
  | 'interview'
  | 'arrival'
  | 'economy'
  | 'civic'
  | 'notice'
  | 'project';

export interface ChronicleEvent {
  id: string;
  simMinutes: number;
  type: ChronicleEventType;
  title: string;
  detail: string;
  agentIds: string[];
  locationName?: string;
}

export interface MemeReachEntry {
  simMinutes: number;
  heardFromId: string;
  snippet: string;
}

export interface TrackedMeme {
  id: string;
  topic: string;
  keywords: string[];
  originAgentId: string;
  createdAt: number;
  knownBy: Record<string, MemeReachEntry>;
}

export interface SimulationStats {
  system1Greetings: number;
  driveInterrupts: number;
  perceptionEvents: number;
  socialCommitments: number;
  llmCallsSaved: number;
  llmCallsMade?: number;
  tokensUsed?: number;
  inputTokensUsed?: number;
  outputTokensUsed?: number;
  economicTransactions?: number;
  totalTradeVolume?: number;
  noticesRead?: number;
  civicVotesCast?: number;
  overheardEvents?: number;
  gossipUpdatesApplied?: number;
  bdiDecisions?: number;
  compressedScenes?: number;
  jobsFilled?: number;
  clinicTreatments?: number;
  electionsCompleted?: number;
  clubGatherings?: number;
  // Phase F–I: Belief Revision, Contracts, Ventures, Mobility & Anti-Sycophancy Friction
  beliefRevisions?: number;
  loansIssued?: number;
  loansRepaid?: number;
  loansDefaulted?: number;
  venturesLaunched?: number;
  petitionsEscalated?: number;
  housingMoves?: number;
  careerPromotions?: number;
  refusalsAndDisagreements?: number;
  conversationsTotal?: number;
  lettersSent?: number;
  socialSeeksCompleted?: number;
  // Phase 2: Service Contracts, Civic Disputes, Coalitions, Boycotts & Shocks
  serviceContractsCreated?: number;
  serviceContractsFulfilled?: number;
  serviceContractsBreached?: number;
  disputesFiled?: number;
  disputesResolved?: number;
  coalitionsFormed?: number;
  boycottsActive?: number;
  shocksTriggered?: number;
  // Phase 3: Epistemic Reality, Rumors, Deception & Cultural Norms
  rumorsSpread?: number;
  rumorsDebunked?: number;
  deceptionsAttempted?: number;
  deceptionsExposed?: number;
  normEndorsements?: number;
  // Phase 4: Open Genesis Trial (Emergent Organizations, Free-Text Norms, Custom Assets & Open Actions)
  openActionsArbitrated?: number;
  orgsFounded?: number;
  emergentNormsCreated?: number;
  customAssetsTraded?: number;
}

export type ScenarioId = 'default' | 'paper_valentine';

export interface AblationSettings {
  noReflection: boolean;
  noPlanning: boolean;
  noMemoryRetrieval: boolean;
  noSystem2Gate: boolean;
}

export const DEFAULT_ABLATIONS: AblationSettings = {
  noReflection: false,
  noPlanning: false,
  noMemoryRetrieval: false,
  noSystem2Gate: false,
};

export interface PartyPresenceStats {
  minutesAtCafeByAgent: Record<string, number>;
  invitedAgentIds: string[];
  agreedAgentIds: string[];
  plannedAfterNewsAgentIds: string[];
  attendedRawIds: string[];
  attendedDecisionIds: string[];
}

export const WORLD_SCHEMA_VERSION = 6;

export interface WorldState {
  schemaVersion?: number;
  worldName?: string;
  scenarioId?: ScenarioId;
  ablations?: AblationSettings;
  idSeq: number;
  simMinutes: number; // Starts at Day 1 09:00 = 9 * 60 = 540
  day: number;
  weather?: WeatherCondition;
  mapWidth: number;
  mapHeight: number;
  tiles: TileKind[][];
  locations: LocationZone[];
  objects: WorldObject[];
  agents: AgentState[];
  conversations: ConversationRecord[];
  chronicle: ChronicleEvent[];
  memes: TrackedMeme[];
  stats: SimulationStats;
  reflectionThreshold: number;
  reactionsTodayByAgent?: Record<string, number>;
  reactionDay?: number;
  lastReactionSimByAgent?: Record<string, number>;
  partyStats?: PartyPresenceStats;
  // Phase A+B+C: Living Economy, Notice Board, Civic Governance & OpenRouter Compression
  businesses?: Record<string, BusinessState>;
  transactions?: EconomicTransaction[];
  notices?: NoticeItem[];
  proposals?: CivicProposal[];
  townTreasury?: number;
  townModifiers?: TownModifiers;
  compressedConversations?: boolean;
  // Phase D+E: Institutions, Labor Market, Elections, Clubs, Macro Telemetry & Scale
  jobPostings?: JobPosting[];
  clubs?: SocialClub[];
  election?: TownElection;
  leadership?: TownLeadership;
  macroHistory?: MacroEconomySnapshot[];
  scaleTarget?: number;
  // Phase F–I: Bilateral Contracts, Petitions, Ventures & Population Diversity History
  loans?: LoanContract[];
  petitions?: CitizenPetition[];
  ventures?: MicroVenture[];
  diversityHistory?: DiversitySnapshot[];
  letters?: PrivateLetter[];
  autonomyMode?: AutonomyMode;
  // Phase 2: Service Contracts, Disputes, Coalitions, Boycotts & Macro Shocks
  serviceContracts?: ServiceContract[];
  disputes?: CivicDispute[];
  coalitions?: CivicCoalition[];
  boycotts?: EconomicBoycott[];
  activeShocks?: TownShock[];
  // Phase 3: Epistemic Reality, Rumors & Cultural Norms
  rumors?: TownRumor[];
  culturalNorms?: CulturalNorm[];
  // Phase 4: Open Genesis Trial
  genesisMode?: GenesisMode;
  organizations?: EmergentOrganization[];
  emergentNorms?: EmergentNorm[];
  customAssets?: CustomAsset[];
  arbitratedActions?: ArbitratedActionRecord[];
}
