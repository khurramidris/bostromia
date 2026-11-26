import { useRef, useSyncExternalStore } from 'react';
import type { ServerMetricsPayload } from '../services/smallvilleApi';
import type { SchedulerState } from '../simulation/cognitionScheduler';
import type { WorldState } from '../simulation/types';

export type ActionExecutionStatus = 'queued' | 'running' | 'failed';

export interface ActionStatusEntry {
  status: ActionExecutionStatus;
  error?: string;
  updatedAtMs: number;
}

export interface TokenPriceConfig {
  inputPer1M: number;
  outputPer1M: number;
}

export interface SmallvilleStoreSnapshot {
  world: WorldState;
  scheduler: SchedulerState;
  dilationRate: number;
  actionStates: Record<string, ActionStatusEntry>;
  serverMetrics: ServerMetricsPayload | null;
  tokenPrices: TokenPriceConfig;
  uiCommitCount: number;
}

export interface SmallvilleStore {
  worldRef: { current: WorldState };
  getSnapshot: () => SmallvilleStoreSnapshot;
  getWorld: () => WorldState;
  setWorld: (next: WorldState, options?: { immediate?: boolean; nowMs?: number }) => boolean;
  setScheduler: (next: SchedulerState, nowMs?: number) => void;
  setDilationRate: (rate: number) => void;
  setActionFailed: (key: string, error: string, nowMs?: number) => void;
  clearActionStatus: (key: string) => void;
  setServerMetrics: (metrics: ServerMetricsPayload | null) => void;
  setTokenPrices: (prices: TokenPriceConfig) => void;
  recordUiCommit: (nowMs?: number) => void;
  getCommitsPerSec: (nowMs?: number) => number;
  subscribe: (listener: () => void) => () => void;
}

export interface CreateSmallvilleStoreOptions {
  tickThrottleMs?: number;
  nowMs?: number;
}

function buildActionStatesFromScheduler(
  scheduler: SchedulerState,
  prev: Record<string, ActionStatusEntry>,
  nowMs: number,
): Record<string, ActionStatusEntry> {
  const next: Record<string, ActionStatusEntry> = {};

  // Preserve recent explicit user failures (< 30s) until overwritten or cleared
  for (const [k, v] of Object.entries(prev)) {
    if (v.status === 'failed' && nowMs - v.updatedAtMs < 30_000) {
      next[k] = v;
    }
  }

  for (const job of scheduler.queue) {
    if (!job.isUserAction) continue;
    const key = `${job.kind}:${job.agentIds[0] ?? ''}`;
    next[key] = { status: 'queued', updatedAtMs: nowMs };
  }

  for (const job of scheduler.inFlight) {
    if (!job.isUserAction) continue;
    const key = `${job.kind}:${job.agentIds[0] ?? ''}`;
    next[key] = { status: 'running', updatedAtMs: nowMs };
  }

  return next;
}

export function createSmallvilleStore(
  initialWorld: WorldState,
  initialScheduler: SchedulerState,
  options: CreateSmallvilleStoreOptions = {},
): SmallvilleStore {
  const tickThrottleMs = Math.max(100, options.tickThrottleMs ?? 260);
  const worldRef = { current: initialWorld };

  let lastWorldNotifyMs = options.nowMs ?? 0;
  let commitTimestampsMs: number[] = [];

  let snapshot: SmallvilleStoreSnapshot = {
    world: initialWorld,
    scheduler: initialScheduler,
    dilationRate: 1,
    actionStates: {},
    serverMetrics: null,
    tokenPrices: { inputPer1M: 0, outputPer1M: 0 },
    uiCommitCount: 0,
  };

  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    worldRef,

    getSnapshot: () => snapshot,
    getWorld: () => worldRef.current,

    setWorld(next, opts = {}) {
      worldRef.current = next;
      const nowMs = opts.nowMs ?? Date.now();
      const immediate = opts.immediate ?? true;
      if (!immediate && nowMs - lastWorldNotifyMs < tickThrottleMs) {
        return false;
      }
      lastWorldNotifyMs = nowMs;
      snapshot = {
        ...snapshot,
        world: next,
      };
      emit();
      return true;
    },

    setScheduler(next, nowMs = Date.now()) {
      const prev = snapshot.scheduler;
      const unchanged =
        prev.currentSimDay === next.currentSimDay &&
        prev.callsToday === next.callsToday &&
        prev.totalCallsCompleted === next.totalCallsCompleted &&
        prev.queue.length === next.queue.length &&
        prev.inFlight.length === next.inFlight.length &&
        prev.recentFailures.length === next.recentFailures.length &&
        prev.queue[0]?.id === next.queue[0]?.id &&
        prev.inFlight[0]?.id === next.inFlight[0]?.id &&
        Object.keys(prev.failuresByKey).length === Object.keys(next.failuresByKey).length &&
        Object.keys(prev.pausedUntilByKind).length === Object.keys(next.pausedUntilByKind).length &&
        prev.config.preset === next.config.preset &&
        prev.config.maxConcurrent === next.config.maxConcurrent &&
        prev.config.maxCallsPerMinute === next.config.maxCallsPerMinute &&
        prev.config.timeDilation === next.config.timeDilation;
      if (unchanged) {
        snapshot.scheduler = next;
        return;
      }
      const nextActionStates = buildActionStatesFromScheduler(next, snapshot.actionStates, nowMs);
      snapshot = {
        ...snapshot,
        scheduler: next,
        actionStates: nextActionStates,
      };
      emit();
    },

    setDilationRate(rate) {
      if (Math.abs(rate - snapshot.dilationRate) < 0.05) return;
      snapshot = {
        ...snapshot,
        dilationRate: rate,
      };
      emit();
    },

    setActionFailed(key, error, nowMs = Date.now()) {
      snapshot = {
        ...snapshot,
        actionStates: {
          ...snapshot.actionStates,
          [key]: {
            status: 'failed',
            error,
            updatedAtMs: nowMs,
          },
        },
      };
      emit();
    },

    clearActionStatus(key) {
      if (!(key in snapshot.actionStates)) return;
      const copy = { ...snapshot.actionStates };
      delete copy[key];
      snapshot = {
        ...snapshot,
        actionStates: copy,
      };
      emit();
    },

    setServerMetrics(metrics) {
      snapshot = {
        ...snapshot,
        serverMetrics: metrics,
      };
      emit();
    },

    setTokenPrices(prices) {
      snapshot = {
        ...snapshot,
        tokenPrices: prices,
      };
      emit();
    },

    recordUiCommit(nowMs = Date.now()) {
      const cutoff = nowMs - 2000;
      commitTimestampsMs = commitTimestampsMs.filter((t) => t > cutoff);
      commitTimestampsMs.push(nowMs);
    },

    getCommitsPerSec(nowMs = Date.now()) {
      const cutoff = nowMs - 2000;
      const recent = commitTimestampsMs.filter((t) => t > cutoff);
      return Number((recent.length / 2).toFixed(1));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useSmallvilleSelector<T>(
  store: SmallvilleStore,
  selector: (snap: SmallvilleStoreSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const prevRef = useRef<{ initialized: boolean; value: T }>({
    initialized: false,
    value: undefined as unknown as T,
  });

  return useSyncExternalStore(
    store.subscribe,
    () => {
      const next = selector(store.getSnapshot());
      if (prevRef.current.initialized && isEqual(prevRef.current.value, next)) {
        return prevRef.current.value;
      }
      prevRef.current = { initialized: true, value: next };
      return next;
    },
    () => selector(store.getSnapshot()),
  );
}
