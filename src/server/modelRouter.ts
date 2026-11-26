/**
 * Phase 1 — Heterogeneous Multi-Model Router & Dev Spend Guardrail.
 *
 * Supports 4 run profiles:
 * - 'auto': standard OPENROUTER_MODEL / GEMINI_MODEL + per-job overrides
 * - 'dev_free': enforces `:free` OpenRouter models ONLY (blocks paid spend during dev)
 * - 'live_cheap': assigns different residents across OPENROUTER_COHORT_MODELS deterministically
 * - 'local': routes to LOCAL_LLM_URL (Ollama / vLLM / LM Studio OpenAI-compatible endpoint)
 */

import type { ServerJobMetricKind } from './rateLimit.ts';

export type LlmRunProfile = 'auto' | 'dev_free' | 'live_cheap' | 'local';

export interface ModelRoutingConfig {
  llmProfile: LlmRunProfile;
  openRouterModel: string;
  geminiModel: string;
  modelConverse?: string;
  modelReflect?: string;
  modelPlan?: string;
  openRouterFreeModels: string[];
  openRouterCohortModels: string[];
  openRouterStrongModel?: string;
  localLlmModel: string;
}

export function parseCsvList(val?: string): string[] {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isFreeOpenRouterModel(model: string): boolean {
  return model.trim().toLowerCase().endsWith(':free');
}

function stableHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resolveAutoModel(
  config: ModelRoutingConfig,
  provider: 'openrouter' | 'gemini' | 'local' | 'none',
  jobKind: ServerJobMetricKind,
): string {
  const isOverrideCompatible = (override?: string) => {
    if (!override) return false;
    if (provider === 'gemini') return !override.includes('/');
    return provider === 'openrouter';
  };
  if (jobKind === 'converse' && isOverrideCompatible(config.modelConverse)) {
    return config.modelConverse!;
  }
  if (jobKind === 'reflect' && isOverrideCompatible(config.modelReflect)) {
    return config.modelReflect!;
  }
  if (jobKind === 'plan' && isOverrideCompatible(config.modelPlan)) {
    return config.modelPlan!;
  }
  if (provider === 'local') return config.localLlmModel;
  if (provider === 'openrouter') return config.openRouterModel;
  if (provider === 'gemini') return config.geminiModel;
  return 'unconfigured';
}

export function resolveModelRoute(params: {
  config: ModelRoutingConfig;
  provider: 'openrouter' | 'gemini' | 'local' | 'none';
  jobKind: ServerJobMetricKind;
  agentId?: string;
  preferStrong?: boolean;
}): { model: string; blockedReason?: string } {
  const { config, provider, jobKind, agentId, preferStrong } = params;

  if (provider === 'local' || config.llmProfile === 'local') {
    return { model: config.localLlmModel };
  }

  if (config.llmProfile === 'dev_free') {
    if (provider !== 'openrouter') {
      return {
        model: config.geminiModel,
        blockedReason: 'Non-OpenRouter paid provider blocked in dev_free profile.',
      };
    }
    const freePool = config.openRouterFreeModels.filter(isFreeOpenRouterModel);
    if (freePool.length > 0) {
      const idx = agentId ? stableHash(agentId) % freePool.length : 0;
      return { model: freePool[idx] };
    }
    if (isFreeOpenRouterModel(config.openRouterModel)) {
      return { model: config.openRouterModel };
    }
    return {
      model: config.openRouterModel,
      blockedReason: `Paid model "${config.openRouterModel}" is blocked when LLM_PROFILE=dev_free.`,
    };
  }

  if (config.llmProfile === 'live_cheap' && provider === 'openrouter') {
    if (preferStrong && config.openRouterStrongModel) {
      return { model: config.openRouterStrongModel };
    }
    if (config.openRouterCohortModels.length > 0) {
      const idx = agentId ? stableHash(agentId) % config.openRouterCohortModels.length : 0;
      return { model: config.openRouterCohortModels[idx] };
    }
  }

  return { model: resolveAutoModel(config, provider, jobKind) };
}

/**
 * Estimates call cost in USD from model family & token usage.
 * Free (`:free`) and local models always estimate to $0.
 */
export function estimateCallCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isLocal = false,
): number {
  const low = model.toLowerCase();
  if (isLocal || isFreeOpenRouterModel(low)) return 0;

  let inRatePer1M = 0.5;
  let outRatePer1M = 1.5;

  if (low.includes('deepseek') && (low.includes('flash') || low.includes('chat') || low.includes('v3') || low.includes('v4'))) {
    inRatePer1M = 0.14;
    outRatePer1M = 0.28;
  } else if (low.includes('flash') || low.includes('hydrogen') || low.includes('mini') || low.includes('lite')) {
    inRatePer1M = 0.1;
    outRatePer1M = 0.4;
  } else if (low.includes('qwen') || low.includes('llama') || low.includes('glm')) {
    inRatePer1M = 0.18;
    outRatePer1M = 0.55;
  } else if (low.includes('pro') || low.includes('sonnet') || low.includes('opus')) {
    inRatePer1M = 2.0;
    outRatePer1M = 8.0;
  }

  const usd = (Math.max(0, inputTokens) * inRatePer1M + Math.max(0, outputTokens) * outRatePer1M) / 1_000_000;
  return Number(usd.toFixed(6));
}

export class DailySpendTracker {
  private readonly maxUsdPerDay: number | null;
  private readonly nowFn: () => number;
  private currentDayKey: string;
  private spentUsd = 0;

  constructor(options: { maxUsdPerDay?: number | null; nowFn?: () => number } = {}) {
    this.maxUsdPerDay =
      typeof options.maxUsdPerDay === 'number' && Number.isFinite(options.maxUsdPerDay) && options.maxUsdPerDay > 0
        ? options.maxUsdPerDay
        : null;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.currentDayKey = this.utcDay();
  }

  private utcDay(): string {
    return new Date(this.nowFn()).toISOString().slice(0, 10);
  }

  private syncDay(): void {
    const day = this.utcDay();
    if (day !== this.currentDayKey) {
      this.currentDayKey = day;
      this.spentUsd = 0;
    }
  }

  hasCapacity(): boolean {
    this.syncDay();
    if (this.maxUsdPerDay === null) return true;
    return this.spentUsd < this.maxUsdPerDay;
  }

  recordSpend(usd: number): void {
    this.syncDay();
    if (usd > 0 && Number.isFinite(usd)) {
      this.spentUsd = Number((this.spentUsd + usd).toFixed(6));
    }
  }

  snapshot() {
    this.syncDay();
    return {
      date: this.currentDayKey,
      spentUsd: this.spentUsd,
      maxUsdPerDay: this.maxUsdPerDay,
      remainingUsd:
        this.maxUsdPerDay !== null ? Math.max(0, Number((this.maxUsdPerDay - this.spentUsd).toFixed(6))) : null,
    };
  }
}
