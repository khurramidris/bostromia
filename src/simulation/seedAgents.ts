import { createMemoryNode } from './memory';
import { computeMoodLabel } from './psychology';
import type {
  AgentDrives,
  AgentState,
  ChronicleEvent,
  ScenarioId,
  ScheduleBlock,
  ScheduleBlockKind,
  SocialEdge,
  TrackedMeme,
} from './types';

export const DEFAULT_GOALS_BY_AGENT: Record<string, string[]> = {
  isabella: [
    'Make Hobbs Cafe the warmest gathering spot in Smallville',
    'Invite neighbors to the Valentine’s Day party at Hobbs Cafe (5:00 PM – 7:00 PM)',
  ],
  john: [
    'Keep Willows Market & Pharmacy stocked with herbal remedies and local produce',
    'Support Mei and Eddy at home',
  ],
  mei: [
    'Guide Oak Hill College seminar students thoughtfully',
    'Collaborate with Clara on Smallville town charter research',
  ],
  eddy: [
    'Compose an evocative piano score for Abigail’s animated short film',
  ],
  klaus: [
    'Complete urban community sociology paper with strong fieldwork',
    'Gather courage to spend quality time with Maria',
  ],
  maria: [
    'Wrap up computational physics lab simulations cleanly',
    'Stay connected with friends along Main Street',
  ],
  sam: [
    'Decide whether to officially announce a campaign for Smallville mayor',
    'Champion evening pedestrian lighting along Johnson Park & South Lane',
  ],
  arthur: [
    'Keep The Rose & Crown Pub lively and welcoming each evening',
    'Offer Sam grounded feedback on town sentiment',
  ],
  abigail: [
    'Finish character keyframe animation using Johnson Park light studies',
    'Sync animated film pacing with Eddy’s piano score',
  ],
  rajiv: [
    'Paint plein-air watercolors across Johnson Park and Southside Garden',
    'Finish seasonal chalkboard lettering for Hobbs Cafe',
  ],
  wolfgang: [
    'Stay sharp in organic chemistry lab and maintain park track splits',
    'Keep road bike tuned with Devon at Willow Workshop',
  ],
  hailey: [
    'Report grounded stories on Smallville civic life for the Gazette',
    'Find out whether Sam Moore intends to run for mayor',
  ],
  elena: [
    'Connect Southside Clinic herbal remedies with John Lin’s pharmacy',
    'Advocate safer evening lighting along South Lane',
  ],
  mateo: [
    'Bake signature sourdough and heirloom fruit pastries at Oakridge Bakery',
    'Mentor apprentice baker Lucas Hernandez',
  ],
  clara: [
    'Preserve Smallville historical archives at Harvey Oak Library',
    'Co-host reading seminars with Mei Lin',
  ],
  devon: [
    'Build cedar street-lantern posts for Johnson Park and South Lane',
    'Maintain Southside market stalls and neighbors’ bicycles',
  ],
  priya: [
    'Coordinate Sunday’s Organic Harvest Pop-Up at St. Jude Community Plaza',
    'Supply fresh heirloom greens to Oakridge Bakery and Willows Market',
  ],
  lucas: [
    'Balance apprenticeship at Oakridge Bakery with astrophysics coursework',
    'Keep astronomy sky charts organized cleanly',
  ],
};

function block(
  id: string,
  hour: number,
  minute: number,
  durationMinutes: number,
  locationId: string,
  objectId: string | undefined,
  activity: string,
  emoji: string,
  kind: ScheduleBlockKind,
  subSteps?: string[],
  opts?: { oneOff?: boolean; fixed?: boolean; day?: number },
): ScheduleBlock {
  return {
    id,
    day: opts?.day ?? 1,
    kind,
    startMinute: hour * 60 + minute,
    durationMinutes,
    locationId,
    objectId,
    activity,
    subSteps,
    emoji,
    source: 'seed',
    ...(opts?.fixed ? { fixed: true } : {}),
    ...(opts?.oneOff ? { oneOff: true } : {}),
  };
}

const HOME_BED_BY_LOCATION: Record<string, string> = {
  oak_hill_college: 'obj_college_dorm_bed',
  oakridge_bakery: 'obj_bakery_bed',
  rose_crown_pub: 'obj_pub_bed',
  hobbs_cafe: 'obj_cafe_bed',
  town_hall: 'obj_hall_bed',
  harvey_library: 'obj_library_bed',
  smallville_clinic: 'obj_clinic_bed',
  willow_workshop: 'obj_workshop_bed',
  lin_home: 'obj_lin_kitchen',
  artist_cottages: 'obj_studio_easel',
  moore_cottages: 'obj_moore_desk',
};

function withWakeAndSleep(
  agentId: string,
  homeLocationId: string,
  dayBlocks: ScheduleBlock[],
): ScheduleBlock[] {
  const bedObjId = HOME_BED_BY_LOCATION[homeLocationId];
  const wakeBlock = block(
    `${agentId}_wake`,
    6,
    30,
    90,
    homeLocationId,
    bedObjId,
    'Waking up and eating a quiet morning breakfast',
    '🍳',
    'meal',
    ['Washing up and getting dressed', 'Preparing breakfast and tea'],
  );
  const sleepBlock = block(
    `${agentId}_sleep`,
    22,
    30,
    90,
    homeLocationId,
    bedObjId,
    'Sleeping peacefully in bed',
    '🛏️',
    'sleep',
    ['Turning out the lamp', 'Resting through the night'],
  );
  return [wakeBlock, ...dayBlocks, sleepBlock];
}

function edge(
  targetId: string,
  roleLabel: string,
  trust: number,
  affection: number,
  familiarity: number,
  inferredGoal: string,
  simMinutes: number,
): SocialEdge {
  return {
    targetId,
    roleLabel,
    trust,
    affection,
    familiarity,
    inferredGoal,
    lastUpdatedSimMin: simMinutes,
  };
}

function makeMood(valence: number, arousal: number, drives: AgentDrives) {
  return {
    valence,
    arousal,
    label: computeMoodLabel(valence, arousal, drives),
  };
}

export function createSeedAgents(startSimMin = 9 * 60): AgentState[] {
  const m = (
    id: string,
    offsetMin: number,
    type: 'observation' | 'reflection' | 'plan',
    description: string,
    importance: number,
  ) =>
    createMemoryNode({
      id,
      createdAt: Math.max(0, startSimMin - offsetMin),
      type,
      description,
      importance,
    });

  const isaDrives: AgentDrives = { energy: 86, hunger: 78, social: 82, purpose: 88 };
  const johnDrives: AgentDrives = { energy: 84, hunger: 82, social: 74, purpose: 80 };
  const meiDrives: AgentDrives = { energy: 82, hunger: 80, social: 68, purpose: 85 };
  const eddyDrives: AgentDrives = { energy: 78, hunger: 75, social: 62, purpose: 86 };
  const klausDrives: AgentDrives = { energy: 74, hunger: 64, social: 58, purpose: 82 };
  const mariaDrives: AgentDrives = { energy: 85, hunger: 60, social: 76, purpose: 80 };
  const samDrives: AgentDrives = { energy: 80, hunger: 78, social: 79, purpose: 84 };
  const arthurDrives: AgentDrives = { energy: 83, hunger: 76, social: 77, purpose: 78 };
  const abigailDrives: AgentDrives = { energy: 81, hunger: 72, social: 66, purpose: 90 };
  const rajivDrives: AgentDrives = { energy: 84, hunger: 74, social: 64, purpose: 87 };
  const wolfgangDrives: AgentDrives = { energy: 90, hunger: 62, social: 68, purpose: 83 };
  const haileyDrives: AgentDrives = { energy: 86, hunger: 70, social: 84, purpose: 89 };
  const elenaDrives: AgentDrives = { energy: 88, hunger: 76, social: 75, purpose: 91 };
  const mateoDrives: AgentDrives = { energy: 79, hunger: 84, social: 72, purpose: 88 };
  const claraDrives: AgentDrives = { energy: 77, hunger: 78, social: 65, purpose: 84 };
  const devonDrives: AgentDrives = { energy: 87, hunger: 68, social: 73, purpose: 86 };
  const priyaDrives: AgentDrives = { energy: 85, hunger: 75, social: 78, purpose: 89 };
  const lucasDrives: AgentDrives = { energy: 72, hunger: 61, social: 70, purpose: 82 };

  return [
    {
      id: 'isabella',
      name: 'Isabella Rodriguez',
      age: 28,
      occupation: 'Owner of Hobbs Cafe',
      homeLocationId: 'hobbs_cafe',
      traits: ['warm', 'outgoing', 'organized', 'community-minded'],
      goals: [...DEFAULT_GOALS_BY_AGENT.isabella],
      innateSummary:
        'Isabella Rodriguez is the warm, driven owner of Hobbs Cafe who loves bringing Smallville neighbors together.',
      currently:
        'Planning a Valentine’s Day party at Hobbs Cafe from 5:00 PM to 7:00 PM and ordering celebration tarts from Mateo.',
      appearance: {
        skin: '#E5B293',
        hair: '#3A231B',
        shirt: '#C2410C',
        pants: '#292524',
        accessory: 'apron',
      },
      x: 17,
      y: 22,
      targetX: 17,
      targetY: 22,
      path: [],
      facing: 'down',
      currentLocationId: 'hobbs_cafe',
      currentObjectId: 'obj_cafe_espresso',
      currentAction: 'Brewing morning espresso and decorating Hobbs Cafe',
      currentSubStep: 'Grinding espresso beans and hanging paper hearts',
      actionEmoji: '☕',
      drives: isaDrives,
      baselineMood: { valence: 0.42, arousal: 0.62 },
      mood: makeMood(0.45, 0.64, isaDrives),
      inventory: ['espresso portafilter', 'party flyers', 'crimson rose order'],
      memories: [
        m('isa_1', 240, 'observation', 'Isabella Rodriguez opened Hobbs Cafe early and wiped down the espresso counter.', 4),
        m('isa_2', 180, 'plan', 'Isabella is hosting a Valentine’s Day party at Hobbs Cafe today from 5:00 PM to 7:00 PM.', 9),
        m('isa_3', 120, 'observation', 'Isabella needs to invite Maria Lopez, Klaus Mueller, John Lin, Sam Moore, and Mateo Silva to the Valentine’s Day party.', 8),
        m('isa_4', 90, 'observation', 'Mateo Silva offered fresh berry tarts from Oakridge Hilltop Bakery if Isabella stops by before noon.', 6),
        m('isa_5', 60, 'reflection', 'Hobbs Cafe thrives when neighbors from all three districts feel personally welcomed.', 8),
      ],
      importanceAccumulator: 18,
      dailySchedule: withWakeAndSleep('isabella', 'hobbs_cafe', [
        block('isa_s0', 8, 0, 62, 'hobbs_cafe', 'obj_cafe_espresso', 'Opening Hobbs Cafe and preparing morning pastries', '☕', 'work', ['Dialing in espresso grind', 'Glazing raspberry croissants', 'Checking daily cafe stock']),
        block('isa_s1', 9, 2, 25, 'willows_market', 'obj_market_shelves', 'Picking up fresh roses and cinnamon for the Valentine’s party', '💐', 'errand', ['Selecting crimson roses', 'Chatting with John at the counter', 'Carrying flower basket back to the cafe'], { oneOff: true }),
        block('isa_s2', 9, 27, 93, 'hobbs_cafe', 'obj_cafe_espresso', 'Serving morning lattes and greeting regulars at Hobbs Cafe', '☕', 'work', ['Steaming oat milk lattes', 'Reviewing chalkboard lettering with Rajiv', 'Greeting morning regulars']),
        block('isa_s3', 11, 0, 60, 'johnson_park', 'obj_park_fountain', 'Handing out Valentine’s party flyers in Johnson Park', '💌', 'social', ['Pinning flyer by the fountain', 'Inviting strollers in the park'], { oneOff: true }),
        block('isa_s4', 12, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Serving lunch rush and chatting with neighbors', '🥐', 'meal', ['Plating warm paninis', 'Pouring iced americanos', 'Checking afternoon table seating']),
        block('isa_s5', 14, 0, 90, 'oakridge_bakery', 'obj_bakery_counter', 'Coordinating celebration berry tarts with Mateo at Oakridge Bakery', '🍰', 'errand', ['Sampling glaze with Mateo', 'Picking up festive tart boxes'], { oneOff: true }),
        block('isa_s6', 15, 30, 90, 'hobbs_cafe', 'obj_cafe_espresso', 'Setting up fairy lights and espresso bar for the Valentine’s party', '🎉', 'work', ['Stringing warm fairy lights', 'Arranging roses on window tables', 'Setting out pastry trays'], { oneOff: true }),
        block('isa_s7', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Hosting the Smallville Valentine’s Day party at Hobbs Cafe', '🥳', 'social', ['Welcoming neighbors at the door', 'Serving spiced cocoa and espresso', 'Toasting Smallville community'], { oneOff: true }),
        block('isa_s8', 19, 0, 180, 'rose_crown_pub', 'obj_pub_bar', 'Winding down in the evening at The Rose & Crown Pub', '🍷', 'meal', ['Sharing daily stories with Arthur', 'Relaxing over dinner and herbal tea']),
      ]),
      relationships: {
        maria: 'Close regular and friend at Hobbs Cafe',
        john: 'Friendly neighbor at Willows Market',
        mateo: 'Artisan baker supplying weekend pastries',
        klaus: 'Polite student who studies at the cafe',
        arthur: 'Fellow local business owner',
        hailey: 'Chats often about town stories over espresso',
      },
      socialGraph: {
        maria: edge('maria', 'Close regular & confidante', 78, 82, 85, 'Looking forward to taking a break from physics lab and relaxing at the party', startSimMin),
        john: edge('john', 'Trusted neighboring shopkeeper', 80, 68, 76, 'Preparing Willows Market morning stock and supporting local events', startSimMin),
        mateo: edge('mateo', 'Friendly baker rival & supplier', 76, 70, 74, 'Perfecting his sourdough & celebration tart recipes up on North Ridge', startSimMin),
        hailey: edge('hailey', 'Gazette journalist', 70, 64, 68, 'Hunting for human-interest angles on the Valentine’s party and election', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'john',
      name: 'John Lin',
      age: 45,
      occupation: 'Pharmacy Shopkeeper',
      homeLocationId: 'lin_home',
      traits: ['kind', 'observant', 'family-oriented', 'dependable'],
      goals: [...DEFAULT_GOALS_BY_AGENT.john],
      innateSummary:
        'John Lin runs Willows Market & Pharmacy with gentle care and coordinates herbal remedies with Dr. Elena Vance.',
      currently:
        'Walking from Lin Family Home to open Willows Market & Pharmacy for the morning.',
      appearance: {
        skin: '#EAC09E',
        hair: '#1F2937',
        shirt: '#0F766E',
        pants: '#334155',
        accessory: 'glasses',
      },
      x: 47,
      y: 5,
      targetX: 47,
      targetY: 5,
      path: [],
      facing: 'down',
      currentLocationId: 'lin_home',
      currentObjectId: 'obj_lin_kitchen',
      currentAction: 'Heading out from Lin Family Home to Willows Market',
      currentSubStep: 'Locking the front latch and checking pharmacy keys',
      actionEmoji: '💊',
      drives: johnDrives,
      baselineMood: { valence: 0.3, arousal: 0.45 },
      mood: makeMood(0.32, 0.46, johnDrives),
      inventory: ['pharmacy key ring', 'reading glasses', 'rose & cinnamon stock'],
      memories: [
        m('john_1', 210, 'observation', 'John Lin had morning tea with Mei and Eddy before heading to Willows Market.', 5),
        m('john_2', 150, 'observation', 'Dr. Elena Vance asked John to stock chamomile and calendula salves from her Southside greenhouse.', 6),
        m('john_3', 100, 'observation', 'Isabella Rodriguez ordered extra roses and cinnamon for Hobbs Cafe.', 7),
        m('john_4', 45, 'reflection', 'Connecting Southside growers like Priya and Elena with Main Street keeps Smallville resilient.', 7),
      ],
      importanceAccumulator: 14,
      dailySchedule: withWakeAndSleep('john', 'lin_home', [
        block('john_s0', 8, 0, 60, 'lin_home', 'obj_lin_kitchen', 'Having breakfast with Mei and Eddy at home', '🍵', 'meal', ['Steeping oolong tea', 'Toasting sourdough', 'Listening to Eddy’s melody ideas']),
        block('john_s1', 9, 0, 150, 'willows_market', 'obj_market_counter', 'Managing the pharmacy counter at Willows Market', '💊', 'work', ['Unlocking Willows Market shutters', 'Organizing prescriptions', 'Greeting morning shoppers']),
        block('john_s2', 11, 30, 60, 'hobbs_cafe', 'obj_cafe_table', 'Having lunch & coffee at Hobbs Cafe', '☕', 'meal', ['Ordering soup & americano', 'Chatting with Isabella at the counter']),
        block('john_s3', 12, 30, 180, 'willows_market', 'obj_market_shelves', 'Helping afternoon customers at Willows Market', '🛒', 'work', ['Restocking citrus and bouquets', 'Filling afternoon refills', 'Chatting with Sam about town matters']),
        block('john_s4', 15, 30, 90, 'community_garden', 'obj_garden_stall', 'Checking produce crates with Priya at St. Jude Plaza', '🥬', 'errand', ['Inspecting fresh greens crate', 'Discussing Sunday harvest pop-up']),
        block('john_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Visiting Hobbs Cafe with Mei for the Valentine’s party', '🎉', 'social', ['Joining Mei at a window table', 'Mingling with neighbors at the party'], { oneOff: true }),
        block('john_s6', 19, 0, 180, 'lin_home', 'obj_lin_kitchen', 'Cooking dinner at home with Mei and Eddy', '🍲', 'meal', ['Simmering ginger vegetable soup', 'Asking Eddy about Abigail’s film']),
      ]),
      relationships: {
        mei: 'Devoted husband of 21 years',
        eddy: 'Proud father supporting Eddy’s music',
        elena: 'Clinical collaborator for pharmacy formulations',
        priya: 'Fresh produce partner from Community Plaza',
        sam: 'Longtime friend and regular customer',
      },
      socialGraph: {
        mei: edge('mei', 'Beloved wife', 95, 92, 98, 'Focused on guiding her Oak Hill students thoughtfully today', startSimMin),
        eddy: edge('eddy', 'Son', 90, 94, 96, 'Eager to turn his piano sketches into a score with Abigail', startSimMin),
        elena: edge('elena', 'Physician partner', 84, 72, 80, 'Preparing herbal infusions while seeing morning clinic patients', startSimMin),
        sam: edge('sam', 'Old friend', 82, 74, 86, 'Weighing whether neighbors truly want him to run for mayor', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'mei',
      name: 'Mei Lin',
      age: 43,
      occupation: 'College Professor',
      homeLocationId: 'lin_home',
      traits: ['thoughtful', 'articulate', 'curious', 'patient'],
      goals: [...DEFAULT_GOALS_BY_AGENT.mei],
      innateSummary:
        'Mei Lin teaches humanities at Oak Hill College and participates in Clara Beaumont’s evening salon at Harvey Oak Library.',
      currently:
        'Walking from Lin Family Home to Oak Hill College for morning lectures and office hours.',
      appearance: {
        skin: '#ECC4A3',
        hair: '#27272A',
        shirt: '#7C3AED',
        pants: '#1E293B',
        accessory: 'scarf',
      },
      x: 52,
      y: 8,
      targetX: 52,
      targetY: 8,
      path: [],
      facing: 'left',
      currentLocationId: 'lin_home',
      currentObjectId: 'obj_lin_study',
      currentAction: 'Walking to Oak Hill College for morning office hours',
      currentSubStep: 'Packing seminar syllabus and crossing Johnson Park',
      actionEmoji: '🎓',
      drives: meiDrives,
      baselineMood: { valence: 0.25, arousal: 0.42 },
      mood: makeMood(0.26, 0.44, meiDrives),
      inventory: ['seminar syllabus', 'thermos of jasmine tea'],
      memories: [
        m('mei_1', 200, 'observation', 'Mei Lin brewed jasmine tea and discussed Eddy’s music project at breakfast.', 5),
        m('mei_2', 130, 'observation', 'Klaus Mueller asked Mei for feedback on his sociology fieldwork in Smallville.', 7),
        m('mei_3', 80, 'observation', 'Clara Beaumont invited Mei to review nineteenth-century Smallville town charters at Harvey Oak Library.', 7),
        m('mei_4', 30, 'reflection', 'Comparing town history in Clara’s archive with Klaus’s fieldwork gives students deeper roots.', 7),
      ],
      importanceAccumulator: 12,
      dailySchedule: withWakeAndSleep('mei', 'lin_home', [
        block('mei_s0', 8, 0, 60, 'lin_home', 'obj_lin_study', 'Preparing seminar notes at home', '📖', 'work', ['Annotating civic ethics readings', 'Sipping jasmine tea']),
        block('mei_s1', 9, 0, 180, 'oak_hill_college', 'obj_college_bookshelf', 'Teaching and holding office hours at Oak Hill College', '🎓', 'work', ['Leading morning humanities seminar', 'Pulling urban sociology texts', 'Holding student office hours']),
        block('mei_s2', 12, 0, 90, 'johnson_park', 'obj_park_bench_west', 'Eating lunch by Willow Creek in Johnson Park', '🥪', 'leisure', ['Unpacking lunch by the creek', 'Reading local Gazette editorial']),
        block('mei_s3', 13, 30, 120, 'harvey_library', 'obj_library_desk', 'Researching civic archives with Clara at Harvey Oak Library', '📚', 'work', ['Inspecting parish charters', 'Discussing seminar book list with Clara']),
        block('mei_s4', 15, 30, 90, 'willows_market', 'obj_market_counter', 'Stopping by Willows Market to check in with John', '💬', 'errand', ['Sharing campus updates with John', 'Picking up dinner greens']),
        block('mei_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Attending the Valentine’s party at Hobbs Cafe', '☕', 'social', ['Enjoying tea and pastries with John', 'Conversing with neighbors'], { oneOff: true }),
        block('mei_s6', 19, 0, 180, 'lin_home', 'obj_lin_kitchen', 'Sharing dinner and evening tea with John and Eddy', '🍵', 'meal', ['Setting the dining table', 'Listening to Eddy play his newest draft']),
      ]),
      relationships: {
        john: 'Loving wife of John Lin',
        eddy: 'Supportive mother to Eddy',
        klaus: 'Faculty advisor to Klaus Mueller',
        clara: 'Intellectual mentor at Harvey Oak Library',
      },
      socialGraph: {
        john: edge('john', 'Husband', 95, 92, 98, 'Wants a steady, peaceful day at the pharmacy before evening social', startSimMin),
        eddy: edge('eddy', 'Son', 92, 95, 96, 'Balancing studio ambition with his coursework', startSimMin),
        clara: edge('clara', 'Head librarian & friend', 86, 80, 82, 'Preserving Smallville oral histories and hosting thoughtful discussions', startSimMin),
        klaus: edge('klaus', 'Advisee', 80, 72, 78, 'Seeking validation on his fieldwork—and quietly distracted by Maria', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'eddy',
      name: 'Eddy Lin',
      age: 19,
      occupation: 'Music Composition Student',
      homeLocationId: 'lin_home',
      traits: ['creative', 'introspective', 'gentle', 'melodic'],
      goals: [...DEFAULT_GOALS_BY_AGENT.eddy],
      innateSummary:
        'Eddy Lin is studying music composition and spends hours sketching melodies on his upright piano.',
      currently:
        'Heading from Lin Family Home to Oak Hill College before collaborating with Abigail.',
      appearance: {
        skin: '#EAC2A1',
        hair: '#18181B',
        shirt: '#2563EB',
        pants: '#1F2937',
      },
      x: 54,
      y: 5,
      targetX: 54,
      targetY: 5,
      path: [],
      facing: 'up',
      currentLocationId: 'lin_home',
      currentObjectId: 'obj_lin_piano',
      currentAction: 'Composing a new piece on the upright piano',
      currentSubStep: 'Voicing soft seventh chords on the upright piano',
      actionEmoji: '🎹',
      drives: eddyDrives,
      baselineMood: { valence: 0.22, arousal: 0.48 },
      mood: makeMood(0.24, 0.5, eddyDrives),
      inventory: ['music manuscript notebook', 'pencil'],
      memories: [
        m('eddy_1', 180, 'observation', 'Eddy Lin worked out a chord progression inspired by rain in Johnson Park.', 6),
        m('eddy_2', 110, 'observation', 'Abigail Chen asked Eddy if he wanted to score her short animated film.', 8),
        m('eddy_3', 50, 'reflection', 'Collaborating with Abigail could turn my solo piano sketches into something bigger.', 7),
      ],
      importanceAccumulator: 15,
      dailySchedule: withWakeAndSleep('eddy', 'lin_home', [
        block('eddy_s0', 8, 0, 64, 'lin_home', 'obj_lin_piano', 'Practicing piano compositions at home', '🎹', 'work', ['Warming up arpeggios', 'Notating rain motif in manuscript book']),
        block('eddy_s1', 9, 4, 86, 'oak_hill_college', 'obj_college_bookshelf', 'Attending morning music theory study at Oak Hill', '🎼', 'work', ['Borrowing counterpoint scores', 'Reviewing harmonic cadence notes']),
        block('eddy_s2', 10, 30, 120, 'artist_cottages', 'obj_studio_desk', 'Discussing film scoring ideas with Abigail Chen', '🎬', 'work', ['Watching Abigail’s animatic reel', 'Timing musical cues to frame beats']),
        block('eddy_s3', 12, 30, 90, 'hobbs_cafe', 'obj_cafe_table', 'Grabbing lunch and listening to cafe acoustics', '☕', 'meal', ['Eating warm sourdough melt', 'Humming melody lines softly']),
        block('eddy_s4', 14, 0, 120, 'lin_home', 'obj_lin_piano', 'Recording piano motifs at Lin Family Home', '🎹', 'work', ['Mic’ing the upright piano', 'Recording two clean takes for Abigail']),
        block('eddy_s5', 16, 0, 90, 'johnson_park', 'obj_park_fountain', 'Sketching melody notes beside the park fountain', '🎵', 'leisure', ['Listening to water rhythms', 'Jotting counterpoint ideas']),
        block('eddy_s6', 17, 30, 90, 'hobbs_cafe', 'obj_cafe_table', 'Stopping by Hobbs Cafe for the Valentine’s party', '🎉', 'social', ['Congratulating Isabella on the turnout', 'Chatting with Maria and Lucas'], { oneOff: true }),
        block('eddy_s7', 19, 0, 180, 'lin_home', 'obj_lin_piano', 'Dinner and evening piano practice at home', '🎹', 'meal', ['Eating dinner with parents', 'Polishing final score barlines']),
      ]),
      relationships: {
        john: 'Son of John Lin',
        mei: 'Son of Mei Lin',
        abigail: 'Creative collaborator on animation music',
        lucas: 'Freshman campus friend and fellow daydreamer',
        maria: 'Campus friend at Oak Hill',
      },
      socialGraph: {
        abigail: edge('abigail', 'Creative collaborator', 78, 76, 72, 'Excited to lock down the emotional tone for her animated short', startSimMin),
        maria: edge('maria', 'Campus friend', 72, 68, 70, 'Juggling physics labs while keeping her evening social calendar open', startSimMin),
        lucas: edge('lucas', 'Campus friend', 74, 70, 64, 'Balancing overnight sky photography with early bakery shifts', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'klaus',
      name: 'Klaus Mueller',
      age: 20,
      occupation: 'Sociology Student',
      homeLocationId: 'oak_hill_college',
      traits: ['passionate', 'analytical', 'earnest', 'shy-romantic'],
      goals: [...DEFAULT_GOALS_BY_AGENT.klaus],
      innateSummary:
        'Klaus Mueller is an earnest sociology student researching urban gentrification while harboring a secret crush on Maria Lopez.',
      currently:
        'Walking from Oak Hill College toward Hobbs Cafe to read and maybe see Maria.',
      appearance: {
        skin: '#F0CBB0',
        hair: '#92400E',
        shirt: '#1D4ED8',
        pants: '#374151',
        accessory: 'glasses',
      },
      x: 7,
      y: 7,
      targetX: 7,
      targetY: 7,
      path: [],
      facing: 'up',
      currentLocationId: 'oak_hill_college',
      currentObjectId: 'obj_college_desk_klaus',
      currentAction: 'Writing sociology research notes at Oak Hill College',
      currentSubStep: 'Summarizing interviews on neighborhood gathering spaces',
      actionEmoji: '📝',
      drives: klausDrives,
      baselineMood: { valence: 0.16, arousal: 0.56 },
      mood: makeMood(0.18, 0.58, klausDrives),
      inventory: ['sociology field notes', 'library card'],
      memories: [
        m('klaus_1', 210, 'observation', 'Klaus Mueller spent the morning reading journal articles on community spaces.', 5),
        m('klaus_2', 140, 'observation', 'Maria Lopez smiled and shared her coffee notes with Klaus yesterday.', 8),
        m('klaus_3', 95, 'observation', 'Klaus secretly hopes Maria will be free to hang out later today.', 8),
        m('klaus_4', 40, 'reflection', 'Smallville’s third places like Hobbs Cafe, Bakery, and Harvey Oak Library keep neighbors connected.', 7),
      ],
      importanceAccumulator: 22,
      dailySchedule: withWakeAndSleep('klaus', 'oak_hill_college', [
        block('klaus_s0', 8, 0, 63, 'oak_hill_college', 'obj_college_desk_klaus', 'Researching sociology paper at Oak Hill College', '📝', 'work', ['Synthesizing field citations', 'Packing notebook for Hobbs Cafe']),
        block('klaus_s1', 9, 3, 117, 'hobbs_cafe', 'obj_cafe_table', 'Getting morning coffee and snack at Hobbs Cafe', '☕', 'meal', ['Ordering drip coffee & toast from Isabella', 'Reading urban sociology chapter by the window']),
        block('klaus_s2', 11, 0, 90, 'harvey_library', 'obj_library_archive', 'Checking historical census journals at Harvey Oak Library', '📚', 'work', ['Scanning neighborhood demography ledgers', 'Asking Clara for Smallville street maps']),
        block('klaus_s3', 12, 30, 90, 'johnson_park', 'obj_park_bench_west', 'Observing community foot traffic in Johnson Park', '👀', 'leisure', ['Logging park bench interactions', 'Resting outdoors in fresh air']),
        block('klaus_s4', 14, 0, 150, 'oak_hill_college', 'obj_college_desk_klaus', 'Writing paper draft in the college study hall', '📝', 'work', ['Drafting section on local third places', 'Meeting Mei for brief advisor feedback']),
        block('klaus_s5', 16, 30, 150, 'hobbs_cafe', 'obj_cafe_table', 'Heading to Hobbs Cafe for the Valentine’s party', '🎉', 'social', ['Helping arrange chairs', 'Working up courage to talk with Maria'], { oneOff: true }),
        block('klaus_s6', 19, 0, 180, 'oak_hill_college', 'obj_college_desk_klaus', 'Reviewing evening notes and supper in the dorm study hall', '🌙', 'meal', ['Eating warm dorm supper', 'Preparing tomorrow’s reading list']),
      ]),
      relationships: {
        maria: 'Secret crush and close study companion',
        mei: 'Respects Mei Lin as his favorite professor',
        clara: 'Helpful research guide at Harvey Oak Library',
        wolfgang: 'Dorm friend at Oak Hill',
      },
      socialGraph: {
        maria: edge('maria', 'Secret crush & study partner', 84, 91, 78, 'Curious whether she secretly wants to spend Valentine’s evening together', startSimMin),
        mei: edge('mei', 'Faculty advisor', 88, 72, 74, 'Expecting rigorous empirical grounding in my gentrification paper', startSimMin),
        clara: edge('clara', 'Head librarian', 82, 74, 68, 'Happy to pull archival town census books for earnest students', startSimMin),
        wolfgang: edge('wolfgang', 'Campus friend', 72, 65, 70, 'Trying to coax me out for a jog instead of living in books', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'maria',
      name: 'Maria Lopez',
      age: 21,
      occupation: 'Physics Student & Streamer',
      homeLocationId: 'oak_hill_college',
      traits: ['energetic', 'curious', 'sociable', 'playful'],
      goals: [...DEFAULT_GOALS_BY_AGENT.maria],
      innateSummary:
        'Maria Lopez balances computational physics labs at Oak Hill College with lively afternoon chats at Hobbs Cafe.',
      currently:
        'Walking from Oak Hill College to Hobbs Cafe for an iced latte and a chat with Isabella.',
      appearance: {
        skin: '#D69E7E',
        hair: '#1C1917',
        shirt: '#DB2777',
        pants: '#1E293B',
      },
      x: 13,
      y: 7,
      targetX: 13,
      targetY: 7,
      path: [],
      facing: 'up',
      currentLocationId: 'oak_hill_college',
      currentObjectId: 'obj_college_desk_maria',
      currentAction: 'Heading from Oak Hill to Hobbs Cafe for morning coffee',
      currentSubStep: 'Closing physics terminal and grabbing scarf',
      actionEmoji: '☕',
      drives: mariaDrives,
      baselineMood: { valence: 0.36, arousal: 0.65 },
      mood: makeMood(0.38, 0.66, mariaDrives),
      inventory: ['physics notebook', 'streaming mic clip'],
      memories: [
        m('maria_1', 190, 'observation', 'Maria Lopez debugged her particle kinematics homework at Oak Hill College.', 5),
        m('maria_2', 130, 'observation', 'Klaus Mueller always sits nearby at Hobbs Cafe and brings thoughtful book recommendations.', 7),
        m('maria_3', 75, 'observation', 'Isabella mentioned planning something special at Hobbs Cafe for Valentine’s Day.', 7),
        m('maria_4', 35, 'reflection', 'Lucas’s astronomy lens calibration notes actually improved our optics lab setup.', 6),
      ],
      importanceAccumulator: 16,
      dailySchedule: withWakeAndSleep('maria', 'oak_hill_college', [
        block('maria_s0', 8, 0, 60, 'oak_hill_college', 'obj_college_desk_maria', 'Working on physics lab simulation at Oak Hill', '💻', 'work', ['Plotting trajectory curves', 'Exporting lab figures']),
        block('maria_s1', 9, 0, 120, 'hobbs_cafe', 'obj_cafe_espresso', 'Grabbing morning espresso and breakfast at Hobbs Cafe', '☕', 'meal', ['Ordering iced vanilla latte and pastry', 'Chatting with neighbors at the counter']),
        block('maria_s2', 11, 0, 60, 'oak_hill_college', 'obj_college_desk_maria', 'Reviewing optics equations with Wolfgang & Lucas', '💻', 'work', ['Checking lab equations with Wolfgang']),
        block('maria_s3', 12, 0, 90, 'johnson_park', 'obj_park_fountain', 'Taking a brisk midday walk through Johnson Park', '🚶', 'leisure', ['Stretching legs around the pond', 'Taking reference photos for evening stream']),
        block('maria_s4', 13, 30, 150, 'oak_hill_college', 'obj_college_bookshelf', 'Studying quantum mechanics in the library', '📚', 'work', ['Working through wave packet exercises']),
        block('maria_s5', 16, 0, 180, 'hobbs_cafe', 'obj_cafe_table', 'Helping Isabella and attending the Hobbs Cafe Valentine’s party', '🥳', 'social', ['Helping plate raspberry croissants', 'Enjoying the Valentine’s party with Klaus and friends'], { oneOff: true }),
        block('maria_s6', 19, 0, 180, 'rose_crown_pub', 'obj_pub_table', 'Evening dinner and trivia hangout at Rose & Crown Pub', '🎲', 'meal', ['Sharing dinner & trivia questions', 'Laughing with Smallville friends']),
      ]),
      relationships: {
        isabella: 'Close friend from Hobbs Cafe',
        klaus: 'Smart study buddy she genuinely enjoys talking with',
        lucas: 'Astronomy lab freshman she tutors',
        wolfgang: 'Science lab classmate',
      },
      socialGraph: {
        isabella: edge('isabella', 'Close friend', 86, 88, 84, 'Excited for her Valentine’s party and hoping everyone shows up', startSimMin),
        klaus: edge('klaus', 'Thoughtful friend', 79, 76, 75, 'Always sweet and attentive—maybe looking for an excuse to ask me to the party', startSimMin),
        lucas: edge('lucas', 'Lab freshman', 74, 70, 66, 'Keen on stargazing but stretching himself thin with bakery mornings', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'sam',
      name: 'Sam Moore',
      age: 64,
      occupation: 'Retired Merchant & Mayoral Candidate',
      homeLocationId: 'moore_cottages',
      traits: ['civic-minded', 'deliberate', 'approachable', 'optimistic'],
      goals: [...DEFAULT_GOALS_BY_AGENT.sam],
      innateSummary:
        'Sam Moore lives in Southside Cottages, ran Smallville’s hardware store for decades, and is weighing a campaign for town mayor.',
      currently:
        'Walking from Town Hall to Johnson Park to greet neighbors and inspect where Devon’s new lanterns will stand.',
      appearance: {
        skin: '#E6BC9B',
        hair: '#CBD5E1',
        shirt: '#475569',
        pants: '#1E293B',
        accessory: 'hat',
      },
      x: 43,
      y: 22,
      targetX: 43,
      targetY: 22,
      path: [],
      facing: 'up',
      currentLocationId: 'town_hall',
      currentObjectId: 'obj_hall_podium',
      currentAction: 'Heading to Johnson Park for a morning neighborhood walk',
      currentSubStep: 'Checking town hall bulletin board before strolling out',
      actionEmoji: '🚶',
      drives: samDrives,
      baselineMood: { valence: 0.28, arousal: 0.46 },
      mood: makeMood(0.3, 0.48, samDrives),
      inventory: ['mayoral platform notes', 'pocket watch'],
      memories: [
        m('sam_1', 220, 'observation', 'Sam Moore read the Smallville Gazette column by Hailey Johnson about revitalizing Johnson Park.', 7),
        m('sam_2', 160, 'plan', 'Sam Moore is considering announcing his candidacy for mayor of Smallville.', 9),
        m('sam_3', 90, 'observation', 'Devon Brooks offered to craft cedar lantern posts for Johnson Park if Town Hall approves the plan.', 7),
        m('sam_4', 40, 'reflection', 'Southside Creek residents like Dr. Elena Vance and Priya want safer evening lighting along South Lane.', 8),
      ],
      importanceAccumulator: 24,
      dailySchedule: withWakeAndSleep('sam', 'moore_cottages', [
        block('sam_s0', 8, 0, 60, 'town_hall', 'obj_hall_podium', 'Reviewing civic budget notices at Town Hall', '🏛️', 'work', ['Reading park maintenance ledger', 'Straightening election notices']),
        block('sam_s1', 9, 0, 120, 'johnson_park', 'obj_park_bench_west', 'Walking Johnson Park and greeting morning strollers', '🚶', 'leisure', ['Inspecting Willow Creek footbridge', 'Greeting neighbors along the park path']),
        block('sam_s2', 11, 0, 120, 'willows_market', 'obj_market_counter', 'Checking in with John Lin at Willows Market', '💬', 'social', ['Asking John how small-shop foot traffic looks', 'Buying peppermints']),
        block('sam_s3', 13, 0, 120, 'willow_workshop', 'obj_workshop_bench', 'Reviewing park lantern timber blueprints with Devon Brooks', '🪚', 'work', ['Examining cedar lamp post sketches', 'Discussing South Lane trail lighting']),
        block('sam_s4', 15, 0, 120, 'town_hall', 'obj_hall_podium', 'Drafting platform notes for the mayor’s race', '✍️', 'work', ['Outlining Johnson Park lighting proposal', 'Practicing announcement remarks']),
        block('sam_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining the neighborhood Valentine’s party at Hobbs Cafe', '🎉', 'social', ['Congratulating Isabella', 'Talking casually with students and Southside neighbors'], { oneOff: true }),
        block('sam_s6', 19, 0, 180, 'rose_crown_pub', 'obj_pub_bar', 'Dinner and conversation with Arthur at The Rose & Crown', '🍺', 'meal', ['Debating local turnout with Arthur over supper', 'Enjoying an amber ale']),
      ]),
      relationships: {
        john: 'Decades-long friend',
        arthur: 'Trusted sounding board at the pub',
        devon: 'Crafts park woodwork with Sam’s civic committee',
        elena: 'Respects her calm Southside leadership',
        hailey: 'Respects her sharp local journalism',
      },
      socialGraph: {
        arthur: edge('arthur', 'Trusted confidant', 88, 80, 90, 'Keeping an ear to the ground for what pub regulars say about the election', startSimMin),
        devon: edge('devon', 'Town carpenter', 84, 76, 78, 'Keen to prove local craftsmen can build the park lantern upgrade on budget', startSimMin),
        elena: edge('elena', 'Southside neighbor', 82, 74, 72, 'Advocating clean air and pedestrian trails down in Southside Creek', startSimMin),
        hailey: edge('hailey', 'Local journalist', 68, 60, 66, 'Waiting to break the scoop on whether I officially file for mayor', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'arthur',
      name: 'Arthur Burton',
      age: 52,
      occupation: 'Bartender & Pub Owner',
      homeLocationId: 'rose_crown_pub',
      traits: ['perceptive', 'wry', 'hospitable', 'grounded'],
      goals: [...DEFAULT_GOALS_BY_AGENT.arthur],
      innateSummary:
        'Arthur Burton keeps The Rose & Crown Pub running smoothly and hears every story in Smallville.',
      currently:
        'Stopping by Willows Market for fresh lemons before opening The Rose & Crown Pub.',
      appearance: {
        skin: '#E0B294',
        hair: '#57534E',
        shirt: '#991B1B',
        pants: '#1C1917',
        accessory: 'apron',
      },
      x: 5,
      y: 22,
      targetX: 5,
      targetY: 22,
      path: [],
      facing: 'down',
      currentLocationId: 'rose_crown_pub',
      currentObjectId: 'obj_pub_bar',
      currentAction: 'Polishing glasses behind the mahogany bar',
      currentSubStep: 'Checking citrus inventory before walking to Willows Market',
      actionEmoji: '🍺',
      drives: arthurDrives,
      baselineMood: { valence: 0.2, arousal: 0.4 },
      mood: makeMood(0.22, 0.42, arthurDrives),
      inventory: ['pub cellar keys', 'trivia cards'],
      memories: [
        m('art_1', 200, 'observation', 'Arthur Burton organized stock deliveries at The Rose & Crown Pub.', 4),
        m('art_2', 135, 'observation', 'Sam Moore confided in Arthur about running for mayor.', 8),
        m('art_3', 70, 'observation', 'Devon Brooks tightened loose oak barstools last week in exchange for ginger beer.', 6),
        m('art_4', 25, 'reflection', 'A good bartender listens twice as much as he speaks.', 7),
      ],
      importanceAccumulator: 14,
      dailySchedule: withWakeAndSleep('arthur', 'rose_crown_pub', [
        block('art_s0', 8, 0, 65, 'rose_crown_pub', 'obj_pub_bar', 'Preparing The Rose & Crown Pub for the day', '🍺', 'work', ['Wiping oak tables', 'Counting cellar kegs']),
        block('art_s1', 9, 5, 45, 'willows_market', 'obj_market_counter', 'Picking up lemons and supplies at Willows Market', '🍋', 'errand', ['Picking fresh lemons and mint', 'Catching up with John']),
        block('art_s2', 9, 50, 130, 'rose_crown_pub', 'obj_pub_bar', 'Stocking the pub cellar and welcoming early visitors', '🍺', 'work', ['Slicing citrus garnishes', 'Prepping evening trivia cards']),
        block('art_s3', 12, 0, 90, 'community_garden', 'obj_garden_stall', 'Picking fresh mint and garnish herbs at Community Plaza', '🌿', 'errand', ['Chatting with Priya at the market stall', 'Stretching legs south of Main Street']),
        block('art_s4', 13, 30, 390, 'rose_crown_pub', 'obj_pub_bar', 'Tending the bar and hosting neighbors at Rose & Crown', '🍻', 'work', ['Pouring afternoon & evening pints', 'Listening to Sam’s campaign thoughts', 'Hosting trivia night']),
        block('art_s5', 20, 0, 150, 'rose_crown_pub', 'obj_pub_table', 'Having late supper and tidying up Rose & Crown Pub', '🍲', 'meal', ['Enjoying stew at the corner booth', 'Closing cellar latches for the night']),
      ]),
      relationships: {
        sam: 'Old friend and confidant',
        rajiv: 'Regular evening patron',
        devon: 'Friendly Southside carpenter who drinks ginger beer',
        isabella: 'Friendly hospitality peer',
      },
      socialGraph: {
        sam: edge('sam', 'Old friend', 88, 78, 92, 'Looking for honest encouragement before announcing a mayoral run', startSimMin),
        rajiv: edge('rajiv', 'Quiet regular', 78, 74, 72, 'Appreciates a quiet corner booth and good light for evening sketching', startSimMin),
        devon: edge('devon', 'Local carpenter', 76, 72, 70, 'Busy building street lanterns and fixing bicycles in Southside', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'abigail',
      name: 'Abigail Chen',
      age: 25,
      occupation: 'Digital Animator & Artist',
      homeLocationId: 'artist_cottages',
      traits: ['imaginative', 'expressive', 'observant', 'warm'],
      goals: [...DEFAULT_GOALS_BY_AGENT.abigail],
      innateSummary:
        'Abigail Chen is an animator working on an indie short film set in a cozy town much like Smallville.',
      currently:
        'Heading to Johnson Park fountain to sketch morning light and character poses.',
      appearance: {
        skin: '#ECC4A3',
        hair: '#312E81',
        shirt: '#7E22CE',
        pants: '#1F2937',
        accessory: 'beret',
      },
      x: 55,
      y: 23,
      targetX: 55,
      targetY: 23,
      path: [],
      facing: 'up',
      currentLocationId: 'artist_cottages',
      currentObjectId: 'obj_studio_easel',
      currentAction: 'Heading to Johnson Park to sketch reference frames',
      currentSubStep: 'Tucking charcoal pencils into her satchel',
      actionEmoji: '🎨',
      drives: abigailDrives,
      baselineMood: { valence: 0.34, arousal: 0.56 },
      mood: makeMood(0.35, 0.58, abigailDrives),
      inventory: ['charcoal sketchbook', 'storyboard cards'],
      memories: [
        m('abi_1', 190, 'observation', 'Abigail Chen finished background color keys for her short animation.', 6),
        m('abi_2', 120, 'observation', 'Eddy Lin agreed to explore composing a gentle piano score for her film.', 8),
        m('abi_3', 60, 'observation', 'Clara Beaumont showed Abigail archival lithographs of Smallville’s old bridge for scene reference.', 6),
        m('abi_4', 20, 'reflection', 'Real life in Johnson Park and Southside Meadow is the best reference for expressive animation.', 7),
      ],
      importanceAccumulator: 16,
      dailySchedule: withWakeAndSleep('abigail', 'artist_cottages', [
        block('abi_s0', 8, 0, 60, 'artist_cottages', 'obj_studio_desk', 'Animating morning keyframes at Artist Cottages', '🎨', 'work', ['Inking storyboard frames', 'Checking color palette notes']),
        block('abi_s1', 9, 0, 150, 'johnson_park', 'obj_park_fountain', 'Sketching people and light by the park fountain', '✏️', 'work', ['Capturing water reflections', 'Gesture-drawing passersby']),
        block('abi_s2', 11, 30, 120, 'hobbs_cafe', 'obj_cafe_table', 'Lunch break and espresso at Hobbs Cafe', '☕', 'meal', ['Comparing sketches over cappuccino and lunch', 'Chatting with Isabella']),
        block('abi_s3', 13, 30, 120, 'artist_cottages', 'obj_studio_desk', 'Collaborating with Eddy on film sound & pacing', '🎬', 'work', ['Reviewing Eddy’s piano demos', 'Syncing cut timing']),
        block('abi_s4', 15, 30, 90, 'harvey_library', 'obj_library_desk', 'Viewing historic bridge illustrations at Harvey Oak Library', '📖', 'work', ['Sketching historic bridge arches', 'Chatting quietly with Clara']),
        block('abi_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Attending the Valentine’s party at Hobbs Cafe', '🎉', 'social', ['Celebrating with Smallville neighbors'], { oneOff: true }),
        block('abi_s6', 19, 0, 180, 'artist_cottages', 'obj_studio_easel', 'Dinner and quiet evening sketching in the cottage', '🌙', 'meal', ['Sharing supper at home', 'Refining evening lighting studies']),
      ]),
      relationships: {
        eddy: 'Scoring collaborator on her animation',
        rajiv: 'Studio housemate and fellow artist',
        clara: 'Shares historical artwork from the library archive',
        isabella: 'Favorite cafe host',
      },
      socialGraph: {
        eddy: edge('eddy', 'Scoring collaborator', 82, 80, 74, 'Looking to find the exact emotional tempo for our fountain scene', startSimMin),
        rajiv: edge('rajiv', 'Studio housemate', 85, 80, 86, 'Developing his plein-air brushwork while helping Isabella with cafe art', startSimMin),
        clara: edge('clara', 'Librarian mentor', 78, 76, 70, 'Happy to share rare historic photos of Smallville creeks and bridges', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'rajiv',
      name: 'Rajiv Patel',
      age: 30,
      occupation: 'Painter & Sculptor',
      homeLocationId: 'artist_cottages',
      traits: ['reflective', 'patient', 'poetic', 'gentle'],
      goals: [...DEFAULT_GOALS_BY_AGENT.rajiv],
      innateSummary:
        'Rajiv Patel paints plein-air landscapes of Johnson Park and Community Plaza and enjoys quiet evenings at the pub.',
      currently:
        'Walking from Johnson Park to Hobbs Cafe to show Isabella chalkboard sign sketches.',
      appearance: {
        skin: '#B57B56',
        hair: '#171717',
        shirt: '#B45309',
        pants: '#292524',
      },
      x: 22,
      y: 9,
      targetX: 22,
      targetY: 9,
      path: [],
      facing: 'down',
      currentLocationId: 'johnson_park',
      currentObjectId: 'obj_park_bench_west',
      currentAction: 'Heading to Hobbs Cafe with chalkboard design sketches',
      currentSubStep: 'Tying watercolor folio before walking down Main Street',
      actionEmoji: '🖌️',
      drives: rajivDrives,
      baselineMood: { valence: 0.28, arousal: 0.38 },
      mood: makeMood(0.3, 0.4, rajivDrives),
      inventory: ['watercolor folio', 'cafe chalkboard sketches'],
      memories: [
        m('raj_1', 170, 'observation', 'Rajiv Patel packed watercolors early to catch morning light over Willow Creek.', 6),
        m('raj_2', 110, 'observation', 'Abigail Chen shared her animation storyboards with Rajiv over tea.', 6),
        m('raj_3', 55, 'observation', 'Isabella Rodriguez invited Rajiv to design a chalkboard sign for Hobbs Cafe.', 7),
        m('raj_4', 25, 'reflection', 'Watching Smallville wake up across North Ridge and Southside reveals rhythms no studio can teach.', 7),
      ],
      importanceAccumulator: 13,
      dailySchedule: withWakeAndSleep('rajiv', 'artist_cottages', [
        block('raj_s0', 8, 0, 61, 'johnson_park', 'obj_park_bench_west', 'Painting morning watercolors in Johnson Park', '🖌️', 'work', ['Laying morning sky wash', 'Sketching Willow Creek reflections']),
        block('raj_s1', 9, 1, 119, 'hobbs_cafe', 'obj_cafe_espresso', 'Dropping off seasonal chalkboard art sketches with Isabella', '☕', 'meal', ['Showing hand-lettered menu mockups', 'Enjoying breakfast pastry & cardamom latte']),
        block('raj_s2', 11, 0, 210, 'artist_cottages', 'obj_studio_easel', 'Working on oil canvases at Artist Cottages', '🎨', 'work', ['Mixing warm ochre underpainting', 'Critiquing light values with Abigail']),
        block('raj_s3', 14, 30, 120, 'community_garden', 'obj_garden_beds', 'Painting afternoon light studies among Southside garden beds', '🌾', 'work', ['Capturing heirloom foliage greens', 'Greeting Priya along the stone path']),
        block('raj_s4', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining friends at Hobbs Cafe for the Valentine’s party', '🎉', 'social', ['Admiring the finished cafe chalkboard', 'Talking art with Eddy and Maria'], { oneOff: true }),
        block('raj_s5', 19, 0, 180, 'rose_crown_pub', 'obj_pub_table', 'Supper with a pint and sketchbook at Rose & Crown', '🍺', 'meal', ['Having pub supper in the corner booth', 'Drawing charcoal portraits and chatting with Arthur']),
      ]),
      relationships: {
        abigail: 'Studio peer and close creative friend',
        arthur: 'Enjoys quiet conversations at the pub',
        priya: 'Models Southside garden beds for his afternoon paintings',
        isabella: 'Commissioned him for cafe chalkboard art',
      },
      socialGraph: {
        abigail: edge('abigail', 'Studio housemate', 85, 82, 86, 'Pouring heart into her Smallville animation keys', startSimMin),
        isabella: edge('isabella', 'Patron & friend', 78, 74, 70, 'Eager to hang the new seasonal chalkboard menu before noon', startSimMin),
        arthur: edge('arthur', 'Pub host', 80, 74, 75, 'Appreciates unhurried conversation once the evening rush settles', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'wolfgang',
      name: 'Wolfgang Schulz',
      age: 21,
      occupation: 'Chemistry Student & Track Runner',
      homeLocationId: 'oak_hill_college',
      traits: ['disciplined', 'upbeat', 'competitive', 'loyal'],
      goals: [...DEFAULT_GOALS_BY_AGENT.wolfgang],
      innateSummary:
        'Wolfgang Schulz studies organic chemistry at Oak Hill College, trains on the park trails, and gets his bike tuned at Willow Workshop.',
      currently:
        'Jogging across Johnson Park before heading into Oak Hill College for chemistry lab.',
      appearance: {
        skin: '#F3D2B8',
        hair: '#D97706',
        shirt: '#15803D',
        pants: '#1E293B',
      },
      x: 38,
      y: 9,
      targetX: 38,
      targetY: 9,
      path: [],
      facing: 'left',
      currentLocationId: 'johnson_park',
      currentObjectId: 'obj_park_bench_east',
      currentAction: 'Cooling down from morning park run before chemistry lab',
      currentSubStep: 'Checking split times and hydrating near Blossom Grove',
      actionEmoji: '🏃',
      drives: wolfgangDrives,
      baselineMood: { valence: 0.34, arousal: 0.68 },
      mood: makeMood(0.36, 0.7, wolfgangDrives),
      inventory: ['stopwatch', 'organic chem lab manual'],
      memories: [
        m('wolf_1', 150, 'observation', 'Wolfgang Schulz ran four crisp laps around Johnson Park before sunrise.', 5),
        m('wolf_2', 90, 'observation', 'Maria Lopez invited Wolfgang to compare lab scripts later today at Oak Hill.', 6),
        m('wolf_3', 50, 'observation', 'Wolfgang noticed Klaus Mueller rehearsing what to say to Maria at Hobbs Cafe.', 7),
        m('wolf_4', 20, 'reflection', 'Training steadily every morning keeps both lab focus and campus friendships sharp.', 6),
      ],
      importanceAccumulator: 12,
      dailySchedule: withWakeAndSleep('wolfgang', 'oak_hill_college', [
        block('wolf_s0', 8, 0, 62, 'johnson_park', 'obj_park_bench_east', 'Running morning track intervals in Johnson Park', '🏃', 'leisure', ['Warming up around Willows Creek', 'Stretching quads at Blossom Grove']),
        block('wolf_s1', 9, 2, 148, 'oak_hill_college', 'obj_college_desk_maria', 'Running chemistry lab prep at Oak Hill College', '🧪', 'work', ['Calibrating titration glassware', 'Reviewing synthesis yields with Maria']),
        block('wolf_s2', 11, 30, 90, 'oakridge_bakery', 'obj_bakery_table', 'Refueling with sourdough sandwich and espresso at Oakridge Bakery', '🥐', 'meal', ['Eating hearty protein toast from Mateo', 'Chatting with Mateo about marathon carb loading']),
        block('wolf_s3', 13, 0, 150, 'oak_hill_college', 'obj_college_bookshelf', 'Studying organic mechanisms in Oak Hill library', '📚', 'work', ['Diagramming reaction pathways']),
        block('wolf_s4', 15, 30, 90, 'willow_workshop', 'obj_workshop_bikerack', 'Getting road bicycle tuned by Devon at Willow Workshop', '🚲', 'errand', ['Truing front wheel spokes', 'Swapping brake cables with Devon']),
        block('wolf_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining Oak Hill friends at Hobbs Cafe Valentine’s party', '🎉', 'social', ['Bringing cheerful energy to the party'], { oneOff: true }),
        block('wolf_s6', 19, 0, 180, 'rose_crown_pub', 'obj_pub_table', 'Evening dinner and trivia at Rose & Crown Pub', '🎲', 'meal', ['Eating pub dinner with friends', 'Covering science trivia categories']),
      ]),
      relationships: {
        maria: 'Lab peer and friend',
        klaus: 'Dorm mate who needs a confidence boost',
        mateo: 'Favorite bakery fueling partner',
        devon: 'Trusts Devon for road bike repairs',
      },
      socialGraph: {
        klaus: edge('klaus', 'Dorm mate', 76, 74, 78, 'Overthinking how to talk to Maria when he should just invite her warmly', startSimMin),
        maria: edge('maria', 'Science classmate', 74, 68, 72, 'Enjoys brisk intellectual banter and lively evening hangouts', startSimMin),
        devon: edge('devon', 'Bike mechanic', 78, 70, 68, 'Always happy to talk bike gear ratios and park trails', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'hailey',
      name: 'Hailey Johnson',
      age: 30,
      occupation: 'Smallville Gazette Journalist',
      homeLocationId: 'town_hall',
      traits: ['inquisitive', 'sharp-eyed', 'empathetic', 'articulate'],
      goals: [...DEFAULT_GOALS_BY_AGENT.hailey],
      innateSummary:
        'Hailey Johnson writes the Smallville Gazette civic column, tracking every local story from Sam Moore’s mayoral ambitions to Southside’s harvest market.',
      currently:
        'Leaving Town Hall with her press notebook to interview neighbors along Main Street and Hobbs Cafe.',
      appearance: {
        skin: '#8D5524',
        hair: '#1C1917',
        shirt: '#0284C7',
        pants: '#1E293B',
        accessory: 'glasses',
      },
      x: 46,
      y: 23,
      targetX: 46,
      targetY: 23,
      path: [],
      facing: 'left',
      currentLocationId: 'town_hall',
      currentObjectId: 'obj_hall_gazette',
      currentAction: 'Heading out from the Gazette desk to interview Smallville residents',
      currentSubStep: 'Tucking fountain pen and reporter pad into coat pocket',
      actionEmoji: '🗞️',
      drives: haileyDrives,
      baselineMood: { valence: 0.3, arousal: 0.6 },
      mood: makeMood(0.32, 0.62, haileyDrives),
      inventory: ['Gazette press badge', 'shorthand notebook'],
      memories: [
        m('hail_1', 180, 'observation', 'Hailey Johnson filed an editorial on revitalizing Johnson Park’s evening lanterns.', 7),
        m('hail_2', 120, 'observation', 'Hailey noticed Sam Moore reviewing park budgets closely and suspects he may run for mayor.', 8),
        m('hail_3', 70, 'observation', 'Isabella Rodriguez invited Hailey to cover the 5:00 PM Valentine’s Day community mixer at Hobbs Cafe.', 7),
        m('hail_4', 30, 'reflection', 'Covering North Ridge bakery craft, Southside clinic wellness, and Town Hall keeps Smallville connected.', 8),
      ],
      importanceAccumulator: 17,
      dailySchedule: withWakeAndSleep('hailey', 'town_hall', [
        block('hail_s0', 8, 0, 61, 'town_hall', 'obj_hall_gazette', 'Proofing morning edition notes at the Gazette desk', '🗞️', 'work', ['Fact-checking Town Hall minutes', 'Drafting interview questions for Sam']),
        block('hail_s1', 9, 1, 119, 'hobbs_cafe', 'obj_cafe_table', 'Interviewing morning coffee crowd over breakfast at Hobbs Cafe', '☕', 'meal', ['Ordering brioche & espresso', 'Listening for local stories over coffee']),
        block('hail_s2', 11, 0, 90, 'smallville_clinic', 'obj_clinic_apothecary', 'Reporting a community health feature with Dr. Elena Vance', '🎙️', 'work', ['Inspecting medicinal herb greenhouse', 'Asking Elena about Southside safety lighting']),
        block('hail_s3', 12, 30, 150, 'town_hall', 'obj_hall_gazette', 'Writing afternoon Smallville Gazette feature column', '✍️', 'work', ['Typing lead paragraphs on civic issues', 'Formatting town community calendar']),
        block('hail_s4', 15, 0, 90, 'community_garden', 'obj_garden_stall', 'Covering Sunday harvest pop-up story with Priya Nair', '🌾', 'work', ['Snapping garden photos', 'Asking about neighborhood farm shares']),
        block('hail_s5', 16, 30, 150, 'hobbs_cafe', 'obj_cafe_table', 'Covering the Valentine’s Day party at Hobbs Cafe', '🎉', 'social', ['Collecting quotes from guests', 'Enjoying warm pastries off the clock'], { oneOff: true }),
        block('hail_s6', 19, 0, 180, 'rose_crown_pub', 'obj_pub_bar', 'Evening town supper and debrief at the Pub', '🍺', 'meal', ['Eating supper and chatting with Arthur and Sam']),
      ]),
      relationships: {
        sam: 'Key civic source for mayoral coverage',
        isabella: 'Reliable source on neighborhood life',
        elena: 'Respects Dr. Vance’s community health insights',
        priya: 'Featured St. Jude Garden in weekend arts & food column',
      },
      socialGraph: {
        sam: edge('sam', 'Civic source', 72, 66, 70, 'Nearly ready to go public with his mayoral candidacy if neighbors back him', startSimMin),
        isabella: edge('isabella', 'Community hub', 80, 78, 76, 'Determined to bring Smallville together tonight at Hobbs Cafe', startSimMin),
        elena: edge('elena', 'Clinic physician', 80, 72, 66, 'Focused on preventative care and greener walkways south of Main Street', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },

    // --- 6 NEW RESIDENTS ACROSS EXPANDED 3-DISTRICT TOWN ---
    {
      id: 'elena',
      name: 'Dr. Elena Vance',
      age: 38,
      occupation: 'Town Physician & Botanist',
      homeLocationId: 'smallville_clinic',
      traits: ['calm', 'observant', 'compassionate', 'scientific'],
      goals: [...DEFAULT_GOALS_BY_AGENT.elena],
      innateSummary:
        'Dr. Elena Vance runs Smallville Clinic & Greenhouse in Southside Creek, combining primary medical care with an apothecary greenhouse.',
      currently:
        'Checking morning clinic charts before walking up Main Street to coordinate herbal remedies with John Lin.',
      appearance: {
        skin: '#D6A484',
        hair: '#451A03',
        shirt: '#0369A1',
        pants: '#1E293B',
        accessory: 'glasses',
      },
      x: 6,
      y: 37,
      targetX: 6,
      targetY: 37,
      path: [],
      facing: 'down',
      currentLocationId: 'smallville_clinic',
      currentObjectId: 'obj_clinic_exam',
      currentAction: 'Preparing clinic charts and inspecting botanical tinctures',
      currentSubStep: 'Checking blood-pressure cuffs and steeping herbal samples',
      actionEmoji: '🩺',
      drives: elenaDrives,
      baselineMood: { valence: 0.3, arousal: 0.45 },
      mood: makeMood(0.32, 0.46, elenaDrives),
      inventory: ['brass stethoscope', 'chamomile tincture vials'],
      memories: [
        m('elena_1', 195, 'observation', 'Dr. Elena Vance watered medicinal thyme and calendula seedlings in the clinic greenhouse.', 5),
        m('elena_2', 130, 'observation', 'John Lin requested fresh chamomile and ginger tincture bottles for Willows Market shelves.', 7),
        m('elena_3', 80, 'observation', 'Sam Moore discussed adding pedestrian lantern posts along South Lane during his last checkup.', 8),
        m('elena_4', 35, 'reflection', 'Healthy towns rely just as much on safe evening walks and community warmth as on prescriptions.', 7),
      ],
      importanceAccumulator: 16,
      dailySchedule: withWakeAndSleep('elena', 'smallville_clinic', [
        block('elena_s0', 8, 0, 62, 'smallville_clinic', 'obj_clinic_exam', 'Morning clinic rounds and greenhouse care', '🩺', 'work', ['Checking morning wellness schedule', 'Watering calendula beds']),
        block('elena_s1', 9, 2, 118, 'willows_market', 'obj_market_counter', 'Delivering botanical remedies and comparing pharmacy notes with John Lin', '🌿', 'work', ['Restocking chamomile drops', 'Discussing winter flu wellness with John']),
        block('elena_s2', 11, 0, 120, 'smallville_clinic', 'obj_clinic_apothecary', 'Seeing clinic patients and speaking with reporter Hailey Johnson', '🩺', 'work', ['Welcoming morning appointments', 'Giving Hailey quotes on neighborhood wellness']),
        block('elena_s3', 13, 0, 90, 'oakridge_bakery', 'obj_bakery_table', 'Lunch break with warm seeded sourdough at Oakridge Bakery', '🥪', 'meal', ['Trying Mateo’s rosemary focaccia', 'Catching breath away from clinic']),
        block('elena_s4', 14, 30, 150, 'smallville_clinic', 'obj_clinic_exam', 'Afternoon patient appointments and herbal compounding', '⚗️', 'work', ['Updating patient wellness files', 'Steeping soothing teas']),
        block('elena_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining Smallville neighbors at Hobbs Cafe Valentine’s party', '🎉', 'social', ['Celebrating with neighbors from Southside and Main Street'], { oneOff: true }),
        block('elena_s6', 19, 0, 180, 'smallville_clinic', 'obj_clinic_apothecary', 'Evening supper and medical reading in clinic quarters', '📖', 'meal', ['Preparing warm herbal broth', 'Reviewing botanical pharmacology notes']),
      ]),
      relationships: {
        john: 'Trusted pharmacy supply collaborator',
        priya: 'Shares Southside botanical & soil tips',
        sam: 'Encourages Sam’s South Lane lantern safety push',
        hailey: 'Respects Hailey’s civic health reporting',
      },
      socialGraph: {
        john: edge('john', 'Pharmacy colleague', 88, 76, 84, 'Always reliable when neighbors need careful remedies', startSimMin),
        priya: edge('priya', 'Southside agronomist', 84, 82, 76, 'Growing vibrant medicinal and culinary herbs right next door', startSimMin),
        sam: edge('sam', 'Civic advocate', 80, 74, 74, 'Needs clear public backing to champion Southside infrastructure as mayor', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'mateo',
      name: 'Mateo Silva',
      age: 34,
      occupation: 'Master Baker at Oakridge Bakery',
      homeLocationId: 'oakridge_bakery',
      traits: ['generous', 'perfectionist', 'early-riser', 'jovial'],
      goals: [...DEFAULT_GOALS_BY_AGENT.mateo],
      innateSummary:
        'Mateo Silva wakes before dawn to fire Oakridge Hilltop Bakery’s brick oven, baking crusty sourdough and fruit tarts for all of Smallville.',
      currently:
        'Pulling a tray of sourdough loaves from the brick oven and mentoring apprentice baker Lucas.',
      appearance: {
        skin: '#D49B78',
        hair: '#292524',
        shirt: '#EA580C',
        pants: '#334155',
        accessory: 'apron',
      },
      x: 64,
      y: 5,
      targetX: 64,
      targetY: 5,
      path: [],
      facing: 'right',
      currentLocationId: 'oakridge_bakery',
      currentObjectId: 'obj_bakery_oven',
      currentAction: 'Pulling fresh sourdough & tarts from the brick oven',
      currentSubStep: 'Brushing warm apricot glaze onto morning tarts',
      actionEmoji: '🥖',
      drives: mateoDrives,
      baselineMood: { valence: 0.36, arousal: 0.58 },
      mood: makeMood(0.38, 0.6, mateoDrives),
      inventory: ['starter levain jar', 'baker peel', 'sample berry tartlets'],
      memories: [
        m('mat_1', 210, 'observation', 'Mateo Silva fired the Oakridge brick oven at 5:30 AM and pulled golden loaves.', 5),
        m('mat_2', 130, 'observation', 'Priya Nair promised heirloom blackberries and squash from St. Jude Garden for Sunday market.', 7),
        m('mat_3', 85, 'observation', 'Isabella Rodriguez asked Mateo about extra celebration tarts for her 5 PM party at Hobbs Cafe.', 8),
        m('mat_4', 30, 'reflection', 'Fresh bread connects North Ridge mornings directly with Main Street cafes and Southside gardens.', 7),
      ],
      importanceAccumulator: 16,
      dailySchedule: withWakeAndSleep('mateo', 'oakridge_bakery', [
        block('mat_s0', 8, 0, 65, 'oakridge_bakery', 'obj_bakery_oven', 'Morning brick-oven bake at Oakridge Bakery', '🥖', 'work', ['Scoring sourdough boules', 'Pulling cinnamon rolls']),
        block('mat_s1', 9, 5, 115, 'oakridge_bakery', 'obj_bakery_counter', 'Serving morning bread rush and training Lucas', '🥐', 'work', ['Packing warm paper bread bags', 'Showing Lucas butter-lamination folds']),
        block('mat_s2', 11, 0, 60, 'willows_market', 'obj_market_shelves', 'Dropping fresh sourdough crates at Willows Market', '🛍️', 'errand', ['Stacking crusty rye loaves for John', 'Buying butter & nutmeg']),
        block('mat_s3', 12, 0, 120, 'oakridge_bakery', 'obj_bakery_table', 'Lunch service and sourdough sandwiches at the bakery', '🥪', 'meal', ['Slicing warm focaccia sandwiches', 'Chatting with Wolfgang and Elena']),
        block('mat_s4', 14, 0, 150, 'oakridge_bakery', 'obj_bakery_oven', 'Baking Valentine celebration tarts with Isabella', '🍰', 'work', ['Glazing berry tartlets', 'Boxing pastry assortment for Hobbs Cafe'], { oneOff: true }),
        block('mat_s5', 16, 30, 150, 'hobbs_cafe', 'obj_cafe_table', 'Delivering fresh tarts and enjoying the Valentine’s party', '🎉', 'social', ['Bringing warm pastry platters to Isabella', 'Tasting espresso pairings'], { oneOff: true }),
        block('mat_s6', 19, 0, 180, 'oakridge_bakery', 'obj_bakery_counter', 'Evening dinner, sourdough levain, and tomorrow’s sponge', '🌙', 'meal', ['Eating warm supper above the oven', 'Mixing overnight levain quietly']),
      ]),
      relationships: {
        isabella: 'Fellow hospitality owner and pastry collaborator',
        lucas: 'Apprentice baker he mentors kindly',
        priya: 'Supplies fresh harvest produce for seasonal loaves',
        john: 'Stocks Oakridge bread at Willows Market',
      },
      socialGraph: {
        isabella: edge('isabella', 'Pastry partner', 84, 80, 78, 'Determined to make tonight’s Hobbs Cafe party unforgettable', startSimMin),
        lucas: edge('lucas', 'Apprentice baker', 82, 78, 76, 'Learning bread craft patiently even after late-night telescope sessions', startSimMin),
        priya: edge('priya', 'Grower partner', 86, 78, 74, 'Organizing Sunday’s Community Plaza farmers harvest stall', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'clara',
      name: 'Clara Beaumont',
      age: 64,
      occupation: 'Head Librarian & Town Archivist',
      homeLocationId: 'harvey_library',
      traits: ['wise', 'cultured', 'methodical', 'wry'],
      goals: [...DEFAULT_GOALS_BY_AGENT.clara],
      innateSummary:
        'Clara Beaumont curates Harvey Oak Library and Smallville’s civic archives, mentoring students and hosting lively reading salons.',
      currently:
        'Shelving parish records at Harvey Oak Library before strolling to Hobbs Cafe for morning tea.',
      appearance: {
        skin: '#EAD2BC',
        hair: '#E2E8F0',
        shirt: '#3730A3',
        pants: '#1E293B',
        accessory: 'glasses',
      },
      x: 67,
      y: 22,
      targetX: 67,
      targetY: 22,
      path: [],
      facing: 'down',
      currentLocationId: 'harvey_library',
      currentObjectId: 'obj_library_archive',
      currentAction: 'Indexing Smallville civic journals in Harvey Oak Library',
      currentSubStep: 'Filing 1920s Willow Creek bridge blueprints cleanly',
      actionEmoji: '🗂️',
      drives: claraDrives,
      baselineMood: { valence: 0.24, arousal: 0.38 },
      mood: makeMood(0.25, 0.4, claraDrives),
      inventory: ['brass library keys', 'Smallville history monograph'],
      memories: [
        m('cla_1', 200, 'observation', 'Clara Beaumont dusted the tall oak archives and lit brass lamps in Harvey Oak Library.', 5),
        m('cla_2', 140, 'observation', 'Klaus Mueller reserved historical census maps to support his Smallville housing study.', 7),
        m('cla_3', 85, 'observation', 'Mei Lin offered to co-host next week’s library philosophy seminar.', 7),
        m('cla_4', 40, 'reflection', 'Every debate about Smallville’s future echoes stories preserved here in the library.', 8),
      ],
      importanceAccumulator: 14,
      dailySchedule: withWakeAndSleep('clara', 'harvey_library', [
        block('cla_s0', 8, 0, 65, 'harvey_library', 'obj_library_archive', 'Opening Harvey Oak Library and catalog indexing', '🗂️', 'work', ['Sorting morning book returns', 'Pulling Klaus’s census folios']),
        block('cla_s1', 9, 5, 55, 'hobbs_cafe', 'obj_cafe_table', 'Morning Earl Grey tea & croissant at Hobbs Cafe', '🍵', 'meal', ['Greeting Isabella warmly', 'Scanning the Smallville Gazette']),
        block('cla_s2', 10, 0, 210, 'harvey_library', 'obj_library_desk', 'Helping researchers & students at Harvey Oak Library', '📚', 'work', ['Pulling historic bridge art for Abigail', 'Guiding Klaus through town archives']),
        block('cla_s3', 13, 30, 90, 'harvey_library', 'obj_library_archive', 'Hosting Mei Lin for afternoon archival research', '📖', 'work', ['Reviewing early town charters', 'Planning library reading salon']),
        block('cla_s4', 15, 0, 120, 'johnson_park', 'obj_park_bench_west', 'Strolling past Willow Creek with her history notebook', '🌿', 'leisure', ['Enjoying afternoon sun by the footbridge']),
        block('cla_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining the neighborhood Valentine’s mixer at Hobbs Cafe', '🎉', 'social', ['Sharing town anecdotes over spiced tea'], { oneOff: true }),
        block('cla_s6', 19, 0, 180, 'harvey_library', 'obj_library_desk', 'Supper and quiet evening reading in the library quarters', '🕯️', 'meal', ['Enjoying light supper & herbal tea', 'Logging today’s archive additions']),
      ]),
      relationships: {
        mei: 'Close academic friend and salon co-host',
        klaus: 'Diligent young sociologist she mentors',
        abigail: 'Shares historic Smallville sketches with her',
        sam: 'Remembers when Sam’s grandfather opened Moore Hardware',
      },
      socialGraph: {
        mei: edge('mei', 'Colleague & friend', 90, 84, 86, 'Building thoughtful bridges between Oak Hill seminars and town history', startSimMin),
        klaus: edge('klaus', 'Student researcher', 84, 78, 72, 'Earnest scholar who lights up whenever Maria enters the room', startSimMin),
        sam: edge('sam', 'Longtime resident', 82, 72, 88, 'Balancing cautious humility with genuine desire to serve as mayor', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'devon',
      name: 'Devon Brooks',
      age: 27,
      occupation: 'Carpenter & Bike Mechanic',
      homeLocationId: 'willow_workshop',
      traits: ['practical', 'cheerful', 'inventive', 'hands-on'],
      goals: [...DEFAULT_GOALS_BY_AGENT.devon],
      innateSummary:
        'Devon Brooks builds timber street lanterns and maintains Smallville’s bicycles out of Willow Workshop & Forge in Southside Creek.',
      currently:
        'Measuring cedar joints at Willow Workshop before checking Johnson Park lantern footings.',
      appearance: {
        skin: '#6F4E37',
        hair: '#171717',
        shirt: '#B45309',
        pants: '#1E293B',
      },
      x: 48,
      y: 37,
      targetX: 48,
      targetY: 37,
      path: [],
      facing: 'down',
      currentLocationId: 'willow_workshop',
      currentObjectId: 'obj_workshop_bench',
      currentAction: 'Crafting cedar lantern posts at Willow Workshop',
      currentSubStep: 'Checking chisel edge and squaring oak mortises',
      actionEmoji: '🪚',
      drives: devonDrives,
      baselineMood: { valence: 0.34, arousal: 0.62 },
      mood: makeMood(0.35, 0.62, devonDrives),
      inventory: ['brass caliper', 'bike spoke wrench', 'cedar blueprint'],
      memories: [
        m('dev_1', 190, 'observation', 'Devon Brooks milled cedar beams for six new Johnson Park lantern posts.', 6),
        m('dev_2', 120, 'observation', 'Sam Moore asked Devon to draft an estimate for lighting South Lane and Johnson Park paths.', 8),
        m('dev_3', 75, 'observation', 'Priya Nair stopped by to ask for a cedar awning repair at St. Jude Community Market stall.', 6),
        m('dev_4', 30, 'reflection', 'Craftsmanship turns civic ideas into places neighbors actually gather safely after dusk.', 7),
      ],
      importanceAccumulator: 16,
      dailySchedule: withWakeAndSleep('devon', 'willow_workshop', [
        block('dev_s0', 8, 0, 63, 'willow_workshop', 'obj_workshop_bench', 'Milling cedar lantern joints at Willow Workshop', '🪚', 'work', ['Squaring lantern brackets', 'Staining weatherproof caps']),
        block('dev_s1', 9, 3, 87, 'johnson_park', 'obj_park_fountain', 'Measuring evening lantern sites along Johnson Park paths', '📐', 'work', ['Checking path clearances near bridge', 'Greeting morning runners and strollers']),
        block('dev_s2', 10, 30, 120, 'community_garden', 'obj_garden_stall', 'Reinforcing timber market stall with Priya Nair', '🔨', 'work', ['Tightening market stall rafters', 'Drinking fresh mint tea with Priya']),
        block('dev_s3', 12, 30, 180, 'willow_workshop', 'obj_workshop_bench', 'Meeting Sam Moore & tuning bikes at Willow Workshop', '🚲', 'work', ['Reviewing lantern blueprint with Sam', 'Tuning Wolfgang’s road bike']),
        block('dev_s4', 15, 30, 90, 'willow_workshop', 'obj_workshop_bikerack', 'Finishing afternoon workshop repairs', '🔧', 'work', ['Lacing wheel spokes', 'Sweeping cedar shavings']),
        block('dev_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Heading to Hobbs Cafe Valentine’s gathering', '🎉', 'social', ['Celebrating with Main Street and Southside friends'], { oneOff: true }),
        block('dev_s6', 19, 0, 180, 'rose_crown_pub', 'obj_pub_bar', 'Supper, ginger beer, and stories with Arthur at Rose & Crown', '🍺', 'meal', ['Eating pub supper & talking shop with Arthur and Sam']),
      ]),
      relationships: {
        sam: 'Civic collaborator on park & South Lane lanterns',
        priya: 'Southside neighbor whose market stall he maintains',
        wolfgang: 'Tunes his track & road bikes',
        arthur: 'Friendly pub regular',
      },
      socialGraph: {
        sam: edge('sam', 'Civic sponsor', 84, 78, 76, 'Wants the Johnson Park lantern project ready to showcase in his campaign', startSimMin),
        priya: edge('priya', 'Southside neighbor', 86, 82, 80, 'Turning Community Plaza into Smallville’s weekend food hub', startSimMin),
        wolfgang: edge('wolfgang', 'Cycling customer', 78, 72, 70, 'Always pushing for lighter gear ratios and faster park splits', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'priya',
      name: 'Priya Nair',
      age: 25,
      occupation: 'Urban Agronomist & Market Organizer',
      homeLocationId: 'moore_cottages',
      traits: ['warm', 'energetic', 'ecological', 'collaborative'],
      goals: [...DEFAULT_GOALS_BY_AGENT.priya],
      innateSummary:
        'Priya Nair oversees St. Jude Community Plaza & Garden in Southside Creek and organizes Smallville’s Sunday organic harvest market.',
      currently:
        'Leaving Moore & Nair Cottages to irrigate heirloom beds and set up Sunday market baskets with Devon.',
      appearance: {
        skin: '#A56C47',
        hair: '#171717',
        shirt: '#15803D',
        pants: '#374151',
        accessory: 'hat',
      },
      x: 73,
      y: 37,
      targetX: 73,
      targetY: 37,
      path: [],
      facing: 'left',
      currentLocationId: 'moore_cottages',
      currentObjectId: 'obj_moore_porch',
      currentAction: 'Heading to Community Plaza Garden for morning harvest prep',
      currentSubStep: 'Checking compost moisture notes and seed packets',
      actionEmoji: '🌱',
      drives: priyaDrives,
      baselineMood: { valence: 0.38, arousal: 0.6 },
      mood: makeMood(0.4, 0.62, priyaDrives),
      inventory: ['heirloom seed packets', 'garden shears', 'harvest flyer'],
      memories: [
        m('pri_1', 180, 'observation', 'Priya Nair drafted flyers for Sunday’s Organic Harvest Pop-up at Community Plaza.', 7),
        m('pri_2', 120, 'observation', 'Mateo Silva agreed to feature Community Plaza pumpkins and herbs in Sunday sourdough specials.', 8),
        m('pri_3', 70, 'observation', 'Dr. Elena Vance shared winter soil mineral notes with Priya over porch tea.', 6),
        m('pri_4', 25, 'reflection', 'Bringing Main Street bakers and merchants down to Southside Plaza makes town life whole.', 7),
      ],
      importanceAccumulator: 17,
      dailySchedule: withWakeAndSleep('priya', 'moore_cottages', [
        block('pri_s0', 8, 0, 61, 'moore_cottages', 'obj_moore_porch', 'Planning harvest calendar over morning tea on porch', '🍵', 'meal', ['Listing heirloom crops', 'Packing gardening gloves']),
        block('pri_s1', 9, 1, 149, 'community_garden', 'obj_garden_beds', 'Tending raised beds & reinforcing stall with Devon', '🌱', 'work', ['Watering winter kale and thyme', 'Sorting crates with Devon']),
        block('pri_s2', 11, 30, 90, 'oakridge_bakery', 'obj_bakery_counter', 'Coordinating harvest loaves over lunch with Mateo Silva', '🥖', 'meal', ['Sharing fresh herb samples with Mateo', 'Eating warm sourdough & soup']),
        block('pri_s3', 13, 0, 120, 'community_garden', 'obj_garden_stall', 'Prepping harvest stall & talking with Hailey and Arthur', '🧺', 'work', ['Setting produce crates on awning shelf', 'Giving Hailey tour for the Gazette']),
        block('pri_s4', 15, 0, 120, 'willows_market', 'obj_market_shelves', 'Delivering fresh greens to John Lin at Willows Market', '🥬', 'errand', ['Arranging heirloom greens display', 'Checking market demand with John']),
        block('pri_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Bringing harvest invitations to the Hobbs Cafe Valentine’s party', '🎉', 'social', ['Sharing Sunday pop-up flyers with guests'], { oneOff: true }),
        block('pri_s6', 19, 0, 180, 'moore_cottages', 'obj_moore_porch', 'Dinner at Southside cottage and journaling seed trials', '🌙', 'meal', ['Enjoying vegetable curry dinner', 'Sipping chamomile tea on the porch']),
      ]),
      relationships: {
        devon: 'Next-door workshop friend who helps maintain Plaza stall',
        mateo: 'Bakes seasonal loaves using her garden crops',
        elena: 'Southside neighbor & botanical friend',
        john: 'Stocks her Plaza greens at Willows Market',
      },
      socialGraph: {
        devon: edge('devon', 'Southside craft partner', 86, 84, 82, 'Excited to install cedar lanterns linking Southside to Johnson Park', startSimMin),
        mateo: edge('mateo', 'Bakery collaborator', 84, 78, 74, 'Looking for crisp garden herbs to elevate Sunday sourdough', startSimMin),
        elena: edge('elena', 'Neighbor & mentor', 86, 82, 78, 'Always generous with practical botanical guidance', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
    {
      id: 'lucas',
      name: 'Lucas Hernandez',
      age: 19,
      occupation: 'Astronomy Freshman & Bakery Apprentice',
      homeLocationId: 'oak_hill_college',
      traits: ['curious', 'enthusiastic', 'night-owl', 'adaptable'],
      goals: [...DEFAULT_GOALS_BY_AGENT.lucas],
      innateSummary:
        'Lucas Hernandez studies astrophysics at Oak Hill College while apprenticing under Mateo Silva at Oakridge Hilltop Bakery.',
      currently:
        'Walking from Oak Hill College across North Ridge to help Mateo with Oakridge Bakery’s morning rush.',
      appearance: {
        skin: '#D9A787',
        hair: '#1C1917',
        shirt: '#0D9488',
        pants: '#1E293B',
      },
      x: 10,
      y: 5,
      targetX: 10,
      targetY: 5,
      path: [],
      facing: 'down',
      currentLocationId: 'oak_hill_college',
      currentObjectId: 'obj_college_bookshelf',
      currentAction: 'Heading to Oakridge Bakery for morning apprentice shift',
      currentSubStep: 'Zipping jacket and checking telescope notes in backpack',
      actionEmoji: '🔭',
      drives: lucasDrives,
      baselineMood: { valence: 0.3, arousal: 0.56 },
      mood: makeMood(0.31, 0.58, lucasDrives),
      inventory: ['star chart', 'flour-dusted apron'],
      memories: [
        m('luc_1', 220, 'observation', 'Lucas Hernandez stayed up late charting Orion from Oak Hill before catching four hours of sleep.', 5),
        m('luc_2', 130, 'observation', 'Mateo Silva taught Lucas how to score sourdough crusts cleanly without deflating the rise.', 7),
        m('luc_3', 75, 'observation', 'Maria Lopez helped Lucas debug his optics script at the campus lab terminal.', 7),
        m('luc_4', 30, 'reflection', 'Working at Oakridge Bakery pays for textbooks and lets me feed my dorm friends.', 6),
      ],
      importanceAccumulator: 13,
      dailySchedule: withWakeAndSleep('lucas', 'oak_hill_college', [
        block('luc_s0', 8, 0, 62, 'oak_hill_college', 'obj_college_bookshelf', 'Packing star charts & prepping for bakery shift', '🔭', 'work', ['Stowing lens filters', 'Reviewing astrophysics lab worksheet']),
        block('luc_s1', 9, 2, 148, 'oakridge_bakery', 'obj_bakery_oven', 'Assisting Mateo Silva during Oakridge Bakery morning rush', '🥐', 'work', ['Folding laminated pastry dough', 'Boxing loaves for morning customers']),
        block('luc_s2', 11, 30, 90, 'oak_hill_college', 'obj_college_desk_maria', 'Reviewing physics optics homework with Maria Lopez', '💻', 'work', ['Comparing diffraction plots', 'Grabbing espresso']),
        block('luc_s3', 13, 0, 120, 'harvey_library', 'obj_library_desk', 'Catching quiet afternoon reading in Harvey Oak Library', '📖', 'work', ['Studying celestial mechanics notes', 'Borrowing astronomy atlas']),
        block('luc_s4', 15, 0, 120, 'johnson_park', 'obj_park_bench_east', 'Catching fresh air & doodling star charts in Johnson Park', '✨', 'leisure', ['Watching clouds pass over Willows Creek']),
        block('luc_s5', 17, 0, 120, 'hobbs_cafe', 'obj_cafe_table', 'Joining Oak Hill & bakery friends at Hobbs Cafe Valentine’s party', '🎉', 'social', ['Helping Mateo bring tarts over', 'Hanging out with Eddy and Maria'], { oneOff: true }),
        block('luc_s6', 19, 0, 180, 'oak_hill_college', 'obj_college_desk_maria', 'Dinner and evening stargazing notes in Oak Hill dorm', '🔭', 'meal', ['Eating warm supper & bakery rolls', 'Logging telescope coordinates for tonight']),
      ]),
      relationships: {
        mateo: 'Kind baker mentor at Oakridge Bakery',
        maria: 'Upperclassman physics tutor and friend',
        eddy: 'Dorm hallway friend',
        clara: 'Lets him borrow vintage astronomy atlases at the library',
      },
      socialGraph: {
        mateo: edge('mateo', 'Baker mentor', 88, 82, 78, 'Always checks that I take warm bread back to the dorms', startSimMin),
        maria: edge('maria', 'Physics mentor', 82, 76, 74, 'Moves fast between simulations and her friends at Hobbs Cafe', startSimMin),
        eddy: edge('eddy', 'Campus friend', 76, 72, 68, 'Hearing melodies everywhere from rain drops to bakery ovens', startSimMin),
      },
      lastConversedAt: {},
      isThinking: false,
    },
  ];
}

export function createSeedChronicle(startSimMin = 9 * 60): ChronicleEvent[] {
  return [
    {
      id: 'chr_init_1',
      simMinutes: startSimMin - 30,
      type: 'plan',
      title: 'Isabella Rodriguez plans Valentine’s Day party',
      detail: 'Scheduled a town gathering at Hobbs Cafe from 5:00 PM to 7:00 PM and partnered with Mateo Silva on celebration berry tarts.',
      agentIds: ['isabella', 'mateo'],
      locationName: 'Hobbs Cafe',
    },
    {
      id: 'chr_init_2',
      simMinutes: startSimMin - 20,
      type: 'world_event',
      title: 'Mayoral speculation & South Lane lantern proposal grow',
      detail: 'Sam Moore reviewed Johnson Park & Southside lighting blueprints with carpenter Devon Brooks while Hailey prepped Gazette questions.',
      agentIds: ['hailey', 'sam', 'devon'],
      locationName: 'Town Hall & Gazette',
    },
    {
      id: 'chr_init_3',
      simMinutes: startSimMin - 10,
      type: 'world_event',
      title: 'Morning across Smallville’s three districts begins',
      detail: 'Eighteen residents stir along North Ridge, Main Street, and Southside Creek—Mateo fires Oakridge Bakery, Dr. Elena Vance tends her clinic greenhouse, and Priya opens the Community Plaza.',
      agentIds: ['john', 'mei', 'mateo', 'elena', 'priya', 'lucas'],
      locationName: 'Smallville',
    },
  ];
}

export function createSeedMemes(startSimMin = 9 * 60): TrackedMeme[] {
  return [
    {
      id: 'meme_valentine_party',
      topic: 'Isabella’s 5:00 PM Valentine’s Party at Hobbs Cafe',
      keywords: ['valentine', 'party', 'hobbs', '5:00', '5 pm'],
      originAgentId: 'isabella',
      createdAt: startSimMin - 180,
      knownBy: {
        isabella: {
          simMinutes: startSimMin - 180,
          heardFromId: 'isabella',
          snippet: 'Planned and hosting the 5:00 PM Valentine’s Day party at Hobbs Cafe.',
        },
        maria: {
          simMinutes: startSimMin - 75,
          heardFromId: 'isabella',
          snippet: 'Heard Isabella is planning something special at Hobbs Cafe today.',
        },
        hailey: {
          simMinutes: startSimMin - 70,
          heardFromId: 'isabella',
          snippet: 'Invited to cover the 5:00 PM community mixer for the Gazette.',
        },
        mateo: {
          simMinutes: startSimMin - 65,
          heardFromId: 'isabella',
          snippet: 'Baking celebration berry tarts for Isabella’s 5 PM cafe mixer.',
        },
      },
    },
    {
      id: 'meme_mayor_race',
      topic: 'Sam Moore’s Potential Run for Smallville Mayor',
      keywords: ['mayor', 'mayoral', 'election', 'sam moore', 'run'],
      originAgentId: 'sam',
      createdAt: startSimMin - 160,
      knownBy: {
        sam: {
          simMinutes: startSimMin - 160,
          heardFromId: 'sam',
          snippet: 'Weighing whether to officially announce a candidacy for town mayor.',
        },
        arthur: {
          simMinutes: startSimMin - 135,
          heardFromId: 'sam',
          snippet: 'Sam confided at The Rose & Crown Pub that he is considering running.',
        },
        mei: {
          simMinutes: startSimMin - 80,
          heardFromId: 'sam',
          snippet: 'Sam mentioned thinking about running for mayor.',
        },
        hailey: {
          simMinutes: startSimMin - 120,
          heardFromId: 'hailey',
          snippet: 'Spotted Sam studying Town Hall park budgets for a likely campaign.',
        },
      },
    },
    {
      id: 'meme_park_lanterns',
      topic: 'Cedar Lanterns & Evening Trail Lighting Along Johnson Park & South Lane',
      keywords: ['lantern', 'lanterns', 'lighting', 'south lane', 'trail'],
      originAgentId: 'devon',
      createdAt: startSimMin - 120,
      knownBy: {
        devon: {
          simMinutes: startSimMin - 120,
          heardFromId: 'devon',
          snippet: 'Milling six cedar street-lantern prototypes at Willow Workshop.',
        },
        sam: {
          simMinutes: startSimMin - 105,
          heardFromId: 'devon',
          snippet: 'Discussed putting new evening lanterns along Johnson Park & South Lane.',
        },
        elena: {
          simMinutes: startSimMin - 80,
          heardFromId: 'sam',
          snippet: 'Advocating safer evening pedestrian lighting south of Main Street.',
        },
      },
    },
    {
      id: 'meme_farmers_market',
      topic: 'Sunday Organic Harvest Pop-Up at St. Jude Community Plaza',
      keywords: ['harvest', 'farmers', 'pop-up', 'plaza', 'sunday', 'garden'],
      originAgentId: 'priya',
      createdAt: startSimMin - 140,
      knownBy: {
        priya: {
          simMinutes: startSimMin - 140,
          heardFromId: 'priya',
          snippet: 'Organizing Sunday’s organic harvest market stall in Southside Plaza.',
        },
        mateo: {
          simMinutes: startSimMin - 120,
          heardFromId: 'priya',
          snippet: 'Agreed to bake seasonal herb & squash loaves from Plaza crops.',
        },
        john: {
          simMinutes: startSimMin - 60,
          heardFromId: 'priya',
          snippet: 'Coordinating produce crates between Community Plaza and Willows Market.',
        },
      },
    },
  ];
}

function isPartyOrMayorText(text: string): boolean {
  return /valentine|party|mixer|celebration\s+(?:berry\s+)?tarts|hobbs.*5\s*:?\s*00\s*pm|run(?:ning)?\s+for\s+mayor|mayor['’]?s\s+race|mayoral\s+run|mayoral\s+candidacy/i.test(
    text,
  );
}

/**
 * Builds agents for a given scenario.
 * In `paper_valentine` (Park et al. 2023 replication):
 * - Day 1 starts 09:00; the Valentine's party takes place on Day 2 from 5:00 PM to 7:00 PM at Hobbs Cafe.
 * - ONLY Isabella initially knows about the party (plus her goal to invite neighbors), and her party block is Day 2 17:00-19:00.
 * - ONLY Sam initially knows about his mayoral run.
 * - All other 17 residents have zero scripted party/mayoral memories or party schedule blocks.
 */
export function createScenarioAgents(
  scenarioId: ScenarioId = 'default',
  startSimMin = 9 * 60,
): AgentState[] {
  const base = createSeedAgents(startSimMin);
  if (scenarioId !== 'paper_valentine') return base;

  return base.map((ag) => {
    if (ag.id === 'isabella') {
      const cleanRoutineDay1 = ag.dailySchedule
        .filter((b) => !isPartyOrMayorText(b.activity) && b.startMinute !== 17 * 60)
        .map((b) => ({ ...b, day: 1, oneOff: undefined }));
      const day1Filled = cleanRoutineDay1.some((b) => b.startMinute === 17 * 60)
        ? cleanRoutineDay1
        : [
            ...cleanRoutineDay1.filter((b) => b.startMinute < 17 * 60 || b.startMinute >= 19 * 60),
            block(
              'isa_p1_prep',
              17,
              0,
              120,
              'hobbs_cafe',
              'obj_cafe_espresso',
              'Baking test batches and planning tomorrow’s Valentine’s Day cafe party',
              '☕',
              'work',
              ['Testing raspberry glaze recipes', 'Jotting neighbor invitation list'],
            ),
          ].sort((a, b) => a.startMinute - b.startMinute);

      const day2Base = day1Filled
        .filter((b) => b.startMinute < 17 * 60 || b.startMinute >= 19 * 60)
        .map((b, idx) => ({
          ...b,
          id: `isa_p2_${idx}`,
          day: 2,
          oneOff: undefined,
        }));
      const day2Party = block(
        'isa_party_day2',
        17,
        0,
        120,
        'hobbs_cafe',
        'obj_cafe_table',
        'Hosting the Smallville Valentine’s Day party at Hobbs Cafe',
        '🥳',
        'social',
        [
          'Welcoming invited Smallville neighbors',
          'Serving spiced cocoa and espresso',
          'Toasting the neighborhood gathering',
        ],
        { fixed: true, oneOff: true, day: 2 },
      );

      return {
        ...ag,
        currently:
          'Opening Hobbs Cafe and planning tomorrow’s 5:00 PM Valentine’s Day party to invite neighbors.',
        goals: [
          'Invite as many neighbors as possible to my Valentine’s Day party at Hobbs Cafe on Day 2 from 5:00 PM to 7:00 PM',
          'Make Hobbs Cafe the warmest gathering spot in Smallville',
        ],
        memories: [
          createMemoryNode({
            id: 'isa_p_seed_1',
            createdAt: Math.max(0, startSimMin - 180),
            type: 'plan',
            source: 'seed',
            description:
              'Isabella Rodriguez decided to throw a Valentine’s Day party at Hobbs Cafe on Day 2 from 5:00 PM to 7:00 PM and wants to invite as many neighbors as possible.',
            importance: 9,
          }),
          createMemoryNode({
            id: 'isa_p_seed_2',
            createdAt: Math.max(0, startSimMin - 120),
            type: 'observation',
            source: 'seed',
            description:
              'Isabella Rodriguez opened Hobbs Cafe early and wiped down the espresso counter.',
            importance: 4,
          }),
        ],
        socialGraph: Object.fromEntries(
          Object.entries(ag.socialGraph).map(([tid, e]) => [
            tid,
            {
              ...e,
              inferredGoal: isPartyOrMayorText(e.inferredGoal)
                ? 'Going about their normal morning in Smallville'
                : e.inferredGoal,
            },
          ]),
        ),
        dailySchedule: [...day1Filled, ...day2Base, day2Party].sort(
          (a, b) => a.day - b.day || a.startMinute - b.startMinute,
        ),
      };
    }

    // All other 17 residents: strip Valentine party & non-Sam mayor rumors so diffusion starts purely from seed origins
    const stripMayorToo = ag.id !== 'sam';
    const filteredMemories = ag.memories.filter((m) => {
      if (isPartyOrMayorText(m.description)) {
        if (ag.id === 'sam' && /mayor/i.test(m.description)) return true;
        return false;
      }
      return true;
    });

    const normalRoutineDay1 = ag.dailySchedule
      .filter((b) => !isPartyOrMayorText(b.activity) && !b.oneOff)
      .map((b) => ({ ...b, day: 1 }));

    const hasAfternoonSlot = normalRoutineDay1.some(
      (b) => b.startMinute <= 17 * 60 && b.startMinute + b.durationMinutes > 17 * 60 + 30,
    );
    const nonPartyEveningSlot = hasAfternoonSlot
      ? normalRoutineDay1
      : [
          ...normalRoutineDay1,
          block(
            `${ag.id}_routine_aft`,
            17,
            0,
            120,
            ag.homeLocationId,
            HOME_BED_BY_LOCATION[ag.homeLocationId],
            `Relaxing and catching up on personal projects at home`,
            '🏡',
            'leisure',
            ['Tidying desk and unpacking bags', 'Spending a quiet evening indoors'],
          ),
        ].sort((a, b) => a.startMinute - b.startMinute);

    const day2Routine = nonPartyEveningSlot.map((b, idx) => ({
      ...b,
      id: `${ag.id}_d2_${idx}`,
      day: 2,
    }));

    const cleanGoals = ag.goals.filter(
      (g) => !/valentine|party/i.test(g) && (!stripMayorToo || !/mayor/i.test(g)),
    );

    return {
      ...ag,
      goals: cleanGoals.length > 0 ? cleanGoals : [`Focus on ${ag.occupation} work in Smallville`],
      currently: isPartyOrMayorText(ag.currently)
        ? `Focusing on daily ${ag.occupation} routine in Smallville.`
        : ag.currently,
      memories: filteredMemories,
      socialGraph: Object.fromEntries(
        Object.entries(ag.socialGraph).map(([tid, e]) => [
          tid,
          {
            ...e,
            inferredGoal: isPartyOrMayorText(e.inferredGoal)
              ? 'Going about their normal routine in Smallville'
              : e.inferredGoal,
          },
        ]),
      ),
      dailySchedule: [...nonPartyEveningSlot, ...day2Routine].sort(
        (a, b) => a.day - b.day || a.startMinute - b.startMinute,
      ),
    };
  });
}

export function createScenarioMemes(
  scenarioId: ScenarioId = 'default',
  startSimMin = 9 * 60,
): TrackedMeme[] {
  const base = createSeedMemes(startSimMin);
  if (scenarioId !== 'paper_valentine') return base;

  return base.map((m) => {
    if (m.id === 'meme_valentine_party') {
      return {
        ...m,
        topic: 'Isabella’s Day 2 5:00 PM Valentine’s Party at Hobbs Cafe',
        knownBy: {
          isabella: {
            simMinutes: startSimMin - 180,
            heardFromId: 'isabella',
            snippet: 'Hosting a Valentine’s Day party at Hobbs Cafe on Day 2 from 5:00 PM to 7:00 PM.',
          },
        },
      };
    }
    if (m.id === 'meme_mayor_race') {
      return {
        ...m,
        knownBy: {
          sam: {
            simMinutes: startSimMin - 160,
            heardFromId: 'sam',
            snippet: 'Quietly weighing whether to announce a run for Smallville mayor.',
          },
        },
      };
    }
    return m;
  });
}

export function createScenarioChronicle(
  scenarioId: ScenarioId = 'default',
  startSimMin = 9 * 60,
): ChronicleEvent[] {
  if (scenarioId !== 'paper_valentine') {
    return createSeedChronicle(startSimMin);
  }
  return [
    {
      id: 'chr_paper_1',
      simMinutes: startSimMin - 20,
      type: 'plan',
      title: 'Isabella Rodriguez quietly plans Day 2 Valentine’s Day party',
      detail:
        'Only Isabella knows about the Day 2 (5:00 PM – 7:00 PM) Hobbs Cafe gathering so invitations spread organically through conversations.',
      agentIds: ['isabella'],
      locationName: 'Hobbs Cafe',
    },
    {
      id: 'chr_paper_2',
      simMinutes: startSimMin - 10,
      type: 'world_event',
      title: 'Paper replication baseline begins (Day 1 · 9:00 AM)',
      detail:
        'Only Sam Moore holds his mayoral intention privately; Park et al. (2023) diffusion & awareness curves begin from unscripted routines.',
      agentIds: ['sam'],
      locationName: 'Smallville',
    },
  ];
}
