# Research-Driven Evolution Plan: Lifelike Autonomous Society (Phases F–I)

Synthesizes the 2024–2026 multi-agent society research frontier—combining biographical digital-twin depth, bi-temporal belief revision, anti-homogenization safeguards on a single OpenRouter model, ledger-grounded free-form contracts, long-horizon life mobility, and population-level collapse diagnostics—to push Smallville significantly closer to a realistic human society.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The decisions below reflect your preferences from our alignment step and establish the architectural boundaries for implementation. Please review and approve to proceed, or request any revisions before code changes begin.

- **Confirmed Decision 1 — Full Research Synthesis**: Incorporate all five research-backed pillars cohesively rather than picking a single track: (1) biographical dossiers, bi-temporal belief graphs, and anti-sycophancy; (2) emergent bilateral contracts, loans, bargaining, and resident-founded ventures; (3) long-horizon housing, households, and career progression; (4) population diversity & persona-collapse diagnostics; and (5) PIANO-inspired concurrent cognitive orchestration with multi-tier archetype surrogates.
- **Confirmed Decision 2 — Single Free OpenRouter Model Strategy**: Keep all LLM-active residents routed through your single primary free OpenRouter model. To overcome single-model **Persona Collapse** and RLHF consensus drift without requiring multiple paid models, the architecture introduces **per-temperament decoding diversity** (temperature, top-p, and repetition penalties), **deep biographical dossiers**, **explicit stubbornness & private-agenda friction contracts**, and **trust-gated receptivity**.
- **Confirmed Decision 3 — Engine & Persistence Strategy (Recommended Selection)**: Retain the fast, pure-TypeScript deterministic simulation engine in the browser for responsive 60 FPS cartographic inspection and deterministic testability, paired with hardened, versioned **server-side world snapshot synchronization** (schema v6 with lossless migration from v1–v5). This preserves a clean kernel/transport boundary so lifting the same engine onto a persistent multi-town server worker later requires zero rewrite of cognitive or economic logic.

---

## 1. Overview & Core Concept

- **What It Does**: Evolves the town from a causal economic micro-society into a **cognitively diverse, friction-capable, institutionally generative human society** where residents hold evolving beliefs that supersede outdated facts, carry private financial and personal agendas, refuse unfavorable proposals, negotiate real loans and wage raises, launch micro-ventures, form households, move homes, and can be audited quantitatively for behavioral realism vs. LLM persona collapse.
- **Target Audience / Persona**: Simulation builders, observers, and system designers studying emergent human-like autonomy at micro (18 focal residents) and meso (36–100+ mixed-tier residents) scales before expanding to city-scale geographies.
- **Key Value**: Solves the two hardest unsolved problems in LLM societies exposed by 2025–2026 literature: (a) **The Fluency Fallacy & Persona Collapse**, where polite RLHF agents sound clever while drifting into uniform artificial consensus; and (b) **World-Physics Drift vs. Expressive Agency**, by letting agents negotiate free-form social and economic contracts that execute strictly inside a conservation-checked causal ledger.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Deep Resident Mind Inspection (`Town Map` → Resident Inspector)**
   - Selecting any resident opens the right-hand inspector with enriched cognitive transparency across existing tabs without crowding the map canvas:
     - **Plan & Identity**: Displays the resident’s biographical dossier summary (background, core values, financial stance, stubbornness & risk profile), active career tier, housing status (owner, renter, roommate), active contracts/loans, and multi-day projects.
     - **Memory & Beliefs**: Adds a clean segmented switch (`Episodic Stream` | `Belief Graph`) inside the Memory tab. In `Belief Graph`, users inspect active vs. superseded bi-temporal beliefs (showing when a belief became valid, when it was contradicted/superseded, and which memory caused the revision) plus associative links between related memories.
     - **Social & Deals**: Displays asymmetric Theory-of-Mind ties alongside active bilateral contracts (loans owed/lent, coalitions/petitions, household partnerships, and grudges).
2. **Emergent Contracts, Ventures & Life Mobility (`Society` View)**
   - Directly integrates two clean editorial panels into the existing Society dashboard:
     - **Contracts, Credit & Ventures Ledger**: Tracks active/repaid/defaulted peer loans, resident-launched micro-ventures/stalls, and grassroots citizen petitions gathering signatures toward town votes.
     - **Housing, Households & Career Mobility**: Shows district rent levels, recent household formations or relocations, and resident skill promotions.
3. **Population Diversity & Anti-Collapse Monitor (`Society` & `Diagnostics` Views)**
   - Adds a quantitative **Behavioral Realism & Diversity Health** strip directly grounded in 2025–2026 multi-agent critique metrics:
     - **Lexical Diversity (Distinct-2)** across recent conversations (detects repetitive phrasing).
     - **Opinion & Mood Variance** across residents (detects premature RLHF consensus).
     - **Disagreement & Refusal Rate** in dialogues and negotiations (verifies healthy human friction).
     - **Contract Fulfillment Rate** & **Social Mobility** across multi-day runs.
   - Displays clear dual-coded text states (`Healthy Spread`, `Narrowing Variance`, `Consensus Risk`)—never hue-only signals—and allows running multi-day headless collapse benchmarks inside the Diagnostics runner.
4. **Server Snapshot Sync Control (`Diagnostics` / Toolbar Utility)**
   - Non-intrusive sync action to push or pull versioned world snapshots to/from the local server store alongside existing JSON import/export and automatic IndexedDB persistence.

### Visual Identity & Theme

- **Aesthetic Direction**: Preserves the established **warm editorial cartography** identity—light parchment canvas (`#F6F4EE`), crisp white structural surfaces (`#FFFFFF`), muted warm hairline borders (`#E2DFD5` / `#E5E2D9`), and botanical forest-green primary focal accents (`#2D6A4F`) with warm amber (`#B45309`) and muted crimson (`#B91C1C`) reserved strictly for financial/health/collapse warnings paired with explicit text labels.
- **60-30-10 Color Discipline**: 60% neutral parchment & map canvas, 30% quiet structural panels and hairline dividers, 10% forest-green active controls and primary actions.
- **Typography & Hierarchy**: Retains the existing display serif + clean body sans + `IBM Plex Mono` (`tabular-nums`) data pairing (strictly honoring the 2+1 font rule and never reverting to generic defaults). All financial figures, Gini indices, variance scores, interest rates, and timestamps align vertically via tabular numerals.
- **Anti-Slop & Layout Rules**:
  - Zero static pill badges: statuses, housing tenure, contract states, and belief validity windows render as clean unboxed inline text separated by typographic middots (`·`).
  - No thick left accent bars, no decorative pulsing dots, no fake cockpit scores, and no nested cards-within-cards—use whitespace and `1px` hairlines.
  - All interactive buttons and segmented tabs stay single-line (`whitespace-nowrap shrink-0`) with plain human language labels (`Call Election`, `Sync Snapshot`, `Belief Graph`, `Episodic Stream`).
  - Full `1440×900` desktop balance: two-zone Town Map sandbox (left 65–70% map stage + right 420px inspector) remains untouched in spatial proportion.

### Interactive Feedback & Motion

- Sub-200ms settling transitions (`transform` / `opacity` only) on tab switches (`Episodic Stream` ↔ `Belief Graph`), contract filters, and diagnostics charts.
- Explicit loading, empty, and error states for server snapshot sync and multi-day collapse diagnostics; optimistic instant rendering on deterministic world actions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Breaking Persona Collapse on a Single Free OpenRouter Model**
  - *Chosen Approach*: Combine four orthogonal levers: (1) **Biographical Dossiers** (Park et al. 1,000-People insight—deep formative experiences, money anxieties, civic worldviews, and speech-style anchors instead of generic 3-word traits); (2) **Per-Temperament Decoding Profiles** (distinct temperature, top-p, and frequency-penalty buckets mapped deterministically to each resident’s cognitive temperament); (3) **Anti-Sycophancy & Stubbornness Mechanics** (explicit conviction scalar, risk tolerance, private agendas, and red lines that let residents refuse requests and argue); and (4) **Trust-Gated Receptivity** (agents discount claims from low-trust peers rather than absorbing every utterance).
  - *Why*: Achieves dramatic behavioral and rhetorical divergence without adding multi-model rate-limit fragility or paid API dependencies.
  - *Alternatives Considered*: Routing across 4 different free OpenRouter models (higher rate-limit failure variance and user preferred a single primary model); post-hoc text rewriting (adds extra LLM latency and weakens genuine reasoning diversity).

- **Decision 2 — Bi-Temporal Belief Graph + A-MEM Associative Linking**
  - *Chosen Approach*: Add a lightweight, deterministic **Semantic Belief Store** per resident alongside the episodic memory stream. Each belief tracks `subject`, `predicate`, `claim`, `confidence`, `validFromSimMin`, `invalidatedAtSimMin`, and `supersededById`. New observations, gossip, elections, contract defaults, and reflections automatically supersede conflicting prior beliefs and cross-link related memory IDs (`linkedMemoryIds`).
  - *Why*: Eliminates the "contradictory memory retrieval" bug where an agent recalls both an outdated rumor and a newer fact simultaneously, keeping multi-week trajectories coherent while trimming prompt token bloat.
  - *Alternatives Considered*: External vector/graph database like Neo4j/Graphiti server (adds heavy runtime infrastructure and breaks pure deterministic headless simulation tests).

- **Decision 3 — Ledger-Grounded Expressive Contracts (Bridging Concordia & EconAgent)**
  - *Chosen Approach*: Extend the BDI decision and compressed-scene schemas with bounded structured contract proposals (`propose_loan`, `negotiate_wage`, `launch_venture`, `sign_petition`) whose terms are negotiated in natural language but **validated and enforced deterministically** by the economic engine (real money transfer, repayment due dates, default penalties, venture stock creation, and petition quorum escalation to the civic ballot).
  - *Why*: Gives residents open-ended economic and political agency without ever permitting LLM accounting hallucinations or broken money conservation.
  - *Alternatives Considered*: Free-form LLM "Game Master" adjudicating arbitrary world mutations (too slow on free-tier OpenRouter and prone to ledger drift over long runs).

- **Decision 4 — Browser Simulation Kernel + Versioned Server Snapshot Sync**
  - *Chosen Approach*: Keep the pure deterministic simulation engine in-browser with IndexedDB persistence, and wire explicit bidirectional synchronization to the existing server-side world persistence API under a unified schema v6 contract.
  - *Why*: Guarantees smooth real-time map interaction, zero WebSocket/DB setup friction, and 100% deterministic automated testing—while maintaining a clean separation of concerns ready for a future server-worker multi-city runtime.
  - *Alternatives Considered*: Immediate server-side tick loop + relational DB (introduces latency and infrastructure complexity before the cognitive realism mechanics are validated).

- **Decision 5 — Archetype Surrogate Policies for Scaled Ambient Residents**
  - *Chosen Approach*: Upgrade `'ambient'` residents (at 36–100+ population) from static schedule followers into **temperament-driven behavioral surrogates** driven by their own dossier parameters (risk tolerance, stubbornness, thriftiness, ambition)—so ambient citizens also seek loans, join petitions, switch apartments when broke, and earn promotions with zero LLM calls.
  - *Why*: Ensures macro-economy and diversity metrics stay authentic at 100+ scale without inflating OpenRouter usage.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & System Flow Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER WORKSPACE (React 19)                         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │  Town Map & Canvas   │  │   Agent Inspector   │  │ Society & Diagnostics│  │
│  │ (LOD, Frustum Cull)  │  │ (Dossier, Beliefs,  │  │ (Contracts, Housing,│  │
│  │                      │  │  Memories, Deals)   │  │  Diversity Health)  │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  └──────────┬──────────┘  │
│             └─────────────────────────┼────────────────────────┘             │
│                                       ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │               PURE DETERMINISTIC SIMULATION KERNEL (v6)                │  │
│  │  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐  │  │
│  │  │  Biographical Mind │ │  Causal Institutions│ │  Spatial & Scale   │  │  │
│  │  │  · Life Dossiers   │ │  · Economy & Prices│ │  · O(N) Hash Grid  │  │  │
│  │  │  · Bi-Temporal     │ │  · Bilateral Loans │ │  · Cached A* Paths │  │  │
│  │  │    Belief Graph    │ │  · Micro-Ventures  │ │  · Multi-Tier      │  │  │
│  │  │  · A-MEM Linking   │ │  · Petitions/Civic │ │    Surrogates      │  │  │
│  │  │  · Friction/ToM    │ │  · Housing/Careers │ │  · Collapse Metrics│  │  │
│  │  └────────────────────┘ └────────────────────┘ └────────────────────┘  │  │
│  └──────────────────┬────────────────────────────────┬────────────────────┘  │
│                     │ Priority Cognitive Streams     │ Snapshot Sync         │
│                     ▼ (PIANO-style Decoupled Queue)  ▼                       │
│  ┌──────────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  Cognition Scheduler & Rate Governor │  │  Local IndexedDB + Server    │  │
│  │  (Focal LLM · Active Scene · Ambient)│  │  Snapshot Sync (v1..v5 -> v6)│  │
│  └──────────────────┬───────────────────┘  └──────────────┬───────────────┘  │
└─────────────────────┼─────────────────────────────────────┼──────────────────┘
                      │ Structured JSON + Per-Temperament   │
                      │ Decoding Profile (temp/top_p/pen)   │
                      ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS SERVER PROXY (/api/*)                        │
│  · Strict payload & schema normalization   · Single Free OpenRouter Model    │
│  · Server-side env API key & daily cap     · Versioned World Snapshot Store  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State (Schema v6, Backward-Compatible Migration from v1–v5)

- **Biographical Dossier & Cognitive Profile** *(per Resident)*:
  - `dossier`: Formative life history (2–3 concrete past events), financial posture (`frugal | balanced | spender | anxious`), civic worldview (`fiscal_conservative | communitarian | pragmatist | reformist`), speech style anchor, private agenda, and non-negotiable red lines.
  - `temperament`: `stubbornness` (`0..1`), `riskTolerance` (`0..1`), `ambition` (`0..1`), and derived decoding profile (`temperature`, `topP`, `frequencyPenalty`).
- **Bi-Temporal Belief Node** *(per Resident)*:
  - `id`, `subjectId` (resident, business, policy, or town concept), `predicate` (e.g., `trustworthiness`, `solvency`, `job_status`, `policy_stance`, `obligation`), `claim`, `confidence` (`0..1`), `validFromSimMin`, `invalidatedAtSimMin?`, `supersededById?`, `sourceMemoryId?`.
- **Associative Episodic Memory Links**:
  - Extends each memory node with optional `tags: string[]` and `linkedMemoryIds: string[]` populated deterministically on ingest and enriched during reflection/consolidation.
- **Emergent Contracts & Ventures** *(World-Level Ledgers)*:
  - `LoanContract`: `id`, `lenderId`, `borrowerId`, `principal`, `interestPct`, `amountDue`, `issuedDay`, `dueDay`, `status` (`active | repaid | defaulted`).
  - `CitizenPetition`: `id`, `title`, `description`, `effectKey`, `sponsorId`, `signerIds`, `targetSignatures`, `status` (`gathering | escalated | expired`), `createdAt`.
  - `MicroVenture`: `id`, `founderId`, `name`, `locationId`, `itemKind`, `unitPrice`, `stock`, `revenue`, `openedDay`, `active`.
- **Housing, Households & Career Progression** *(per Resident & World)*:
  - `housingStatus` (`owner | renter | shared`), `monthlyRent`, `householdPartnerIds`, `careerTier` (`apprentice | practitioner | senior | master`), and `yearsExperience` / promotion milestones.
- **Population Realism & Collapse Telemetry** *(Computed Snapshot & Daily History)*:
  - `lexicalDiversity` (Distinct-2 ratio across recent turns), `moodStdDev`, `trustPolarization`, `refusalDisagreementRate`, `activeContractsCount`, `loanDefaultRate`, `householdMobilityEvents`, and `collapseRiskLevel` (`healthy | narrowing | collapse_risk`).

### Interactive Component & State Mapping

- **Resident Inspector (`Belief Graph` toggle & Dossier summary)**:
  - Clicking `Belief Graph` switches from the virtualized episodic stream to a filterable view (`Active Beliefs` | `Superseded History`) where each belief links directly to its originating memory node; clicking a source link scrolls to and highlights that memory in `Episodic Stream`.
- **Society View (`Contracts, Credit & Ventures` + `Housing & Mobility` + `Diversity Health`)**:
  - Renders live, zero-pill editorial summaries of active peer loans, grassroots petitions (with signature progress bars), micro-ventures, housing tenure shifts, and population diversity indices. Clicking any resident name navigates directly to inspect them on the Town Map.
  - Interactive action buttons allow users to sponsor/seed a community petition or trigger a credit/housing audit without breaking simulation determinism.
- **Diagnostics View (`Collapse & Diversity Audit` + `Server Snapshot Sync`)**:
  - Extends the headless multi-day runner output to report **Persona Collapse & Diversity Metrics** (lexical diversity, opinion/mood spread, contract settlement, belief revisions) alongside existing memory/schedule invariants.
  - Adds `Save to Server` / `Load from Server` controls with clear inline status feedback and graceful error handling when server saves are disabled.

### Key Cognitive & Execution Sequences

1. **Anti-Sycophancy Dialogue & Negotiation Flow**:
   - Before invoking the OpenRouter endpoint, the engine retrieves (a) top associative episodic memories (following `linkedMemoryIds` 1 hop), (b) active non-superseded beliefs about the conversation partner and topic, and (c) each participant's dossier, private agenda, red lines, and stubbornness scalar.
   - The server proxy applies the speaker's deterministic temperament decoding profile (`temperature`, `top_p`, `frequency_penalty`) on the single free OpenRouter model and validates returned JSON strictly against the extended schema (including optional bilateral contract offers, refusals, and belief revisions).
   - Accepted contract offers (loans, wage adjustments, petition signatures) execute immediately through pure ledger functions; refusals and broken promises record durable belief revisions and trust/reputation deltas.
2. **Daily Institutional & Life-Cycle Rollover**:
   - At midnight rollover: (1) check maturing loans (auto-repay if solvent, or mark `defaulted` with trust/belief/gossip fallout); (2) collect rent and allow strained renters to relocate or share cottages; (3) evaluate high-skill promotions and capital-backed micro-venture launches; (4) escalate petitions that hit signature quorum onto the formal Civic Proposals ballot; and (5) record the daily macro + diversity/collapse telemetry snapshot.
3. **Verification & Regression Guarantee**:
   - Every new pure simulation subsystem (bi-temporal belief revision, A-MEM linking, loans/defaults, micro-ventures, petitions, housing/career mobility, diversity/collapse metrics, schema v6 migration, and 100-agent ambient surrogate parity) will ship with dedicated deterministic unit tests alongside the existing 71-test suite, plus live browser verification at `1440×900` with zero console errors.
