import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  normalizeBdiDecisionPayload,
  normalizeCommitment,
  normalizeCompressedScenePayload,
  normalizeConsolidationPayload,
  normalizeConverseTurnPayload,
  normalizeConverseWrapupPayload,
  normalizeEmotionalShift,
  normalizeGossipUpdates,
  normalizeInterviewJudgePayload,
  normalizeInterviewPayload,
  normalizeOpenActionOps,
  normalizePlanPayload,
  normalizeReactionPayload,
  normalizeReflectionPayload,
  normalizeReflectionQuestionsPayload,
  normalizeStepDetailPayload,
  normalizeTomUpdate,
  normalizeWhisperPayload,
  safeParseJson,
} from './src/simulation/llmJson.ts';
import { extractKeywords, retrieveMemories } from './src/simulation/memory.ts';
import type { MemoryNode, MemoryType, ScheduleBlockKind } from './src/simulation/types.ts';
import {
  DailyBudgetTracker,
  MetricsCollector,
  TokenBucketLimiter,
  type ServerJobMetricKind,
} from './src/server/rateLimit.ts';
import {
  DailySpendTracker,
  estimateCallCostUsd,
  parseCsvList,
  resolveModelRoute,
  type LlmRunProfile,
} from './src/server/modelRouter.ts';
import {
  isValidUuid,
  validateArbitrateBody,
  validateConverseBody,
  validateConsolidateBody,
  validateDecideBody,
  validateEmbedBody,
  validateInterviewBody,
  validateInterviewJudgeBody,
  validatePlanBody,
  validateReactBody,
  validateReflectBody,
  validateReflectQuestionsBody,
  validateStepDetailBody,
  validateWhisperBody,
  validateWorldSaveBody,
} from './src/server/validate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
const EMBED_MODEL_NAME = 'gemini-embedding-2';

const REALISM_ANCHOR =
  'Ground every response in a realistic everyday human community (ordinary residents, grounded human psychology, household finances, daily work, civic choices, and neighborhood relationships—never fictional TV shows or supernatural personas).';

export class UpstreamApiError extends Error {
  status: number;
  retryAfterSec?: number;
  code?: string;

  constructor(message: string, status: number, options: { retryAfterSec?: number; code?: string } = {}) {
    super(message);
    this.status = status;
    this.retryAfterSec = options.retryAfterSec;
    this.code = options.code;
  }
}

export interface ServerConfig {
  llmProvider: 'auto' | 'gemini' | 'openrouter' | 'local';
  llmProfile?: LlmRunProfile;
  openRouterApiKey: string | null;
  openRouterModel: string;
  openRouterFreeModels?: string[];
  openRouterCohortModels?: string[];
  openRouterStrongModel?: string;
  geminiApiKey: string | null;
  geminiModel: string;
  localLlmUrl?: string | null;
  localLlmModel?: string;
  localLlmApiKey?: string | null;
  maxEstimatedUsdPerDay?: number | null;
  modelConverse?: string;
  modelReflect?: string;
  modelPlan?: string;
  maxConverseTurns?: number;
  enableServerSaves: boolean;
  maxCallsPerDay: number;
  appAccessToken: string | null;
  worldsDir: string;
  appUrl: string;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawProvider = (env.LLM_PROVIDER || 'auto').trim().toLowerCase();
  const llmProvider: ServerConfig['llmProvider'] =
    rawProvider === 'gemini' || rawProvider === 'openrouter' || rawProvider === 'local'
      ? rawProvider
      : 'auto';

  const rawProfile = (env.LLM_PROFILE || 'auto').trim().toLowerCase();
  const llmProfile: LlmRunProfile =
    rawProfile === 'dev_free' || rawProfile === 'live_cheap' || rawProfile === 'local'
      ? rawProfile
      : 'auto';

  const rawOrKey = env.OPENROUTER_API_KEY?.trim();
  const openRouterApiKey =
    rawOrKey && rawOrKey !== 'MY_OPENROUTER_API_KEY' ? rawOrKey : null;

  const rawGemKey = env.GEMINI_API_KEY?.trim();
  const geminiApiKey =
    rawGemKey && rawGemKey !== 'MY_GEMINI_API_KEY' ? rawGemKey : null;

  const localLlmUrl = env.LOCAL_LLM_URL?.trim() || null;
  const localLlmModel = env.LOCAL_LLM_MODEL?.trim() || 'llama3.2';
  const localLlmApiKey = env.LOCAL_LLM_API_KEY?.trim() || null;

  const maxCallsParsed = Number(env.MAX_LLM_CALLS_PER_DAY);
  const maxCallsPerDay =
    Number.isFinite(maxCallsParsed) && maxCallsParsed >= 1
      ? Math.floor(maxCallsParsed)
      : 10000;

  const maxUsdParsed = Number(env.MAX_ESTIMATED_USD_PER_DAY);
  const maxEstimatedUsdPerDay =
    Number.isFinite(maxUsdParsed) && maxUsdParsed > 0 ? maxUsdParsed : null;

  const maxTurnsParsed = Number(env.MAX_CONVERSE_TURNS);
  const maxConverseTurns =
    Number.isFinite(maxTurnsParsed) && maxTurnsParsed >= 2
      ? Math.min(8, Math.floor(maxTurnsParsed))
      : 6;

  const rawOrModel = env.OPENROUTER_MODEL?.trim();
  const normalizedOrModel =
    !rawOrModel || rawOrModel === 'nvidia/nemotron-3-ultra-550b-a55b:free'
      ? DEFAULT_OPENROUTER_MODEL
      : rawOrModel.endsWith(':batch')
        ? rawOrModel.slice(0, -':batch'.length)
        : rawOrModel;
  const openRouterModel = normalizedOrModel || DEFAULT_OPENROUTER_MODEL;

  return {
    llmProvider,
    llmProfile,
    openRouterApiKey,
    openRouterModel,
    openRouterFreeModels: parseCsvList(env.OPENROUTER_FREE_MODELS),
    openRouterCohortModels: parseCsvList(env.OPENROUTER_COHORT_MODELS),
    openRouterStrongModel: env.OPENROUTER_STRONG_MODEL?.trim() || undefined,
    geminiApiKey,
    geminiModel: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    localLlmUrl,
    localLlmModel,
    localLlmApiKey,
    maxEstimatedUsdPerDay,
    modelConverse: env.MODEL_CONVERSE?.trim() || undefined,
    modelReflect: env.MODEL_REFLECT?.trim() || undefined,
    modelPlan: env.MODEL_PLAN?.trim() || undefined,
    maxConverseTurns,
    enableServerSaves: env.ENABLE_SERVER_SAVES?.trim().toLowerCase() === 'true',
    maxCallsPerDay,
    appAccessToken: env.APP_ACCESS_TOKEN?.trim() || null,
    worldsDir: path.resolve(__dirname, 'data/worlds'),
    appUrl: env.APP_URL?.trim() || 'http://localhost:3000',
  };
}

function resolveActiveProvider(config: ServerConfig): 'openrouter' | 'gemini' | 'local' | 'none' {
  if (config.llmProfile === 'local' || config.llmProvider === 'local') {
    return config.localLlmUrl ? 'local' : 'none';
  }
  if (config.llmProvider === 'openrouter') {
    return config.openRouterApiKey ? 'openrouter' : 'none';
  }
  if (config.llmProvider === 'gemini') {
    return config.geminiApiKey ? 'gemini' : 'none';
  }
  if (config.openRouterApiKey) return 'openrouter';
  if (config.geminiApiKey) return 'gemini';
  if (config.localLlmUrl) return 'local';
  return 'none';
}

function resolveModelForJob(
  config: ServerConfig,
  provider: 'openrouter' | 'gemini' | 'local' | 'none',
  jobKind: ServerJobMetricKind,
  agentId?: string,
  preferStrong = false,
): string {
  return resolveModelRoute({
    config: {
      llmProfile: config.llmProfile ?? 'auto',
      openRouterModel: config.openRouterModel,
      geminiModel: config.geminiModel,
      modelConverse: config.modelConverse,
      modelReflect: config.modelReflect,
      modelPlan: config.modelPlan,
      openRouterFreeModels: config.openRouterFreeModels ?? [],
      openRouterCohortModels: config.openRouterCohortModels ?? [],
      openRouterStrongModel: config.openRouterStrongModel,
      localLlmModel: config.localLlmModel ?? 'llama3.2',
    },
    provider,
    jobKind,
    agentId,
    preferStrong,
  }).model;
}

function isOpenRouterDailyQuotaError(err: unknown): boolean {
  if (!(err instanceof UpstreamApiError)) return false;
  if (err.status !== 429 && err.status !== 402) return false;
  if (err.code === 'DAILY_BUDGET_REACHED') return false;
  const msg = err.message.toLowerCase();
  return (
    err.status === 402 ||
    msg.includes('free-models-per-day') ||
    msg.includes('per-day') ||
    msg.includes('daily') ||
    msg.includes('insufficient credits') ||
    msg.includes('more credits')
  );
}

function msUntilNextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return Math.max(60_000, nextMidnight - nowMs);
}

function extractCleanErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : 'Unexpected error while calling upstream LLM API.';
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const inner = parsed?.error?.message ?? parsed?.message;
    if (typeof inner === 'string' && inner.trim()) {
      return inner.split('\n')[0].trim();
    }
  } catch {
    // plain message
  }
  return raw;
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) {
    return Math.ceil(num);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new UpstreamApiError('Client disconnected.', 499));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UpstreamApiError('Client disconnected.', 499));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function combineAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of signals) {
        s.removeEventListener('abort', onAbort);
      }
    },
  };
}

interface StructuredJsonRequest {
  jobKind: ServerJobMetricKind;
  systemInstruction: string;
  prompt: string;
  jsonContract: string;
  geminiSchema?: unknown;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  agentId?: string;
  preferStrong?: boolean;
}

interface AgentContextPayload {
  id: string;
  name: string;
  age: number;
  occupation: string;
  traits: string[];
  goals?: string[];
  innateSummary: string;
  currently: string;
  currentAction: string;
  currentSubStep?: string;
  locationName: string;
  inventory?: string[];
  wallet?: number;
  reputation?: number;
  employerName?: string;
  housingStatus?: string;
  careerTier?: string;
  dossier?: {
    background?: string;
    financialPosture?: string;
    civicWorldview?: string;
    speechStyle?: string;
    privateAgenda?: string;
    redLines?: string[];
  };
  temperament?: {
    stubbornness?: number;
    riskTolerance?: number;
    ambition?: number;
    decoding?: {
      temperature?: number;
      topP?: number;
      frequencyPenalty?: number;
    };
  };
  beliefs?: Array<{
    subjectId: string;
    predicate: string;
    claim: string;
    confidence?: number;
  }>;
  projects?: Array<{ id: string; title: string; progress: number; category?: string }>;
  goods?: Record<string, number>;
  drives?: { energy: number; hunger: number; social: number; purpose: number };
  mood?: { valence: number; arousal: number; label: string };
  socialGraph?: Record<
    string,
    {
      roleLabel: string;
      trust: number;
      affection: number;
      familiarity: number;
      inferredGoal: string;
    }
  >;
  nearbyObjects?: Array<{ name: string; state: string; persistentNote?: string }>;
  retrievedMemories?: Array<{ id: string; type: string; description: string; importance: number; createdAt?: number; lastAccessed?: number }>;
  candidateMemories?: Array<{ id: string; type: string; description: string; importance: number; createdAt?: number; lastAccessed?: number }>;
  relationships?: Record<string, string>;
}

function getDecodingParams(
  agent: AgentContextPayload | undefined,
  defaults: { temperature: number; topP?: number; frequencyPenalty?: number },
): { temperature: number; topP?: number; frequencyPenalty?: number } {
  const dec = agent?.temperament?.decoding;
  return {
    temperature: dec?.temperature ?? defaults.temperature,
    topP: dec?.topP ?? defaults.topP,
    frequencyPenalty: dec?.frequencyPenalty ?? defaults.frequencyPenalty,
  };
}

function formatPsychContext(agent: AgentContextPayload): string[] {
  const lines: string[] = [];
  if (agent.goals && agent.goals.length > 0) {
    lines.push(`Personal Goals: ${agent.goals.join('; ')}`);
  }
  if (typeof agent.wallet === 'number' || typeof agent.reputation === 'number') {
    const finParts: string[] = [];
    if (typeof agent.wallet === 'number') finParts.push(`Wallet=$${Math.round(agent.wallet)}`);
    if (agent.employerName) finParts.push(`Workplace=${agent.employerName}`);
    if (agent.careerTier) finParts.push(`CareerTier=${agent.careerTier}`);
    if (agent.housingStatus) finParts.push(`Housing=${agent.housingStatus}`);
    if (typeof agent.reputation === 'number') finParts.push(`Community Reputation=${Math.round(agent.reputation)}/100`);
    lines.push(`Economic & Civic Standing: ${finParts.join(', ')}`);
  }
  if (agent.dossier) {
    if (agent.dossier.background) lines.push(`Biographical Dossier: ${agent.dossier.background}`);
    const stanceParts = [
      agent.dossier.financialPosture ? `Financial posture=${agent.dossier.financialPosture}` : '',
      agent.dossier.civicWorldview ? `Worldview=${agent.dossier.civicWorldview}` : '',
      agent.temperament?.stubbornness !== undefined
        ? `Stubbornness=${Math.round(agent.temperament.stubbornness * 100)}%`
        : '',
    ].filter(Boolean);
    if (stanceParts.length > 0) lines.push(`Temperament & Worldview: ${stanceParts.join(', ')}`);
    if (agent.dossier.speechStyle) lines.push(`Distinct Speech Cadence: ${agent.dossier.speechStyle}`);
    if (agent.dossier.privateAgenda) lines.push(`Private Agenda: ${agent.dossier.privateAgenda}`);
    if (agent.dossier.redLines && agent.dossier.redLines.length > 0) {
      lines.push(`Hard Red Lines (do NOT concede): ${agent.dossier.redLines.join('; ')}`);
    }
  }
  if (agent.beliefs && agent.beliefs.length > 0) {
    lines.push(
      `Current Active Beliefs (bi-temporal truth): ${agent.beliefs
        .slice(0, 6)
        .map((b) => `[${b.predicate}:${b.subjectId}] ${b.claim}`)
        .join(' | ')}`,
    );
  }
  if (agent.projects && agent.projects.length > 0) {
    lines.push(
      `Active Multi-Day Projects: ${agent.projects
        .map((p) => `[${p.id}] ${p.title} (${Math.round(p.progress)}%)`)
        .join('; ')}`,
    );
  }
  if (agent.goods && Object.keys(agent.goods).length > 0) {
    const owned = Object.entries(agent.goods)
      .filter(([, q]) => q > 0)
      .map(([k, q]) => `${k}×${q}`);
    if (owned.length > 0) {
      lines.push(`Owned Goods: ${owned.join(', ')}`);
    }
  }
  if (agent.mood) {
    lines.push(
      `Affective State: ${agent.mood.label} (valence=${agent.mood.valence.toFixed(2)}, arousal=${agent.mood.arousal.toFixed(2)})`,
    );
  }
  if (agent.drives) {
    lines.push(
      `Internal Drives (0-100): Energy=${Math.round(agent.drives.energy)}, Hunger=${Math.round(agent.drives.hunger)}, Social=${Math.round(agent.drives.social)}, Purpose=${Math.round(agent.drives.purpose)}`,
    );
  }
  if (agent.inventory && agent.inventory.length > 0) {
    lines.push(`Carrying items: ${agent.inventory.join(', ')}`);
  }
  if (agent.currentSubStep) {
    lines.push(`Micro-action: ${agent.currentSubStep}`);
  }
  if (agent.nearbyObjects && agent.nearbyObjects.length > 0) {
    lines.push(
      `Nearby Environment Affordances: ${agent.nearbyObjects
        .map((o) =>
          o.persistentNote ? `${o.name} [${o.state}; trace: ${o.persistentNote}]` : `${o.name} [${o.state}]`,
        )
        .join('; ')}`,
    );
  }
  return lines;
}

function buildPrivateSpeakerBlock(
  speaker: AgentContextPayload,
  partner: { id: string; name: string },
  memoriesOverride?: Array<{ id: string; type: string; description: string; importance: number }>,
): string[] {
  const tom = speaker.socialGraph?.[partner.id];
  const memoriesToShow = memoriesOverride ?? speaker.retrievedMemories ?? [];
  return [
    `You are ${speaker.name} (${speaker.age}, ${speaker.occupation}).`,
    `Traits: ${speaker.traits.join(', ')}`,
    `Bio: ${speaker.innateSummary}`,
    `Current intention: ${speaker.currently}`,
    `Current action: ${speaker.currentAction}`,
    ...formatPsychContext(speaker),
    `Your private belief about ${partner.name}: ${speaker.relationships?.[partner.id] ?? 'Neighbor in Smallville'}${
      tom
        ? ` (Trust=${tom.trust}, Affection=${tom.affection}, What you guess they want: "${tom.inferredGoal}")`
        : ''
    }`,
    `Your retrieved private memories:`,
    ...memoriesToShow.map((m) => `- [id=${m.id}, ${m.type}, imp ${m.importance}] ${m.description}`),
  ];
}

export interface CreateAppOptions {
  config?: ServerConfig;
  fetchImpl?: typeof fetch;
  geminiGenerateImpl?: (params: {
    model: string;
    systemInstruction: string;
    contents: string;
    geminiSchema: unknown;
    signal: AbortSignal;
  }) => Promise<{ text: string; inputTokens?: number; outputTokens?: number }>;
  rateLimiter?: TokenBucketLimiter;
  dailyBudget?: DailyBudgetTracker;
  metrics?: MetricsCollector;
  nowFn?: () => number;
  suppressLogs?: boolean;
}

export function createSmallvilleApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadServerConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowFn = options.nowFn ?? (() => Date.now());
  const rateLimiter =
    options.rateLimiter ??
    new TokenBucketLimiter({ requestsPerMinute: 240, burst: 40, nowFn });
  const dailyBudget =
    options.dailyBudget ??
    new DailyBudgetTracker({ maxCallsPerDay: config.maxCallsPerDay, nowFn });
  const spendTracker = new DailySpendTracker({
    maxUsdPerDay: config.maxEstimatedUsdPerDay ?? null,
    nowFn,
  });
  const metrics =
    options.metrics ??
    new MetricsCollector(options.suppressLogs ? () => undefined : (line) => console.log(line));

  const geminiClient = config.geminiApiKey
    ? new GoogleGenAI({
        apiKey: config.geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  let openRouterCooldownUntilMs = 0;
  let openRouterFailoverReason: string | null = null;

  function canFailoverToGemini(): boolean {
    return config.llmProvider === 'auto' && Boolean(geminiClient || options.geminiGenerateImpl);
  }

  function resolveEffectiveProvider(): {
    provider: 'openrouter' | 'gemini' | 'local' | 'none';
    failoverActive: boolean;
    failoverReason: string | null;
  } {
    const primary = resolveActiveProvider(config);
    if (primary === 'openrouter' && canFailoverToGemini() && nowFn() < openRouterCooldownUntilMs) {
      return {
        provider: 'gemini',
        failoverActive: true,
        failoverReason: openRouterFailoverReason,
      };
    }
    return {
      provider: primary,
      failoverActive: false,
      failoverReason: null,
    };
  }

  const app = express();
  app.set('trust proxy', true);

  // Enforce APP_ACCESS_TOKEN on all /api routes when configured
  app.use('/api', (req, res, next) => {
    if (!config.appAccessToken) {
      next();
      return;
    }
    const provided = req.header('x-app-token')?.trim() ?? '';
    if (provided !== config.appAccessToken) {
      res.status(401).json({
        error: 'Valid access token required in x-app-token header.',
        requiresAccessToken: true,
      });
      return;
    }
    next();
  });

  // Per-route strict body size caps
  app.use('/api/agent', express.json({ limit: '300kb' }));
  app.use('/api/world', express.json({ limit: '5mb' }));
  app.use('/api', express.json({ limit: '300kb' }));

  // Malformed JSON body error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request payload exceeds route limit.' });
      return;
    }
    if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    next(err);
  });

  function isLlmConfigured(): boolean {
    return resolveActiveProvider(config) !== 'none';
  }

  function handleApiError(res: express.Response, err: unknown, context: string) {
    if (res.headersSent) return;
    const rawMessage =
      err instanceof Error ? err.message : 'Unexpected error while calling upstream LLM API.';
    const message = extractCleanErrorMessage(err);
    if (!options.suppressLogs) {
      console.error(`[Smallville API Error - ${context}]`, message);
    }

    const explicitStatus = err instanceof UpstreamApiError ? err.status : 0;
    const retryAfterSec = err instanceof UpstreamApiError ? err.retryAfterSec : undefined;
    if (retryAfterSec) {
      res.setHeader('Retry-After', String(retryAfterSec));
    }

    const status =
      explicitStatus === 400 ||
      explicitStatus === 401 ||
      explicitStatus === 403 ||
      explicitStatus === 429 ||
      explicitStatus === 502 ||
      explicitStatus === 503 ||
      explicitStatus === 504 ||
      explicitStatus === 499
        ? explicitStatus
        : rawMessage.includes('API_KEY') || rawMessage.includes('PERMISSION_DENIED')
          ? 403
          : rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')
            ? 429
            : rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')
              ? 503
              : 500;

    res.status(status).json({
      error: message,
      ...(err instanceof UpstreamApiError && err.code ? { code: err.code } : {}),
      ...(retryAfterSec ? { retryAfterSec } : {}),
    });
  }

  function attachRequestAbort(req: express.Request, res: express.Response, totalDeadlineMs: number) {
    const controller = new AbortController();
    const deadlineAtMs = nowFn() + totalDeadlineMs;
    const deadlineTimer = setTimeout(() => {
      controller.abort();
    }, totalDeadlineMs);

    const onReqAborted = () => {
      controller.abort();
    };
    const onReqClose = () => {
      if (!req.complete && !res.writableFinished) {
        controller.abort();
      }
    };
    const onResClose = () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    };
    req.on('aborted', onReqAborted);
    req.on('close', onReqClose);
    res.on('close', onResClose);

    return {
      signal: controller.signal,
      deadlineAtMs,
      cleanup: () => {
        clearTimeout(deadlineTimer);
        req.off('aborted', onReqAborted);
        req.off('close', onReqClose);
        res.off('close', onResClose);
      },
    };
  }

  // Enforce IP + x-world-id token-bucket rate limiter & daily call budget on /api/agent/*
  app.use('/api/agent', (req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const worldIdHeader = req.header('x-world-id')?.trim();
    const keys = [`ip:${clientIp}`];
    if (worldIdHeader && isValidUuid(worldIdHeader)) {
      keys.push(`world:${worldIdHeader}`);
    }

    const decision = rateLimiter.consumeAll(keys);
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Retry in ${decision.retryAfterSec}s.`,
        retryAfterSec: decision.retryAfterSec,
      });
      return;
    }

    if (!dailyBudget.hasCapacity()) {
      res.status(429).json({
        error: 'daily budget reached',
        code: 'DAILY_BUDGET_REACHED',
      });
      return;
    }

    if (!spendTracker.hasCapacity()) {
      res.status(429).json({
        error: 'daily estimated USD spend cap reached',
        code: 'DAILY_SPEND_CAP_REACHED',
      });
      return;
    }

    next();
  });

  async function invokeSingleOpenRouterCall(params: {
    model: string;
    systemPrompt: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature: number;
    topP?: number;
    frequencyPenalty?: number;
    maxTokens: number;
    useJsonFormat: boolean;
    includeReasoningControl: boolean;
    routeSignal: AbortSignal;
    perCallTimeoutMs: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const callTimeout = AbortSignal.timeout(params.perCallTimeoutMs);
    const { signal, cleanup } = combineAbortSignals([params.routeSignal, callTimeout]);

    try {
      const body: Record<string, unknown> = {
        model: params.model,
        messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      };
      if (typeof params.topP === 'number' && Number.isFinite(params.topP)) {
        body.top_p = Math.max(0.5, Math.min(1, params.topP));
      }
      if (typeof params.frequencyPenalty === 'number' && Number.isFinite(params.frequencyPenalty)) {
        body.frequency_penalty = Math.max(0, Math.min(1.5, params.frequencyPenalty));
      }
      if (params.useJsonFormat) {
        body.response_format = { type: 'json_object' };
      }
      if (params.includeReasoningControl) {
        body.reasoning = { effort: 'low', exclude: true };
      }

      const res = await fetchImpl(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.appUrl,
          'X-Title': 'Smallville Generative Town',
        },
        body: JSON.stringify(body),
        signal,
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ message?: { content?: string | null } }>;
      };

      if (!res.ok) {
        const errMsg =
          data?.error?.message ?? `OpenRouter request failed with HTTP ${res.status}.`;
        if (
          params.includeReasoningControl &&
          res.status === 400 &&
          errMsg.toLowerCase().includes('reasoning')
        ) {
          return invokeSingleOpenRouterCall({
            ...params,
            includeReasoningControl: false,
          });
        }
        if (
          params.useJsonFormat &&
          res.status === 400 &&
          errMsg.toLowerCase().includes('response_format')
        ) {
          return invokeSingleOpenRouterCall({
            ...params,
            useJsonFormat: false,
          });
        }
        const retryAfterSec = parseRetryAfterHeader(res.headers.get('retry-after'));
        const mappedStatus = res.status === 401 ? 403 : res.status;
        throw new UpstreamApiError(errMsg, mappedStatus, { retryAfterSec });
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new UpstreamApiError('OpenRouter returned an empty completion.', 502);
      }

      return {
        content,
        inputTokens: Number(data.usage?.prompt_tokens ?? 0) || 0,
        outputTokens: Number(data.usage?.completion_tokens ?? 0) || 0,
      };
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        if (params.routeSignal.aborted) {
          throw new UpstreamApiError('Request aborted or exceeded route deadline.', 504);
        }
        throw new UpstreamApiError('Upstream model call timed out after 25s.', 504);
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async function invokeSingleGeminiCall(params: {
    model: string;
    systemInstruction: string;
    contents: string;
    geminiSchema: unknown;
    temperature?: number;
    topP?: number;
    routeSignal: AbortSignal;
    perCallTimeoutMs: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!geminiClient && !options.geminiGenerateImpl) {
      throw new UpstreamApiError(
        'GEMINI_API_KEY is not configured.',
        503,
      );
    }

    const timeoutSignal = AbortSignal.timeout(params.perCallTimeoutMs);
    const { signal, cleanup } = combineAbortSignals([params.routeSignal, timeoutSignal]);

    try {
      if (options.geminiGenerateImpl) {
        const res = await options.geminiGenerateImpl({
          model: params.model,
          systemInstruction: params.systemInstruction,
          contents: params.contents,
          geminiSchema: params.geminiSchema,
          signal,
        });
        const content = res.text ?? '';
        if (!content.trim()) {
          throw new UpstreamApiError('Gemini returned an empty completion.', 502);
        }
        return {
          content,
          inputTokens: Number(res.inputTokens ?? 0) || 0,
          outputTokens: Number(res.outputTokens ?? 0) || 0,
        };
      }

      const response = await geminiClient!.models.generateContent({
        model: params.model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(params.topP !== undefined ? { topP: params.topP } : {}),
          ...(params.geminiSchema ? { responseSchema: params.geminiSchema as never } : {}),
          abortSignal: signal,
        },
      });

      const content = response.text ?? '';
      if (!content.trim()) {
        throw new UpstreamApiError('Gemini returned an empty completion.', 502);
      }
      return {
        content,
        inputTokens: Number(response.usageMetadata?.promptTokenCount ?? 0) || 0,
        outputTokens: Number(response.usageMetadata?.candidatesTokenCount ?? 0) || 0,
      };
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new UpstreamApiError('Upstream Gemini call timed out after 25s.', 504);
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async function invokeSingleLocalLlmCall(params: {
    model: string;
    systemPrompt: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature: number;
    topP?: number;
    frequencyPenalty?: number;
    maxTokens: number;
    useJsonFormat: boolean;
    routeSignal: AbortSignal;
    perCallTimeoutMs: number;
  }): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (!config.localLlmUrl) {
      throw new UpstreamApiError('LOCAL_LLM_URL is not configured.', 503);
    }
    const callTimeout = AbortSignal.timeout(params.perCallTimeoutMs);
    const { signal, cleanup } = combineAbortSignals([params.routeSignal, callTimeout]);
    try {
      const body: Record<string, unknown> = {
        model: params.model,
        messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      };
      if (typeof params.topP === 'number' && Number.isFinite(params.topP)) {
        body.top_p = Math.max(0.5, Math.min(1, params.topP));
      }
      if (typeof params.frequencyPenalty === 'number' && Number.isFinite(params.frequencyPenalty)) {
        body.frequency_penalty = Math.max(0, Math.min(1.5, params.frequencyPenalty));
      }
      if (params.useJsonFormat) {
        body.response_format = { type: 'json_object' };
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.localLlmApiKey) {
        headers.Authorization = `Bearer ${config.localLlmApiKey}`;
      }
      const res = await fetchImpl(config.localLlmUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      if (!res.ok) {
        const errMsg = data?.error?.message ?? `Local LLM request failed with HTTP ${res.status}.`;
        if (params.useJsonFormat && res.status === 400 && errMsg.toLowerCase().includes('response_format')) {
          return invokeSingleLocalLlmCall({ ...params, useJsonFormat: false });
        }
        throw new UpstreamApiError(errMsg, res.status >= 400 ? res.status : 502);
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new UpstreamApiError('Local LLM returned an empty completion.', 502);
      }
      return {
        content,
        inputTokens: Number(data.usage?.prompt_tokens ?? 0) || 0,
        outputTokens: Number(data.usage?.completion_tokens ?? 0) || 0,
      };
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new UpstreamApiError('Upstream local LLM call timed out.', 504);
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async function runSingleTrackedCall<T>(
    jobKind: ServerJobMetricKind,
    provider: 'openrouter' | 'gemini' | 'local',
    model: string,
    deadlineAtMs: number,
    routeSignal: AbortSignal,
    fn: (perCallTimeoutMs: number) => Promise<T>,
  ): Promise<T> {
    const budgetCheck = dailyBudget.tryConsume();
    if (!budgetCheck.allowed) {
      throw new UpstreamApiError('daily budget reached', 429, {
        code: 'DAILY_BUDGET_REACHED',
      });
    }
    if (!spendTracker.hasCapacity()) {
      throw new UpstreamApiError('daily estimated USD spend cap reached', 429, {
        code: 'DAILY_SPEND_CAP_REACHED',
      });
    }

    const remainingMs = Math.max(500, deadlineAtMs - nowFn());
    const perCallTimeoutMs = Math.min(25_000, remainingMs);
    const startedMs = nowFn();

    try {
      const res = await fn(perCallTimeoutMs);
      const usageRes = res as { inputTokens?: number; outputTokens?: number };
      const inTok = usageRes?.inputTokens ?? 0;
      const outTok = usageRes?.outputTokens ?? 0;
      const costUsd = estimateCallCostUsd(model, inTok, outTok, provider === 'local');
      spendTracker.recordSpend(costUsd);
      metrics.recordUpstreamCall({
        jobKind,
        provider,
        model,
        latencyMs: nowFn() - startedMs,
        ok: true,
        inputTokens: inTok,
        outputTokens: outTok,
        estimatedCostUsd: costUsd,
        status: 200,
      });
      return res;
    } catch (err) {
      const status = err instanceof UpstreamApiError ? err.status : 500;
      metrics.recordUpstreamCall({
        jobKind,
        provider,
        model,
        latencyMs: nowFn() - startedMs,
        ok: false,
        status,
      });
      throw err;
    }
  }

  async function generateStructuredJson<T>(
    req: StructuredJsonRequest,
    routeSignal: AbortSignal,
    deadlineAtMs: number,
  ): Promise<T> {
    let activeProvider = resolveEffectiveProvider().provider;
    if (activeProvider === 'none') {
      throw new UpstreamApiError(
        'No LLM API key is configured. Add OPENROUTER_API_KEY (or GEMINI_API_KEY) in Secrets.',
        503,
      );
    }
    const systemPrompt = [
      REALISM_ANCHOR,
      req.systemInstruction,
      '',
      'Respond strictly with a single valid JSON object matching this exact TypeScript shape (no prose outside JSON):',
      req.jsonContract,
    ].join('\n');

    const callOnce = async (
      provider: 'openrouter' | 'gemini' | 'local',
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    ) => {
      const routed = resolveModelRoute({
        config: {
          llmProfile: config.llmProfile ?? 'auto',
          openRouterModel: config.openRouterModel,
          geminiModel: config.geminiModel,
          modelConverse: config.modelConverse,
          modelReflect: config.modelReflect,
          modelPlan: config.modelPlan,
          openRouterFreeModels: config.openRouterFreeModels ?? [],
          openRouterCohortModels: config.openRouterCohortModels ?? [],
          openRouterStrongModel: config.openRouterStrongModel,
          localLlmModel: config.localLlmModel ?? 'llama3.2',
        },
        provider,
        jobKind: req.jobKind,
        agentId: req.agentId,
        preferStrong: req.preferStrong,
      });
      if (routed.blockedReason) {
        throw new UpstreamApiError(routed.blockedReason, 403, {
          code: 'PAID_MODEL_BLOCKED_IN_DEV_FREE',
        });
      }
      const model = routed.model;
      return runSingleTrackedCall(req.jobKind, provider, model, deadlineAtMs, routeSignal, (perCallTimeoutMs) => {
        if (provider === 'local') {
          return invokeSingleLocalLlmCall({
            model,
            systemPrompt,
            messages,
            temperature: req.temperature ?? 0.7,
            topP: req.topP,
            frequencyPenalty: req.frequencyPenalty,
            maxTokens: req.maxTokens ?? 2200,
            useJsonFormat: true,
            routeSignal,
            perCallTimeoutMs,
          });
        }
        if (provider === 'openrouter') {
          return invokeSingleOpenRouterCall({
            model,
            systemPrompt,
            messages,
            temperature: req.temperature ?? 0.7,
            topP: req.topP,
            frequencyPenalty: req.frequencyPenalty,
            maxTokens: req.maxTokens ?? 2200,
            useJsonFormat: true,
            includeReasoningControl: true,
            routeSignal,
            perCallTimeoutMs,
          });
        }
        return invokeSingleGeminiCall({
          model,
          systemInstruction: req.geminiSchema
            ? `${REALISM_ANCHOR} ${req.systemInstruction}`
            : systemPrompt,
          contents: messages.map((m) => m.content).join('\n\n'),
          geminiSchema: req.geminiSchema,
          temperature: req.temperature,
          topP: req.topP,
          routeSignal,
          perCallTimeoutMs,
        });
      });
    };

    const failOverToGemini = async (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      reasonErr: unknown,
      cooldownMs: number,
    ) => {
      const reason = extractCleanErrorMessage(reasonErr);
      const nowMs = nowFn();
      const shouldLog = !options.suppressLogs && nowMs >= openRouterCooldownUntilMs;
      openRouterCooldownUntilMs = Math.max(openRouterCooldownUntilMs, nowMs + cooldownMs);
      openRouterFailoverReason = reason;
      activeProvider = 'gemini';
      if (shouldLog) {
        console.warn(
          `[Smallville LLM Failover] OpenRouter unavailable (${reason}); routing to Gemini (${config.geminiModel}).`,
        );
      }
      return callOnce('gemini', messages);
    };

    // At most 1 transient retry for timeout (504), 5xx, or 429 (honouring Retry-After),
    // with automatic failover from OpenRouter to Gemini when llmProvider === 'auto' and Gemini is configured.
    let rawReply: { content: string; inputTokens: number; outputTokens: number };
    const initialMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: req.prompt },
    ];

    try {
      rawReply = await callOnce(activeProvider, initialMessages);
    } catch (err) {
      if (routeSignal.aborted || nowFn() >= deadlineAtMs - 1000) {
        throw err;
      }
      const status = err instanceof UpstreamApiError ? err.status : 0;
      const isDailyCap =
        err instanceof UpstreamApiError &&
        (err.code === 'DAILY_BUDGET_REACHED' || err.code === 'DAILY_SPEND_CAP_REACHED');
      if (isDailyCap) {
        throw err;
      }

      if (activeProvider === 'openrouter' && isOpenRouterDailyQuotaError(err)) {
        if (canFailoverToGemini()) {
          rawReply = await failOverToGemini(
            initialMessages,
            err,
            msUntilNextUtcMidnight(nowFn()),
          );
        } else {
          const retryAfterSec =
            err instanceof UpstreamApiError && err.retryAfterSec ? err.retryAfterSec : 60;
          throw new UpstreamApiError(extractCleanErrorMessage(err), 429, {
            retryAfterSec,
            code: 'PROVIDER_DAILY_QUOTA_EXHAUSTED',
          });
        }
      } else if (activeProvider === 'openrouter' && status === 429 && canFailoverToGemini()) {
        const cooldownMs =
          err instanceof UpstreamApiError && err.retryAfterSec
            ? Math.max(60_000, err.retryAfterSec * 1000)
            : 2 * 60_000;
        rawReply = await failOverToGemini(initialMessages, err, cooldownMs);
      } else {
        const isRetryable = status === 429 || status === 504 || (status >= 500 && status <= 599);
        if (!isRetryable) {
          throw err;
        }

        const retryDelayMs =
          err instanceof UpstreamApiError && err.retryAfterSec
            ? Math.min(err.retryAfterSec * 1000, Math.max(0, deadlineAtMs - nowFn() - 2000))
            : 1200;
        if (retryDelayMs > 0) {
          await sleepWithAbort(retryDelayMs, routeSignal);
        }
        try {
          rawReply = await callOnce(activeProvider, initialMessages);
        } catch (retryErr) {
          if (
            activeProvider === 'openrouter' &&
            canFailoverToGemini() &&
            !routeSignal.aborted &&
            nowFn() < deadlineAtMs - 1000 &&
            !(
              retryErr instanceof UpstreamApiError &&
              (retryErr.code === 'DAILY_BUDGET_REACHED' ||
                retryErr.code === 'DAILY_SPEND_CAP_REACHED')
            )
          ) {
            rawReply = await failOverToGemini(initialMessages, retryErr, 2 * 60_000);
          } else {
            throw retryErr;
          }
        }
      }
    }

    try {
      return safeParseJson<T>(rawReply.content);
    } catch {
      // Single JSON repair attempt
      if (routeSignal.aborted || nowFn() >= deadlineAtMs - 1000) {
        throw new UpstreamApiError(
          'Model returned invalid JSON and route deadline prevented repair.',
          502,
        );
      }
      const repairMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: req.prompt },
        { role: 'assistant', content: rawReply.content },
        {
          role: 'user',
          content: 'Your last reply was not valid JSON. Reply with only the JSON object.',
        },
      ];
      let repairReply: { content: string; inputTokens: number; outputTokens: number };
      try {
        repairReply = await callOnce(activeProvider, repairMessages);
      } catch (repairErr) {
        if (repairErr instanceof UpstreamApiError && repairErr.code === 'DAILY_BUDGET_REACHED') {
          throw repairErr;
        }
        throw new UpstreamApiError(
          `Model failed to produce valid JSON (${repairErr instanceof Error ? repairErr.message : 'repair failed'}).`,
          502,
        );
      }

      try {
        return safeParseJson<T>(repairReply.content);
      } catch {
        throw new UpstreamApiError(
          'Model returned invalid JSON twice (initial + single repair attempt).',
          502,
        );
      }
    }
  }

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    const { provider, failoverActive, failoverReason } = resolveEffectiveProvider();
    const model = resolveModelForJob(config, provider, 'interview');
    const converseModel = resolveModelForJob(config, provider, 'converse');
    const reflectModel = resolveModelForJob(config, provider, 'reflect');
    const planModel = resolveModelForJob(config, provider, 'plan');
    const isFree =
      provider === 'openrouter' &&
      [model, converseModel, reflectModel, planModel].some((m) => m.endsWith(':free'));

    res.json({
      ok: true,
      llmConfigured: provider !== 'none',
      provider,
      llmProfile: config.llmProfile ?? 'auto',
      localLlmConfigured: Boolean(config.localLlmUrl),
      cohortModels: config.openRouterCohortModels ?? [],
      model,
      failoverActive,
      ...(failoverReason ? { failoverReason } : {}),
      models: {
        default: model,
        converse: converseModel,
        reflect: reflectModel,
        plan: planModel,
      },
      embeddingsConfigured: Boolean(config.geminiApiKey),
      embedModel: EMBED_MODEL_NAME,
      serverSavesEnabled: config.enableServerSaves,
      limits: {
        maxCallsPerDay: config.maxCallsPerDay,
        ratePerMinute: 240,
        rateBurst: 40,
        freeModelDailyCap: isFree ? 50 : null,
        freeModelPaidCreditCap: isFree ? 1000 : null,
        maxEstimatedUsdPerDay: config.maxEstimatedUsdPerDay ?? null,
      },
      usageToday: dailyBudget.snapshot(),
      spendToday: spendTracker.snapshot(),
    });
  });

  // Metrics endpoint
  app.get('/api/metrics', (_req, res) => {
    res.json({
      usageToday: dailyBudget.snapshot(),
      spendToday: spendTracker.snapshot(),
      ...metrics.snapshot(),
    });
  });

  // Per-user world state routes (x-world-id UUID required; gated behind ENABLE_SERVER_SAVES)
  function resolveWorldSaveFile(worldId: string): string {
    const resolved = path.resolve(config.worldsDir, `${worldId}.json`);
    const prefix = config.worldsDir.endsWith(path.sep)
      ? config.worldsDir
      : config.worldsDir + path.sep;
    if (!resolved.startsWith(prefix)) {
      throw new UpstreamApiError('Invalid world save path.', 400);
    }
    return resolved;
  }

  app.get('/api/world', async (req, res) => {
    const worldId = req.header('x-world-id')?.trim();
    if (!isValidUuid(worldId)) {
      res.status(400).json({ error: 'Missing or invalid x-world-id UUID header.' });
      return;
    }
    if (!config.enableServerSaves) {
      res.json({ world: null, serverSavesEnabled: false });
      return;
    }
    try {
      const filePath = resolveWorldSaveFile(worldId);
      if (!fs.existsSync(filePath)) {
        res.json({ world: null, serverSavesEnabled: true });
        return;
      }
      const raw = await fs.promises.readFile(filePath, 'utf8');
      res.json({ world: JSON.parse(raw), serverSavesEnabled: true });
    } catch (err) {
      handleApiError(res, err, 'world-load');
    }
  });

  app.post('/api/world', async (req, res) => {
    const worldId = req.header('x-world-id')?.trim();
    if (!isValidUuid(worldId)) {
      res.status(400).json({ error: 'Missing or invalid x-world-id UUID header.' });
      return;
    }
    const validationErr = validateWorldSaveBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }
    if (!config.enableServerSaves) {
      res.json({ ok: true, persisted: false, serverSavesEnabled: false });
      return;
    }
    try {
      const filePath = resolveWorldSaveFile(worldId);
      await fs.promises.mkdir(config.worldsDir, { recursive: true });
      await fs.promises.writeFile(
        filePath,
        JSON.stringify((req.body as { world: unknown }).world),
        'utf8',
      );
      res.json({ ok: true, persisted: true, serverSavesEnabled: true });
    } catch (err) {
      handleApiError(res, err, 'world-save');
    }
  });

  app.delete('/api/world', async (req, res) => {
    const worldId = req.header('x-world-id')?.trim();
    if (!isValidUuid(worldId)) {
      res.status(400).json({ error: 'Missing or invalid x-world-id UUID header.' });
      return;
    }
    if (!config.enableServerSaves) {
      res.json({ ok: true, persisted: false, serverSavesEnabled: false });
      return;
    }
    try {
      const filePath = resolveWorldSaveFile(worldId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      res.json({ ok: true, persisted: true, serverSavesEnabled: true });
    } catch (err) {
      handleApiError(res, err, 'world-delete');
    }
  });

  // 1. Sandboxed Asymmetric Two-Agent Conversation (2..MAX_TURNS + 2 parallel wrap-up calls, 120s deadline)
  app.post('/api/agent/converse', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({
        error:
          'No LLM API key configured. Add OPENROUTER_API_KEY (or GEMINI_API_KEY) in Secrets.',
      });
      return;
    }

    const validationErr = validateConverseBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 120_000);
    try {
      // True Turn-by-Turn Information-Asymmetric Multi-Party Scene (each speaker ONLY sees their own private memories/dossier + spoken turns)
      if ((req.body as { mode?: string }).mode === 'group_private') {
        const {
          participants,
          simTimeLabel,
          worldName,
          startReason,
          candidateMemes,
          locations,
          objects,
        } = req.body as {
          participants: AgentContextPayload[];
          simTimeLabel: string;
          worldName?: string;
          startReason?: string;
          candidateMemes?: Array<{ id: string; topic: string; knownByIds?: string[] }>;
          locations?: Array<{ id: string; name: string }>;
          objects?: Array<{ id: string; name: string; locationId: string }>;
        };

        const townTitle = worldName?.trim() || 'the community';
        const validLocIds = new Set((locations ?? []).map((l) => l.id));
        const validObjIds = new Set((objects ?? []).map((o) => o.id));
        const memesList = candidateMemes ?? [];
        const validMemeIds = new Set(memesList.map((m) => m.id));
        const locHint = locations?.map((l) => `${l.id} (${l.name})`).join(', ') ?? '';
        const objHint =
          objects && objects.length > 0
            ? objects.slice(0, 28).map((o) => `${o.id}@${o.locationId}`).join(', ')
            : '';

        const totalTurns = Math.min(6, Math.max(3, participants.length + 1));
        const turns: Array<{
          speakerId: string;
          speakerName: string;
          text: string;
          privateThought?: string;
        }> = [];

        for (let tIdx = 0; tIdx < totalTurns; tIdx++) {
          const speaker = participants[tIdx % participants.length];
          const others = participants.filter((p) => p.id !== speaker.id);
          const knownMemesForSpeaker = memesList.filter(
            (m) => !m.knownByIds || m.knownByIds.includes(speaker.id),
          );
          const transcriptLines =
            turns.length === 0
              ? [
                  `You are gathered with ${others.map((o) => `${o.name} (${o.occupation})`).join(', ')}.`,
                  startReason ? `Why this caught your attention: ${startReason}.` : '',
                ].filter(Boolean)
              : [
                  `Spoken dialogue so far:`,
                  ...turns.map((t) =>
                    t.speakerId === speaker.id
                      ? `- You said: "${t.text}"`
                      : `- ${t.speakerName} said: "${t.text}"`,
                  ),
                ];

          const turnPrompt = [
            `Time: ${simTimeLabel} at ${speaker.locationName} in ${townTitle}.`,
            ...buildPrivateSpeakerBlock(speaker, {
              id: others[0]?.id ?? speaker.id,
              name: others.map((o) => o.name).join(', '),
            }),
            knownMemesForSpeaker.length > 0
              ? `Town news/rumours you know privately: ${knownMemesForSpeaker.map((m) => `[${m.id}] ${m.topic}`).join('; ')}`
              : '',
            '',
            ...transcriptLines,
            '',
            `Speak strictly as ${speaker.name} (1-2 sentences). You do NOT know anyone else's private thoughts, red lines, or unshared memories.`,
          ]
            .filter(Boolean)
            .join('\n');

          const dec = getDecodingParams(speaker, { temperature: 0.74, frequencyPenalty: 0.22 });
          const turnRaw = await generateStructuredJson<unknown>(
            {
              jobKind: 'converse',
              agentId: speaker.id,
              systemInstruction: `Roleplay strictly as ${speaker.name}. Maintain strict information asymmetry: only reference facts from your own private memories, beliefs, and what has been spoken aloud.`,
              prompt: turnPrompt,
              ...dec,
              jsonContract: `{ "spokenLine": string, "privateThought": string, "endConversation": boolean }`,
              maxTokens: 900,
              geminiSchema: {
                type: Type.OBJECT,
                properties: {
                  spokenLine: { type: Type.STRING },
                  privateThought: { type: Type.STRING },
                  endConversation: { type: Type.BOOLEAN },
                },
                required: ['spokenLine', 'privateThought', 'endConversation'],
              },
            },
            ctx.signal,
            ctx.deadlineAtMs,
          );
          const turn = normalizeConverseTurnPayload(
            turnRaw,
            `Good to catch up with everyone here today.`,
          );
          turns.push({
            speakerId: speaker.id,
            speakerName: speaker.name,
            text: turn.spokenLine,
            privateThought: turn.privateThought,
          });
          if (turns.length >= participants.length && turn.endConversation) break;
        }

        const transcriptOnly = turns.map((t) => `- ${t.speakerName}: "${t.text}"`).join('\n');
        const wrapPrompt = [
          `Time: ${simTimeLabel} in ${townTitle}.`,
          `Participants: ${participants.map((p) => `${p.name} [${p.id}]`).join(', ')}`,
          startReason ? `Context: ${startReason}` : '',
          '',
          `Public Spoken Transcript:`,
          transcriptOnly,
          '',
          memesList.length > 0
            ? `Candidate meme IDs: ${memesList.map((m) => `${m.id}="${m.topic}"`).join('; ')}`
            : '',
          locHint ? `Valid locations for any sharedAgreement: ${locHint}${objHint ? `; objects: ${objHint}` : ''}` : '',
          `From the spoken transcript above, synthesize summaryByAgent, emotionalShiftByAgent, tomUpdates, optional beliefUpdatesByAgent, optional bilateralDeal, optional gossipUpdates, memeIdsDiscussed, newNews, and optional sharedAgreement.`,
        ]
          .filter(Boolean)
          .join('\n');

        const wrapRaw = await generateStructuredJson<unknown>(
          {
            jobKind: 'converse',
            agentId: participants[0]?.id,
            systemInstruction: `Summarize a multi-resident spoken conversation in ${townTitle} into structured memory/ToM updates strictly grounded in the transcript.`,
            prompt: wrapPrompt,
            temperature: 0.62,
            jsonContract: `{
  "summaryByAgent": Record<string, { "summary": string, "importance": integer (1..10), "planUpdate"?: string }>,
  "emotionalShiftByAgent": Record<string, { "deltaValence": number (-0.3..0.3), "deltaArousal": number (-0.3..0.3) }>,
  "tomUpdates": Array<{ "fromId": string, "targetId": string, "deltaTrust": integer (-10..10), "deltaAffection": integer (-10..10), "inferredGoal": string }>,
  "beliefUpdatesByAgent"?: Record<string, Array<{ "subjectId": string, "predicate": "trustworthiness"|"solvency"|"job_status"|"policy_stance"|"obligation"|"reputation"|"world_fact", "claim": string, "confidence"?: number }>>,
  "bilateralDeal"?: { "kind": "loan"|"transfer"|"petition_support"|"refusal", "proposerId": string, "responderId": string, "accepted": boolean, "amount"?: integer, "petitionId"?: string, "note": string },
  "gossipUpdates"?: Array<{ "speakerId": string, "listenerId": string, "aboutAgentId": string, "deltaTrust": integer (-12..12), "deltaAffection": integer (-12..12), "claim": string }>,
  "memeIdsDiscussed": string[],
  "newNews"?: Array<{ "topic": string, "keywords": string[] }>,
  "sharedAgreement"?: { "day": "today"|"tomorrow", "minuteOfDay": integer (360..1350), "durationMinutes": integer, "locationId": string, "objectId"?: string, "activity": string, "emoji"?: string }
}`,
            maxTokens: 1800,
            geminiSchema: undefined,
          },
          ctx.signal,
          ctx.deadlineAtMs,
        );

        const normalized = normalizeCompressedScenePayload(
          { ...(wrapRaw && typeof wrapRaw === 'object' ? wrapRaw : {}), turns },
          participants.map((p) => ({ id: p.id, name: p.name })),
          validMemeIds,
        );
        let validatedAgreement = normalized.sharedAgreement;
        if (validatedAgreement) {
          if (!validLocIds.has(validatedAgreement.locationId)) {
            validatedAgreement = undefined;
          } else if (validatedAgreement.objectId && !validObjIds.has(validatedAgreement.objectId)) {
            validatedAgreement = { ...validatedAgreement, objectId: undefined };
          }
        }
        const maxImp = Math.max(
          4,
          ...Object.values(normalized.summaryByAgent).map((s) => s.importance),
        );
        res.json({
          mode: 'scene',
          participantIds: participants.map((p) => p.id),
          turns,
          summaryByAgent: normalized.summaryByAgent,
          emotionalShiftByAgent: normalized.emotionalShiftByAgent,
          tomUpdates: normalized.tomUpdates,
          beliefUpdatesByAgent: normalized.beliefUpdatesByAgent,
          bilateralDeal: normalized.bilateralDeal,
          gossipUpdates: normalized.gossipUpdates,
          memeIdsDiscussed: normalized.memeIdsDiscussed,
          newNews: normalized.newNews,
          sharedAgreement: validatedAgreement,
          reason: startReason,
          importance: maxImp,
        });
        return;
      }

      // Fast 1-call compressed multi-party scene mode (2..4 participants in 1 LLM call for OpenRouter throughput)
      if ((req.body as { mode?: string }).mode === 'scene') {
        const {
          participants,
          simTimeLabel,
          worldName,
          startReason,
          candidateMemes,
          locations,
          objects,
        } = req.body as {
          participants: AgentContextPayload[];
          simTimeLabel: string;
          worldName?: string;
          startReason?: string;
          candidateMemes?: Array<{ id: string; topic: string; knownByIds?: string[] }>;
          locations?: Array<{ id: string; name: string }>;
          objects?: Array<{ id: string; name: string; locationId: string }>;
        };

        const townTitle = worldName?.trim() || 'the community';
        const validLocIds = new Set((locations ?? []).map((l) => l.id));
        const validObjIds = new Set((objects ?? []).map((o) => o.id));
        const memesList = candidateMemes ?? [];
        const validMemeIds = new Set(memesList.map((m) => m.id));
        const locHint = locations?.map((l) => `${l.id} (${l.name})`).join(', ') ?? '';
        const objHint =
          objects && objects.length > 0
            ? objects.slice(0, 28).map((o) => `${o.id}@${o.locationId}`).join(', ')
            : '';

        const participantBlocks = participants.map((p) => {
          const mems = (p.retrievedMemories ?? []).slice(0, 6);
          const knownMemes = memesList
            .filter((m) => !m.knownByIds || m.knownByIds.includes(p.id))
            .map((m) => `[${m.id}] ${m.topic}`);
          return [
            `### ${p.name} (id="${p.id}", ${p.age}, ${p.occupation})`,
            `Traits: ${p.traits.join(', ')}`,
            `Doing: ${p.currentAction} (${p.currently})`,
            ...formatPsychContext(p),
            knownMemes.length > 0 ? `Rumours known privately: ${knownMemes.join('; ')}` : '',
            `Private memories:`,
            ...mems.map((m) => `- (${m.type}, imp ${m.importance}) ${m.description}`),
          ]
            .filter(Boolean)
            .join('\n');
        });

        const scenePrompt = [
          `Time: ${simTimeLabel} at ${participants[0]?.locationName ?? townTitle} in ${townTitle}.`,
          startReason ? `Context for encounter: ${startReason}` : '',
          `Participants (${participants.length}): ${participants.map((p) => `${p.name} [${p.id}]`).join(', ')}`,
          '',
          ...participantBlocks,
          '',
          memesList.length > 0
            ? `Candidate meme IDs (only cite IDs genuinely discussed): ${memesList.map((m) => `${m.id}="${m.topic}"`).join('; ')}`
            : '',
          locHint ? `Valid locations for any sharedAgreement: ${locHint}${objHint ? `; objects: ${objHint}` : ''}` : '',
          '',
          `Simulate a grounded, natural ${participants.length}-person dialogue of 3 to 5 spoken turns.`,
          `Respect private knowledge: each speaker only shares facts from their own memories or replies to what was spoken aloud.`,
          `Voice & Register: Write everyday small-town spoken dialogue shaped by each person's age, trade, and mood—contractions, warmth, banter, sighs, or blunt candor. Keep tactical caution in privateThought rather than sounding like contract auditors aloud (never repeat clinical buzzwords like "single-source", "two witnesses", "locked condition", "terms extraction", or "verification protocol").`,
          `Also return per-participant summaries, emotional shifts, ToM relationship updates, up to 2 concrete "beliefUpdatesByAgent" entries per speaker if they formed/revised a factual belief (predicates: trustworthiness|solvency|job_status|policy_stance|obligation|reputation|world_fact), optional "bilateralDeal" ONLY if two participants explicitly negotiated or refused a concrete loan, cash transfer, or petition endorsement, optional third-party "gossipUpdates", and optional "sharedAgreement" if they commit to meet later.`,
        ]
          .filter(Boolean)
          .join('\n');

        const sceneDec = getDecodingParams(participants[0], {
          temperature: 0.75,
          topP: 0.92,
          frequencyPenalty: 0.25,
        });
        const sceneRaw = await generateStructuredJson<unknown>(
          {
            jobKind: 'converse',
            systemInstruction: `Simulate an authentic multi-resident conversation in ${townTitle} in a single structured JSON response. Preserve each resident's distinct everyday voice, age, occupation, private agenda, financial posture, and hard red lines. Avoid both generic sycophancy and stiff legalistic/audit jargon aloud: residents with clashing worldviews, low trust, or high stubbornness should push back in plain, idiomatic speech.`,
            prompt: scenePrompt,
            ...sceneDec,
            jsonContract: `{
  "turns": Array<{ "speakerId": string, "spokenLine": string, "privateThought": string }>,
  "summaryByAgent": Record<string, { "summary": string, "importance": integer (1..10), "planUpdate"?: string }>,
  "emotionalShiftByAgent": Record<string, { "deltaValence": number (-0.3..0.3), "deltaArousal": number (-0.3..0.3) }>,
  "tomUpdates": Array<{ "fromId": string, "targetId": string, "deltaTrust": integer (-10..10), "deltaAffection": integer (-10..10), "inferredGoal": string }>,
  "beliefUpdatesByAgent"?: Record<string, Array<{ "subjectId": string, "predicate": "trustworthiness"|"solvency"|"job_status"|"policy_stance"|"obligation"|"reputation"|"world_fact", "claim": string, "confidence"?: number (0.2..0.98) }>>,
  "bilateralDeal"?: { "kind": "loan"|"transfer"|"petition_support"|"refusal", "proposerId": string, "responderId": string, "accepted": boolean, "amount"?: integer (5..250), "petitionId"?: string, "note": string },
  "gossipUpdates"?: Array<{ "speakerId": string, "listenerId": string, "aboutAgentId": string, "deltaTrust": integer (-12..12), "deltaAffection": integer (-12..12), "claim": string }>,
  "memeIdsDiscussed": string[],
  "newNews"?: Array<{ "topic": string, "keywords": string[] }>,
  "sharedAgreement"?: { "day": "today"|"tomorrow", "minuteOfDay": integer (360..1350), "durationMinutes": integer, "locationId": string, "objectId"?: string, "activity": string, "emoji"?: string }
}`,
            maxTokens: 2500,
            // Dynamic agent-ID map keys (summaryByAgent, emotionalShiftByAgent, beliefUpdatesByAgent)
            // cannot use empty Type.OBJECT in Gemini responseSchema; rely on JSON mode + exact contract.
            geminiSchema: undefined,
          },
          ctx.signal,
          ctx.deadlineAtMs,
        );

        const normalized = normalizeCompressedScenePayload(
          sceneRaw,
          participants.map((p) => ({ id: p.id, name: p.name })),
          validMemeIds,
        );

        let validatedAgreement = normalized.sharedAgreement;
        if (validatedAgreement) {
          if (!validLocIds.has(validatedAgreement.locationId)) {
            validatedAgreement = undefined;
          } else if (
            validatedAgreement.objectId &&
            !validObjIds.has(validatedAgreement.objectId)
          ) {
            validatedAgreement = { ...validatedAgreement, objectId: undefined };
          }
        }

        const maxImp = Math.max(
          4,
          ...Object.values(normalized.summaryByAgent).map((s) => s.importance),
        );

        res.json({
          mode: 'scene',
          participantIds: participants.map((p) => p.id),
          turns: normalized.turns,
          summaryByAgent: normalized.summaryByAgent,
          emotionalShiftByAgent: normalized.emotionalShiftByAgent,
          tomUpdates: normalized.tomUpdates,
          beliefUpdatesByAgent: normalized.beliefUpdatesByAgent,
          bilateralDeal: normalized.bilateralDeal,
          gossipUpdates: normalized.gossipUpdates,
          memeIdsDiscussed: normalized.memeIdsDiscussed,
          newNews: normalized.newNews,
          sharedAgreement: validatedAgreement,
          reason: startReason,
          importance: maxImp,
        });
        return;
      }

      const {
        agentA,
        agentB,
        simTimeLabel,
        worldName,
        simMinutes,
        startReason,
        candidateMemes,
        locations,
        objects,
      } = req.body as {
        agentA: AgentContextPayload;
        agentB: AgentContextPayload;
        simTimeLabel: string;
        worldName?: string;
        simMinutes?: number;
        startReason?: string;
        candidateMemes?: Array<{ id: string; topic: string; knownByIds?: string[] }>;
        locations?: Array<{ id: string; name: string }>;
        objects?: Array<{ id: string; name: string; locationId: string }>;
      };
      const townTitle = worldName?.trim() || 'Smallville';

      const maxTurns = Math.max(2, Math.min(8, config.maxConverseTurns ?? 6));
      const refSimMin = typeof simMinutes === 'number' && Number.isFinite(simMinutes) ? simMinutes : 540;
      const locHint = locations?.map((l) => `${l.id} (${l.name})`).join(', ') ?? '';
      const objHint =
        objects && objects.length > 0
          ? objects
              .slice(0, 32)
              .map((o) => `${o.id}@${o.locationId}`)
              .join(', ')
          : '';
      const validLocIds = new Set((locations ?? []).map((l) => l.id));
      const validObjIds = new Set((objects ?? []).map((o) => o.id));
      const memesList = candidateMemes ?? [];
      const validMemeIds = new Set(memesList.map((m) => m.id));

      const toPoolNodes = (speaker: AgentContextPayload): MemoryNode[] => {
        const rawPool =
          speaker.candidateMemories && speaker.candidateMemories.length > 0
            ? speaker.candidateMemories
            : speaker.retrievedMemories ?? [];
        return rawPool.map((m) => ({
          id: m.id,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : refSimMin - 30,
          lastAccessed: typeof m.lastAccessed === 'number' ? m.lastAccessed : refSimMin - 30,
          type: (m.type === 'reflection' || m.type === 'plan' || m.type === 'consolidated'
            ? m.type
            : 'observation') as MemoryType,
          description: m.description,
          importance: m.importance,
          keywords: extractKeywords(m.description),
        }));
      };

      const poolNodesA = toPoolNodes(agentA);
      const poolNodesB = toPoolNodes(agentB);
      const accessedSetA = new Set<string>();
      const accessedSetB = new Set<string>();
      const memByIdA = new Map(poolNodesA.map((m) => [m.id, m]));
      const memByIdB = new Map(poolNodesB.map((m) => [m.id, m]));

      // Rank strictly from active speaker's own situation + partner's public name/action + last spoken line
      const rankForSpeakerTurn = (
        speaker: AgentContextPayload,
        partnerPublic: { name: string; currentAction: string },
        poolNodes: MemoryNode[],
        accessedSet: Set<string>,
        lastSpokenLine: string,
      ) => {
        const query = [
          speaker.currently,
          speaker.currentAction,
          partnerPublic.name,
          partnerPublic.currentAction,
          lastSpokenLine,
        ]
          .filter(Boolean)
          .join(' ');
        const ranked = retrieveMemories(poolNodes, query, refSimMin, 8).map((r) => ({
          id: r.node.id,
          type: r.node.type,
          description: r.node.description,
          importance: r.node.importance,
        }));
        for (const r of ranked) accessedSet.add(r.id);
        return ranked;
      };

      const turns: Array<{
        speakerId: string;
        speakerName: string;
        text: string;
        privateThought: string;
      }> = [];
      let endedBy: string | undefined;

      for (let turnIdx = 0; turnIdx < maxTurns; turnIdx++) {
        const isA = turnIdx % 2 === 0;
        const speaker = isA ? agentA : agentB;
        const partner = isA ? agentB : agentA;
        const poolNodes = isA ? poolNodesA : poolNodesB;
        const accessedSet = isA ? accessedSetA : accessedSetB;
        const lastSpokenLine = turns.length > 0 ? turns[turns.length - 1].text : '';

        const activeMemories = rankForSpeakerTurn(
          speaker,
          { name: partner.name, currentAction: partner.currentAction },
          poolNodes,
          accessedSet,
          lastSpokenLine,
        );

        const knownMemesForSpeaker = memesList.filter(
          (m) => !m.knownByIds || m.knownByIds.includes(speaker.id),
        );

        const transcriptLines =
          turns.length === 0
            ? [
                `You just encountered ${partner.name} (${partner.occupation}) who appears to be: ${partner.currentAction}.`,
                startReason ? `Why this caught your attention: ${startReason}.` : '',
              ].filter(Boolean)
            : [
                `Spoken dialogue so far:`,
                ...turns.map((t) =>
                  t.speakerId === speaker.id
                    ? `- You said: "${t.text}"`
                    : `- ${t.speakerName} said: "${t.text}"`,
                ),
              ];

        const turnPrompt = [
          `Time: ${simTimeLabel} at ${speaker.locationName} in Smallville.`,
          ...buildPrivateSpeakerBlock(speaker, { id: partner.id, name: partner.name }, activeMemories),
          knownMemesForSpeaker.length > 0
            ? `Town news/rumours you know: ${knownMemesForSpeaker.map((m) => `[${m.id}] ${m.topic}`).join('; ')}`
            : '',
          '',
          ...transcriptLines,
          '',
          turnIdx >= 1
            ? `Respond naturally as ${speaker.name} (1-2 sentences). You do NOT know ${partner.name}'s private thoughts or unshared memories. Set "endConversation": true if this feels like a natural place to say goodbye (${turns.length + 1}/${maxTurns} turns).`
            : `Start the conversation naturally as ${speaker.name} (1-2 sentences). Set "endConversation": false.`,
        ]
          .filter(Boolean)
          .join('\n');

        const spkDecoding = speaker.temperament?.decoding;
        const turnRaw = await generateStructuredJson<unknown>(
          {
            jobKind: 'converse',
            agentId: speaker.id,
            systemInstruction: `Roleplay strictly as ${speaker.name}. Maintain strict information asymmetry: only reference facts from your own memories, active beliefs, environment, and what was spoken aloud. Speak in plain, everyday small-town voice matching your age and occupation—keep calculations in privateThought and avoid repetitive legalistic or audit buzzwords ("single-source", "two witnesses", "locked condition", "verification protocol") aloud. Defend your agenda and red lines naturally when you disagree.`,
            prompt: turnPrompt,
            temperature: spkDecoding?.temperature ?? 0.72,
            topP: spkDecoding?.topP,
            frequencyPenalty: spkDecoding?.frequencyPenalty ?? 0.22,
            jsonContract: `{ "spokenLine": string, "privateThought": string, "endConversation": boolean }`,
            maxTokens: 1200,
            geminiSchema: {
              type: Type.OBJECT,
              properties: {
                spokenLine: { type: Type.STRING },
                privateThought: { type: Type.STRING },
                endConversation: { type: Type.BOOLEAN },
              },
              required: ['spokenLine', 'privateThought', 'endConversation'],
            },
          },
          ctx.signal,
          ctx.deadlineAtMs,
        );

        const turn = normalizeConverseTurnPayload(
          turnRaw,
          turnIdx === 0
            ? `Good to see you, ${partner.name.split(' ')[0]}.`
            : `Always glad to catch up, ${partner.name.split(' ')[0]}.`,
        );

        turns.push({
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: turn.spokenLine,
          privateThought: turn.privateThought,
        });

        if (turns.length >= 2 && turn.endConversation) {
          endedBy = speaker.id;
          break;
        }
      }

      const transcriptBlock = turns
        .map((t) => `- ${t.speakerName}: "${t.text}"`)
        .join('\n');

      const accessedMemListA = Array.from(accessedSetA)
        .map((id) => memByIdA.get(id))
        .filter((m): m is MemoryNode => Boolean(m));
      const accessedMemListB = Array.from(accessedSetB)
        .map((id) => memByIdB.get(id))
        .filter((m): m is MemoryNode => Boolean(m));

      const memeListHint =
        memesList.length > 0
          ? memesList.map((m) => `id="${m.id}" topic="${m.topic}"`).join('; ')
          : 'none';

      const buildWrapupPrompt = (
        speaker: AgentContextPayload,
        partner: AgentContextPayload,
        usedMemories: MemoryNode[],
        includeSharedAgreement: boolean,
      ) =>
        [
          `Time: ${simTimeLabel} at ${speaker.locationName} in Smallville.`,
          ...buildPrivateSpeakerBlock(speaker, { id: partner.id, name: partner.name }, usedMemories),
          '',
          `Full spoken dialogue with ${partner.name}:`,
          transcriptBlock,
          '',
          `Known candidate rumour IDs (only cite IDs from this list that were actually discussed): ${memeListHint}.`,
          `From strictly ${speaker.name}'s own private perspective after hearing the full dialogue:`,
          `- Write a one-sentence third-person memory "summary" and personal poignancy "importance" (1..10).`,
          `- Provide "emotionalShift" (-0.3..+0.3) and "tomUpdate" about ${partner.name}.`,
          `- Optional "planUpdate" if your intention changed.`,
          `- Optional "beliefUpdates": up to 2 concrete beliefs formed or revised from what was spoken aloud ({ "subjectId": "${partner.id}" | "${speaker.id}" | "town", "predicate": "trustworthiness"|"solvency"|"job_status"|"policy_stance"|"obligation"|"reputation"|"world_fact", "claim": string, "confidence": number (0.2..0.98) }).`,
          `- "memeIdsDiscussed": array of IDs from the list above you shared or learned in dialogue.`,
          `- "newNews": array of genuinely new concrete town announcements/discoveries introduced ({ "topic": string, "keywords": string[] }).`,
          includeSharedAgreement
            ? `- Optional "sharedAgreement" ONLY if BOTH speakers explicitly agreed to meet/do something together later: { "day": "today"|"tomorrow", "minuteOfDay": integer (360..1350), "durationMinutes": integer, "locationId": string, "objectId"?: string, "activity": string, "emoji"?: string }. Valid locationIds: ${locHint}${objHint ? `; objects: ${objHint}` : ''}.`
            : '',
          includeSharedAgreement
            ? `- Optional "bilateralDeal" ONLY if speakers explicitly agreed to OR explicitly refused a concrete loan, cash transfer, or petition endorsement during the dialogue: { "kind": "loan"|"transfer"|"petition_support"|"refusal", "proposerId": "${agentA.id}"|"${agentB.id}", "responderId": "${agentA.id}"|"${agentB.id}", "accepted": boolean, "amount"?: integer (5..250), "petitionId"?: string, "note": string }.`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

      const wrapupContractBase = `{
  "summary": string,
  "importance": integer (1..10),
  "planUpdate"?: string,
  "emotionalShift": { "deltaValence": number (-0.3..0.3), "deltaArousal": number (-0.3..0.3) },
  "tomUpdate": { "deltaTrust": integer (-10..10), "deltaAffection": integer (-10..10), "inferredGoal": string },
  "beliefUpdates"?: Array<{ "subjectId": string, "predicate": "trustworthiness"|"solvency"|"job_status"|"policy_stance"|"obligation"|"reputation"|"world_fact", "claim": string, "confidence"?: number }>,
  "memeIdsDiscussed": string[],
  "newNews": Array<{ "topic": string, "keywords": string[] }>`;

      const wrapupSchemaBase = {
        summary: { type: Type.STRING },
        importance: { type: Type.INTEGER },
        planUpdate: { type: Type.STRING },
        emotionalShift: {
          type: Type.OBJECT,
          properties: {
            deltaValence: { type: Type.NUMBER },
            deltaArousal: { type: Type.NUMBER },
          },
          required: ['deltaValence', 'deltaArousal'],
        },
        tomUpdate: {
          type: Type.OBJECT,
          properties: {
            deltaTrust: { type: Type.INTEGER },
            deltaAffection: { type: Type.INTEGER },
            inferredGoal: { type: Type.STRING },
          },
          required: ['deltaTrust', 'deltaAffection', 'inferredGoal'],
        },
        beliefUpdates: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              subjectId: { type: Type.STRING },
              predicate: { type: Type.STRING },
              claim: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
            required: ['subjectId', 'predicate', 'claim'],
          },
        },
        memeIdsDiscussed: { type: Type.ARRAY, items: { type: Type.STRING } },
        newNews: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['topic', 'keywords'],
          },
        },
      };

      const pairAgentIds = new Set([agentA.id, agentB.id]);
      const [rawWrapA, rawWrapB] = await Promise.all([
        generateStructuredJson<unknown>(
          {
            jobKind: 'converse',
            agentId: agentA.id,
            systemInstruction: `Summarize and update private memory/emotions/beliefs strictly as ${agentA.name}. Only cite meme IDs you actually know or heard in the spoken transcript.`,
            prompt: buildWrapupPrompt(agentA, agentB, accessedMemListA, true),
            ...getDecodingParams(agentA, { temperature: 0.62 }),
            jsonContract: `${wrapupContractBase},\n  "sharedAgreement"?: { "day": "today"|"tomorrow", "minuteOfDay": integer (360..1350), "durationMinutes": integer, "locationId": string, "objectId"?: string, "activity": string, "emoji"?: string },\n  "bilateralDeal"?: { "kind": "loan"|"transfer"|"petition_support"|"refusal", "proposerId": string, "responderId": string, "accepted": boolean, "amount"?: integer (5..250), "petitionId"?: string, "note": string }\n}`,
            maxTokens: 1700,
            geminiSchema: {
              type: Type.OBJECT,
              properties: {
                ...wrapupSchemaBase,
                sharedAgreement: {
                  type: Type.OBJECT,
                  properties: {
                    day: { type: Type.STRING },
                    minuteOfDay: { type: Type.INTEGER },
                    durationMinutes: { type: Type.INTEGER },
                    locationId: { type: Type.STRING },
                    objectId: { type: Type.STRING },
                    activity: { type: Type.STRING },
                    emoji: { type: Type.STRING },
                  },
                  required: ['day', 'minuteOfDay', 'locationId', 'activity'],
                },
                bilateralDeal: {
                  type: Type.OBJECT,
                  properties: {
                    kind: { type: Type.STRING },
                    proposerId: { type: Type.STRING },
                    responderId: { type: Type.STRING },
                    accepted: { type: Type.BOOLEAN },
                    amount: { type: Type.INTEGER },
                    petitionId: { type: Type.STRING },
                    note: { type: Type.STRING },
                  },
                  required: ['kind', 'proposerId', 'responderId', 'accepted', 'note'],
                },
              },
              required: ['summary', 'importance', 'emotionalShift', 'tomUpdate'],
            },
          },
          ctx.signal,
          ctx.deadlineAtMs,
        ),
        generateStructuredJson<unknown>(
          {
            jobKind: 'converse',
            agentId: agentB.id,
            systemInstruction: `Summarize and update private memory/emotions/beliefs strictly as ${agentB.name}. Only cite meme IDs you actually know or heard in the spoken transcript.`,
            prompt: buildWrapupPrompt(agentB, agentA, accessedMemListB, false),
            ...getDecodingParams(agentB, { temperature: 0.62 }),
            jsonContract: `${wrapupContractBase}\n}`,
            maxTokens: 1600,
            geminiSchema: {
              type: Type.OBJECT,
              properties: wrapupSchemaBase,
              required: ['summary', 'importance', 'emotionalShift', 'tomUpdate'],
            },
          },
          ctx.signal,
          ctx.deadlineAtMs,
        ),
      ]);

      const wrapA = normalizeConverseWrapupPayload(
        rawWrapA,
        `${agentA.name} spoke with ${agentB.name} about life in ${townTitle}.`,
        validMemeIds,
        pairAgentIds,
      );
      const wrapB = normalizeConverseWrapupPayload(
        rawWrapB,
        `${agentB.name} chatted with ${agentA.name} at ${agentB.locationName}.`,
        validMemeIds,
        pairAgentIds,
      );
      const gossipUpdatesA = normalizeGossipUpdates(
        rawWrapA && typeof rawWrapA === 'object'
          ? (rawWrapA as { gossipUpdates?: unknown }).gossipUpdates
          : undefined,
        undefined,
        agentA.id,
        agentB.id,
      );
      const gossipUpdatesB = normalizeGossipUpdates(
        rawWrapB && typeof rawWrapB === 'object'
          ? (rawWrapB as { gossipUpdates?: unknown }).gossipUpdates
          : undefined,
        undefined,
        agentB.id,
        agentA.id,
      );

      let validatedSharedAgreement = wrapA.sharedAgreement;
      if (validatedSharedAgreement) {
        if (!validLocIds.has(validatedSharedAgreement.locationId)) {
          validatedSharedAgreement = undefined;
        } else if (
          validatedSharedAgreement.objectId &&
          !validObjIds.has(validatedSharedAgreement.objectId)
        ) {
          validatedSharedAgreement = {
            ...validatedSharedAgreement,
            objectId: undefined,
          };
        }
      }

      res.json({
        turns,
        summaryA: wrapA.summary,
        summaryB: wrapB.summary,
        importanceA: wrapA.importance,
        importanceB: wrapB.importance,
        importance: Math.max(wrapA.importance, wrapB.importance),
        reason: startReason,
        endedBy,
        planUpdateA: wrapA.planUpdate,
        planUpdateB: wrapB.planUpdate,
        sharedAgreement: validatedSharedAgreement,
        memeIdsDiscussedA: wrapA.memeIdsDiscussed,
        memeIdsDiscussedB: wrapB.memeIdsDiscussed,
        newNewsA: wrapA.newNews,
        newNewsB: wrapB.newNews,
        gossipUpdatesA,
        gossipUpdatesB,
        accessedMemoryIdsA: Array.from(accessedSetA),
        accessedMemoryIdsB: Array.from(accessedSetB),
        emotionalShiftA: wrapA.emotionalShift,
        emotionalShiftB: wrapB.emotionalShift,
        tomUpdateA: wrapA.tomUpdate,
        tomUpdateB: wrapB.tomUpdate,
        beliefUpdatesA: wrapA.beliefUpdates,
        beliefUpdatesB: wrapB.beliefUpdates,
        bilateralDeal: wrapA.bilateralDeal,
      });
    } catch (err) {
      handleApiError(res, err, 'converse');
    } finally {
      ctx.cleanup();
    }
  });

  // 1b. Autonomous BDI Strategic Decision Fork (1 call per resident fork)
  app.post('/api/agent/decide', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateDecideBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const {
        agent,
        simTimeLabel,
        worldName,
        forkReason,
        locations,
        openProposals,
        recentNotices,
        openPetitions,
        election,
        knownPeers,
        ambitions,
        commitments,
        unreadLetters,
        openDisputes,
        coalitions,
        activeBoycotts,
        activeShocks,
        activeRumors,
        culturalNorms,
        organizations,
        emergentNorms,
        customAssets,
      } = req.body as {
        agent: AgentContextPayload;
        simTimeLabel: string;
        worldName?: string;
        forkReason?: string;
        locations: Array<{ id: string; name: string }>;
        openProposals?: Array<{ id: string; title: string; description?: string; cost?: number }>;
        recentNotices?: Array<{ title: string; category?: string }>;
        openPetitions?: Array<{ id: string; title: string; signatures?: number; requiredSignatures?: number }>;
        election?: {
          status: string;
          electionDay?: number;
          hasVoted?: boolean;
          candidates?: Array<{ agentId: string; name: string; platform?: string }>;
        };
        knownPeers?: Array<{ id: string; name: string; trust?: number; walletBand?: string }>;
        ambitions?: Array<{ title: string; domain?: string; progress?: number }>;
        commitments?: Array<{ title: string; locationId: string; dueDay?: number; dueMinute?: number }>;
        unreadLetters?: Array<{ fromAgentId: string; fromName: string; subject: string; body: string }>;
        openDisputes?: Array<{ id: string; category: string; claimSummary: string; claimedAmount?: number }>;
        coalitions?: Array<{ id: string; name: string; agenda: string; memberCount?: number }>;
        activeBoycotts?: Array<{ id: string; targetLocationId?: string; targetBusinessName: string; reason: string }>;
        activeShocks?: Array<{ kind?: string; title: string; description: string }>;
        activeRumors?: Array<{ id: string; claim: string; originName?: string; hopCount?: number }>;
        culturalNorms?: Array<{ key: string; title: string; strength?: number }>;
        organizations?: Array<{ id: string; name: string; charter?: string; treasury?: number; memberCount?: number }>;
        emergentNorms?: Array<{ id: string; statement: string; strength?: number }>;
        customAssets?: Array<{ id: string; name: string; unitValue?: number; ownerId?: string }>;
      };

      const townTitle = worldName?.trim() || 'the community';
      const validLocIds = new Set(locations.map((l) => l.id));

      const prompt = [
        `Time: ${simTimeLabel} in ${townTitle} (currently at ${agent.locationName}).`,
        `Resident: ${agent.name} (${agent.age}, ${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        `Current plan: ${agent.currently} (${agent.currentAction})`,
        ...formatPsychContext(agent),
        forkReason ? `Decision Fork Trigger: ${forkReason}` : '',
        election
          ? `Mayoral Election Status: ${election.status}${election.electionDay ? ` (Election Day ${election.electionDay})` : ''}${election.hasVoted ? ' [you already voted]' : ' [you have NOT voted yet]'}${
              election.candidates && election.candidates.length > 0
                ? `\nCandidates:\n${election.candidates
                    .map((c) => `- [${c.agentId}] ${c.name}: "${c.platform ?? 'Town leadership'}"`)
                    .join('\n')}`
                : ''
            }`
          : '',
        openProposals && openProposals.length > 0
          ? `Open Civic Proposals to consider voting on:\n${openProposals
              .map((p) => `- [${p.id}] ${p.title}${p.cost ? ` ($${p.cost})` : ''}${p.description ? `: ${p.description}` : ''}`)
              .join('\n')}`
          : '',
        openPetitions && openPetitions.length > 0
          ? `Grassroots Petitions gathering signatures:\n${openPetitions
              .map((p) => `- [${p.id}] ${p.title} (${p.signatures ?? 0}/${p.requiredSignatures ?? 4} signatures)`)
              .join('\n')}`
          : '',
        knownPeers && knownPeers.length > 0
          ? `Known Neighbors (id, trust, finances): ${knownPeers
              .map((p) => `${p.id} (${p.name}, trust=${p.trust ?? 45}, finances=${p.walletBand ?? 'steady'})`)
              .join('; ')}`
          : '',
        recentNotices && recentNotices.length > 0
          ? `Recent Town Notices: ${recentNotices.map((n) => n.title).join('; ')}`
          : '',
        ambitions && ambitions.length > 0
          ? `Long-Term Ambitions: ${ambitions.map((a) => `${a.title} (${a.progress ?? 0}%)`).join('; ')}`
          : '',
        commitments && commitments.length > 0
          ? `Pending Commitments: ${commitments.map((c) => `${c.title} @ ${c.locationId}`).join('; ')}`
          : '',
        unreadLetters && unreadLetters.length > 0
          ? `Private Letters Received:\n${unreadLetters.map((l) => `- From ${l.fromName} [${l.fromAgentId}] "${l.subject}": "${l.body}"`).join('\n')}`
          : '',
        openDisputes && openDisputes.length > 0
          ? `Open Town Hall Disputes:\n${openDisputes.map((d) => `- [${d.id}] ${d.category}: ${d.claimSummary}`).join('\n')}`
          : '',
        coalitions && coalitions.length > 0
          ? `Active Civic Coalitions:\n${coalitions.map((c) => `- [${c.id}] ${c.name} (${c.agenda}, ${c.memberCount ?? 1} members)`).join('\n')}`
          : '',
        activeBoycotts && activeBoycotts.length > 0
          ? `Active Consumer Boycotts:\n${activeBoycotts.map((b) => `- ${b.targetBusinessName}: ${b.reason}`).join('\n')}`
          : '',
        activeShocks && activeShocks.length > 0
          ? `Active Town Shocks / Conditions:\n${activeShocks.map((s) => `- ${s.title}: ${s.description}`).join('\n')}`
          : '',
        activeRumors && activeRumors.length > 0
          ? `Rumors You Have Heard (unverified hearsay):\n${activeRumors.map((r) => `- [${r.id}] "${r.claim}" (origin: ${r.originName ?? 'unknown'}, hops: ${r.hopCount ?? 0})`).join('\n')}`
          : '',
        culturalNorms && culturalNorms.length > 0
          ? `Prevailing Town Norms:\n${culturalNorms.map((n) => `- ${n.title} [${n.key}] (strength ${n.strength ?? 60}/100)`).join('\n')}`
          : '',
        organizations && organizations.length > 0
          ? `Resident-Created Organizations:\n${organizations.map((o) => `- [${o.id}] ${o.name} ($${o.treasury ?? 0} pool, ${o.memberCount ?? 1} members)${o.charter ? `: ${o.charter}` : ''}`).join('\n')}`
          : '',
        emergentNorms && emergentNorms.length > 0
          ? `Emergent Free-Text Community Norms:\n${emergentNorms.map((n) => `- [${n.id}] "${n.statement}" (strength ${n.strength ?? 55}/100)`).join('\n')}`
          : '',
        customAssets && customAssets.length > 0
          ? `Available Custom Resident Assets:\n${customAssets.map((a) => `- [${a.id}] ${a.name} ($${a.unitValue ?? 5})`).join('\n')}`
          : '',
        `Relevant Private Memories:`,
        ...(agent.retrievedMemories ?? []).map(
          (m) => `- (${m.type}, imp=${m.importance}) ${m.description}`,
        ),
        `Valid Location IDs: ${locations.map((l) => `${l.id} (${l.name})`).join(', ')}`,
        '',
        `Choose ONE grounded autonomous action for ${agent.name} right now (pick the specific economic, civic, health, or social verb that fits the fork rather than defaulting to "advance_project"):`,
        `- "work_shift": pick up a paid work shift (especially if savings are low).`,
        `- "advance_project": invest focused effort into your active multi-day project.`,
        `- "vote_proposal": vote on an open civic proposal (specify proposalId & voteSupport: true/false — evaluate critically against your civicWorldview, financialPosture, and the proposal cost; vote false if it conflicts with your priorities).`,
        `- "vote_election": cast your ballot in the open Mayoral Election (specify candidateId from Candidates list above).`,
        `- "declare_candidacy": enter the upcoming Mayoral race with your own platform (specify platform).`,
        `- "sign_petition": sign a grassroots petition that aligns with your civic worldview (specify petitionId).`,
        `- "start_petition": launch a new grassroots citizen petition (specify petitionTitle, petitionDescription, petitionEffect: "streetLighting"|"marketStipend"|"extendedLibrary"|"communityClinic").`,
        `- "propose_loan": request a short-term peer loan from a flush trusted neighbor (specify targetAgentId & loanAmount 20..200).`,
        `- "transfer_money": directly send cash to support or pay a neighbor (specify targetAgentId & transferAmount 5..250).`,
        `- "launch_venture": invest startup capital to open a pop-up micro-venture stall if well-funded (specify ventureName, locationId, itemKind).`,
        `- "post_notice": post a meaningful community notice to the public board (specify noticeTitle, noticeBody, noticeCategory).`,
        `- "buy_item": buy an everyday item ("coffee"|"pastry"|"bread"|"meal"|"groceries"|"produce"|"medicine"|"craft_goods"|"book"|"flowers"|"drink") — e.g. medicine at smallville_clinic when unwell.`,
        `- "consume_item": eat or use an item you already own at home.`,
        `- "socialize": head out to connect with neighbors or attend a scheduled club meeting (specify locationId & optional targetAgentId).`,
        `- "seek_person": actively track down and visit a specific resident across town to speak face-to-face (specify targetAgentId).`,
        `- "avoid_person": step away from and steer clear of a rival or strained neighbor (specify targetAgentId).`,
        `- "send_letter": send a private asynchronous letter to a specific neighbor (specify targetAgentId, letterSubject, letterBody).`,
        `- "propose_contract": sign a formal bilateral service agreement with escrow (specify targetAgentId, contractKind: "supply_delivery"|"labor_pact"|"patronage"|"political_pact", contractTerms, contractAmount 15..180).`,
        `- "file_dispute": file a formal dispute at Town Hall for arbitration against someone who defaulted/breached/wronged you (specify targetAgentId, disputeCategory: "loan_default"|"contract_breach"|"unfair_layoff"|"reputation_harm", disputeClaim, disputeAmount).`,
        `- "form_coalition": launch a new civic or economic coalition (specify coalitionName, coalitionAgenda: "fiscal_restraint"|"public_welfare"|"merchant_guild"|"labor_rights"|"civic_reform").`,
        `- "join_coalition": join an existing active civic coalition from the list above (specify coalitionId).`,
        `- "call_boycott": organize or join a consumer boycott against a business over unfair practices or high prices (specify boycottLocationId, boycottReason).`,
        `- "spread_rumor": share an unverified or strategic claim about a resident/business around town (specify targetAgentId, rumorClaim, optional isDeceptive: true/false, or rumorId to pass on an existing rumor).`,
        `- "fact_check": investigate Town Hall / library records to verify or debunk an active rumor (specify rumorId).`,
        `- "endorse_norm": publicly affirm a town cultural standard at Town Hall (specify normKey: "debt_honor"|"fair_pricing"|"mutual_aid"|"civic_duty"|"truthfulness").`,
        `- "open_action": propose an open-ended civic, economic, cultural, or institutional initiative not limited to preset verbs (e.g. founding a mutual-aid fund, credit circle, newspaper, custom voucher, or new social norm; specify openIntent).`,
        `- "rest": take a restorative break at home.`,
        `- "adjust_goal": revise or add a concrete personal goal/ambition (specify newGoal or ambitionTitle).`,
      ]
        .filter(Boolean)
        .join('\n');

      const decDecoding = getDecodingParams(agent, {
        temperature: 0.68,
        frequencyPenalty: 0.2,
      });
      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'decide',
          agentId: agent.id,
          preferStrong: true,
          systemInstruction: `Make a grounded Belief-Desire-Intention (BDI) life decision for ${agent.name} in ${townTitle}, respecting their budget, drives, biographical dossier, private agenda, red lines, and civic worldview. Never rubber-stamp civic proposals when your worldview or budget leans against them.`,
          prompt,
          ...decDecoding,
          jsonContract: `{
  "action": "work_shift" | "buy_item" | "consume_item" | "advance_project" | "post_notice" | "vote_proposal" | "vote_election" | "declare_candidacy" | "sign_petition" | "start_petition" | "propose_loan" | "transfer_money" | "launch_venture" | "socialize" | "seek_person" | "avoid_person" | "send_letter" | "propose_contract" | "file_dispute" | "form_coalition" | "join_coalition" | "call_boycott" | "spread_rumor" | "fact_check" | "endorse_norm" | "open_action" | "rest" | "adjust_goal",
  "reason": string,
  "locationId"?: string,
  "activity"?: string,
  "emoji"?: string,
  "durationMinutes"?: integer (30..120),
  "itemKind"?: "coffee" | "pastry" | "bread" | "meal" | "groceries" | "produce" | "medicine" | "craft_goods" | "book" | "flowers" | "drink",
  "targetAgentId"?: string,
  "proposalId"?: string,
  "voteSupport"?: boolean,
  "candidateId"?: string,
  "platform"?: string,
  "petitionId"?: string,
  "petitionTitle"?: string,
  "petitionDescription"?: string,
  "petitionEffect"?: "streetLighting" | "marketStipend" | "extendedLibrary" | "communityClinic",
  "loanAmount"?: integer (20..200),
  "transferAmount"?: integer (5..250),
  "ventureName"?: string,
  "noticeTitle"?: string,
  "noticeBody"?: string,
  "noticeCategory"?: "news" | "market" | "civic" | "event" | "job",
  "letterSubject"?: string,
  "letterBody"?: string,
  "ambitionTitle"?: string,
  "contractKind"?: "supply_delivery" | "labor_pact" | "patronage" | "political_pact",
  "contractTerms"?: string,
  "contractAmount"?: integer (15..180),
  "disputeCategory"?: "loan_default" | "contract_breach" | "unfair_layoff" | "reputation_harm",
  "disputeClaim"?: string,
  "disputeAmount"?: integer (0..250),
  "coalitionId"?: string,
  "coalitionName"?: string,
  "coalitionAgenda"?: "fiscal_restraint" | "public_welfare" | "merchant_guild" | "labor_rights" | "civic_reform",
  "boycottLocationId"?: string,
  "boycottReason"?: string,
  "rumorId"?: string,
  "rumorClaim"?: string,
  "isDeceptive"?: boolean,
  "normKey"?: "debt_honor" | "fair_pricing" | "mutual_aid" | "civic_duty" | "truthfulness",
  "openIntent"?: string,
  "newGoal"?: string
}`,
          maxTokens: 950,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING },
              reason: { type: Type.STRING },
              locationId: { type: Type.STRING },
              activity: { type: Type.STRING },
              emoji: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              itemKind: { type: Type.STRING },
              targetAgentId: { type: Type.STRING },
              proposalId: { type: Type.STRING },
              voteSupport: { type: Type.BOOLEAN },
              candidateId: { type: Type.STRING },
              platform: { type: Type.STRING },
              petitionId: { type: Type.STRING },
              petitionTitle: { type: Type.STRING },
              petitionDescription: { type: Type.STRING },
              petitionEffect: { type: Type.STRING },
              loanAmount: { type: Type.INTEGER },
              transferAmount: { type: Type.INTEGER },
              ventureName: { type: Type.STRING },
              noticeTitle: { type: Type.STRING },
              noticeBody: { type: Type.STRING },
              noticeCategory: { type: Type.STRING },
              letterSubject: { type: Type.STRING },
              letterBody: { type: Type.STRING },
              ambitionTitle: { type: Type.STRING },
              contractKind: { type: Type.STRING },
              contractTerms: { type: Type.STRING },
              contractAmount: { type: Type.INTEGER },
              disputeCategory: { type: Type.STRING },
              disputeClaim: { type: Type.STRING },
              disputeAmount: { type: Type.INTEGER },
              coalitionId: { type: Type.STRING },
              coalitionName: { type: Type.STRING },
              coalitionAgenda: { type: Type.STRING },
              boycottLocationId: { type: Type.STRING },
              boycottReason: { type: Type.STRING },
              rumorId: { type: Type.STRING },
              rumorClaim: { type: Type.STRING },
              isDeceptive: { type: Type.BOOLEAN },
              normKey: { type: Type.STRING },
              openIntent: { type: Type.STRING },
              newGoal: { type: Type.STRING },
            },
            required: ['action', 'reason'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      const norm = normalizeBdiDecisionPayload(raw, validLocIds);
      res.json(norm);
    } catch (err) {
      handleApiError(res, err, 'decide');
    } finally {
      ctx.cleanup();
    }
  });

  // 1e. Open Genesis Trial: Constrained Conservation Arbiter translating openIntent into atomic conserved ops
  app.post('/api/world/arbitrate', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }
    const validationErr = validateArbitrateBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const {
        agent,
        openIntent,
        simTimeLabel,
        locations,
        validAgentIds,
        organizations,
        emergentNorms,
      } = req.body as {
        agent: AgentContextPayload;
        openIntent: string;
        simTimeLabel: string;
        locations: Array<{ id: string; name: string }>;
        validAgentIds?: string[];
        organizations?: Array<{ id: string; name: string; treasury?: number }>;
        emergentNorms?: Array<{ id: string; statement: string }>;
      };

      const validLocIds = new Set(locations.map((l) => l.id));
      const validAgIds = validAgentIds && validAgentIds.length > 0 ? new Set(validAgentIds) : undefined;
      const prompt = [
        `Time: ${simTimeLabel}`,
        `Actor: ${agent.name} [${agent.id}] (${agent.occupation}) at ${agent.locationName}`,
        `Actor wallet & constraints: respect strict conservation of money and physical presence.`,
        `Proposed Open Initiative: "${openIntent}"`,
        organizations && organizations.length > 0
          ? `Active Organizations: ${organizations.map((o) => `${o.id}="${o.name}" ($${o.treasury ?? 0})`).join('; ')}`
          : '',
        emergentNorms && emergentNorms.length > 0
          ? `Active Emergent Norms: ${emergentNorms.map((n) => `${n.id}="${n.statement}"`).join('; ')}`
          : '',
        `Valid Location IDs: ${locations.map((l) => l.id).join(', ')}`,
        '',
        `Translate this initiative into 1..3 strictly conserved atomic operations from:`,
        `- create_org { op:"create_org", name, charter, roleTitle?, initialContribution? (0..150), duesAmount? (0..40), headquartersLocationId?, rule? }`,
        `- join_org { op:"join_org", orgId, roleTitle?, contribution? (0..150) }`,
        `- org_contribute { op:"org_contribute", orgId, amount (1..150), note? }`,
        `- org_payout { op:"org_payout", orgId, toAgentId, amount (1..250), reason }`,
        `- transfer_cash { op:"transfer_cash", fromId:"${agent.id}", toId, amount (1..250), note }`,
        `- propose_norm { op:"propose_norm", statement }`,
        `- adopt_or_challenge_norm { op:"adopt_or_challenge_norm", normId, adopt: boolean }`,
        `- sanction_norm { op:"sanction_norm", normId, targetAgentId, reason }`,
        `- create_asset { op:"create_asset", name, description, unitValue (1..100), quantity? (1..20), organizationId? }`,
        `- trade_asset { op:"trade_asset", assetId, buyerId, price (1..200) }`,
        `- publish_record { op:"publish_record", title, body, locationId? }`,
        `- shift_relation { op:"shift_relation", targetAgentId, deltaTrust (-16..16), deltaAffection (-16..16), reason }`,
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'decide',
          agentId: agent.id,
          preferStrong: true,
          systemInstruction: `You are the Bostromia Conservation Arbiter. Compile a resident's open-ended social or economic initiative into legal, conserved atomic kernel operations. Never conjure cash or reference unknown entities.`,
          prompt,
          jsonContract: `{ "narrative": string, "ops": Array<{ "op": string, ... }> }`,
          maxTokens: 700,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              narrative: { type: Type.STRING },
              ops: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    op: { type: Type.STRING },
                    name: { type: Type.STRING },
                    charter: { type: Type.STRING },
                    statement: { type: Type.STRING },
                    title: { type: Type.STRING },
                    body: { type: Type.STRING },
                    description: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    note: { type: Type.STRING },
                    fromId: { type: Type.STRING },
                    toId: { type: Type.STRING },
                    toAgentId: { type: Type.STRING },
                    targetAgentId: { type: Type.STRING },
                    orgId: { type: Type.STRING },
                    normId: { type: Type.STRING },
                    assetId: { type: Type.STRING },
                    buyerId: { type: Type.STRING },
                    headquartersLocationId: { type: Type.STRING },
                    locationId: { type: Type.STRING },
                    roleTitle: { type: Type.STRING },
                    amount: { type: Type.INTEGER },
                    initialContribution: { type: Type.INTEGER },
                    duesAmount: { type: Type.INTEGER },
                    contribution: { type: Type.INTEGER },
                    unitValue: { type: Type.INTEGER },
                    quantity: { type: Type.INTEGER },
                    price: { type: Type.INTEGER },
                    deltaTrust: { type: Type.INTEGER },
                    deltaAffection: { type: Type.INTEGER },
                    adopt: { type: Type.BOOLEAN },
                  },
                  required: ['op'],
                },
              },
            },
            required: ['narrative', 'ops'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const narrative =
        typeof obj.narrative === 'string' && obj.narrative.trim()
          ? obj.narrative.trim().slice(0, 220)
          : openIntent.slice(0, 200);
      const ops = normalizeOpenActionOps(obj.ops, validAgIds, validLocIds);
      res.json({ narrative, ops });
    } catch (err) {
      handleApiError(res, err, 'arbitrate');
    } finally {
      ctx.cleanup();
    }
  });

  // 2a. Reflection Call 1: Generate 3 Focal Questions from up to 100 recent memories
  app.post('/api/agent/reflect/questions', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateReflectQuestionsBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, simTimeLabel, recentMemories } = req.body as {
        agent: AgentContextPayload;
        simTimeLabel: string;
        recentMemories: Array<{ id: string; type: string; description: string; importance: number }>;
      };

      const memoryListText = recentMemories
        .map((m, idx) => `${idx + 1}. (${m.type}, imp=${m.importance}) ${m.description}`)
        .join('\n');

      const prompt = [
        `Time: ${simTimeLabel}`,
        `Agent: ${agent.name} (${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        ...formatPsychContext(agent),
        `Recent Memory Stream (${recentMemories.length} entries):`,
        memoryListText,
        '',
        `Given only the information above, what are the 3 most salient high-level questions we can answer about the subjects and relationships in ${agent.name}'s recent experiences?`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'reflect',
          agentId: agent.id,
          systemInstruction:
            'Identify the 3 highest-salience reflective questions implied by the resident memory stream.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.65 }),
          jsonContract: `{ "focalQuestions": string[] }`,
          maxTokens: 900,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              focalQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['focalQuestions'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeReflectionQuestionsPayload(raw, agent.name));
    } catch (err) {
      handleApiError(res, err, 'reflect-questions');
    } finally {
      ctx.cleanup();
    }
  });

  // 2b. Reflection Call 2 (with strict cited evidence validation) or backwards-compatible fallback
  app.post('/api/agent/reflect', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateReflectBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, simTimeLabel, questionEvidenceSets, recentMemories } = req.body as {
        agent: AgentContextPayload;
        simTimeLabel: string;
        questionEvidenceSets?: Array<{
          question: string;
          memories: Array<{ id: string; type: string; description: string; importance: number }>;
        }>;
        recentMemories?: Array<{ id: string; type: string; description: string; importance: number }>;
      };

      const validIds = new Set<string>();
      const promptSections: string[] = [
        `Time: ${simTimeLabel}`,
        `Agent: ${agent.name} (${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        ...formatPsychContext(agent),
      ];

      if (questionEvidenceSets && questionEvidenceSets.length > 0) {
        promptSections.push('', `Focal Questions & Retrieved Evidence (cite ONLY the listed [id=...]):`);
        for (const set of questionEvidenceSets) {
          promptSections.push(`Question: ${set.question}`);
          for (const m of set.memories) {
            validIds.add(m.id);
            promptSections.push(`  - [id=${m.id}] (${m.type}, imp=${m.importance}) ${m.description}`);
          }
        }
        promptSections.push(
          '',
          `Synthesize up to 5 concise high-level insights (including insights referencing prior reflections if present in evidence). Every insight MUST cite at least 1 exact id in "evidenceIds" strictly from the IDs listed above.`,
        );
      } else {
        const list = recentMemories ?? [];
        for (const m of list) validIds.add(m.id);
        promptSections.push(
          `Recent Memory Stream:`,
          ...list.map((m, idx) => `${idx + 1}. [id=${m.id}] (${m.type}, imp=${m.importance}) ${m.description}`),
          '',
          `Identify 3 focal questions and up to 5 reflective insights citing ONLY exact IDs from [id=...].`,
        );
      }

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'reflect',
          agentId: agent.id,
          preferStrong: true,
          systemInstruction:
            'Perform Park et al. (2023) higher-level cognitive reflection for a Smallville resident. Only cite exact evidence IDs present in the prompt.',
          prompt: promptSections.join('\n'),
          ...getDecodingParams(agent, { temperature: 0.66 }),
          jsonContract: `{
  "focalQuestions": string[],
  "reflections": Array<{ "insight": string, "importance": integer (1..10), "evidenceIds": string[] }>
}`,
          maxTokens: 2200,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              focalQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              reflections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    insight: { type: Type.STRING },
                    importance: { type: Type.INTEGER },
                    evidenceIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['insight', 'importance', 'evidenceIds'],
                },
              },
            },
            required: ['focalQuestions', 'reflections'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeReflectionPayload(raw, validIds));
    } catch (err) {
      handleApiError(res, err, 'reflect');
    } finally {
      ctx.cleanup();
    }
  });

  // 3. Dynamic Re-planning / Morning Schedule Synthesis (40s route deadline)
  app.post('/api/agent/plan', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validatePlanBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, simTimeLabel, currentMinuteOfDay, locations, objects, isMorningPlan } =
        req.body as {
          agent: AgentContextPayload;
          simTimeLabel: string;
          currentMinuteOfDay: number;
          locations: Array<{ id: string; name: string }>;
          objects?: Array<{ id: string; name: string; locationId: string }>;
          isMorningPlan?: boolean;
        };

      const startFrom = isMorningPlan ? 420 : currentMinuteOfDay;
      const objDirectory =
        objects && objects.length > 0
          ? [
              `Valid Interactive Object IDs (pick an objectId inside the chosen locationId when applicable):`,
              ...objects.map((o) => `- ${o.id} (${o.locationId}): ${o.name}`),
            ]
          : [];

      const prompt = [
        `Current Time: ${simTimeLabel} (minute of day: ${currentMinuteOfDay})`,
        `Planning Mode: ${isMorningPlan ? 'New Day Morning Full Schedule Synthesis (carrying forward yesterday’s sleep lessons, goals, & fixed commitments)' : 'Mid-day Dynamic Surgical Re-plan'}`,
        `Resident: ${agent.name} (${agent.age}, ${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        `Summary: ${agent.innateSummary}`,
        `Current Intent: ${agent.currently}`,
        ...formatPsychContext(agent),
        `Key Memories, Sleep Lessons & Commitments:`,
        ...(agent.retrievedMemories ?? []).map(
          (m) => `- [${m.type}, imp ${m.importance}] ${m.description}`,
        ),
        '',
        `Valid Smallville Location IDs:`,
        ...locations.map((l) => `- ${l.id}: ${l.name}`),
        ...objDirectory,
        '',
        isMorningPlan
          ? `Create 5 to 8 non-overlapping schedule blocks from wake (~420) to sleep (through 1440), honoring any fixed social commitments or plans recalled above. Include a "sleep" block and at least 2 "meal" blocks (breakfast + supper/lunch), alongside work/craft, social, leisure, or errands. Every block must specify kind ("sleep"|"meal"|"work"|"social"|"errand"|"leisure"|"rest"), startMinute, durationMinutes (45..180), locationId, optional objectId, activity, 2-4 subSteps, and emoji.`
          : `Create 3 to 5 non-overlapping schedule blocks starting at ${startFrom} to adjust the upcoming hours while respecting drives and goals. Each block needs kind ("sleep"|"meal"|"work"|"social"|"errand"|"leisure"|"rest"), startMinute, durationMinutes, locationId, optional objectId, activity, subSteps, and emoji.`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'plan',
          agentId: agent.id,
          systemInstruction:
            'Generate coherent, non-overlapping, psychologically grounded schedule blocks with kind, locationId, objectId affordances, and hierarchical sub-steps.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.68 }),
          jsonContract: `{
  "updatedSummary": string,
  "blocks": Array<{
    "kind": "sleep" | "meal" | "work" | "social" | "errand" | "leisure" | "rest",
    "startMinute": integer,
    "durationMinutes": integer (45..180),
    "locationId": string,
    "objectId"?: string,
    "activity": string,
    "subSteps": string[],
    "emoji": string
  }>
}`,
          maxTokens: 2800,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              updatedSummary: { type: Type.STRING },
              blocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    kind: { type: Type.STRING },
                    startMinute: { type: Type.INTEGER },
                    durationMinutes: { type: Type.INTEGER },
                    locationId: { type: Type.STRING },
                    objectId: { type: Type.STRING },
                    activity: { type: Type.STRING },
                    subSteps: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    emoji: { type: Type.STRING },
                  },
                  required: ['kind', 'startMinute', 'durationMinutes', 'locationId', 'activity', 'emoji'],
                },
              },
            },
            required: ['updatedSummary', 'blocks'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      const fallbackLoc = locations[0]?.id ?? 'hobbs_cafe';
      res.json(normalizePlanPayload(raw, fallbackLoc, startFrom));
    } catch (err) {
      handleApiError(res, err, 'plan');
    } finally {
      ctx.cleanup();
    }
  });

  // 3b. Salient Observation Reaction Decision (Park et al. 2023)
  app.post('/api/agent/react', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateReactBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, observation, simTimeLabel, partnerName, partnerAction, locations, objects } =
        req.body as {
          agent: AgentContextPayload;
          observation: string;
          simTimeLabel: string;
          partnerName?: string;
          partnerAction?: string;
          locations: Array<{ id: string; name: string }>;
          objects?: Array<{ id: string; name: string; locationId: string }>;
        };

      const validLocIds = new Set(locations.map((l) => l.id));
      const validObjIds = new Set((objects ?? []).map((o) => o.id));

      const prompt = [
        `Time: ${simTimeLabel} at ${agent.locationName}.`,
        `Resident: ${agent.name} (${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        `Current plan: ${agent.currently} (${agent.currentAction})`,
        ...formatPsychContext(agent),
        `Retrieved Memories:`,
        ...(agent.retrievedMemories ?? []).map((m) => `- (${m.type}, imp=${m.importance}) ${m.description}`),
        '',
        `New Salient Observation: "${observation}"`,
        partnerName ? `Observed Person Nearby: ${partnerName} (${partnerAction ?? 'nearby'})` : '',
        `Valid Locations: ${locations.map((l) => `${l.id} (${l.name})`).join(', ')}`,
        `Should ${agent.name} interrupt or adapt their current non-fixed plan to react right now? Answer react=true only if the observation genuinely warrants changing action or talking.`,
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'react',
          agentId: agent.id,
          systemInstruction:
            'Decide whether a Smallville resident reacts immediately to a salient perception by adjusting their current block.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.68 }),
          jsonContract: `{
  "react": boolean,
  "reason": string,
  "newActivity"?: string,
  "kind"?: "sleep" | "meal" | "work" | "social" | "errand" | "leisure" | "rest",
  "locationId"?: string,
  "objectId"?: string,
  "durationMinutes"?: integer (30..180),
  "emoji"?: string,
  "talkTo"?: string
}`,
          maxTokens: 900,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              react: { type: Type.BOOLEAN },
              reason: { type: Type.STRING },
              newActivity: { type: Type.STRING },
              kind: { type: Type.STRING },
              locationId: { type: Type.STRING },
              objectId: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              emoji: { type: Type.STRING },
              talkTo: { type: Type.STRING },
            },
            required: ['react', 'reason'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      const norm = normalizeReactionPayload(raw);
      if (norm.locationId && !validLocIds.has(norm.locationId)) {
        delete norm.locationId;
      }
      if (norm.objectId && !validObjIds.has(norm.objectId)) {
        delete norm.objectId;
      }
      res.json(norm);
    } catch (err) {
      handleApiError(res, err, 'react');
    } finally {
      ctx.cleanup();
    }
  });

  // 3c. Hierarchical Step Detail Decomposition
  app.post('/api/agent/step-detail', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateStepDetailBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 35_000);
    try {
      const { agent, block, simTimeLabel } = req.body as {
        agent: AgentContextPayload;
        block: { activity: string; kind: ScheduleBlockKind; durationMinutes: number };
        simTimeLabel: string;
      };

      const prompt = [
        `Time: ${simTimeLabel} at ${agent.locationName}.`,
        `Resident: ${agent.name} (${agent.occupation})`,
        `Scheduled Block (${block.durationMinutes} min, kind=${block.kind}): "${block.activity}"`,
        `Break this block into 3 to 5 sequential concrete 5-15 minute micro-steps for ${agent.name}.`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'step_detail',
          systemInstruction: 'Decompose a resident schedule block into 3 to 5 concise concrete micro-steps.',
          prompt,
          jsonContract: `{ "subSteps": string[] }`,
          maxTokens: 500,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              subSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['subSteps'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeStepDetailPayload(raw, block));
    } catch (err) {
      handleApiError(res, err, 'step-detail');
    } finally {
      ctx.cleanup();
    }
  });

  // 3d. Interview Answer Rubric Judge (1..5 scale)
  app.post('/api/agent/interview-judge', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateInterviewJudgeBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 35_000);
    try {
      const { agent, question, answer, simTimeLabel } = req.body as {
        agent: AgentContextPayload;
        question: string;
        answer: string;
        simTimeLabel?: string;
      };

      const prompt = [
        simTimeLabel ? `Time: ${simTimeLabel}` : '',
        `Resident: ${agent.name} (${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        ...(agent.goals?.length ? [`Goals: ${agent.goals.join('; ')}`] : []),
        `Retrieved Ground-Truth Memories:`,
        ...(agent.retrievedMemories ?? []).map((m) => `- (${m.type}, imp=${m.importance}) ${m.description}`),
        '',
        `Question: "${question}"`,
        `Resident Answer: "${answer}"`,
        `Score 1 (incoherent/inconsistent with memories & persona) to 5 (deeply grounded, consistent, specific, in-character).`,
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'judge',
          systemInstruction:
            'Grade a Smallville generative agent interview response from 1 to 5 for memory consistency and persona fidelity.',
          prompt,
          jsonContract: `{ "score": integer (1..5), "rationale": string }`,
          maxTokens: 400,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER },
              rationale: { type: Type.STRING },
            },
            required: ['score', 'rationale'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeInterviewJudgePayload(raw));
    } catch (err) {
      handleApiError(res, err, 'interview-judge');
    } finally {
      ctx.cleanup();
    }
  });

  // 4. Reporter Interview (40s route deadline)
  app.post('/api/agent/interview', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateInterviewBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, question, simTimeLabel } = req.body as {
        agent: AgentContextPayload;
        question: string;
        simTimeLabel: string;
      };

      const prompt = [
        `Time: ${simTimeLabel} at ${agent.locationName}.`,
        `You are roleplaying as ${agent.name} (${agent.age}, ${agent.occupation}).`,
        `Traits: ${agent.traits.join(', ')}`,
        `Bio: ${agent.innateSummary}`,
        `Currently doing: ${agent.currentAction}`,
        ...formatPsychContext(agent),
        `Your Retrieved Memories relevant to the reporter's question:`,
        ...(agent.retrievedMemories ?? []).map(
          (m) => `- [id=${m.id}, ${m.type}, imp=${m.importance}] ${m.description}`,
        ),
        '',
        `Smallville Gazette Reporter asks: "${question}"`,
        `Answer in first-person strictly staying in character, letting your current mood and drives subtly color your tone, and drawing upon your retrieved memories. Cite which memory IDs informed your answer.`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'interview',
          agentId: agent.id,
          systemInstruction:
            'Respond authentically in the voice of the Smallville resident. Keep the answer natural, conversational, and 2-4 sentences long.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.72, frequencyPenalty: 0.2 }),
          jsonContract: `{
  "answer": string,
  "citedMemoryIds": string[],
  "observationSummary": string
}`,
          maxTokens: 1800,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              citedMemoryIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              observationSummary: {
                type: Type.STRING,
              },
            },
            required: ['answer', 'citedMemoryIds', 'observationSummary'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeInterviewPayload(raw, agent.name));
    } catch (err) {
      handleApiError(res, err, 'interview');
    } finally {
      ctx.cleanup();
    }
  });

  // 5. Inner Voice / Whisper Thought Injection (40s route deadline)
  app.post('/api/agent/whisper', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateWhisperBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, thought, simTimeLabel, locations } = req.body as {
        agent: AgentContextPayload;
        thought: string;
        simTimeLabel: string;
        locations: Array<{ id: string; name: string }>;
      };

      const prompt = [
        `Time: ${simTimeLabel}.`,
        `Resident: ${agent.name} (${agent.occupation}) currently at ${agent.locationName} (${agent.currentAction}).`,
        `Traits: ${agent.traits.join(', ')}`,
        ...formatPsychContext(agent),
        `Recent Memories:`,
        ...(agent.retrievedMemories ?? []).map((m) => `- ${m.description}`),
        '',
        `An inner thought just crossed ${agent.name}'s mind: "${thought}"`,
        `Available locations: ${locations.map((l) => `${l.id} (${l.name})`).join(', ')}`,
        `Decide how ${agent.name} reacts immediately, what memory observation to record, any emotional shift (-0.3..+0.3), whether they decide to walk to a different location right now (optional targetLocationId), and a short speech/thought bubble.`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'whisper',
          agentId: agent.id,
          systemInstruction:
            'Simulate an inner thought/directive inside a Smallville generative agent and return their grounded reaction, emotional shift, and immediate action shift.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.72, frequencyPenalty: 0.18 }),
          jsonContract: `{
  "reactionBubble": string,
  "memoryObservation": string,
  "importance": integer (1..10),
  "newAction": string,
  "targetLocationId": string (valid locationId or empty string ""),
  "emoji": string,
  "emotionalShift": { "deltaValence": number (-0.3..0.3), "deltaArousal": number (-0.3..0.3) }
}`,
          maxTokens: 1800,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              reactionBubble: { type: Type.STRING },
              memoryObservation: { type: Type.STRING },
              importance: { type: Type.INTEGER },
              newAction: { type: Type.STRING },
              targetLocationId: { type: Type.STRING },
              emoji: { type: Type.STRING },
              emotionalShift: {
                type: Type.OBJECT,
                properties: {
                  deltaValence: { type: Type.NUMBER },
                  deltaArousal: { type: Type.NUMBER },
                },
                required: ['deltaValence', 'deltaArousal'],
              },
            },
            required: ['reactionBubble', 'memoryObservation', 'importance', 'newAction', 'emoji'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeWhisperPayload(raw, agent.name, agent.currentAction));
    } catch (err) {
      handleApiError(res, err, 'whisper');
    } finally {
      ctx.cleanup();
    }
  });

  // 6. Dense Semantic Embeddings (40s route deadline)
  app.post('/api/agent/embed', async (req, res) => {
    if (!geminiClient) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured for dense vector embeddings. Hybrid lexical + recency + importance retrieval remains active.',
      });
      return;
    }

    const validationErr = validateEmbedBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { texts } = req.body as { texts: string[] };
      const clipped = texts.slice(0, 32).map((t) => String(t).slice(0, 600));
      const result = await runSingleTrackedCall(
        'embed',
        'gemini',
        EMBED_MODEL_NAME,
        ctx.deadlineAtMs,
        ctx.signal,
        async (perCallTimeoutMs) => {
          const timeoutSignal = AbortSignal.timeout(perCallTimeoutMs);
          const { signal, cleanup } = combineAbortSignals([ctx.signal, timeoutSignal]);
          try {
            return await geminiClient.models.embedContent({
              model: EMBED_MODEL_NAME,
              contents: clipped.map((text) => ({ role: 'user', parts: [{ text }] })),
              config: { outputDimensionality: 768, abortSignal: signal },
            });
          } finally {
            cleanup();
          }
        },
      );

      const embeddings = (result.embeddings ?? []).map((e) => e.values ?? []);
      res.json({ embeddings });
    } catch (err) {
      handleApiError(res, err, 'embed');
    } finally {
      ctx.cleanup();
    }
  });

  // 7. Nightly Sleep Memory Consolidation (40s route deadline)
  app.post('/api/agent/consolidate', async (req, res) => {
    if (!isLlmConfigured()) {
      res.status(503).json({ error: 'No LLM API key configured.' });
      return;
    }

    const validationErr = validateConsolidateBody(req.body);
    if (validationErr) {
      res.status(400).json({ error: validationErr });
      return;
    }

    const ctx = attachRequestAbort(req, res, 40_000);
    try {
      const { agent, simTimeLabel, memories } = req.body as {
        agent: AgentContextPayload;
        simTimeLabel: string;
        memories: Array<{ id: string; type: string; description: string; importance: number }>;
      };

      const memText = memories
        .map((m) => `- [id=${m.id}] (${m.type}, imp=${m.importance}) ${m.description}`)
        .join('\n');

      const socialText = Object.entries(agent.socialGraph ?? {})
        .map(
          ([tid, edge]) =>
            `- ${tid} (${edge.roleLabel}, trust=${edge.trust}, affection=${edge.affection}): "${edge.inferredGoal}"`,
        )
        .join('\n');

      const prompt = [
        `Sleep Memory Consolidation Phase — ${simTimeLabel}`,
        `Resident: ${agent.name} (${agent.occupation})`,
        `Traits: ${agent.traits.join(', ')}`,
        ...formatPsychContext(agent),
        '',
        `Current Theory of Mind Social Ledger:`,
        socialText || '(none yet)',
        '',
        `Full Recent Memory Stream (${memories.length} items):`,
        memText,
        '',
        `Following cognitive sleep consolidation research ("Language Models Need Sleep"):`,
        `1. Distill 2-3 durable autobiographical 'consolidated' insights summarizing the emotional arc, lasting lessons, or shifting relationships from today.`,
        `2. Identify IDs of up to 4 low-importance routine observations (imp <= 4) that are safe to prune after consolidation.`,
        `3. Optionally refine Theory of Mind inferred goals for up to 2 neighbors based on today's memories.`,
      ].join('\n');

      const raw = await generateStructuredJson<unknown>(
        {
          jobKind: 'consolidate',
          agentId: agent.id,
          preferStrong: true,
          systemInstruction:
            'Perform human-like overnight memory consolidation for a Smallville generative agent: synthesize durable long-term autobiographical abstractions, update social mental models, and mark trivial observations for gentle forgetting.',
          prompt,
          ...getDecodingParams(agent, { temperature: 0.64 }),
          jsonContract: `{
  "consolidatedInsights": Array<{ "insight": string, "importance": integer (1..10), "evidenceIds": string[] }>,
  "prunedMemoryIds": string[],
  "socialUpdates"?: Array<{ "targetId": string, "inferredGoal": string, "deltaTrust"?: integer }>
}`,
          maxTokens: 2600,
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              consolidatedInsights: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    insight: { type: Type.STRING },
                    importance: { type: Type.INTEGER },
                    evidenceIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['insight', 'importance', 'evidenceIds'],
                },
              },
              prunedMemoryIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              socialUpdates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    targetId: { type: Type.STRING },
                    inferredGoal: { type: Type.STRING },
                    deltaTrust: { type: Type.INTEGER },
                  },
                  required: ['targetId', 'inferredGoal'],
                },
              },
            },
            required: ['consolidatedInsights', 'prunedMemoryIds'],
          },
        },
        ctx.signal,
        ctx.deadlineAtMs,
      );

      res.json(normalizeConsolidationPayload(raw));
    } catch (err) {
      handleApiError(res, err, 'consolidate');
    } finally {
      ctx.cleanup();
    }
  });

  return { app, config, dailyBudget, rateLimiter, metrics };
}

async function bootServer() {
  const { app, config } = createSmallvilleApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const provider = resolveActiveProvider(config);
    const activeModel = resolveModelForJob(config, provider, 'interview');
    console.log(
      `[Smallville] Server listening on http://localhost:${PORT} (provider=${provider}, model=${activeModel}, serverSaves=${config.enableServerSaves}, dailyCap=${config.maxCallsPerDay})`,
    );
  });
}

const isDirectEntry =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectEntry) {
  bootServer();
}
