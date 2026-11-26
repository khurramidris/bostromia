import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactMemories,
  computeImportanceScore,
  computeMemorySurpriseScore,
  computeRecencyScore,
  computeRelevanceScore,
  containsWholeWordOrPhrase,
  cosineSimilarity,
  createMemoryNode,
  formatSimTime,
  markAccessed,
  retrieveMemories,
  scoreImportance,
  shouldTriggerReflection,
} from './memory';
import {
  buildSmallvilleTiles,
  MAP_HEIGHT,
  MAP_WIDTH,
  SMALLVILLE_LOCATIONS,
  SMALLVILLE_OBJECTS,
} from './mapData';
import { findNearestWalkableTile, findPath } from './pathfinding';
import {
  applyConsolidationResult,
  applyConversationResult,
  applyPlanResult,
  applyReactionResult,
  applyReflectionResult,
  canAgentsConverse,
  computeWeatherForSimMinutes,
  createInitialWorldState,
  getActiveScheduleBlock,
  patchScheduleWithBlock,
  stepWorldState,
} from './engine';
import {
  buildSystem1Greeting,
  evaluateEncounterSalience,
  stepAgentDrives,
  stepMoodState,
  updateSocialEdge,
} from './psychology';
import {
  normalizeCommitment,
  normalizeConverseTurnPayload,
  normalizeConverseWrapupPayload,
  normalizeEmotionalShift,
  normalizePlanPayload,
  normalizeReflectionPayload,
  normalizeTomUpdate,
  safeParseJson,
  validateAndRepairPlanBlocks,
} from './llmJson';
import { INTERVIEW_BATTERY, answerInterviewRuleBased } from './paperExperiment';
import { migrateWorldState } from '../services/worldStore';

test('retrieval scoring prioritizes relevant, important, recent memories', () => {
  const now = 1000;
  const partyMem = createMemoryNode({
    id: 'm1',
    createdAt: now - 30,
    type: 'plan',
    description: 'Isabella is hosting a Valentine Day party at Hobbs Cafe.',
    importance: 9,
  });
  const staleChore = createMemoryNode({
    id: 'm2',
    createdAt: now - 600,
    type: 'observation',
    description: 'Swept the floor near the back storage room.',
    importance: 2,
  });
  const coffeeMem = createMemoryNode({
    id: 'm3',
    createdAt: now - 10,
    type: 'observation',
    description: 'Brewed fresh espresso at Hobbs Cafe.',
    importance: 5,
  });

  const ranked = retrieveMemories(
    [staleChore, coffeeMem, partyMem],
    'Valentine Day party at Hobbs Cafe',
    now,
    3,
  );

  assert.equal(ranked[0].node.id, 'm1');
  assert.equal(ranked[0].usedEmbedding, false);
  assert.ok(ranked[0].score > ranked[2].score);
  assert.equal(ranked[2].node.id, 'm2');
});

test('dense cosine similarity retrieval ranks semantically aligned embeddings highest', () => {
  const now = 1000;
  const queryVec = [1, 0, 0];
  const semanticHit = createMemoryNode({
    id: 'sem1',
    createdAt: now - 60,
    type: 'observation',
    description: 'Organized autumn civic gathering with neighbors.',
    importance: 6,
    embedding: [0.98, 0.1, 0],
  });
  const unrelatedVec = createMemoryNode({
    id: 'sem2',
    createdAt: now - 60,
    type: 'observation',
    description: 'Balanced ledger books at the counter.',
    importance: 6,
    embedding: [0, 1, 0],
  });

  assert.ok(cosineSimilarity([1, 0, 0], [1, 0, 0]) > 0.99);
  const relHit = computeRelevanceScore('community social event', semanticHit, queryVec);
  assert.equal(relHit.usedEmbedding, true);
  assert.ok(relHit.score > 0.75);

  const ranked = retrieveMemories(
    [unrelatedVec, semanticHit],
    'community social event',
    now,
    2,
    undefined,
    queryVec,
  );
  assert.equal(ranked[0].node.id, 'sem1');
  assert.equal(ranked[0].usedEmbedding, true);
});

test('compactMemories preserves consolidated, reflection, and high-importance nodes over routine chatter', () => {
  const nodes = [
    createMemoryNode({ id: 'cons_old', createdAt: 10, type: 'consolidated', description: 'Old sleep wisdom.', importance: 8 }),
    createMemoryNode({ id: 'refl_old', createdAt: 20, type: 'reflection', description: 'Old reflection.', importance: 6 }),
    createMemoryNode({ id: 'imp_old', createdAt: 30, type: 'observation', description: 'Critical mayor announcement.', importance: 8 }),
    ...Array.from({ length: 15 }, (_, idx) =>
      createMemoryNode({
        id: `routine_${idx}`,
        createdAt: 100 + idx * 10,
        type: 'observation',
        description: `Walked past bench #${idx}.`,
        importance: 3,
      }),
    ),
  ];

  const compacted = compactMemories(nodes, 12);
  assert.equal(compacted.length, 12);
  assert.ok(compacted.some((m) => m.id === 'cons_old'));
  assert.ok(compacted.some((m) => m.id === 'refl_old'));
  assert.ok(compacted.some((m) => m.id === 'imp_old'));
  assert.ok(!compacted.some((m) => m.id === 'routine_0'), 'Oldest low-importance observation should be evicted');
  assert.ok(compacted.some((m) => m.id === 'routine_14'), 'Newest routine observation should remain');
});

test('recency and importance helpers clamp and decay monotonically', () => {
  assert.equal(computeRecencyScore(600, 600), 1);
  assert.ok(computeRecencyScore(0, 600) < computeRecencyScore(540, 600));
  assert.equal(computeImportanceScore(10), 1);
  assert.equal(computeImportanceScore(15), 1);
  assert.equal(computeImportanceScore(0), 0.1);
  assert.ok(
    computeRelevanceScore('Valentine party', {
      description: 'Hosting a Valentine party',
      keywords: ['valentine', 'party'],
    }).score > 0.3,
  );
});

test('formatSimTime formats Day and 12h clock accurately', () => {
  assert.equal(formatSimTime(9 * 60).fullLabel, 'Day 1 · 9:00 AM');
  assert.equal(formatSimTime(17 * 60 + 5).fullLabel, 'Day 1 · 5:05 PM');
  assert.equal(formatSimTime(1440 + 60).fullLabel, 'Day 2 · 1:00 AM');
});

test('psychological drives, PAD mood, ToM edges, and System-1/System-2 salience gating work coherently', () => {
  const tired = stepAgentDrives(
    { energy: 50, hunger: 40, social: 60, purpose: 70 },
    {
      minuteOfDay: 14 * 60,
      locationCategory: 'cafe',
      isMoving: false,
      isAtDestination: true,
      isResting: false,
      isEatingMeal: true,
    },
    10,
  );
  assert.ok(tired.hunger > 40, 'Explicit meal at cafe should restore hunger');
  assert.ok(tired.social > 60, 'Cafe destination should boost social drive');

  const stressedMood = stepMoodState(
    { valence: 0.4, arousal: 0.5, label: 'Content' },
    { valence: 0.3, arousal: 0.5 },
    { energy: 12, hunger: 15, social: 15, purpose: 50 },
    20,
  );
  assert.equal(stressedMood.label, 'Exhausted');

  const edge = updateSocialEdge(undefined, {
    targetId: 'maria',
    roleLabel: 'Study companion',
    deltaTrust: 12,
    deltaAffection: 15,
    deltaFamiliarity: 10,
    inferredGoal: 'Excited to attend the Hobbs Cafe party',
    simMinutes: 600,
  });
  assert.equal(edge.trust, 22);
  assert.equal(edge.affection, 25);
  assert.equal(edge.inferredGoal, 'Excited to attend the Hobbs Cafe party');

  const walkingPath = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }];
  const rushGate = evaluateEncounterSalience({
    agentA: {
      id: 'a',
      drives: { energy: 18, hunger: 70, social: 75, purpose: 70 },
      mood: { valence: 0.2, arousal: 0.4, label: 'Exhausted' },
      path: walkingPath,
      lastConversedAt: { b: 480 },
      socialGraph: {},
    },
    agentB: {
      id: 'b',
      drives: { energy: 75, hunger: 70, social: 75, purpose: 70 },
      mood: { valence: 0.2, arousal: 0.5, label: 'Content' },
      path: walkingPath,
      lastConversedAt: { a: 480 },
      socialGraph: {},
    },
    memes: [],
    simMinutes: 560,
  });
  assert.equal(rushGate.shouldUseSystem2, false, 'Exhausted walking street crossing should route to System-1 greeting');
  assert.ok(buildSystem1Greeting('Sam Moore', 'Tom Lin', 600, { energy: 18, hunger: 70, social: 70, purpose: 70 }).includes('Tom'));

  const memeGate = evaluateEncounterSalience({
    agentA: {
      id: 'isabella',
      drives: { energy: 75, hunger: 70, social: 45, purpose: 70 },
      mood: { valence: 0.4, arousal: 0.6, label: 'Warm' },
      path: [],
      lastConversedAt: {},
      socialGraph: {},
    },
    agentB: {
      id: 'tom',
      drives: { energy: 75, hunger: 70, social: 55, purpose: 70 },
      mood: { valence: 0.2, arousal: 0.5, label: 'Content' },
      path: [],
      lastConversedAt: {},
      socialGraph: {},
    },
    memes: [{ topic: 'Valentine Party', knownBy: { isabella: { simMinutes: 500 } } }],
    simMinutes: 560,
  });
  assert.equal(memeGate.shouldUseSystem2, true, 'First encounter with asymmetric meme at stationary venue should escalate to System-2');
});

test('computeMemorySurpriseScore assigns higher poignancy to novel observations than repetitive ones', () => {
  const recent = [
    createMemoryNode({
      id: 'rec_1',
      createdAt: 500,
      type: 'observation',
      description: 'At Hobbs Cafe, Isabella brewed espresso and greeted Maria at the counter.',
      importance: 4,
    }),
    createMemoryNode({
      id: 'rec_2',
      createdAt: 510,
      type: 'observation',
      description: 'At Hobbs Cafe, espresso counter steamed fresh espresso.',
      importance: 4,
    }),
  ];

  const routineScore = computeMemorySurpriseScore(
    'At Hobbs Cafe, Isabella brewed espresso at the espresso counter.',
    recent,
  );
  const surprisingScore = computeMemorySurpriseScore(
    'At Smallville Clinic, Dr. Elena Vance organized winter lantern medical kits with Priya.',
    recent,
  );

  assert.ok(surprisingScore > routineScore, `Expected surprising (${surprisingScore}) > routine (${routineScore})`);
  assert.ok(surprisingScore >= 6 && surprisingScore <= 7);
});

test('A* pathfinding connects all 14 Smallville locations across North Ridge, Main Street, and Southside Creek', () => {
  const tiles = buildSmallvilleTiles();
  const cafe = SMALLVILLE_LOCATIONS.find((l) => l.id === 'hobbs_cafe')!;
  const college = SMALLVILLE_LOCATIONS.find((l) => l.id === 'oak_hill_college')!;
  const linHome = SMALLVILLE_LOCATIONS.find((l) => l.id === 'lin_home')!;
  const bakery = SMALLVILLE_LOCATIONS.find((l) => l.id === 'oakridge_bakery')!;
  const library = SMALLVILLE_LOCATIONS.find((l) => l.id === 'harvey_library')!;
  const clinic = SMALLVILLE_LOCATIONS.find((l) => l.id === 'smallville_clinic')!;
  const garden = SMALLVILLE_LOCATIONS.find((l) => l.id === 'community_garden')!;
  const workshop = SMALLVILLE_LOCATIONS.find((l) => l.id === 'willow_workshop')!;
  const moore = SMALLVILLE_LOCATIONS.find((l) => l.id === 'moore_cottages')!;

  const pathCafeToCollege = findPath(
    tiles,
    cafe.doorX,
    cafe.doorY + 1,
    college.doorX,
    college.doorY - 1,
  );
  assert.ok(pathCafeToCollege.length > 5, 'Should find path from Hobbs Cafe to Oak Hill College');

  const pathCollegeToLin = findPath(
    tiles,
    college.doorX,
    college.doorY - 1,
    linHome.doorX,
    linHome.doorY - 1,
  );
  assert.ok(pathCollegeToLin.length > 10, 'Should find path from College to Lin Home');

  const pathBakeryToClinic = findPath(
    tiles,
    bakery.doorX,
    bakery.doorY - 1,
    clinic.doorX,
    clinic.doorY + 1,
  );
  assert.ok(pathBakeryToClinic.length > 35, 'Should connect North Ridge bakery to Southside clinic');

  const pathLibraryToWorkshop = findPath(
    tiles,
    library.doorX,
    library.doorY + 1,
    workshop.doorX,
    workshop.doorY + 1,
  );
  assert.ok(pathLibraryToWorkshop.length > 10, 'Should connect Harvey Library to Willow Workshop');

  const pathClinicToMoore = findPath(
    tiles,
    clinic.doorX,
    clinic.doorY + 1,
    moore.doorX,
    moore.doorY + 1,
  );
  assert.ok(pathClinicToMoore.length > 30, 'Should connect Clinic to Moore & Nair Cottages');

  const fountain = SMALLVILLE_OBJECTS.find((o) => o.id === 'obj_park_fountain')!;
  const parkWalk = findNearestWalkableTile(tiles, fountain.tileX, fountain.tileY);
  const pathToPark = findPath(tiles, cafe.doorX, cafe.doorY + 1, parkWalk.x, parkWalk.y);
  assert.ok(pathToPark.length > 4, 'Should find path into Johnson Park');

  const gardenBeds = SMALLVILLE_OBJECTS.find((o) => o.id === 'obj_garden_beds')!;
  const gardenWalk = findNearestWalkableTile(tiles, gardenBeds.tileX, gardenBeds.tileY);
  const pathToGarden = findPath(tiles, library.doorX, library.doorY + 1, gardenWalk.x, gardenWalk.y);
  assert.ok(pathToGarden.length > 10, 'Should find path into Community Plaza & Garden');
  assert.ok(garden.w > 0);
});

test('createInitialWorldState seeds 18 residents across 80x46 3-district town with 4 memes', () => {
  const initial = createInitialWorldState();
  assert.equal(initial.mapWidth, MAP_WIDTH);
  assert.equal(initial.mapHeight, MAP_HEIGHT);
  assert.equal(MAP_WIDTH, 80);
  assert.equal(MAP_HEIGHT, 46);
  assert.equal(initial.locations.length, 14);
  assert.equal(initial.objects.length, 40);
  assert.equal(initial.agents.length, 18);
  assert.ok(initial.agents.some((a) => a.id === 'elena'));
  assert.ok(initial.agents.some((a) => a.id === 'mateo'));
  assert.ok(initial.agents.some((a) => a.id === 'clara'));
  assert.ok(initial.agents.some((a) => a.id === 'devon'));
  assert.ok(initial.agents.some((a) => a.id === 'priya'));
  assert.ok(initial.agents.some((a) => a.id === 'lucas'));
  assert.ok(initial.agents.every((a) => Array.isArray(a.inventory) && a.inventory.length > 0));
  assert.equal(initial.memes.length, 4);
  assert.ok(initial.weather);

  const movingOnLoad = initial.agents.filter((a) => a.path.length > 0);
  assert.ok(
    movingOnLoad.length >= 6,
    `Expected at least 6 residents moving on load, got ${movingOnLoad.length}`,
  );
});

test('simulation step drives hunger detours, persistent object notes, delta perceptions, and encounter gating', () => {
  let state = createInitialWorldState();
  state = { ...state, simMinutes: 11 * 60 };
  const step1 = stepWorldState(state, 1);
  const isabella = step1.nextState.agents.find((a) => a.id === 'isabella')!;
  assert.ok(isabella.path.length > 0, 'Isabella should plan a path for her 11:00 AM schedule block');
  assert.ok(isabella.currentSubStep, 'Schedule block should resolve an active sub-step');

  // Hungry agent near west campus detours to Hobbs Cafe; east-side resident near bakery detours to Oakridge Bakery
  const starvingState = {
    ...step1.nextState,
    agents: step1.nextState.agents.map((ag) => {
      if (ag.id === 'klaus') {
        return {
          ...ag,
          x: 9,
          y: 12,
          currentLocationId: null,
          drives: { ...ag.drives, hunger: 14 },
          lastDriveInterruptSimMin: undefined,
        };
      }
      if (ag.id === 'clara') {
        return {
          ...ag,
          x: 70,
          y: 17,
          currentLocationId: null,
          drives: { ...ag.drives, hunger: 14 },
          lastDriveInterruptSimMin: undefined,
        };
      }
      return ag;
    }),
  };
  const stepHungry = stepWorldState(starvingState, 0.5);
  const klausDetour = stepHungry.nextState.agents.find((a) => a.id === 'klaus')!;
  const claraDetour = stepHungry.nextState.agents.find((a) => a.id === 'clara')!;
  assert.ok(
    klausDetour.dailySchedule.some((b) => b.source === 'drive_interrupt' && b.locationId === 'hobbs_cafe'),
    'Hungry Klaus near Oak Hill should detour to Hobbs Cafe',
  );
  assert.ok(
    claraDetour.dailySchedule.some(
      (b) => b.source === 'drive_interrupt' && b.locationId === 'oakridge_bakery',
    ),
    'Hungry Clara near Harvey Library should detour to nearer Oakridge Bakery',
  );
  assert.ok(stepHungry.nextState.stats.driveInterrupts >= 2);

  // Weather transitions cleanly across time blocks
  assert.equal(computeWeatherForSimMinutes(4 * 180), 'drizzle');
  const rainyStep = stepWorldState({ ...step1.nextState, simMinutes: 4 * 180 - 0.5, weather: 'clear' }, 1);
  assert.equal(rainyStep.nextState.weather, 'drizzle');
  assert.ok(rainyStep.nextState.chronicle.some((c) => c.title.includes('rain')));

  // Verify persistent object trace when an agent stands near an active schedule object
  const activeObjAgent = step1.nextState.agents.find((a) => a.currentObjectId)!;
  const targetObj = step1.nextState.objects.find((o) => o.id === activeObjAgent.currentObjectId)!;
  const steppedNearObj = stepWorldState(
    {
      ...step1.nextState,
      agents: step1.nextState.agents.map((ag) =>
        ag.id === activeObjAgent.id
          ? { ...ag, x: targetObj.tileX, y: targetObj.tileY + 1, path: [] }
          : ag,
      ),
    },
    0.5,
  );
  const mutatedObj = steppedNearObj.nextState.objects.find((o) => o.id === targetObj.id)!;
  assert.ok(mutatedObj.occupiedByAgentId === activeObjAgent.id);

  // Verify delta room perception emits observation once and does not duplicate on identical steady state
  const firstPercepCount = steppedNearObj.nextState.stats.perceptionEvents;
  assert.ok(firstPercepCount > 0, 'Stationary residents sharing rooms or seeing traces should emit perception events');

  // Verify Klaus & Maria proximity triggers conversation pair
  const maria = step1.nextState.agents.find((a) => a.id === 'maria')!;
  const adjustedAgents = step1.nextState.agents.map((ag) =>
    ag.id === 'klaus' ? { ...ag, x: maria.x + 1, y: maria.y, path: [] } : ag,
  );
  const step2 = stepWorldState({ ...step1.nextState, agents: adjustedAgents }, 0.5);
  const hasPair = step2.triggers.conversationPairs.some(
    ([a, b]) => (a === 'klaus' && b === 'maria') || (a === 'maria' && b === 'klaus'),
  );
  assert.equal(hasPair, true);

  assert.equal(shouldTriggerReflection({ importanceAccumulator: 52, isThinking: false }, 50), true);
  assert.equal(shouldTriggerReflection({ importanceAccumulator: 52, isThinking: true }, 50), false);

  // Verify patchScheduleWithBlock respects active drive_interrupt
  const patched = patchScheduleWithBlock(klausDetour.dailySchedule, {
    id: 'social_test',
    day: 1,
    kind: 'leisure',
    startMinute: 660,
    durationMinutes: 60,
    locationId: 'johnson_park',
    activity: 'Walk in the park',
    emoji: '🌳',
    source: 'social_commitment',
  });
  const activeAt11 = getActiveScheduleBlock(patched, 1, 661);
  assert.equal(activeAt11?.source, 'drive_interrupt');
});

test('conversation commitments, privateThoughts, meme diffusion, reflection, and sleep consolidation work end-to-end', () => {
  const initial = createInitialWorldState();
  const afterConv = applyConversationResult(initial, {
    agentAId: 'maria',
    agentBId: 'klaus',
    turns: [
      {
        speakerId: 'maria',
        speakerName: 'Maria Lopez',
        text: 'Are you coming to Isabella’s 5 PM Valentine party at Hobbs Cafe?',
        privateThought: 'I hope Klaus joins tonight.',
      },
      {
        speakerId: 'klaus',
        speakerName: 'Klaus Mueller',
        text: 'I will be there right at 5:00 PM!',
        privateThought: 'Wait—she invited me directly!',
      },
    ],
    summaryA: 'Maria invited Klaus to Isabella’s 5 PM Valentine party at Hobbs Cafe.',
    summaryB: 'Klaus accepted Maria’s invitation to the 5 PM Valentine party at Hobbs Cafe.',
    importance: 8,
    planUpdateB: 'Attend the Valentine party at Hobbs Cafe at 5 PM with Maria.',
    memeIdsDiscussedA: ['meme_valentine_party'],
    commitmentB: {
      day: 'today',
      minuteOfDay: 17 * 60,
      durationMinutes: 90,
      locationId: 'hobbs_cafe',
      objectId: 'obj_cafe_table',
      activity: 'Attend Valentine party with Maria',
      emoji: '🎉',
    },
    emotionalShiftB: { deltaValence: 0.15, deltaArousal: 0.1 },
    tomUpdateB: {
      deltaTrust: 5,
      deltaAffection: 6,
      inferredGoal: 'Excited for tonight’s Hobbs Cafe Valentine party',
    },
  });

  const klaus = afterConv.agents.find((a) => a.id === 'klaus')!;
  assert.equal(klaus.speechBubble?.text, 'I will be there right at 5:00 PM!');
  assert.ok(klaus.memories.some((m) => m.description.includes('Valentine party')));
  assert.equal(
    klaus.socialGraph.maria?.inferredGoal,
    'Excited for tonight’s Hobbs Cafe Valentine party',
  );
  assert.ok(
    klaus.dailySchedule.some(
      (b) =>
        b.source === 'social_commitment' &&
        b.locationId === 'hobbs_cafe' &&
        b.objectId === 'obj_cafe_table' &&
        b.startMinute === 17 * 60,
    ),
    'Structured commitmentB should patch Klaus dailySchedule with grounded objectId at 5:00 PM',
  );
  assert.equal(afterConv.conversations.length, 1);
  assert.equal(afterConv.conversations[0].turns[1].privateThought, 'Wait—she invited me directly!');
  const valMeme = afterConv.memes.find((m) => m.id === 'meme_valentine_party')!;
  assert.ok(valMeme.knownBy.klaus, 'Klaus should now be recorded as knowing the Valentine party meme from Maria');
  assert.equal(valMeme.knownBy.klaus.heardFromId, 'maria');

  const maria = afterConv.agents.find((a) => a.id === 'maria')!;
  const afterRefl = applyReflectionResult(afterConv, 'maria', [
    {
      insight: 'Friends at Hobbs Cafe are creating a warm community event tonight.',
      importance: 9,
      evidenceIds: [maria.memories[0].id],
    },
  ]);
  const mariaRefl = afterRefl.agents.find((a) => a.id === 'maria')!;
  assert.equal(mariaRefl.importanceAccumulator, 0);
  assert.equal(mariaRefl.memories[0].type, 'reflection');

  const lowImpRoutineMem = createMemoryNode({
    id: 'routine_prune_ok',
    createdAt: 500,
    type: 'observation',
    description: 'Walked past a quiet mailbox.',
    importance: 3,
  });
  const importantSeedId = mariaRefl.memories.find((m) => m.importance >= 8)!.id;
  const mariaWithRoutine = {
    ...afterRefl,
    agents: afterRefl.agents.map((ag) =>
      ag.id === 'maria' ? { ...ag, memories: [lowImpRoutineMem, ...ag.memories] } : ag,
    ),
  };

  const afterSleep = applyConsolidationResult(mariaWithRoutine, 'maria', {
    consolidatedInsights: [
      {
        insight: 'Strong friendships at Hobbs Cafe anchored my day despite heavy physics study.',
        importance: 9,
        evidenceIds: [mariaRefl.memories[0].id],
      },
    ],
    prunedMemoryIds: ['routine_prune_ok', importantSeedId],
    socialUpdates: [
      {
        targetId: 'klaus',
        inferredGoal: 'Looking forward to celebrating at the Valentine’s party together',
        deltaTrust: 4,
      },
    ],
  });

  const mariaSleep = afterSleep.agents.find((a) => a.id === 'maria')!;
  assert.equal(mariaSleep.memories[0].type, 'consolidated');
  assert.ok(!mariaSleep.memories.some((m) => m.id === 'routine_prune_ok'));
  assert.ok(
    mariaSleep.memories.some((m) => m.id === importantSeedId),
    'Consolidation must refuse to prune memories with importance >= 5',
  );
  assert.ok(mariaSleep.drives.energy >= 88);
  assert.equal(afterSleep.chronicle[0].type, 'consolidation');
});

test('safeParseJson and LLM response normalizers handle reasoning tags, fences, and out-of-range numbers', () => {
  const rawModelText = [
    '<think>Let me think as Isabella about the coffee bar.</think>',
    'Here is the JSON output:',
    '```json',
    '{ "spokenLine": "Good morning, Klaus!", "privateThought": "He looks tired today." }',
    '```',
  ].join('\n');

  const parsed = safeParseJson<{ spokenLine: string; privateThought: string }>(rawModelText);
  assert.equal(parsed.spokenLine, 'Good morning, Klaus!');
  assert.equal(parsed.privateThought, 'He looks tired today.');

  const shift = normalizeEmotionalShift({ deltaValence: 1.5, deltaArousal: -0.9 });
  assert.deepEqual(shift, { deltaValence: 0.3, deltaArousal: -0.3 });

  const tom = normalizeTomUpdate({ deltaTrust: 42.6, deltaAffection: -30, inferredGoal: 'Host a talk' });
  assert.deepEqual(tom, { deltaTrust: 15, deltaAffection: -15, inferredGoal: 'Host a talk' });

  assert.equal(normalizeCommitment({ activity: 'Meet up' }), undefined);
  const validCommit = normalizeCommitment({
    minuteOfDay: 1020,
    durationMinutes: 90,
    locationId: 'hobbs_cafe',
    objectId: 'obj_cafe_table',
    activity: 'Attend Valentine Party',
  });
  assert.equal(validCommit?.locationId, 'hobbs_cafe');

  const refl = normalizeReflectionPayload({
    focalQuestions: ['Q1', ''],
    reflections: [{ insight: 'Neighbors care deeply.', importance: 99, evidenceIds: ['m1'] }],
  });
  assert.equal(refl.focalQuestions.length, 1);
  assert.equal(refl.reflections[0].importance, 10);

  const plan = normalizePlanPayload(
    {
      updatedSummary: 'Evening reading',
      blocks: [
        {
          startMinute: 960,
          durationMinutes: 10,
          locationId: '',
          activity: 'Read archive records',
          subSteps: ['Select ledger', 'Take notes'],
          emoji: '📖',
        },
      ],
    },
    'harvey_library',
    900,
  );
  assert.equal(plan.blocks[0].locationId, 'harvey_library');
  assert.equal(plan.blocks[0].durationMinutes, 30);
  assert.equal(plan.blocks[0].subSteps?.length, 2);
});

test('Phase 3: dated schedules, tomorrow/past commitments, fixed commitment survival, kind-driven drives, outdoors location & LoS', () => {
  const initial = createInitialWorldState();

  // 1. Walking trail leisure does NOT restore energy; explicit sleep/rest DOES restore energy
  const walkStep = stepAgentDrives(
    { energy: 50, hunger: 60, social: 60, purpose: 60 },
    {
      minuteOfDay: 14 * 60,
      locationCategory: 'cafe',
      isMoving: false,
      isAtDestination: true,
      isResting: false,
      isEatingMeal: false,
      isAtHome: false,
    },
    10,
  );
  assert.ok(walkStep.hunger < 60, 'Cafe non-meal block must not refill hunger');
  assert.ok(walkStep.energy < 50, 'Non-rest leisure must not refill energy');

  const sleepStep = stepAgentDrives(
    { energy: 50, hunger: 60, social: 60, purpose: 60 },
    {
      minuteOfDay: 2 * 60,
      locationCategory: 'home',
      isMoving: false,
      isAtDestination: true,
      isResting: true,
      isEatingMeal: false,
      isAtHome: true,
    },
    10,
  );
  assert.ok(sleepStep.energy > 50, 'Resting/sleep must restore energy');

  // 2. Tomorrow commitment only matches Day 2, never Day 1, and survives re-plan/morning plan
  const baseSchedule = initial.agents[0].dailySchedule;
  const withTomorrow = patchScheduleWithBlock(baseSchedule, {
    id: 'tomorrow_coffee',
    day: 2,
    kind: 'social',
    fixed: true,
    oneOff: true,
    startMinute: 15 * 60,
    durationMinutes: 60,
    locationId: 'hobbs_cafe',
    objectId: 'obj_cafe_table',
    activity: 'Meet Maria for afternoon tea tomorrow',
    emoji: '☕',
    source: 'social_commitment',
  });
  assert.notEqual(getActiveScheduleBlock(withTomorrow, 1, 15 * 60 + 5)?.id, 'tomorrow_coffee');
  assert.equal(getActiveScheduleBlock(withTomorrow, 2, 15 * 60 + 5)?.id, 'tomorrow_coffee');

  // 3. Morning plan / re-plan preserves fixed future commitments even when omitted by LLM output
  const worldWithFixed = {
    ...initial,
    agents: initial.agents.map((ag) =>
      ag.id === 'isabella' ? { ...ag, dailySchedule: withTomorrow } : ag,
    ),
  };
  const replanned = applyPlanResult(
    { ...worldWithFixed, simMinutes: 1440 + 6 * 60 },
    'isabella',
    {
      updatedSummary: 'Quiet Day 2 morning',
      blocks: [
        {
          kind: 'work',
          startMinute: 8 * 60,
          durationMinutes: 480,
          locationId: 'hobbs_cafe',
          activity: 'Work cafe counter all day',
          emoji: '☕',
        },
      ],
    },
    { isMorningPlan: true },
  );
  const isaAfterPlan = replanned.agents.find((a) => a.id === 'isabella')!;
  assert.ok(
    isaAfterPlan.dailySchedule.some((b) => b.id === 'tomorrow_coffee' && b.fixed),
    'Morning plan must preserve existing fixed commitment even if omitted',
  );

  // 4. Past commitments & outside 06:00..22:30 commitments rejected
  const atNoon = { ...initial, simMinutes: 12 * 60 };
  const afterPastAndLate = applyConversationResult(atNoon, {
    agentAId: 'isabella',
    agentBId: 'maria',
    turns: [
      { speakerId: 'isabella', speakerName: 'Isabella Rodriguez', text: 'Hey!' },
      { speakerId: 'maria', speakerName: 'Maria Lopez', text: 'Hi!' },
    ],
    summaryA: 'Brief chat.',
    summaryB: 'Brief chat.',
    sharedAgreement: {
      day: 'today',
      minuteOfDay: 10 * 60, // already past noon!
      locationId: 'hobbs_cafe',
      activity: 'Morning coffee',
    },
    commitmentB: {
      day: 'today',
      minuteOfDay: 23 * 60, // outside COMMITMENT_MAX_MINUTE (22:30)
      durationMinutes: 60,
      locationId: 'hobbs_cafe',
      activity: 'Midnight espresso',
    },
  });
  assert.equal(afterPastAndLate.conversations[0].agreement, undefined);
  assert.ok(
    !afterPastAndLate.agents
      .find((a) => a.id === 'maria')!
      .dailySchedule.some((b) => b.source === 'social_commitment'),
  );

  // 5. Outdoors tile clears currentLocationId to null & sets currentAreaLabel; wall blocks canAgentsConverse
  const steppedOutdoors = stepWorldState(
    {
      ...initial,
      agents: initial.agents.map((ag) =>
        ag.id === 'klaus'
          ? { ...ag, x: 40, y: 15, targetX: 40, targetY: 15, path: [] } // Main Street outdoor corridor
          : ag,
      ),
    },
    0.5,
  );
  const outdoorKlaus = steppedOutdoors.nextState.agents.find((a) => a.id === 'klaus')!;
  assert.equal(outdoorKlaus.currentLocationId, null);
  assert.ok(outdoorKlaus.currentAreaLabel);

  // Wall separates interior (x=7, y=7 inside oak_hill_college) vs outside adjacent tile (x=7, y=10 -> check wall at y=9)
  const indoorAg = { ...outdoorKlaus, id: 'in_a', x: 7, y: 8, currentLocationId: 'oak_hill_college', path: [] };
  const outdoorAg = { ...outdoorKlaus, id: 'out_b', x: 7, y: 11, currentLocationId: null, path: [] };
  assert.equal(canAgentsConverse({ tiles: initial.tiles, locations: initial.locations }, indoorAg, outdoorAg), false);

  // 6. Whole-word rumor check does not match "run" inside "brunch"
  assert.equal(containsWholeWordOrPhrase('Let us grab brunch together', 'run'), false);
  assert.equal(containsWholeWordOrPhrase('Sam decided to run for mayor', 'run'), true);

  // 7. Schema migration upgrades v1/v2/v3 saves to v4 and rejects corrupt payloads safely
  const legacyRaw = {
    ...initial,
    schemaVersion: 2,
    objects: initial.objects.filter((o) => o.kind !== 'bed'),
    agents: initial.agents.map((a) => ({
      ...a,
      dailySchedule: a.dailySchedule.map(({ day: _d, kind: _k, ...rest }) => rest),
    })),
  };
  const migrated = migrateWorldState(legacyRaw);
  assert.ok(migrated.world);
  assert.equal(migrated.world.schemaVersion, 6);
  assert.ok(migrated.notice?.includes('v6'));
  assert.ok(migrated.world.objects.some((o) => o.kind === 'bed'));
  assert.ok(migrated.world.agents[0].dailySchedule.every((b) => b.day >= 1 && Boolean(b.kind)));

  const corrupt = migrateWorldState({ broken: true });
  assert.equal(corrupt.world, null);
  assert.ok(corrupt.notice);
});

test('Phase 4: stay-based perception, unified importance/relevance, markAccessed, and safe 7-day compaction', () => {
  // 1. Stay-based room perception creates 1 perc_ per stay unless new known peer or new trace appears
  let world = createInitialWorldState();
  world = {
    ...world,
    simMinutes: 10 * 60,
    agents: world.agents.map((ag) => {
      if (ag.id === 'isabella') {
        return { ...ag, x: 16, y: 19, path: [], currentLocationId: 'hobbs_cafe' };
      }
      if (ag.id === 'klaus') {
        return { ...ag, x: 17, y: 19, path: [], currentLocationId: 'hobbs_cafe' };
      }
      return { ...ag, path: [] };
    }),
  };

  for (let i = 0; i < 6; i++) {
    world = stepWorldState(world, 1).nextState;
  }
  const isaPercs = world.agents
    .find((a) => a.id === 'isabella')!
    .memories.filter((m) => m.id.startsWith('perc_isabella'));
  assert.equal(isaPercs.length, 1, 'Routine repeated room ticks during a single stay should emit 1 stay observation');

  // 2. scoreImportance puts crisis high and walking routine low
  assert.ok(scoreImportance({ kind: 'conversation', description: 'A fire broke out in the bakery and Mateo was hurt.', recentMemories: [] }) >= 8);
  assert.ok(scoreImportance({ kind: 'routine_perception', description: 'Walked past a bench along Main Street.', recentMemories: [] }) <= 3);

  // 3. Mixed embedding coverage (<90%) falls back cleanly to lexical scoring for all candidates
  const vecMem = createMemoryNode({
    id: 'vec_m',
    createdAt: 500,
    type: 'observation',
    description: 'Discussed astronomy lecture notes.',
    importance: 5,
    embedding: [0.1, 0.9, 0],
  });
  const unvecMem = createMemoryNode({
    id: 'unvec_m',
    createdAt: 500,
    type: 'observation',
    description: 'Valentine party celebration at Hobbs Cafe.',
    importance: 5,
  });
  const mixedRanked = retrieveMemories(
    [vecMem, unvecMem],
    'Valentine party',
    520,
    2,
    undefined,
    [1, 0, 0],
  );
  assert.equal(mixedRanked.every((r) => !r.usedEmbedding), true);
  assert.equal(mixedRanked[0].node.id, 'unvec_m');

  // 4. markAccessed updates lastAccessed and increases recency
  const oldMem = createMemoryNode({
    id: 'touch_me',
    createdAt: 0,
    type: 'observation',
    description: 'Stored paintbrushes.',
    importance: 5,
  });
  const touchedWorld = markAccessed(
    {
      ...world,
      agents: world.agents.map((a) =>
        a.id === 'isabella' ? { ...a, memories: [oldMem] } : a,
      ),
    },
    'isabella',
    ['touch_me'],
    1000,
  );
  assert.equal(touchedWorld.agents.find((a) => a.id === 'isabella')!.memories[0].lastAccessed, 1000);

  // 5. compactMemories preserves importance >= 8 younger than 7 sim days & creates daily consolidated summary
  const recentHigh = createMemoryNode({
    id: 'imp8_young',
    createdAt: 2 * 1440,
    type: 'observation',
    description: 'Major fire near Oakridge Bakery injured Mateo.',
    importance: 9,
  });
  const overflowRoutine = Array.from({ length: 40 }, (_, i) =>
    createMemoryNode({
      id: `rout_${i}`,
      createdAt: 100 + i,
      type: 'observation',
      description: `Routine walk #${i}`,
      importance: 2,
    }),
  );
  let seq = 1;
  const compacted = compactMemories(
    [recentHigh, ...overflowRoutine],
    20,
    4 * 1440,
    (p) => `${p}_${seq++}`,
  );
  assert.ok(compacted.length <= 20);
  assert.ok(compacted.some((m) => m.id === 'imp8_young'));
  assert.ok(compacted.some((m) => m.type === 'consolidated' && (m.evidenceIds?.length ?? 0) > 0));
});

test('Phase 5: conversation normalizers, validated memeIdsDiscussed, and dual-schedule sharedAgreement', () => {
  const turnParsed = normalizeConverseTurnPayload(
    {
      spokenLine: 'Let us meet at Hobbs Cafe.',
      privateThought: 'Hope he likes espresso.',
      endConversation: true,
    },
    'Hello.',
  );
  assert.equal(turnParsed.endConversation, true);
  assert.equal(turnParsed.spokenLine, 'Let us meet at Hobbs Cafe.');

  const wrap = normalizeConverseWrapupPayload(
    {
      summary: 'Isabella and Klaus agreed to meet tomorrow at Hobbs Cafe.',
      importance: 8,
      memeIdsDiscussed: ['meme_valentine_party', 'hallucinated_fake_meme'],
      emotionalShift: { deltaValence: 0.2, deltaArousal: 0.1 },
      tomUpdate: { deltaTrust: 6, deltaAffection: 5, inferredGoal: 'Planning meetup' },
      sharedAgreement: {
        day: 'tomorrow',
        minuteOfDay: 10 * 60,
        durationMinutes: 60,
        locationId: 'hobbs_cafe',
        activity: 'Coffee tasting',
      },
    },
    'Fallback',
    new Set(['meme_valentine_party']),
  );
  assert.deepEqual(wrap.memeIdsDiscussed, ['meme_valentine_party']);
  assert.equal(wrap.sharedAgreement?.locationId, 'hobbs_cafe');

  // Shared agreement writes identical Day-2 fixed commitment to BOTH speakers and only discussed memes spread
  const world = createInitialWorldState();
  const afterShared = applyConversationResult(world, {
    agentAId: 'isabella',
    agentBId: 'john',
    turns: [
      { speakerId: 'isabella', speakerName: 'Isabella Rodriguez', text: 'Want to organize supplies tomorrow morning?' },
      { speakerId: 'john', speakerName: 'John Lin', text: 'Sure, see you at 10 AM at Willows Market!' },
    ],
    summaryA: 'Isabella and John agreed to organize supplies tomorrow.',
    summaryB: 'John and Isabella agreed to meet tomorrow at 10 AM.',
    reason: 'planning',
    endedBy: 'john',
    memeIdsDiscussedA: [], // Even though party exists, NOT discussed!
    memeIdsDiscussedB: [],
    sharedAgreement: {
      day: 'tomorrow',
      minuteOfDay: 10 * 60,
      durationMinutes: 60,
      locationId: 'willows_market',
      activity: 'Organize market supplies together',
    },
  });

  const isa = afterShared.agents.find((a) => a.id === 'isabella')!;
  const john = afterShared.agents.find((a) => a.id === 'john')!;
  assert.ok(isa.dailySchedule.some((b) => b.day === 2 && b.fixed && b.locationId === 'willows_market'));
  assert.ok(john.dailySchedule.some((b) => b.day === 2 && b.fixed && b.locationId === 'willows_market'));
  assert.equal(afterShared.conversations[0].reason, 'planning');
  assert.equal(afterShared.conversations[0].endedBy, 'john');
  assert.equal(afterShared.conversations[0].agreement?.locationId, 'willows_market');

  // Un-discussed Valentine party meme must NOT spread to John
  const partyMeme = afterShared.memes.find((m) => m.id === 'meme_valentine_party')!;
  assert.equal(Boolean(partyMeme.knownBy.john), false);
});

test('Phase 6: reflection evidence filtering, morning plan repair, surgical re-plan, and reaction cap', () => {
  // 1. Evidence filtering drops unprovided IDs, drops 0-evidence insights, and keeps prior reflections
  const validIds = new Set(['mem_obs_1', 'refl_prior_2']);
  const filtered = normalizeReflectionPayload(
    {
      focalQuestions: ['Q1', 'Q2', 'Q3'],
      reflections: [
        {
          insight: 'Supported by observation and prior reflection.',
          importance: 8,
          evidenceIds: ['mem_obs_1', 'hallucinated_99', 'refl_prior_2'],
        },
        {
          insight: 'Only cites a hallucinated ID — must be dropped.',
          importance: 9,
          evidenceIds: ['fake_id_1', 'fake_id_2'],
        },
      ],
    },
    validIds,
  );
  assert.equal(filtered.reflections.length, 1);
  assert.deepEqual(filtered.reflections[0].evidenceIds, ['mem_obs_1', 'refl_prior_2']);

  // 2. Plan validator guarantees sleep + >= 2 meals, zero overlaps, and preserves fixed blocks
  const world = createInitialWorldState();
  const isa = world.agents.find((a) => a.id === 'isabella')!;
  const fixedLunch = {
    id: 'fixed_social_lunch',
    day: 2,
    kind: 'social' as const,
    startMinute: 720,
    durationMinutes: 60,
    locationId: 'hobbs_cafe',
    objectId: 'obj_cafe_table',
    activity: 'Fixed meetup with Maria',
    emoji: '🤝',
    fixed: true,
    source: 'social_commitment' as const,
  };
  const repaired = validateAndRepairPlanBlocks({
    day: 2,
    isMorningPlan: true,
    homeLocationId: isa.homeLocationId,
    validLocationIds: new Set(world.locations.map((l) => l.id)),
    objectLocationById: new Map(world.objects.map((o) => [o.id, o.locationId])),
    defaultObjectByLocation: new Map([['hobbs_cafe', 'obj_cafe_table']]),
    fixedBlocksToday: [fixedLunch],
    candidateBlocks: [
      {
        id: 'cand_work',
        day: 2,
        kind: 'work',
        startMinute: 540,
        durationMinutes: 240,
        locationId: 'invalid_location',
        activity: 'Baking & espresso prep',
        emoji: '☕',
        source: 'morning_plan',
      },
    ],
  });
  assert.ok(repaired.some((b) => b.id === 'fixed_social_lunch'), 'Fixed block must survive morning plan repair');
  assert.ok(repaired.some((b) => b.kind === 'sleep'), 'Repaired morning plan must include sleep');
  assert.ok(
    repaired.filter((b) => b.kind === 'meal').length >= 2,
    'Repaired morning plan must include >= 2 meal blocks',
  );
  for (let i = 1; i < repaired.length; i++) {
    assert.ok(
      repaired[i].startMinute >= repaired[i - 1].startMinute + repaired[i - 1].durationMinutes,
      'Repaired blocks must have zero overlaps',
    );
  }

  // 3. Surgical re-plan preserves fixed block AND blocks after nextFixedStart
  const worldWithSchedule = {
    ...world,
    simMinutes: 1440 + 600, // Day 2 10:00 AM
    day: 2,
    agents: world.agents.map((a) =>
      a.id === 'klaus'
        ? {
            ...a,
            dailySchedule: [
              {
                id: 'k_morn',
                day: 2,
                kind: 'work' as const,
                startMinute: 480,
                durationMinutes: 180,
                locationId: 'oak_hill_college',
                activity: 'Morning seminar',
                emoji: '📖',
                source: 'morning_plan' as const,
              },
              {
                id: 'k_fixed',
                day: 2,
                kind: 'social' as const,
                startMinute: 780, // 13:00
                durationMinutes: 60,
                locationId: 'hobbs_cafe',
                activity: 'Fixed thesis review with Mei',
                emoji: '🎓',
                fixed: true,
                source: 'social_commitment' as const,
              },
              {
                id: 'k_eve',
                day: 2,
                kind: 'leisure' as const,
                startMinute: 900, // 15:00 — after fixed!
                durationMinutes: 120,
                locationId: 'johnson_park',
                activity: 'Evening park walk',
                emoji: '🌳',
                source: 'morning_plan' as const,
              },
            ],
          }
        : a,
    ),
  };
  const afterSurgical = applyPlanResult(
    worldWithSchedule,
    'klaus',
    {
      updatedSummary: 'Adjusted late morning study block.',
      blocks: [
        {
          kind: 'errand',
          startMinute: 600,
          durationMinutes: 90,
          locationId: 'harvey_library',
          activity: 'Pick up reference volumes before lunch',
          emoji: '📚',
        },
        {
          kind: 'leisure',
          startMinute: 920, // Outside [600, 780) -> must NOT overwrite k_eve!
          durationMinutes: 60,
          locationId: 'rose_crown_pub',
          activity: 'Unrequested late detour',
          emoji: '🍺',
        },
      ],
    },
    { isMorningPlan: false },
  );
  const klausAfter = afterSurgical.agents.find((a) => a.id === 'klaus')!;
  assert.ok(klausAfter.dailySchedule.some((b) => b.id === 'k_fixed'));
  assert.ok(klausAfter.dailySchedule.some((b) => b.id === 'k_eve'));
  assert.equal(klausAfter.dailySchedule.some((b) => b.activity === 'Unrequested late detour'), false);

  // 4. Reaction cap: at most 4 reactions per resident per sim day
  let reactWorld = worldWithSchedule;
  for (let i = 0; i < 6; i++) {
    reactWorld = applyReactionResult(reactWorld, 'klaus', {
      react: true,
      reason: `Event #${i}`,
      newActivity: `Quick check #${i}`,
      kind: 'social',
      locationId: 'hobbs_cafe',
      durationMinutes: 30,
    });
  }
  assert.equal(reactWorld.reactionsTodayByAgent?.klaus, 4);
  const klausReacts = reactWorld.agents
    .find((a) => a.id === 'klaus')!
    .memories.filter((m) => m.source === 'reaction');
  assert.equal(klausReacts.length, 4);
});

test('Phase 7: paper_valentine scenario isolates Day 2 party & mayor knowledge cleanly and supports 25-question battery', () => {
  const paper = createInitialWorldState('paper_valentine');
  assert.equal(paper.scenarioId, 'paper_valentine');
  assert.equal(formatSimTime(paper.simMinutes).day, 1);
  assert.equal(formatSimTime(paper.simMinutes).hour24, 9);

  const partyMeme = paper.memes.find((m) => m.id === 'meme_valentine_party')!;
  const mayorMeme = paper.memes.find((m) => m.id === 'meme_mayor_race')!;
  assert.deepEqual(Object.keys(partyMeme.knownBy), ['isabella']);
  assert.deepEqual(Object.keys(mayorMeme.knownBy), ['sam']);

  for (const ag of paper.agents) {
    if (ag.id !== 'isabella') {
      assert.equal(
        ag.dailySchedule.some((b) => /valentine/i.test(b.activity)),
        false,
        `${ag.id} must have zero seeded Valentine party schedule blocks in paper_valentine`,
      );
      assert.equal(
        ag.memories.some((m) => /valentine/i.test(m.description)),
        false,
        `${ag.id} must have zero seeded Valentine party memories in paper_valentine`,
      );
    }
  }

  assert.equal(INTERVIEW_BATTERY.length, 25);
  const maria = paper.agents.find((a) => a.id === 'maria')!;
  const q1 = answerInterviewRuleBased(paper, maria, INTERVIEW_BATTERY.find((q) => q.id === 'q_mem_1')!);
  assert.ok(q1.answer.toLowerCase().includes('haven’t heard') || q1.answer.toLowerCase().includes('no'));
});


