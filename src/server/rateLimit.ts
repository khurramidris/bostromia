export interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

/**
 * Pure token-bucket rate limiter per key (default 30 req/min, burst 10).
 * A continuous-drip refill allows 10 immediate bursts and up to ~30 requests
 * across 60 seconds when paced cleanly, rejecting the 31st request inside 60s
 * if burst + refills are exhausted.
 */
export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly buckets = new Map<string, BucketState>();
  private readonly nowFn: () => number;

  constructor(
    options: {
      requestsPerMinute?: number;
      burst?: number;
      nowFn?: () => number;
    } = {},
  ) {
    const rpm = Math.max(1, options.requestsPerMinute ?? 30);
    this.capacity = Math.max(1, options.burst ?? 10);
    this.refillPerMs = rpm / 60_000;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  private refill(key: string, nowMs: number): BucketState {
    const existing = this.buckets.get(key);
    if (!existing) {
      const fresh = { tokens: this.capacity, lastRefillMs: nowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    const elapsed = Math.max(0, nowMs - existing.lastRefillMs);
    const nextTokens = Math.min(this.capacity, existing.tokens + elapsed * this.refillPerMs);
    existing.tokens = nextTokens;
    existing.lastRefillMs = nowMs;
    return existing;
  }

  consume(key: string): RateLimitDecision {
    const nowMs = this.nowFn();
    const bucket = this.refill(key, nowMs);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        retryAfterSec: 0,
        remaining: Math.floor(bucket.tokens),
      };
    }
    const deficit = 1 - bucket.tokens;
    const waitMs = Math.ceil(deficit / this.refillPerMs);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)),
      remaining: 0,
    };
  }

  /**
   * Checks multiple keys (e.g. IP + worldId). Only deducts a token from all keys if ALL allow.
   */
  consumeAll(keys: string[]): RateLimitDecision {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const nowMs = this.nowFn();
    let maxRetryAfterSec = 0;
    let minRemaining = this.capacity;

    const states = uniqueKeys.map((k) => this.refill(k, nowMs));
    for (const st of states) {
      if (st.tokens < 1) {
        const deficit = 1 - st.tokens;
        const waitSec = Math.max(1, Math.ceil(deficit / this.refillPerMs / 1000));
        if (waitSec > maxRetryAfterSec) maxRetryAfterSec = waitSec;
        minRemaining = 0;
      }
    }

    if (maxRetryAfterSec > 0) {
      return {
        allowed: false,
        retryAfterSec: maxRetryAfterSec,
        remaining: 0,
      };
    }

    for (const st of states) {
      st.tokens -= 1;
      minRemaining = Math.min(minRemaining, Math.floor(st.tokens));
    }
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: minRemaining,
    };
  }
}

export class DailyBudgetTracker {
  private readonly maxCallsPerDay: number;
  private readonly nowFn: () => number;
  private currentDayKey: string;
  private callsCount = 0;

  constructor(options: { maxCallsPerDay?: number; nowFn?: () => number } = {}) {
    this.maxCallsPerDay = Math.max(1, options.maxCallsPerDay ?? 2000);
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
      this.callsCount = 0;
    }
  }

  hasCapacity(): boolean {
    this.syncDay();
    return this.callsCount < this.maxCallsPerDay;
  }

  tryConsume(): { allowed: boolean; count: number; maxCallsPerDay: number } {
    this.syncDay();
    if (this.callsCount >= this.maxCallsPerDay) {
      return {
        allowed: false,
        count: this.callsCount,
        maxCallsPerDay: this.maxCallsPerDay,
      };
    }
    this.callsCount += 1;
    return {
      allowed: true,
      count: this.callsCount,
      maxCallsPerDay: this.maxCallsPerDay,
    };
  }

  snapshot() {
    this.syncDay();
    return {
      date: this.currentDayKey,
      count: this.callsCount,
      maxCallsPerDay: this.maxCallsPerDay,
      remaining: Math.max(0, this.maxCallsPerDay - this.callsCount),
    };
  }
}

export type ServerJobMetricKind =
  | 'converse'
  | 'reflect'
  | 'plan'
  | 'react'
  | 'decide'
  | 'step_detail'
  | 'interview'
  | 'judge'
  | 'whisper'
  | 'consolidate'
  | 'embed';

interface JobMetricsBucket {
  calls: number;
  failures: number;
  latenciesMs: number[];
  inputTokens: number;
  outputTokens: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

export class MetricsCollector {
  private readonly byKind = new Map<ServerJobMetricKind, JobMetricsBucket>();
  private readonly byModel = new Map<string, { calls: number; failures: number; estimatedCostUsd: number }>();
  private totalEstimatedCostUsd = 0;
  private readonly logFn: (line: string) => void;

  constructor(logFn: (line: string) => void = (line) => console.log(line)) {
    this.logFn = logFn;
  }

  recordUpstreamCall(entry: {
    jobKind: ServerJobMetricKind;
    provider: string;
    model: string;
    latencyMs: number;
    ok: boolean;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    status?: number;
    repaired?: boolean;
  }): void {
    let bucket = this.byKind.get(entry.jobKind);
    if (!bucket) {
      bucket = {
        calls: 0,
        failures: 0,
        latenciesMs: [],
        inputTokens: 0,
        outputTokens: 0,
      };
      this.byKind.set(entry.jobKind, bucket);
    }

    bucket.calls += 1;
    if (!entry.ok) bucket.failures += 1;
    bucket.latenciesMs.push(Math.max(0, Math.round(entry.latencyMs)));
    if (bucket.latenciesMs.length > 200) {
      bucket.latenciesMs.shift();
    }
    bucket.inputTokens += Math.max(0, Math.round(entry.inputTokens ?? 0));
    bucket.outputTokens += Math.max(0, Math.round(entry.outputTokens ?? 0));

    const costUsd = Math.max(0, Number(entry.estimatedCostUsd ?? 0));
    this.totalEstimatedCostUsd = Number((this.totalEstimatedCostUsd + costUsd).toFixed(6));
    const modelKey = entry.model || 'unknown';
    const prevModel = this.byModel.get(modelKey) ?? { calls: 0, failures: 0, estimatedCostUsd: 0 };
    this.byModel.set(modelKey, {
      calls: prevModel.calls + 1,
      failures: prevModel.failures + (entry.ok ? 0 : 1),
      estimatedCostUsd: Number((prevModel.estimatedCostUsd + costUsd).toFixed(6)),
    });

    this.logFn(
      JSON.stringify({
        event: 'smallville_upstream_call',
        ts: new Date().toISOString(),
        jobKind: entry.jobKind,
        provider: entry.provider,
        model: entry.model,
        ok: entry.ok,
        status: entry.status ?? (entry.ok ? 200 : 500),
        latencyMs: Math.round(entry.latencyMs),
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        estimatedCostUsd: costUsd,
        repaired: Boolean(entry.repaired),
      }),
    );
  }

  snapshot() {
    const byJobType: Record<
      string,
      {
        calls: number;
        failures: number;
        p50LatencyMs: number;
        p95LatencyMs: number;
        inputTokens: number;
        outputTokens: number;
      }
    > = {};

    for (const [kind, b] of this.byKind.entries()) {
      const sorted = [...b.latenciesMs].sort((a, bVal) => a - bVal);
      byJobType[kind] = {
        calls: b.calls,
        failures: b.failures,
        p50LatencyMs: percentile(sorted, 50),
        p95LatencyMs: percentile(sorted, 95),
        inputTokens: b.inputTokens,
        outputTokens: b.outputTokens,
      };
    }

    const byModel: Record<string, { calls: number; failures: number; estimatedCostUsd: number }> = {};
    for (const [m, stats] of this.byModel.entries()) {
      byModel[m] = stats;
    }

    return {
      byJobType,
      byModel,
      totalEstimatedCostUsd: this.totalEstimatedCostUsd,
    };
  }
}
