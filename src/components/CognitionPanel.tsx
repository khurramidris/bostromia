import { useEffect, useState } from 'react';
import type { ServerMetricsPayload } from '../services/smallvilleApi';
import {
  computeEffectivePriority,
  type SchedulerJobKind,
  type SchedulerState,
} from '../simulation/cognitionScheduler';
import { formatSimTime } from '../simulation/memory';
import type { WorldState } from '../simulation/types';
import type { TokenPriceConfig } from '../store/smallvilleStore';

interface CognitionPanelProps {
  world: WorldState;
  schedulerState: SchedulerState;
  dilationRate: number;
  serverMetrics: ServerMetricsPayload | null;
  tokenPrices: TokenPriceConfig;
  onChangeTokenPrices: (next: TokenPriceConfig) => void;
}

export function CognitionPanel({
  world,
  schedulerState,
  dilationRate,
  serverMetrics,
  tokenPrices,
  onChangeTokenPrices,
}: CognitionPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const recentCallsInMin = schedulerState.callTimestampsMs.filter((t) => t > nowMs - 60_000).length;

  const sortedQueue = [...schedulerState.queue]
    .map((job) => ({
      job,
      priority: computeEffectivePriority(job, schedulerState, world.simMinutes),
      waitSec: Math.max(0, Math.round((nowMs - job.enqueuedAtMs) / 1000)),
    }))
    .sort((a, b) => b.priority - a.priority);

  const activeBackoffs = Object.entries(schedulerState.failuresByKey)
    .filter(([, f]) => f.nextRetryAtMs > nowMs)
    .map(([key, f]) => ({
      key,
      attempts: f.attempts,
      remainingSec: Math.max(1, Math.ceil((f.nextRetryAtMs - nowMs) / 1000)),
      lastError: f.lastError,
    }));

  const pausedKinds = (
    Object.entries(schedulerState.pausedUntilByKind) as Array<[SchedulerJobKind, number | undefined]>
  ).filter(([, until]) => typeof until === 'number' && until > nowMs);

  // Sum token telemetry from server metrics when connected, fallback to world stats
  const serverByJob = Object.entries(serverMetrics?.byJobType ?? {});
  const serverInputTokens = serverByJob.reduce((s, [, m]) => s + (m.inputTokens || 0), 0);
  const serverOutputTokens = serverByJob.reduce((s, [, m]) => s + (m.outputTokens || 0), 0);
  const inputTokens = Math.max(world.stats.inputTokensUsed ?? 0, serverInputTokens);
  const outputTokens = Math.max(world.stats.outputTokensUsed ?? 0, serverOutputTokens);
  const totalTokens = Math.max(world.stats.tokensUsed ?? 0, inputTokens + outputTokens);
  const callsToday = Math.max(
    schedulerState.callsToday,
    world.stats.llmCallsMade ?? 0,
    serverMetrics?.usageToday?.count ?? 0,
  );

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * Math.max(0, tokenPrices.inputPer1M) +
    (outputTokens / 1_000_000) * Math.max(0, tokenPrices.outputPer1M);

  const agentNameMap = new Map(world.agents.map((a) => [a.id, a.name.split(' ')[0]]));

  return (
    <section
      aria-label="Live cognition pipeline panel"
      className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#EFECE4] pb-3">
        <div>
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            Cognition Pipeline, Queue &amp; Token Cost Monitor
          </h2>
          <p className="text-xs text-[#5C645E]">
            Live view of in-flight LLM jobs, queued work with priority &amp; wait timers, retry backoff state, calls/min, and token cost estimation.
          </p>
        </div>
        <div className="font-mono text-xs text-[#3C4640] tabular-nums">
          Clock Scale: ×{dilationRate.toFixed(2)} {dilationRate < 0.99 ? '(slowed for cognition)' : '(real-time)'}
        </div>
      </div>

      {/* Live Rate & Usage Strip */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] px-3 py-2.5">
          <dt className="text-[11px] text-[#5C645E]">Calls / Min</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
            {recentCallsInMin} / {schedulerState.config.maxCallsPerMinute}
          </dd>
        </div>
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] px-3 py-2.5">
          <dt className="text-[11px] text-[#5C645E]">Calls Today</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
            {callsToday}
          </dd>
        </div>
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] px-3 py-2.5">
          <dt className="text-[11px] text-[#5C645E]">Input / Output Tokens</dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold text-[#1D2420] tabular-nums">
            {inputTokens.toLocaleString()} / {outputTokens.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] px-3 py-2.5">
          <dt className="text-[11px] text-[#5C645E]">Total Tokens Today</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold text-[#2D6A4F] tabular-nums">
            {totalTokens.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] px-3 py-2.5">
          <dt className="text-[11px] text-[#5C645E]">Estimated Cost</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
            ${estimatedCostUsd.toFixed(4)}
          </dd>
        </div>
      </dl>

      {/* Editable $/1M Token Cost Estimator */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-[#EFECE4] bg-[#FAF8F4] px-4 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Input $/1M tokens</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.05}
              value={tokenPrices.inputPer1M}
              onChange={(e) =>
                onChangeTokenPrices({
                  ...tokenPrices,
                  inputPer1M: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-28 rounded border border-[#D5D0C3] bg-white px-2.5 py-1 font-mono text-xs text-[#1D2420] tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Output $/1M tokens</span>
            <input
              type="number"
              min={0}
              max={200}
              step={0.05}
              value={tokenPrices.outputPer1M}
              onChange={(e) =>
                onChangeTokenPrices({
                  ...tokenPrices,
                  outputPer1M: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-28 rounded border border-[#D5D0C3] bg-white px-2.5 py-1 font-mono text-xs text-[#1D2420] tabular-nums"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[#5C645E]">Rate presets:</span>
          {[
            { label: 'Free ($0 / $0)', input: 0, output: 0 },
            { label: 'Gemini Flash ($0.15 / $0.60)', input: 0.15, output: 0.6 },
            { label: 'Paid Mid ($0.50 / $1.50)', input: 0.5, output: 1.5 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChangeTokenPrices({ inputPer1M: preset.input, outputPer1M: preset.output })}
              className="rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[#2F3833] hover:bg-[#EFECE3] whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two-Column Active Execution: In Flight & Queued */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] p-3.5 space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <h3 className="font-semibold text-[#1D2420]">
              Jobs In Flight ({schedulerState.inFlight.length}/{schedulerState.config.maxConcurrent})
            </h3>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">Active lanes</span>
          </div>
          {schedulerState.inFlight.length === 0 ? (
            <p className="text-xs text-[#5C645E]">No LLM calls running right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {schedulerState.inFlight.map((job) => {
                const who = job.agentIds.map((id) => agentNameMap.get(id) ?? id).join(' & ');
                const elapsedSec = Math.max(0, Math.round((nowMs - job.enqueuedAtMs) / 1000));
                return (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-2 rounded border border-[#D5D0C3] bg-white px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate font-medium text-[#1D2420]">
                      <span className="font-mono text-[#2D6A4F]">{job.kind}</span> · {who}
                      {job.isUserAction ? ' · manual' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-[#5C645E] tabular-nums shrink-0">
                      {elapsedSec}s
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-[#E6E3D8] bg-[#FAF8F4] p-3.5 space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <h3 className="font-semibold text-[#1D2420]">
              Priority Queue ({sortedQueue.length})
            </h3>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">Priority · Wait</span>
          </div>
          {sortedQueue.length === 0 ? (
            <p className="text-xs text-[#5C645E]">Queue empty — all due cognition dispatched.</p>
          ) : (
            <ul className="space-y-1.5 max-h-44 overflow-y-auto smallville-scroll pr-1">
              {sortedQueue.slice(0, 12).map(({ job, priority, waitSec }) => {
                const who = job.agentIds.map((id) => agentNameMap.get(id) ?? id).join(' & ');
                return (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-2 rounded border border-[#E6E3D8] bg-white px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-[#1D2420]">
                      <span className="font-mono font-medium text-[#2F3833]">{job.kind}</span> · {who}
                      {job.isUserAction ? ' · manual' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-[#5C645E] tabular-nums shrink-0">
                      P{Math.round(priority)} · {waitSec}s
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Backoff Timers & Recent Failures */}
      {(pausedKinds.length > 0 || activeBackoffs.length > 0 || schedulerState.recentFailures.length > 0) && (
        <div className="border-t border-[#EFECE4] pt-3 space-y-2 text-xs">
          <h3 className="font-semibold text-[#1D2420]">Backoff Timers &amp; Failure Log</h3>
          <div className="flex flex-wrap gap-2">
            {pausedKinds.map(([kind, until]) => (
              <div
                key={kind}
                className="rounded border border-[#D97706]/40 bg-[#FFFBEB] px-3 py-1.5 font-mono text-[11px] text-[#92400E] tabular-nums"
              >
                Global 429 pause ({kind}): {Math.max(1, Math.ceil(((until ?? 0) - nowMs) / 1000))}s remaining
              </div>
            ))}
            {activeBackoffs.map((b) => (
              <div
                key={b.key}
                className="rounded border border-[#DC2626]/30 bg-[#FEF2F2] px-3 py-1.5 font-mono text-[11px] text-[#991B1B] tabular-nums"
              >
                Backoff {b.key} (try {b.attempts}/3): retry in {b.remainingSec}s
              </div>
            ))}
          </div>
          {schedulerState.recentFailures.length > 0 && (
            <ul className="space-y-1">
              {schedulerState.recentFailures.slice(0, 5).map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#FAF8F4] px-3 py-1.5 text-[11px] text-[#3C4640]"
                >
                  <span className="truncate">
                    <span className="font-mono font-semibold text-[#991B1B]">{f.kind}</span> (
                    {f.agentIds.join(', ')}) attempt {f.attempts}: {f.error}
                  </span>
                  <span className="font-mono text-[#5C645E] tabular-nums shrink-0">
                    {formatSimTime(f.atSimMin).fullLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Server Per-Endpoint Latency & Token Table (when connected) */}
      {serverByJob.length > 0 && (
        <div className="border-t border-[#EFECE4] pt-3 space-y-2">
          <h3 className="text-xs font-semibold text-[#1D2420]">
            Server Upstream Endpoint Latency &amp; Token Breakdown
          </h3>
          <div className="overflow-x-auto rounded border border-[#E5E2D9]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E5E2D9] bg-[#FAF8F4] text-[#5C645E]">
                <tr>
                  <th className="px-3 py-2 font-medium">Endpoint</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Fails</th>
                  <th className="px-3 py-2 font-medium text-right">p50 (ms)</th>
                  <th className="px-3 py-2 font-medium text-right">p95 (ms)</th>
                  <th className="px-3 py-2 font-medium text-right">In Tok</th>
                  <th className="px-3 py-2 font-medium text-right">Out Tok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE4] font-mono tabular-nums text-[#1D2420]">
                {serverByJob.map(([jobType, m]) => (
                  <tr key={jobType}>
                    <td className="px-3 py-1.5 font-medium">{jobType}</td>
                    <td className="px-3 py-1.5 text-right">{m.calls}</td>
                    <td className="px-3 py-1.5 text-right">{m.failures}</td>
                    <td className="px-3 py-1.5 text-right">{m.p50LatencyMs}</td>
                    <td className="px-3 py-1.5 text-right">{m.p95LatencyMs}</td>
                    <td className="px-3 py-1.5 text-right">{m.inputTokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{m.outputTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
