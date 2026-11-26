import { AlertTriangle, Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ServerMetricsPayload } from '../services/smallvilleApi';
import {
  buildSchedulerConfig,
  type BudgetPreset,
  type SchedulerConfig,
  type SchedulerJobKind,
  type SchedulerState,
} from '../simulation/cognitionScheduler';
import { formatSimTime } from '../simulation/memory';
import type { WorldState } from '../simulation/types';
import type { TokenPriceConfig } from '../store/smallvilleStore';
import { CognitionPanel } from './CognitionPanel';

interface ArchitectureViewProps {
  world: WorldState;
  llmInfo?: {
    provider?: string;
    model?: string;
    models?: {
      default: string;
      converse: string;
      reflect: string;
      plan: string;
    };
    embeddingsConfigured?: boolean;
    serverSavesEnabled?: boolean;
    limits?: {
      maxCallsPerDay: number;
      ratePerMinute: number;
      freeModelDailyCap: number | null;
      freeModelPaidCreditCap: number | null;
    };
    usageToday?: {
      count: number;
      maxCallsPerDay: number;
      remaining: number;
    };
  };
  schedulerState: SchedulerState;
  dilationRate: number;
  serverMetrics: ServerMetricsPayload | null;
  tokenPrices: TokenPriceConfig;
  onChangeTokenPrices: (next: TokenPriceConfig) => void;
  onUpdateSchedulerConfig: (next: SchedulerConfig) => void;
  onExportWorld: () => void;
  onImportWorldFile: (jsonText: string) => void;
}

export function ArchitectureView({
  world,
  llmInfo,
  schedulerState,
  dilationRate,
  serverMetrics,
  tokenPrices,
  onChangeTokenPrices,
  onUpdateSchedulerConfig,
  onExportWorld,
  onImportWorldFile,
}: ArchitectureViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const totalMemories = world.agents.reduce((acc, a) => acc + a.memories.length, 0);
  const totalReflections = world.agents.reduce(
    (acc, a) =>
      acc +
      a.memories.filter((m) => m.type === 'reflection' || m.type === 'consolidated').length,
    0,
  );
  const totalSocialEdges = world.agents.reduce(
    (acc, a) => acc + Object.keys(a.socialGraph).length,
    0,
  );
  const embeddedMemories = world.agents.reduce(
    (acc, a) => acc + a.memories.filter((m) => Boolean(m.embedding?.length)).length,
    0,
  );

  const engineLabel = llmInfo?.model ?? 'unconfigured';
  const providerLabel = llmInfo?.provider ? ` (${llmInfo.provider})` : '';
  const nowMs = Date.now();
  const pausedEntries = (
    Object.entries(schedulerState.pausedUntilByKind) as Array<[SchedulerJobKind, number | undefined]>
  ).filter(([, until]) => typeof until === 'number' && until > nowMs);

  const handlePresetChange = (preset: BudgetPreset) => {
    onUpdateSchedulerConfig(
      buildSchedulerConfig(preset, {
        timeDilation: schedulerState.config.timeDilation,
      }),
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      onImportWorldFile(text);
      setImportFeedback(`Loaded "${file.name}".`);
    } catch {
      setImportFeedback('Could not read selected JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 space-y-8">
      <div className="border-b border-[#E2DFD5] pb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#1D2420]">
            Smallville Cognitive &amp; Psychosocial Architecture
          </h1>
          <p className="mt-1 text-sm text-[#5C645E] max-w-3xl">
            Grounded in Stanford Generative Agents (Park et al., 2023), Theory of Mind Social Ledgers, Grounded World Affordances, Homeostatic Drives &amp; PAD Affect, Dense Vector Retrieval (<span className="font-mono text-xs">gemini-embedding-2</span>), and Overnight Memory Consolidation.
          </p>
          <p className="mt-2 font-mono text-[11px] text-[#3C4640]">
            Reasoning Engine: {engineLabel}{providerLabel} · Memory Retrieval:{' '}
            {llmInfo?.embeddingsConfigured ? 'Dense Vector + Lexical Hybrid' : 'Lexical + Recency + Poignancy Hybrid'}
            {llmInfo?.usageToday && (
              <>
                {' '}
                · Server Calls Today: {llmInfo.usageToday.count}/{llmInfo.usageToday.maxCallsPerDay}
              </>
            )}
          </p>
        </div>

        {/* World Portability: Export & Import JSON */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={onExportWorld}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3 py-1.5 text-xs font-medium text-[#1D2420] hover:bg-[#EFECE3] transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
            <span>Export world</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3 py-1.5 text-xs font-medium text-[#1D2420] hover:bg-[#EFECE3] transition-colors whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
            <span>Import world</span>
          </button>
        </div>
      </div>

      {importFeedback && (
        <p className="text-xs font-medium text-[#1B4332]">{importFeedback}</p>
      )}

      {/* OpenRouter :free Warning Notice */}
      {llmInfo?.limits?.freeModelDailyCap && (
        <section
          data-testid="free-model-warning"
          className="rounded-lg border border-[#D97706]/40 bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E] flex items-start gap-2.5"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              OpenRouter Free Endpoint Active ({llmInfo.model})
            </p>
            <p className="mt-0.5 leading-relaxed">
              Free-tier endpoints are limited to <span className="font-mono font-medium">20 requests/min</span> and <span className="font-mono font-medium">{llmInfo.limits.freeModelDailyCap} requests/day</span> ({llmInfo.limits.freeModelPaidCreditCap}/day after purchasing at least 10 credits on OpenRouter). Note that free NVIDIA endpoints on OpenRouter may log prompts; use <span className="font-mono">Thrifty</span> or <span className="font-mono">GEMINI_API_KEY</span> for higher privacy and daily headroom.
            </p>
          </div>
        </section>
      )}

      {/* Cognition Scheduler Settings & Live Telemetry */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFECE4] pb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Cognition Scheduler &amp; Budget Controls
            </h2>
            <p className="text-xs text-[#5C645E]">
              Controls parallel model lanes, per-minute pacing, per-resident daily fairness, and automatic time dilation while thinking.
            </p>
          </div>
          <div className="font-mono text-xs text-[#3C4640] tabular-nums">
            Queue: {schedulerState.queue.length} · In flight: {schedulerState.inFlight.length}/
            {schedulerState.config.maxConcurrent} · Today: {schedulerState.callsToday}
            {schedulerState.config.maxCallsPerSimDay ? `/${schedulerState.config.maxCallsPerSimDay}` : ''} calls
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-5">
          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Budget Preset</span>
            <select
              aria-label="Scheduler budget preset"
              value={schedulerState.config.preset}
              onChange={(e) => handlePresetChange(e.target.value as BudgetPreset)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-3 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="thrifty">Thrifty (~150 calls/day)</option>
              <option value="balanced">Balanced (~420 calls/day)</option>
              <option value="research">Research (~600 calls/day)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Max Concurrent</span>
            <input
              type="number"
              min={1}
              max={6}
              value={schedulerState.config.maxConcurrent}
              onChange={(e) =>
                onUpdateSchedulerConfig({
                  ...schedulerState.config,
                  maxConcurrent: Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                })
              }
              className="w-24 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Calls / Minute</span>
            <input
              type="number"
              min={4}
              max={60}
              value={schedulerState.config.maxCallsPerMinute}
              onChange={(e) =>
                onUpdateSchedulerConfig({
                  ...schedulerState.config,
                  maxCallsPerMinute: Math.max(4, Math.min(60, Number(e.target.value) || 10)),
                })
              }
              className="w-24 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            />
          </label>

          <label className="flex items-center gap-2 py-1.5 text-xs text-[#1D2420] cursor-pointer">
            <input
              type="checkbox"
              checked={schedulerState.config.timeDilation}
              onChange={(e) =>
                onUpdateSchedulerConfig({
                  ...schedulerState.config,
                  timeDilation: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border-[#D5D0C3] accent-[#2D6A4F]"
            />
            <span>Slow sim clock while residents think (time dilation)</span>
          </label>
        </div>

        {/* Rate-limit pauses & Recent Failures */}
        {(pausedEntries.length > 0 || schedulerState.recentFailures.length > 0) && (
          <div className="border-t border-[#EFECE4] pt-3 space-y-2 text-xs">
            {pausedEntries.map(([kind, until]) => (
              <div
                key={kind}
                className="rounded border border-[#D97706]/30 bg-[#FFFBEB] px-3 py-1.5 text-[#92400E] font-mono"
              >
                Rate-limited pause on <span className="font-semibold">{kind}</span>: resuming in{' '}
                {Math.max(1, Math.ceil(((until ?? 0) - nowMs) / 1000))}s
              </div>
            ))}

            {schedulerState.recentFailures.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#5C645E]">
                  Recent Scheduler Failures ({schedulerState.recentFailures.length})
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {schedulerState.recentFailures.slice(0, 6).map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#FAF8F4] px-2.5 py-1 text-[11px] text-[#3C4640]"
                    >
                      <span>
                        <span className="font-mono font-semibold text-[#991B1B]">{f.kind}</span>{' '}
                        ({f.agentIds.join(', ')}) attempt {f.attempts}: {f.error}
                      </span>
                      <span className="font-mono text-[#5C645E]">
                        {formatSimTime(f.atSimMin).fullLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Dedicated Cognition Queue, Telemetry & Token Cost Estimator Panel */}
      <CognitionPanel
        world={world}
        schedulerState={schedulerState}
        dilationRate={dilationRate}
        serverMetrics={serverMetrics}
        tokenPrices={tokenPrices}
        onChangeTokenPrices={onChangeTokenPrices}
      />

      {/* Live Aggregate Simulation Counts */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-b border-[#E2DFD5] pb-6">
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Active Residents</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {world.agents.length}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Memories / Embedded</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {totalMemories} / {embeddedMemories}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Reflections &amp; Sleep</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {totalReflections}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Dialogues / ToM Edges</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {world.conversations.length} / {totalSocialEdges}
          </dd>
        </div>
      </dl>

      {/* Six Research Mechanisms */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            01. Hybrid Dense-Vector Memory &amp; Novelty Scoring
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            Every observation, reflection, plan, and sleep consolidation carries a timestamp and poignancy score (1–10) dynamically weighted by contextual novelty vs. recent memories. Dense <span className="font-mono">gemini-embedding-2</span> vectors persist in IndexedDB while world snapshots save per-browser in IndexedDB:
          </p>
          <div className="rounded-md bg-[#F6F4EE] px-3 py-2 font-mono text-xs text-[#1D2420]">
            score = 1.0·Recency(0.995^Δh) + 1.0·Importance + 1.0·Relevance(cosine)
          </div>
        </article>

        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            02. Reflection &amp; Nightly Sleep Consolidation
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            When accumulated poignancy hits {world.reflectionThreshold}, 2-step reflection synthesizes cited insights across retrieved memory pools (throttled to at most 3 per day). Between 22:30 and 03:00, Sleep Consolidation runs across all residents and feeds Day 2+ morning re-planning.
          </p>
        </article>

        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            03. Homeostatic Drives, Weather &amp; PAD Affect
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            Residents track Energy, Hunger, Social, and Purpose alongside Russell’s Valence–Arousal mood and natural valley weather rhythms ({world.weather ?? 'clear'}). Critical hunger routes autonomously to the nearest open cafe or bakery via A*, while System-1 gating filters passing nods from deep dialogues.
          </p>
        </article>

        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            04. Sandboxed Conversations &amp; Theory of Mind
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            Conversations lock partners in face-to-face alignment while isolated per-speaker turns execute, and stamp results at conversation start + turns × 1.5 sim minutes with zero telepathic context leakage.
          </p>
        </article>

        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            05. Three-District {world.mapWidth}×{world.mapHeight} A* Town Topology
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            Hourly blocks decompose into progressive micro-actions while {world.agents.length} residents navigate {world.locations.length} buildings across North Ridge, Main Street, and Southside Creek smoothly via A*.
          </p>
        </article>

        <article className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-2">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            06. Delta Room Perception &amp; {world.objects.length} Persistent Props
          </h2>
          <p className="text-xs leading-relaxed text-[#3C4640]">
            Interactive props (bakery hearth, library oak archives, workshop benches, clinic bay, espresso counter, piano, easel) leave persistent traces after use, and delta perception scores room novelty dynamically.
          </p>
        </article>
      </div>
    </div>
  );
}
