import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createSmallvilleApp, type ServerConfig } from '../../server.ts';
import { DailyBudgetTracker, TokenBucketLimiter } from './rateLimit.ts';
import { validateInterviewBody, validatePlanBody, validateWorldSaveBody } from './validate.ts';

function makeValidAgent() {
  return {
    id: 'isabella',
    name: 'Isabella Rodriguez',
    age: 34,
    occupation: 'Cafe Owner',
    traits: ['warm', 'organized'],
    innateSummary: 'Runs Hobbs Cafe warmly every day.',
    currently: 'Brewing espresso',
    currentAction: 'Opening Hobbs Cafe',
    locationName: 'Hobbs Cafe',
    retrievedMemories: [
      {
        id: 'm_1',
        type: 'observation',
        description: 'Opened Hobbs Cafe at 7:00 AM.',
        importance: 5,
      },
    ],
  };
}

function makeTestConfig(worldsDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    llmProvider: 'openrouter',
    openRouterApiKey: 'test-or-key',
    openRouterModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    geminiApiKey: null,
    geminiModel: 'gemini-4-hydrogen',
    enableServerSaves: false,
    maxCallsPerDay: 2000,
    appAccessToken: null,
    worldsDir,
    appUrl: 'http://localhost:3000',
    ...overrides,
  };
}

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  appOptions: Parameters<typeof createSmallvilleApp>[0] = {},
) {
  const { app } = createSmallvilleApp({ suppressLogs: true, ...appOptions });
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('server body validators reject oversized strings, oversized arrays, and malformed IDs', () => {
  const goodInterview = {
    agent: makeValidAgent(),
    question: 'What are your plans tonight?',
    simTimeLabel: 'Day 1 · 10:00 AM',
  };
  assert.equal(validateInterviewBody(goodInterview), null);

  assert.ok(
    validateInterviewBody({
      ...goodInterview,
      question: 'x'.repeat(650),
    })?.includes('600'),
  );

  assert.ok(
    validateInterviewBody({
      ...goodInterview,
      agent: {
        ...makeValidAgent(),
        id: 'bad id with spaces!',
      },
    }),
  );

  assert.ok(
    validatePlanBody({
      agent: {
        ...makeValidAgent(),
        retrievedMemories: Array.from({ length: 45 }, (_, idx) => ({
          id: `m_${idx}`,
          type: 'observation',
          description: 'hi',
          importance: 5,
        })),
      },
      simTimeLabel: 'Day 1 · 9:00 AM',
      currentMinuteOfDay: 540,
      locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
    })?.includes('40'),
  );

  assert.ok(validateWorldSaveBody({ world: { bad: true } }));
});

test('TokenBucketLimiter allows initial burst 10, refills at 30/min, and rejects 31st request within 60s', () => {
  let tightNow = 0;
  const tight = new TokenBucketLimiter({ requestsPerMinute: 30, burst: 10, nowFn: () => tightNow });

  // 10 burst requests immediately at t = 0
  for (let i = 0; i < 10; i++) {
    assert.equal(tight.consume('ip:test').allowed, true, `Burst request ${i + 1} should pass`);
  }
  // 11th immediate request blocked
  assert.equal(tight.consume('ip:test').allowed, false);

  // Paced at 1 request every 2s (= 0.5/s = 30/min) for 40s -> 20 more requests allowed (30 total inside 40s)
  for (let i = 0; i < 20; i++) {
    tightNow += 2000;
    assert.equal(tight.consume('ip:test').allowed, true, `Paced request ${11 + i} should pass`);
  }

  // 31st request immediately at t = 40s has 0 tokens and must be rejected with Retry-After >= 1
  const denied31 = tight.consume('ip:test');
  assert.equal(denied31.allowed, false);
  assert.ok(denied31.retryAfterSec >= 1);
});

test('/api/world requires x-world-id UUID (400 if missing) and isolates per-world saves when enabled', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-worlds-'));
  try {
    // 1. Default: server saves disabled
    await withServer(
      async (baseUrl) => {
        const resNoHeader = await fetch(`${baseUrl}/api/world`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            world: { simMinutes: 540, agents: [makeValidAgent()], tiles: [[]], locations: [] },
          }),
        });
        assert.equal(resNoHeader.status, 400);

        const resDelNoHeader = await fetch(`${baseUrl}/api/world`, { method: 'DELETE' });
        assert.equal(resDelNoHeader.status, 400);

        const worldA = '11111111-1111-4111-8111-111111111111';
        const resDisabledSave = await fetch(`${baseUrl}/api/world`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-world-id': worldA },
          body: JSON.stringify({
            world: { simMinutes: 540, agents: [makeValidAgent()], tiles: [[]], locations: [] },
          }),
        });
        assert.equal(resDisabledSave.status, 200);
        const saveData = (await resDisabledSave.json()) as { persisted: boolean };
        assert.equal(saveData.persisted, false);
      },
      { config: makeTestConfig(tmpDir, { enableServerSaves: false }) },
    );

    // 2. Enabled: strict per-worldId isolation
    await withServer(
      async (baseUrl) => {
        const idA = '11111111-1111-4111-8111-111111111111';
        const idB = '22222222-2222-4222-8222-222222222222';
        await fetch(`${baseUrl}/api/world`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-world-id': idA },
          body: JSON.stringify({
            world: { simMinutes: 777, agents: [makeValidAgent()], tiles: [[]], locations: [] },
          }),
        });

        const readB = await fetch(`${baseUrl}/api/world`, { headers: { 'x-world-id': idB } });
        const dataB = (await readB.json()) as { world: unknown };
        assert.equal(dataB.world, null);

        const readA = await fetch(`${baseUrl}/api/world`, { headers: { 'x-world-id': idA } });
        const dataA = (await readA.json()) as { world: { simMinutes: number } };
        assert.equal(dataA.world.simMinutes, 777);
      },
      { config: makeTestConfig(tmpDir, { enableServerSaves: true }) },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('non-JSON upstream reply triggers exactly one repair call, succeeding or returning 502', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-repair-'));
  try {
    let fetchCalls = 0;
    let repairPromptSawInstruction = false;

    // Case A: Repair succeeds on second call
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': '33333333-3333-4333-8333-333333333333',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            question: 'How is business today?',
            simTimeLabel: 'Day 1 · 10:00 AM',
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { answer: string };
        assert.equal(body.answer, 'Coffee is brewing nicely!');
        assert.equal(fetchCalls, 2);
        assert.equal(repairPromptSawInstruction, true);
      },
      {
        config: makeTestConfig(tmpDir),
        fetchImpl: async (_url, init) => {
          fetchCalls += 1;
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ content: string }>;
          };
          if (fetchCalls === 1) {
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: 'Not valid JSON at all sorry!' } }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          repairPromptSawInstruction = Boolean(
            payload.messages?.some((m) => m.content.includes('Your last reply was not valid JSON')),
          );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer: 'Coffee is brewing nicely!',
                      citedMemoryIds: ['m_1'],
                      observationSummary: 'Isabella answered a reporter.',
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 120, completion_tokens: 35 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );

    // Case B: Repair also fails -> returns 502 after exactly 2 calls
    let failFetchCalls = 0;
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': '33333333-3333-4333-8333-333333333333',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            question: 'How is business today?',
            simTimeLabel: 'Day 1 · 10:00 AM',
          }),
        });
        assert.equal(res.status, 502);
        assert.equal(failFetchCalls, 2);
      },
      {
        config: makeTestConfig(tmpDir),
        fetchImpl: async () => {
          failFetchCalls += 1;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Still not JSON' } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('daily budget cap MAX_LLM_CALLS_PER_DAY rejects the 6th call with 429 daily budget reached, and APP_ACCESS_TOKEN protects /api', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-budget-'));
  try {
    await withServer(
      async (baseUrl) => {
        // Without token -> 401
        const unauthRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(unauthRes.status, 401);

        // With token -> 200 health + provider openrouter + free cap reported
        const healthRes = await fetch(`${baseUrl}/api/health`, {
          headers: { 'x-app-token': 'secret-token-123' },
        });
        assert.equal(healthRes.status, 200);
        const health = (await healthRes.json()) as {
          provider: string;
          limits: { freeModelDailyCap: number };
        };
        assert.equal(health.provider, 'openrouter');
        assert.equal(health.limits.freeModelDailyCap, 50);

        // Run 5 valid calls
        for (let i = 0; i < 5; i++) {
          const r = await fetch(`${baseUrl}/api/agent/interview`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-world-id': '44444444-4444-4444-8444-444444444444',
              'x-app-token': 'secret-token-123',
            },
            body: JSON.stringify({
              agent: makeValidAgent(),
              question: 'Morning!',
              simTimeLabel: 'Day 1 · 10:00 AM',
            }),
          });
          assert.equal(r.status, 200);
        }

        // 6th call -> 429 daily budget reached
        const r6 = await fetch(`${baseUrl}/api/agent/interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': '44444444-4444-4444-8444-444444444444',
            'x-app-token': 'secret-token-123',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            question: 'One more!',
            simTimeLabel: 'Day 1 · 10:05 AM',
          }),
        });
        assert.equal(r6.status, 429);
        const errBody = (await r6.json()) as { error: string; code?: string };
        assert.equal(errBody.error, 'daily budget reached');
      },
      {
        config: makeTestConfig(tmpDir, {
          maxCallsPerDay: 5,
          appAccessToken: 'secret-token-123',
        }),
        dailyBudget: new DailyBudgetTracker({ maxCallsPerDay: 5 }),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer: 'Lovely morning.',
                      citedMemoryIds: ['m_1'],
                      observationSummary: 'Answered question.',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('Phase 5: /api/agent/converse keeps zero private-plan leakage and supports 2..N turns + early exit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-converse-'));
  try {
    const capturePromptsForRun = async (secretCurrentlyB: string, maxConverseTurns = 4) => {
      const capturedPrompts: Array<{ sys: string; user: string }> = [];
      let resBody: Record<string, unknown> = {};

      await withServer(
        async (baseUrl) => {
          const agentA = {
            ...makeValidAgent(),
            id: 'isabella',
            name: 'Isabella Rodriguez',
            currently: 'Preparing pastries at Hobbs Cafe',
            currentAction: 'Wiping down the espresso counter',
            candidateMemories: [
              {
                id: 'mem_a_1',
                type: 'observation',
                description: 'Ordered fresh espresso beans for Hobbs Cafe.',
                importance: 5,
                createdAt: 500,
                lastAccessed: 500,
              },
            ],
          };
          const agentB = {
            ...makeValidAgent(),
            id: 'klaus',
            name: 'Klaus Mueller',
            occupation: 'Research Student',
            currently: secretCurrentlyB,
            currentAction: 'Reading a textbook at the corner table',
            locationName: 'Hobbs Cafe',
            candidateMemories: [
              {
                id: 'mem_b_1',
                type: 'observation',
                description: 'Secret diary note: worried about thesis.',
                importance: 7,
                createdAt: 510,
                lastAccessed: 510,
              },
            ],
          };

          const r = await fetch(`${baseUrl}/api/agent/converse`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-world-id': '55555555-5555-4555-8555-555555555555',
            },
            body: JSON.stringify({
              agentA,
              agentB,
              simTimeLabel: 'Day 1 · 10:30 AM',
              simMinutes: 630,
              startReason: 'shared_venue',
              candidateMemes: [
                {
                  id: 'meme_valentine_party',
                  topic: 'Valentine Party at Hobbs Cafe',
                  knownByIds: ['isabella'],
                },
              ],
              locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
              objects: [{ id: 'obj_cafe_table', name: 'Cafe Table', locationId: 'hobbs_cafe' }],
            }),
          });
          assert.equal(r.status, 200);
          resBody = (await r.json()) as Record<string, unknown>;
        },
        {
          config: makeTestConfig(tmpDir, { maxConverseTurns }),
          fetchImpl: async (_url, init) => {
            const payload = JSON.parse(String(init?.body ?? '{}')) as {
              messages?: Array<{ role: string; content: string }>;
            };
            const sys = payload.messages?.find((m) => m.role === 'system')?.content ?? '';
            const user = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
            capturedPrompts.push({ sys, user });

            const isWrapup = user.includes('Full spoken dialogue');
            if (isWrapup) {
              return new Response(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          summary: sys.includes('Isabella')
                            ? 'Isabella chatted with Klaus at Hobbs Cafe.'
                            : 'Klaus chatted with Isabella over coffee.',
                          importance: 6,
                          emotionalShift: { deltaValence: 0.1, deltaArousal: 0.05 },
                          tomUpdate: { deltaTrust: 4, deltaAffection: 3, inferredGoal: 'Studying' },
                          memeIdsDiscussed: ['meme_valentine_party', 'fake_id_ignored'],
                          newNews: [],
                          ...(sys.includes('Isabella')
                            ? {
                                sharedAgreement: {
                                  day: 'tomorrow',
                                  minuteOfDay: 600,
                                  durationMinutes: 60,
                                  locationId: 'hobbs_cafe',
                                  activity: 'Morning coffee catch-up',
                                },
                              }
                            : {}),
                        }),
                      },
                    },
                  ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              );
            }

            const turnCount = capturedPrompts.filter((p) => !p.user.includes('Full spoken dialogue')).length;
            const spokenLine = sys.includes('Isabella')
              ? 'Hello Klaus, want a fresh cup of coffee?'
              : 'Thanks Isabella, that sounds lovely!';
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        spokenLine,
                        privateThought: 'Friendly morning chat.',
                        endConversation: turnCount >= 2,
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          },
        },
      );

      return { capturedPrompts, resBody };
    };

    const run1 = await capturePromptsForRun('SECRET_PLAN_ONE_HIKING_ALPINE_PEAKS');
    const run2 = await capturePromptsForRun('SECRET_PLAN_TWO_WRITING_POETRY_NOCTURNE');

    // Early stop after 2 turns when turn 2 sets endConversation: true (2 turns + 2 wrapups = 4 LLM calls)
    assert.equal((run1.resBody.turns as unknown[]).length, 2);
    assert.equal(run1.resBody.endedBy, 'klaus');
    assert.deepEqual(run1.resBody.memeIdsDiscussedA, ['meme_valentine_party']);
    assert.ok(run1.resBody.sharedAgreement);
    assert.ok(Array.isArray(run1.resBody.accessedMemoryIdsA));

    // All prompts generated for Isabella (Agent A) must be 100% identical despite changing Klaus's private currently!
    const promptsForA1 = run1.capturedPrompts.filter((p) => p.sys.includes('Isabella'));
    const promptsForA2 = run2.capturedPrompts.filter((p) => p.sys.includes('Isabella'));
    assert.equal(promptsForA1.length, 2); // turn 1 + wrapup
    assert.deepEqual(promptsForA1, promptsForA2);
    for (const p of promptsForA1) {
      assert.equal(p.user.includes('SECRET_PLAN_ONE'), false);
      assert.equal(p.user.includes('Secret diary note'), false);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 6: 2-step /api/agent/reflect drops hallucinated evidence IDs and 0-evidence insights; /react & /step-detail normalize cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-p6-'));
  try {
    await withServer(
      async (baseUrl) => {
        const headers = {
          'Content-Type': 'application/json',
          'x-world-id': '66666666-6666-4666-8666-666666666666',
        };
        const qRes = await fetch(`${baseUrl}/api/agent/reflect/questions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            simTimeLabel: 'Day 1 · 2:00 PM',
            recentMemories: Array.from({ length: 25 }, (_, i) => ({
              id: `mem_${i}`,
              type: i === 2 ? 'reflection' : 'observation',
              description: `Memory item ${i} around Hobbs Cafe.`,
              importance: 5,
            })),
          }),
        });
        assert.equal(qRes.status, 200);
        const qData = (await qRes.json()) as { focalQuestions: string[] };
        assert.equal(qData.focalQuestions.length, 3);

        const rRes = await fetch(`${baseUrl}/api/agent/reflect`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            simTimeLabel: 'Day 1 · 2:00 PM',
            questionEvidenceSets: [
              {
                question: qData.focalQuestions[0],
                memories: [
                  { id: 'mem_1', type: 'observation', description: 'Obs 1', importance: 6 },
                  { id: 'mem_2', type: 'reflection', description: 'Prior refl', importance: 8 },
                ],
              },
            ],
          }),
        });
        assert.equal(rRes.status, 200);
        const rData = (await rRes.json()) as {
          reflections: Array<{ insight: string; evidenceIds: string[] }>;
        };
        assert.equal(rData.reflections.length, 1);
        assert.deepEqual(rData.reflections[0].evidenceIds, ['mem_1', 'mem_2']);

        const reactRes = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Maria arrived smiling with event posters.',
            simTimeLabel: 'Day 1 · 2:10 PM',
            partnerName: 'Maria Lopez',
            partnerAction: 'Hanging posters',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(reactRes.status, 200);
        const reactData = (await reactRes.json()) as { react: boolean; locationId?: string };
        assert.equal(reactData.react, true);
        assert.equal(reactData.locationId, 'hobbs_cafe');

        const stepRes = await fetch(`${baseUrl}/api/agent/step-detail`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            simTimeLabel: 'Day 1 · 2:15 PM',
            block: { activity: 'Prepares espresso & pastries', kind: 'work', durationMinutes: 90 },
          }),
        });
        assert.equal(stepRes.status, 200);
        const stepData = (await stepRes.json()) as { subSteps: string[] };
        assert.ok(stepData.subSteps.length >= 3);
      },
      {
        config: makeTestConfig(tmpDir),
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role: string; content: string }>;
          };
          const user = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
          if (user.includes('focalQuestions') || user.includes('salient high-level questions')) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        focalQuestions: ['Q1 cafe prep?', 'Q2 neighbors?', 'Q3 energy?'],
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (user.includes('Retrieved Evidence')) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        focalQuestions: ['Q1 cafe prep?'],
                        reflections: [
                          {
                            insight: 'Valid insight grounded in obs and prior reflection.',
                            importance: 8,
                            evidenceIds: ['mem_1', 'mem_2', 'hallucinated_id'],
                          },
                          {
                            insight: 'Invalid insight citing zero real IDs.',
                            importance: 7,
                            evidenceIds: ['fake_only'],
                          },
                        ],
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (user.includes('New Salient Observation')) {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        react: true,
                        reason: 'Want to help Maria hang posters.',
                        newActivity: 'Help Maria display event posters',
                        kind: 'social',
                        locationId: 'hobbs_cafe',
                        durationMinutes: 45,
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subSteps: ['Grind espresso', 'Warm milk', 'Arrange pastry tray'],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('OpenRouter free-models-per-day 429 automatically fails over to Gemini in auto mode and stays on Gemini during cooldown', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-failover-'));
  try {
    let openRouterCalls = 0;
    let geminiCalls = 0;
    let geminiModelUsed = '';
    const fixedNow = Date.UTC(2026, 10, 25, 12, 0, 0);

    await withServer(
      async (baseUrl) => {
        const headers = {
          'Content-Type': 'application/json',
          'x-world-id': '77777777-7777-4777-8777-777777777777',
        };

        // Call 1: OpenRouter returns free-models-per-day-high-balance 429 -> immediately fails over to Gemini
        const r1 = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Maria arrived with posters for the neighborhood mixer.',
            simTimeLabel: 'Day 1 · 10:15 AM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(r1.status, 200);
        const body1 = (await r1.json()) as { react: boolean; newActivity?: string };
        assert.equal(body1.react, true);
        assert.equal(openRouterCalls, 1);
        assert.equal(geminiCalls, 1);
        assert.equal(geminiModelUsed, 'gemini-4-hydrogen');

        // /api/health now reflects active Gemini failover
        const healthRes = await fetch(`${baseUrl}/api/health`);
        assert.equal(healthRes.status, 200);
        const health = (await healthRes.json()) as {
          provider: string;
          model: string;
          failoverActive: boolean;
          failoverReason?: string;
        };
        assert.equal(health.provider, 'gemini');
        assert.equal(health.model, 'gemini-4-hydrogen');
        assert.equal(health.failoverActive, true);
        assert.ok(health.failoverReason?.includes('free-models-per-day-high-balance'));

        // Call 2: Skips exhausted OpenRouter directly and routes straight to Gemini
        const r2 = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Klaus walked in carrying notes.',
            simTimeLabel: 'Day 1 · 10:20 AM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(r2.status, 200);
        assert.equal(openRouterCalls, 1);
        assert.equal(geminiCalls, 2);
      },
      {
        config: makeTestConfig(tmpDir, {
          llmProvider: 'auto',
          openRouterApiKey: 'test-or-key',
          geminiApiKey: 'test-gem-key',
          geminiModel: 'gemini-4-hydrogen',
          modelConverse: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        }),
        nowFn: () => fixedNow,
        fetchImpl: async () => {
          openRouterCalls += 1;
          return new Response(
            JSON.stringify({
              error: {
                message: 'Rate limit exceeded: free-models-per-day-high-balance.',
                code: 429,
              },
            }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          );
        },
        geminiGenerateImpl: async ({ model }) => {
          geminiCalls += 1;
          geminiModelUsed = model;
          return {
            text: JSON.stringify({
              react: true,
              reason: 'Welcoming Maria and helping display the posters.',
              newActivity: 'Help Maria hang mixer posters',
              kind: 'social',
              locationId: 'hobbs_cafe',
              durationMinutes: 30,
            }),
            inputTokens: 150,
            outputTokens: 45,
          };
        },
      },
    );

    // Explicit openrouter mode with no Gemini fallback returns 429 PROVIDER_DAILY_QUOTA_EXHAUSTED after 1 attempt (no pointless retry)
    let explicitOrCalls = 0;
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': '88888888-8888-4888-8888-888888888888',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Notice posted on the cafe board.',
            simTimeLabel: 'Day 1 · 10:30 AM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(res.status, 429);
        const errBody = (await res.json()) as { error: string; code?: string };
        assert.equal(errBody.code, 'PROVIDER_DAILY_QUOTA_EXHAUSTED');
        assert.equal(explicitOrCalls, 1);
      },
      {
        config: makeTestConfig(tmpDir, {
          llmProvider: 'openrouter',
          openRouterApiKey: 'test-or-key',
          geminiApiKey: null,
        }),
        fetchImpl: async () => {
          explicitOrCalls += 1;
          return new Response(
            JSON.stringify({
              error: {
                message: 'Rate limit exceeded: free-models-per-day-high-balance.',
                code: 429,
              },
            }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('Phase 1 model router: dev_free blocks paid models, live_cheap assigns heterogeneous cohorts & enforces USD spend cap, and local routes to LOCAL_LLM_URL', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-router-'));
  try {
    // 1. dev_free rejects paid OpenRouter model with 403
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': '99999999-9999-4999-8999-999999999999',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Quiet afternoon.',
            simTimeLabel: 'Day 1 · 2:00 PM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(res.status, 403);
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, 'PAID_MODEL_BLOCKED_IN_DEV_FREE');
      },
      {
        config: makeTestConfig(tmpDir, {
          llmProvider: 'openrouter',
          llmProfile: 'dev_free',
          openRouterModel: 'deepseek/deepseek-chat-v3', // paid model (no :free)
        }),
      },
    );

    // 2. live_cheap distributes residents deterministically across cohort models & enforces MAX_ESTIMATED_USD_PER_DAY
    const usedModelsByAgent: string[] = [];
    await withServer(
      async (baseUrl) => {
        for (const agentId of ['isabella', 'john', 'klaus', 'maria', 'sam', 'mei']) {
          const r = await fetch(`${baseUrl}/api/agent/react`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-world-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
            body: JSON.stringify({
              agent: { ...makeValidAgent(), id: agentId },
              observation: 'Checking cohort routing.',
              simTimeLabel: 'Day 1 · 2:10 PM',
              locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
            }),
          });
          assert.equal(r.status, 200);
        }
        assert.ok(
          new Set(usedModelsByAgent).size >= 2,
          `Expected heterogeneous model assignment across cohort, got ${usedModelsByAgent.join(', ')}`,
        );

        // Next call exceeds tight maxEstimatedUsdPerDay cap -> 429
        const capped = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Should hit spend cap.',
            simTimeLabel: 'Day 1 · 2:20 PM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(capped.status, 429);
        const capBody = (await capped.json()) as { code?: string };
        assert.equal(capBody.code, 'DAILY_SPEND_CAP_REACHED');
      },
      {
        config: makeTestConfig(tmpDir, {
          llmProvider: 'openrouter',
          llmProfile: 'live_cheap',
          openRouterCohortModels: [
            'qwen/qwen-3-32b',
            'meta-llama/llama-4-scout',
            'z-ai/glm-4-air',
          ],
          maxEstimatedUsdPerDay: 0.0022,
        }),
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
          if (payload.model) usedModelsByAgent.push(payload.model);
          return new Response(
            JSON.stringify({
              usage: { prompt_tokens: 1000, completion_tokens: 400 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      react: false,
                      reason: 'Staying on task.',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );

    // 3. local profile routes directly to LOCAL_LLM_URL
    let localUrlHit = '';
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/react`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            observation: 'Local Ollama test.',
            simTimeLabel: 'Day 1 · 3:00 PM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(res.status, 200);
        assert.equal(localUrlHit, 'http://localhost:11434/v1/chat/completions');
      },
      {
        config: makeTestConfig(tmpDir, {
          llmProvider: 'local',
          llmProfile: 'local',
          localLlmUrl: 'http://localhost:11434/v1/chat/completions',
          localLlmModel: 'llama3.2',
        }),
        fetchImpl: async (url) => {
          localUrlHit = String(url);
          return new Response(
            JSON.stringify({
              usage: { prompt_tokens: 100, completion_tokens: 40 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({ react: false, reason: 'Local model ok.' }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('Phase 1 group_private conversation mode maintains strict zero-memory-leakage across 3 participants', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-group-priv-'));
  const observedTurnPrompts: string[] = [];

  try {
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/converse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          },
          body: JSON.stringify({
            mode: 'group_private',
            participants: [
              {
                ...makeValidAgent(),
                id: 'isabella',
                name: 'Isabella Rodriguez',
                retrievedMemories: [
                  {
                    id: 'm_isa',
                    type: 'observation',
                    description: 'SECRET_ISABELLA_KEY: cafe vault code is 9912.',
                    importance: 8,
                  },
                ],
              },
              {
                ...makeValidAgent(),
                id: 'john',
                name: 'John Lin',
                retrievedMemories: [
                  {
                    id: 'm_john',
                    type: 'observation',
                    description: 'SECRET_JOHN_KEY: hidden wholesale ledger deficit.',
                    importance: 8,
                  },
                ],
              },
              {
                ...makeValidAgent(),
                id: 'klaus',
                name: 'Klaus Mueller',
                retrievedMemories: [
                  {
                    id: 'm_klaus',
                    type: 'observation',
                    description: 'SECRET_KLAUS_KEY: draft research critique.',
                    importance: 8,
                  },
                ],
              },
            ],
            simTimeLabel: 'Day 1 · 4:00 PM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          mode: string;
          turns: Array<{ speakerId: string; text: string }>;
        };
        assert.equal(body.mode, 'scene');
        assert.ok(body.turns.length >= 3);

        // Verify strict isolation on each turn prompt: Isabella's prompt must never see John/Klaus secrets, etc.
        assert.equal(observedTurnPrompts.length >= 3, true);
        assert.equal(observedTurnPrompts[0].includes('SECRET_ISABELLA_KEY'), true);
        assert.equal(observedTurnPrompts[0].includes('SECRET_JOHN_KEY'), false);
        assert.equal(observedTurnPrompts[0].includes('SECRET_KLAUS_KEY'), false);

        assert.equal(observedTurnPrompts[1].includes('SECRET_JOHN_KEY'), true);
        assert.equal(observedTurnPrompts[1].includes('SECRET_ISABELLA_KEY'), false);
        assert.equal(observedTurnPrompts[1].includes('SECRET_KLAUS_KEY'), false);

        assert.equal(observedTurnPrompts[2].includes('SECRET_KLAUS_KEY'), true);
        assert.equal(observedTurnPrompts[2].includes('SECRET_ISABELLA_KEY'), false);
        assert.equal(observedTurnPrompts[2].includes('SECRET_JOHN_KEY'), false);
      },
      {
        config: makeTestConfig(tmpDir, { llmProvider: 'openrouter' }),
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role: string; content: string }>;
          };
          const userPrompt = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
          if (userPrompt.includes('Speak strictly as')) {
            observedTurnPrompts.push(userPrompt);
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        spokenLine: 'Good afternoon neighbors, busy day in town.',
                        privateThought: 'Keeping my own counsel.',
                        endConversation: false,
                      }),
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summaryByAgent: {
                        isabella: { summary: 'Chatted with John and Klaus.', importance: 5 },
                        john: { summary: 'Caught up at Hobbs Cafe.', importance: 5 },
                        klaus: { summary: 'Discussed town happenings.', importance: 5 },
                      },
                      emotionalShiftByAgent: {},
                      tomUpdates: [],
                      memeIdsDiscussed: [],
                      newNews: [],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 2 /api/agent/decide validates coalitions, openDisputes, boycotts & shocks and normalizes Phase 2 actions', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-phase2-test-'));
  let capturedPrompt = '';
  try {
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/decide`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            simTimeLabel: 'Day 3 · 11:00 AM',
            locations: [
              { id: 'town_hall', name: 'Town Hall' },
              { id: 'hobbs_cafe', name: 'Hobbs Cafe' },
            ],
            openDisputes: [
              { id: 'dsp_1', category: 'loan_default', claimSummary: 'Unpaid $60 loan', claimedAmount: 60 },
            ],
            coalitions: [
              { id: 'coal_1', name: 'Southside Care Bloc', agenda: 'public_welfare', memberCount: 3 },
            ],
            activeBoycotts: [
              { id: 'boy_1', targetLocationId: 'hobbs_cafe', targetBusinessName: 'Hobbs Cafe', reason: 'High prices' },
            ],
            activeShocks: [
              { kind: 'supply_shortage', title: 'Supply Bottleneck', description: 'Tight retail stock' },
            ],
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          action?: string;
          coalitionName?: string;
          coalitionAgenda?: string;
        };
        assert.equal(body.action, 'form_coalition');
        assert.equal(body.coalitionName, 'Civic Builders');
        assert.equal(body.coalitionAgenda, 'civic_reform');
        assert.ok(capturedPrompt.includes('Active Civic Coalitions'));
        assert.ok(capturedPrompt.includes('Open Town Hall Disputes'));
        assert.ok(capturedPrompt.includes('Active Town Shocks'));
      },
      {
        config: makeTestConfig(tmpDir, { llmProvider: 'openrouter' }),
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role: string; content: string }>;
          };
          capturedPrompt = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      action: 'form_coalition',
                      reason: 'Coordinate reform amidst supply bottleneck.',
                      coalitionName: 'Civic Builders',
                      coalitionAgenda: 'civic_reform',
                      locationId: 'town_hall',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 3 /api/agent/decide validates activeRumors & culturalNorms, keeps ground-truth un-leaked, and normalizes epistemic actions', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-phase3-test-'));
  let capturedPrompt = '';
  try {
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/agent/decide`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            simTimeLabel: 'Day 4 · 2:15 PM',
            locations: [{ id: 'town_hall', name: 'Town Hall' }],
            activeRumors: [
              { id: 'rum_1', claim: 'Cafe owner is facing bankruptcy.', originName: 'Eddy Lin', hopCount: 2 },
            ],
            culturalNorms: [
              { key: 'truthfulness', title: 'Truthfulness & Public Evidence', strength: 70 },
            ],
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          action?: string;
          rumorId?: string;
          normKey?: string;
        };
        assert.equal(body.action, 'fact_check');
        assert.equal(body.rumorId, 'rum_1');
        assert.ok(capturedPrompt.includes('Rumors You Have Heard'));
        assert.ok(capturedPrompt.includes('Prevailing Town Norms'));
        assert.ok(!capturedPrompt.includes('Cafe owner is facing bankruptcy." (false)'));
        assert.ok(!capturedPrompt.includes('deceptive=true'));
      },
      {
        config: makeTestConfig(tmpDir, { llmProvider: 'openrouter' }),
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role: string; content: string }>;
          };
          capturedPrompt = payload.messages?.find((m) => m.role === 'user')?.content ?? '';
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      action: 'fact_check',
                      reason: 'Verify claim at Town Hall archives.',
                      rumorId: 'rum_1',
                      locationId: 'town_hall',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 4 /api/world/arbitrate compiles openIntent into conserved AtomicWorldOps and filters invalid ops', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smallville-phase4-test-'));
  try {
    await withServer(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/world/arbitrate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-world-id': 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
          body: JSON.stringify({
            agent: makeValidAgent(),
            openIntent: 'Start the Oak Hill Cooperative Guild with $25 pooled dues.',
            simTimeLabel: 'Day 2 · 1:00 PM',
            locations: [{ id: 'hobbs_cafe', name: 'Hobbs Cafe' }],
            validAgentIds: ['isabella', 'john'],
          }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          narrative?: string;
          ops?: Array<{ op: string; name?: string; initialContribution?: number }>;
        };
        assert.ok(body.narrative?.includes('Cooperative Guild'));
        assert.equal(body.ops?.length, 1);
        assert.equal(body.ops?.[0]?.op, 'create_org');
        assert.equal(body.ops?.[0]?.initialContribution, 25);
      },
      {
        config: makeTestConfig(tmpDir, { llmProvider: 'openrouter' }),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      narrative: 'Founded the Oak Hill Cooperative Guild with $25 initial pool.',
                      ops: [
                        {
                          op: 'create_org',
                          name: 'Oak Hill Cooperative Guild',
                          charter: 'Support neighborhood craftspeople.',
                          initialContribution: 25,
                          headquartersLocationId: 'hobbs_cafe',
                        },
                        {
                          op: 'unknown_hack_op',
                          amount: 99999,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});



