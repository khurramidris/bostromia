import {
  CheckCircle2,
  Download,
  FlaskConical,
  MessageSquareText,
  Play,
  RotateCcw,
  Scale,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BudgetPreset } from '../simulation/cognitionScheduler';
import {
  runHeadless,
  type AwarenessTimelineSample,
  type HeadlessOptions,
  type HeadlessResult,
} from '../simulation/headless';
import type {
  HeadlessWorkerError,
  HeadlessWorkerRequest,
  HeadlessWorkerResponse,
} from '../simulation/headless.worker';
import {
  answerInterviewRuleBased,
  INTERVIEW_BATTERY,
  PAPER_BENCHMARKS,
  type InterviewGroup,
  type InterviewSavedAnswer,
} from '../simulation/paperExperiment';
import {
  DEFAULT_ABLATIONS,
  type AblationSettings,
  type ScenarioId,
  type WorldState,
} from '../simulation/types';

interface ExperimentsViewProps {
  world: WorldState;
  llmConfigured: boolean | null;
  onResetScenario: (scenarioId: ScenarioId, ablations?: AblationSettings) => void;
  onToggleAblation: (key: keyof AblationSettings, enabled: boolean) => void;
  onInterviewAgent: (
    agentId: string,
    question: string,
  ) => Promise<{ answer: string; citedMemoryIds: string[] } | null>;
  onJudgeInterview: (
    agentId: string,
    question: string,
    answer: string,
    targetWorld?: WorldState,
  ) => Promise<{ score: number; rationale: string } | null>;
  onSelectAgentAndMap: (agentId: string) => void;
}

const ABLATION_LABELS: Array<{ key: keyof AblationSettings; label: string; desc: string }> = [
  {
    key: 'noReflection',
    label: 'No Reflection',
    desc: 'Disables higher-order reflection triggers and insight generation.',
  },
  {
    key: 'noPlanning',
    label: 'No Planning / Reactions',
    desc: 'Disables LLM morning planning and schedule reactions (baseline seed blocks only).',
  },
  {
    key: 'noMemoryRetrieval',
    label: 'No Weighted Retrieval',
    desc: 'Replaces recency+importance+relevance scoring with recent-10 memory slicing.',
  },
  {
    key: 'noSystem2Gate',
    label: 'No System-2 Gate',
    desc: 'Allows trivial passing encounters to escalate directly without salience filtering.',
  },
];

function executeHeadlessInWorker(options: HeadlessOptions): Promise<HeadlessResult> {
  return new Promise((resolve, reject) => {
    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(
          new URL('../simulation/headless.worker.ts', import.meta.url),
          { type: 'module' },
        );
        worker.onmessage = (ev: MessageEvent<HeadlessWorkerResponse | HeadlessWorkerError>) => {
          worker.terminate();
          if (ev.data.ok) {
            resolve(ev.data.result);
          } else {
            reject(new Error(ev.data.error));
          }
        };
        worker.onerror = () => {
          worker.terminate();
          setTimeout(() => {
            try {
              resolve(runHeadless(options));
            } catch (innerErr) {
              reject(innerErr);
            }
          }, 0);
        };
        const req: HeadlessWorkerRequest = { id: 1, options };
        worker.postMessage(req);
        return;
      } catch {
        // Fall through to async timeout fallback
      }
    }
    setTimeout(() => {
      try {
        resolve(runHeadless(options));
      } catch (err) {
        reject(err);
      }
    }, 0);
  });
}

function buildPolylinePoints(
  samples: AwarenessTimelineSample[],
  getValue: (s: AwarenessTimelineSample) => number,
  maxY: number,
  width: number,
  height: number,
  padLeft: number,
  padTop: number,
  padRight: number,
  padBottom: number,
): string {
  if (samples.length === 0) return '';
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  return samples
    .map((s, idx) => {
      const x =
        samples.length === 1
          ? padLeft + innerW / 2
          : padLeft + (idx / (samples.length - 1)) * innerW;
      const clamped = Math.max(0, Math.min(maxY, getValue(s)));
      const y = padTop + innerH - (clamped / maxY) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function computeLiveDensity(world: WorldState): number {
  const edges = new Set<string>();
  for (const ag of world.agents) {
    for (const [targetId, edge] of Object.entries(ag.socialGraph)) {
      if (edge.familiarity >= 45) {
        const key = ag.id < targetId ? `${ag.id}:${targetId}` : `${targetId}:${ag.id}`;
        edges.add(key);
      }
    }
  }
  const n = world.agents.length;
  if (n < 2) return 0;
  return Number((edges.size / ((n * (n - 1)) / 2)).toFixed(3));
}

export function ExperimentsView({
  world,
  llmConfigured,
  onResetScenario,
  onToggleAblation,
  onInterviewAgent,
  onJudgeInterview,
  onSelectAgentAndMap,
}: ExperimentsViewProps) {
  // Experiment Runner Config
  const [expDays, setExpDays] = useState<number>(2);
  const [expSpeed, setExpSpeed] = useState<1 | 2 | 5>(2);
  const [expPreset, setExpPreset] = useState<BudgetPreset>('balanced');
  const [expScenario, setExpScenario] = useState<ScenarioId>('paper_valentine');
  const [isRunningExp, setIsRunningExp] = useState<boolean>(false);
  const [expError, setExpError] = useState<string | null>(null);
  const [expResult, setExpResult] = useState<HeadlessResult | null>(null);
  const [ablationComparison, setAblationComparison] = useState<{
    baseline: HeadlessResult;
    ablated: HeadlessResult;
  } | null>(null);

  // 25-Question Battery State
  const [batteryAgentId, setBatteryAgentId] = useState<string>('maria');
  const [batteryGroup, setBatteryGroup] = useState<'all' | InterviewGroup>('all');
  const [batteryWorldSource, setBatteryWorldSource] = useState<'live' | 'experiment'>('live');
  const [savedAnswers, setSavedAnswers] = useState<Record<string, InterviewSavedAnswer>>({});
  const [ablatedAnswers, setAblatedAnswers] = useState<Record<string, InterviewSavedAnswer>>({});
  const [askingQId, setAskingQId] = useState<string | null>(null);
  const [judgingQId, setJudgingQId] = useState<string | null>(null);

  const liveAblations: AblationSettings = {
    ...DEFAULT_ABLATIONS,
    ...(world.ablations ?? {}),
  };

  const livePartyMeme = world.memes.find((m) => m.id === 'meme_valentine_party');
  const liveMayorMeme = world.memes.find((m) => m.id === 'meme_mayor_race');
  const livePartyPct = livePartyMeme
    ? Number(
        (
          (Object.keys(livePartyMeme.knownBy).length / Math.max(1, world.agents.length)) *
          100
        ).toFixed(1),
      )
    : 0;
  const liveMayorPct = liveMayorMeme
    ? Number(
        (
          (Object.keys(liveMayorMeme.knownBy).length / Math.max(1, world.agents.length)) *
          100
        ).toFixed(1),
      )
    : 0;
  const liveDensity = useMemo(() => computeLiveDensity(world), [world]);

  const targetBatteryWorld =
    batteryWorldSource === 'experiment' && expResult ? expResult.endOfRun.finalWorld : world;
  const targetBatteryAgent =
    targetBatteryWorld.agents.find((a) => a.id === batteryAgentId) ?? targetBatteryWorld.agents[0];

  const visibleQuestions = useMemo(
    () =>
      batteryGroup === 'all'
        ? INTERVIEW_BATTERY
        : INTERVIEW_BATTERY.filter((q) => q.group === batteryGroup),
    [batteryGroup],
  );

  const handleRunExperiment = async () => {
    setIsRunningExp(true);
    setExpError(null);
    try {
      const clampedDays = Math.max(1, Math.min(4, Number(expDays) || 2));
      const res = await executeHeadlessInWorker({
        days: clampedDays,
        speed: expSpeed,
        latencyMs: 3500,
        mode: 'scheduler',
        preset: expPreset,
        scenario: expScenario,
        ablations: liveAblations,
        seed: 42,
      });
      setExpResult(res);
      setBatteryWorldSource('experiment');
    } catch (err) {
      setExpError(err instanceof Error ? err.message : 'Experiment run failed.');
    } finally {
      setIsRunningExp(false);
    }
  };

  const handleCompareAblation = async () => {
    setIsRunningExp(true);
    setExpError(null);
    const hasAnyLiveAblation = Object.values(liveAblations).some(Boolean);
    const targetAblations: AblationSettings = hasAnyLiveAblation
      ? liveAblations
      : { ...DEFAULT_ABLATIONS, noReflection: true };

    try {
      const clampedDays = Math.max(1, Math.min(4, Number(expDays) || 2));
      const baseline = await executeHeadlessInWorker({
        days: clampedDays,
        speed: 2,
        latencyMs: 3000,
        mode: 'scheduler',
        preset: expPreset,
        scenario: expScenario,
        ablations: DEFAULT_ABLATIONS,
        seed: 42,
      });
      const ablated = await executeHeadlessInWorker({
        days: clampedDays,
        speed: 2,
        latencyMs: 3000,
        mode: 'scheduler',
        preset: expPreset,
        scenario: expScenario,
        ablations: targetAblations,
        seed: 42,
      });
      setExpResult(baseline);
      setAblationComparison({ baseline, ablated });
      setBatteryWorldSource('experiment');
    } catch (err) {
      setExpError(err instanceof Error ? err.message : 'Ablation comparison failed.');
    } finally {
      setIsRunningExp(false);
    }
  };

  const handleExportRunJson = () => {
    if (!expResult) return;
    const blob = new Blob([JSON.stringify(expResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `smallville-${expResult.scenarioId}-${expResult.options.days}d.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleRunOfflineBattery = () => {
    if (!targetBatteryAgent) return;
    const next: Record<string, InterviewSavedAnswer> = {};
    for (const spec of INTERVIEW_BATTERY) {
      next[spec.id] = answerInterviewRuleBased(targetBatteryWorld, targetBatteryAgent, spec);
    }
    setSavedAnswers(next);

    if (ablationComparison) {
      const ablatedAg =
        ablationComparison.ablated.endOfRun.finalWorld.agents.find(
          (a) => a.id === targetBatteryAgent.id,
        ) ?? ablationComparison.ablated.endOfRun.finalWorld.agents[0];
      if (ablatedAg) {
        const ablNext: Record<string, InterviewSavedAnswer> = {};
        for (const spec of INTERVIEW_BATTERY) {
          ablNext[spec.id] = answerInterviewRuleBased(
            ablationComparison.ablated.endOfRun.finalWorld,
            ablatedAg,
            spec,
          );
        }
        setAblatedAnswers(ablNext);
      }
    } else {
      setAblatedAnswers({});
    }
  };

  const handleAskLiveLlm = async (specId: string, question: string) => {
    if (!targetBatteryAgent) return;
    setAskingQId(specId);
    try {
      const res = await onInterviewAgent(targetBatteryAgent.id, question);
      if (res) {
        const spec = INTERVIEW_BATTERY.find((q) => q.id === specId)!;
        setSavedAnswers((prev) => ({
          ...prev,
          [specId]: {
            questionId: specId,
            group: spec.group,
            question,
            answer: res.answer,
            citedMemoryIds: res.citedMemoryIds,
          },
        }));
      }
    } finally {
      setAskingQId(null);
    }
  };

  const handleJudgeAnswer = async (specId: string) => {
    const saved = savedAnswers[specId];
    if (!saved || !targetBatteryAgent) return;
    setJudgingQId(specId);
    try {
      const verdict = await onJudgeInterview(
        targetBatteryAgent.id,
        saved.question,
        saved.answer,
        targetBatteryWorld,
      );
      if (verdict) {
        setSavedAnswers((prev) => ({
          ...prev,
          [specId]: {
            ...prev[specId],
            score: verdict.score,
            judgeRationale: verdict.rationale,
          },
        }));
      }
    } finally {
      setJudgingQId(null);
    }
  };

  // Chart geometry constants
  const chartW = 540;
  const chartH = 210;
  const padL = 40;
  const padT = 16;
  const padR = 16;
  const padB = 28;
  const innerH = chartH - padT - padB;
  const samples = expResult?.awarenessTimeline ?? [];

  const partyLineYTarget =
    padT + innerH - (PAPER_BENCHMARKS.valentinePartyAwarenessPct / 100) * innerH;
  const mayorLineYTarget =
    padT + innerH - (PAPER_BENCHMARKS.mayorRaceAwarenessPct / 100) * innerH;
  const densityStartYTarget = padT + innerH - PAPER_BENCHMARKS.networkDensityStart * innerH;
  const densityEndYTarget = padT + innerH - PAPER_BENCHMARKS.networkDensityEnd * innerH;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-8">
      {/* Header */}
      <div className="border-b border-[#E2DFD5] pb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#1D2420]">
            Experiments, Paper Benchmarks &amp; Ablations
          </h1>
          <p className="mt-1 text-sm text-[#5C645E] max-w-3xl">
            Replicate the Park et al. (2023) Valentine’s Day party &amp; mayoral information diffusion study, toggle architectural ablations, and evaluate residents on the 25-question interview battery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onResetScenario('default', DEFAULT_ABLATIONS)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              (world.scenarioId ?? 'default') === 'default'
                ? 'border-[#2D6A4F] bg-[#EAF2ED] text-[#1B4332]'
                : 'border-[#D5D0C3] bg-white text-[#2F3833] hover:bg-[#EFECE3]'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Live: Standard Town</span>
          </button>
          <button
            type="button"
            onClick={() => onResetScenario('paper_valentine', DEFAULT_ABLATIONS)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              world.scenarioId === 'paper_valentine'
                ? 'border-[#2D6A4F] bg-[#EAF2ED] text-[#1B4332]'
                : 'border-[#D5D0C3] bg-white text-[#2F3833] hover:bg-[#EFECE3]'
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Live: Valentine Paper Scenario</span>
          </button>
        </div>
      </div>

      {/* Live Scenario Telemetry & Architectural Ablation Switches */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE4] pb-2.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Live World Emergence Snapshot
            </h2>
            <span className="font-mono text-[11px] text-[#5C645E]">
              {world.scenarioId === 'paper_valentine' ? 'paper_valentine' : 'default'}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2">
              <dt className="text-[11px] text-[#5C645E]">Party Awareness</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                {livePartyPct}%
                <span className="ml-1 text-[11px] font-normal text-[#5C645E]">
                  / {PAPER_BENCHMARKS.valentinePartyAwarenessPct}%
                </span>
              </dd>
            </div>
            <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2">
              <dt className="text-[11px] text-[#5C645E]">Mayor Awareness</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                {liveMayorPct}%
                <span className="ml-1 text-[11px] font-normal text-[#5C645E]">
                  / {PAPER_BENCHMARKS.mayorRaceAwarenessPct}%
                </span>
              </dd>
            </div>
            <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2">
              <dt className="text-[11px] text-[#5C645E]">Social Density</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                {liveDensity.toFixed(3)}
              </dd>
            </div>
            <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2">
              <dt className="text-[11px] text-[#5C645E]">Party Funnel</dt>
              <dd className="mt-0.5 font-mono text-xs font-semibold text-[#1D2420] tabular-nums">
                Inv {world.partyStats?.invitedAgentIds.length ?? 0} · Agr{' '}
                {world.partyStats?.agreedAgentIds.length ?? 0} · Att{' '}
                {world.partyStats?.attendedDecisionIds.length ?? 0}
              </dd>
            </div>
          </dl>
        </div>

        <div className="lg:col-span-7 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE4] pb-2.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Architectural Ablations
            </h2>
            <span className="text-[11px] text-[#5C645E]">
              Applies immediately to both live town &amp; headless experiment runner
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {ABLATION_LABELS.map((item) => {
              const checked = liveAblations[item.key];
              return (
                <label
                  key={item.key}
                  className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors ${
                    checked
                      ? 'border-[#B45309]/40 bg-[#FFFBEB]'
                      : 'border-[#E5E2D9] bg-[#FAF8F4]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onToggleAblation(item.key, e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#D5D0C3] accent-[#2D6A4F]"
                  />
                  <span>
                    <span className="block font-semibold text-[#1D2420]">{item.label}</span>
                    <span className="block text-[11px] text-[#5C645E] leading-snug">
                      {item.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      {/* Headless Experiment Runner */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Scenario</span>
            <select
              aria-label="Experiment scenario"
              value={expScenario}
              onChange={(e) => setExpScenario(e.target.value as ScenarioId)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="paper_valentine">Valentine’s Party (Paper)</option>
              <option value="default">Standard Smallville</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Days (1–4)</span>
            <input
              type="number"
              min={1}
              max={4}
              value={expDays}
              onChange={(e) => setExpDays(Math.max(1, Math.min(4, Number(e.target.value) || 2)))}
              className="w-20 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Speed</span>
            <select
              aria-label="Experiment speed"
              value={expSpeed}
              onChange={(e) => setExpSpeed(Number(e.target.value) as 1 | 2 | 5)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={5}>5×</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Budget Preset</span>
            <select
              aria-label="Experiment budget preset"
              value={expPreset}
              onChange={(e) => setExpPreset(e.target.value as BudgetPreset)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="thrifty">Thrifty</option>
              <option value="balanced">Balanced</option>
              <option value="research">Research</option>
            </select>
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {expResult && (
              <button
                type="button"
                onClick={handleExportRunJson}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3 py-2 text-xs font-medium text-[#1D2420] hover:bg-[#EFECE3] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                <span>Export Run JSON</span>
              </button>
            )}
            <button
              type="button"
              disabled={isRunningExp}
              onClick={handleCompareAblation}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3 py-2 text-xs font-semibold text-[#1D2420] hover:bg-[#EFECE3] disabled:opacity-50 whitespace-nowrap"
            >
              <Scale className="h-3.5 w-3.5 text-[#B45309]" aria-hidden="true" />
              <span>Compare Full vs Ablated</span>
            </button>
            <button
              type="button"
              disabled={isRunningExp}
              onClick={handleRunExperiment}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2D6A4F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#23533D] disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isRunningExp ? 'Running experiment…' : 'Run Experiment'}</span>
            </button>
          </div>
        </div>

        {expError && (
          <p className="text-xs text-[#991B1B]" role="alert">
            {expError}
          </p>
        )}

        {expResult && (
          <div className="space-y-6 border-t border-[#EFECE4] pt-4" data-testid="experiment-results">
            {/* Dual SVG Charts */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-[#E5E2D9] bg-[#FAF8F4] p-4 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#1D2420]">
                    Information Diffusion vs Park et al. Benchmark (%)
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-[#5C645E]">
                    <span className="text-[#2D6A4F]">● Party Awareness</span>
                    <span className="text-[#B45309]">● Mayor Race</span>
                  </div>
                </div>
                <svg
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  role="img"
                  aria-label="Awareness percentage over time compared to Park et al. benchmark"
                  className="w-full h-auto"
                >
                  {[0, 25, 50, 75, 100].map((tick) => {
                    const y = padT + innerH - (tick / 100) * innerH;
                    return (
                      <g key={tick}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={chartW - padR}
                          y2={y}
                          stroke="#E5E2D9"
                          strokeWidth={1}
                        />
                        <text
                          x={padL - 6}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#5C645E"
                          fontFamily="monospace"
                        >
                          {tick}%
                        </text>
                      </g>
                    );
                  })}
                  {/* Park et al. target dashed references */}
                  <line
                    x1={padL}
                    y1={partyLineYTarget}
                    x2={chartW - padR}
                    y2={partyLineYTarget}
                    stroke="#2D6A4F"
                    strokeDasharray="4 3"
                    strokeOpacity={0.55}
                  />
                  <line
                    x1={padL}
                    y1={mayorLineYTarget}
                    x2={chartW - padR}
                    y2={mayorLineYTarget}
                    stroke="#B45309"
                    strokeDasharray="4 3"
                    strokeOpacity={0.55}
                  />
                  <polyline
                    fill="none"
                    stroke="#2D6A4F"
                    strokeWidth={2.2}
                    points={buildPolylinePoints(
                      samples,
                      (s) => s.partyAwarenessPct,
                      100,
                      chartW,
                      chartH,
                      padL,
                      padT,
                      padR,
                      padB,
                    )}
                  />
                  <polyline
                    fill="none"
                    stroke="#B45309"
                    strokeWidth={2}
                    points={buildPolylinePoints(
                      samples,
                      (s) => s.mayorAwarenessPct,
                      100,
                      chartW,
                      chartH,
                      padL,
                      padT,
                      padR,
                      padB,
                    )}
                  />
                  {samples.length > 0 && (
                    <>
                      <text x={padL} y={chartH - 8} fontSize="9" fill="#5C645E" fontFamily="monospace">
                        {samples[0].label}
                      </text>
                      <text
                        x={chartW - padR}
                        y={chartH - 8}
                        textAnchor="end"
                        fontSize="9"
                        fill="#5C645E"
                        fontFamily="monospace"
                      >
                        {samples[samples.length - 1].label}
                      </text>
                    </>
                  )}
                </svg>
              </div>

              <div className="rounded-lg border border-[#E5E2D9] bg-[#FAF8F4] p-4 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#1D2420]">
                    Social Network Density 2|E| / (|V|(|V|−1))
                  </h3>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-[#5C645E]">
                    <span>Start target 0.167 · End target 0.74</span>
                  </div>
                </div>
                <svg
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  role="img"
                  aria-label="Network density trajectory"
                  className="w-full h-auto"
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                    const y = padT + innerH - tick * innerH;
                    return (
                      <g key={tick}>
                        <line
                          x1={padL}
                          y1={y}
                          x2={chartW - padR}
                          y2={y}
                          stroke="#E5E2D9"
                          strokeWidth={1}
                        />
                        <text
                          x={padL - 6}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#5C645E"
                          fontFamily="monospace"
                        >
                          {tick.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}
                  <line
                    x1={padL}
                    y1={densityStartYTarget}
                    x2={chartW - padR}
                    y2={densityStartYTarget}
                    stroke="#5C645E"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                  <line
                    x1={padL}
                    y1={densityEndYTarget}
                    x2={chartW - padR}
                    y2={densityEndYTarget}
                    stroke="#1B4332"
                    strokeDasharray="4 3"
                    strokeOpacity={0.55}
                  />
                  <polyline
                    fill="none"
                    stroke="#1B4332"
                    strokeWidth={2.2}
                    points={buildPolylinePoints(
                      samples,
                      (s) => s.networkDensity,
                      1,
                      chartW,
                      chartH,
                      padL,
                      padT,
                      padR,
                      padB,
                    )}
                  />
                  {samples.length > 0 && (
                    <>
                      <text x={padL} y={chartH - 8} fontSize="9" fill="#5C645E" fontFamily="monospace">
                        {samples[0].label}
                      </text>
                      <text
                        x={chartW - padR}
                        y={chartH - 8}
                        textAnchor="end"
                        fontSize="9"
                        fill="#5C645E"
                        fontFamily="monospace"
                      >
                        {samples[samples.length - 1].label}
                      </text>
                    </>
                  )}
                </svg>
              </div>
            </div>

            {/* Party Funnel & Summary Metrics */}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">Origin / Invited</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                  {expResult.endOfRun.partySummary.originCount} →{' '}
                  {expResult.endOfRun.partySummary.invitedCount}
                </dd>
              </div>
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">Agreed / Planned</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                  {expResult.endOfRun.partySummary.agreedCount} /{' '}
                  {expResult.endOfRun.partySummary.plannedAfterNewsCount}
                </dd>
              </div>
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">Attended (≥20m / 5 target)</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#2D6A4F] tabular-nums">
                  {expResult.endOfRun.partySummary.attendedDecisionCount}
                  <span className="ml-1 text-[11px] font-normal text-[#5C645E]">
                    (raw {expResult.endOfRun.partySummary.attendedRawCount})
                  </span>
                </dd>
              </div>
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">Network Density</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                  {expResult.endOfRun.initialNetworkDensity.toFixed(2)} →{' '}
                  {expResult.endOfRun.finalNetworkDensity.toFixed(2)}
                </dd>
              </div>
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">LLM Calls Made</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                  {expResult.endOfRun.llmCallsTotal}
                </dd>
              </div>
              <div className="rounded border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
                <dt className="text-[11px] text-[#5C645E]">Est. Tokens</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
                  {expResult.endOfRun.tokensEstimated.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Side-by-Side Ablation Comparison Table */}
        {ablationComparison && (
          <div className="overflow-x-auto border-t border-[#EFECE4] pt-4">
            <h3 className="text-xs font-semibold text-[#1D2420] mb-2">
              Controlled Ablation Comparison (Full Agent vs Ablated)
            </h3>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E5E2D9] bg-[#FAF8F4] text-[#5C645E]">
                <tr>
                  <th className="px-3 py-2 font-medium">Condition</th>
                  <th className="px-3 py-2 font-medium">Party Awareness</th>
                  <th className="px-3 py-2 font-medium">Mayor Awareness</th>
                  <th className="px-3 py-2 font-medium">Attended</th>
                  <th className="px-3 py-2 font-medium">Final Density</th>
                  <th className="px-3 py-2 font-medium">Reflections</th>
                  <th className="px-3 py-2 font-medium">Conversations</th>
                  <th className="px-3 py-2 font-medium">LLM Calls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] font-mono tabular-nums text-[#1D2420]">
                {[
                  { label: 'Full Architecture (Baseline)', res: ablationComparison.baseline },
                  {
                    label: `Ablated (${
                      Object.entries(ablationComparison.ablated.ablations)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(', ') || 'none'
                    })`,
                    res: ablationComparison.ablated,
                  },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 font-sans font-medium">{row.label}</td>
                    <td className="px-3 py-2">{row.res.endOfRun.paperComparison.partyAwarenessPct}%</td>
                    <td className="px-3 py-2">{row.res.endOfRun.paperComparison.mayorAwarenessPct}%</td>
                    <td className="px-3 py-2">{row.res.endOfRun.partySummary.attendedDecisionCount}</td>
                    <td className="px-3 py-2">{row.res.endOfRun.finalNetworkDensity.toFixed(3)}</td>
                    <td className="px-3 py-2">{row.res.endOfRun.reflectionsTotal}</td>
                    <td className="px-3 py-2">
                      {row.res.perDay.reduce((s, d) => s + d.conversations, 0)}
                    </td>
                    <td className="px-3 py-2">{row.res.endOfRun.llmCallsTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 25-Question Interview Battery */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
        <div className="flex flex-col gap-3 border-b border-[#EFECE4] pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1D2420]">
              25-Question Interview Battery (Park et al., 5 Cognitive Categories)
            </h2>
            <p className="text-xs text-[#5C645E]">
              Probe Self-Knowledge, Memory, Plans, Reactions, and Reflections offline or via live LLM, with optional 1–5 believability rubric judging.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              aria-label="Battery resident"
              value={targetBatteryAgent?.id ?? 'maria'}
              onChange={(e) => setBatteryAgentId(e.target.value)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              {targetBatteryWorld.agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Battery source world"
              value={batteryWorldSource}
              onChange={(e) => setBatteryWorldSource(e.target.value as 'live' | 'experiment')}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="live">Live Town State</option>
              <option value="experiment" disabled={!expResult}>
                {expResult ? 'Last Experiment World' : 'Experiment World (run first)'}
              </option>
            </select>

            <button
              type="button"
              onClick={handleRunOfflineBattery}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2D6A4F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#23533D] whitespace-nowrap"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Run Offline 25-Q Battery</span>
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div
          role="group"
          aria-label="Interview category filter"
          className="flex flex-wrap items-center gap-1 rounded-md border border-[#DEDAD0] bg-[#F2EFE7] p-0.5"
        >
          {(
            [
              { id: 'all', label: 'All (25)' },
              { id: 'self_knowledge', label: 'Self-Knowledge (5)' },
              { id: 'memory', label: 'Memory (5)' },
              { id: 'plans', label: 'Plans (5)' },
              { id: 'reactions', label: 'Reactions (5)' },
              { id: 'reflections', label: 'Reflections (5)' },
            ] as const
          ).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setBatteryGroup(g.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                batteryGroup === g.id
                  ? 'bg-white text-[#1D2420] shadow-xs'
                  : 'text-[#5C645E] hover:text-[#1D2420]'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Question List */}
        <div className="space-y-2.5">
          {visibleQuestions.map((spec, idx) => {
            const saved = savedAnswers[spec.id];
            const ablated = ablatedAnswers[spec.id];
            return (
              <article
                key={spec.id}
                className="rounded-lg border border-[#E5E2D9] bg-[#FAF8F4] p-3.5 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] text-[#5C645E]">
                      #{idx + 1} · {spec.groupLabel} · {spec.id}
                    </span>
                    <h3 className="mt-0.5 text-xs font-semibold text-[#1D2420]">{spec.question}</h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {llmConfigured && batteryWorldSource === 'live' && targetBatteryAgent && (
                      <button
                        type="button"
                        disabled={askingQId === spec.id}
                        onClick={() => handleAskLiveLlm(spec.id, spec.question)}
                        className="inline-flex items-center gap-1 rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] font-medium text-[#2D6A4F] hover:bg-[#EAF2ED] disabled:opacity-50 whitespace-nowrap"
                      >
                        <MessageSquareText className="h-3 w-3" aria-hidden="true" />
                        <span>{askingQId === spec.id ? 'Asking…' : 'Ask via LLM'}</span>
                      </button>
                    )}
                    {llmConfigured && saved && (
                      <button
                        type="button"
                        disabled={judgingQId === spec.id}
                        onClick={() => handleJudgeAnswer(spec.id)}
                        className="inline-flex items-center gap-1 rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] font-medium text-[#1D2420] hover:bg-[#EFECE3] disabled:opacity-50 whitespace-nowrap"
                      >
                        <Scale className="h-3 w-3 text-[#B45309]" aria-hidden="true" />
                        <span>
                          {judgingQId === spec.id
                            ? 'Judging…'
                            : saved.score !== undefined
                              ? `Score ${saved.score}/5`
                              : 'Judge (1–5)'}
                        </span>
                      </button>
                    )}
                    {targetBatteryAgent && (
                      <button
                        type="button"
                        onClick={() => onSelectAgentAndMap(targetBatteryAgent.id)}
                        className="text-[11px] text-[#5C645E] hover:text-[#2D6A4F] hover:underline whitespace-nowrap"
                      >
                        Inspect
                      </button>
                    )}
                  </div>
                </div>

                {saved && (
                  <div className="rounded border border-[#E5E2D9] bg-white p-2.5 space-y-1">
                    <p className="text-[#1D2420] leading-relaxed">
                      <span className="font-semibold">{targetBatteryAgent?.name.split(' ')[0]}:</span>{' '}
                      {saved.answer}
                    </p>
                    {saved.citedMemoryIds.length > 0 && (
                      <p className="font-mono text-[10px] text-[#5C645E]">
                        Cited IDs: {saved.citedMemoryIds.join(', ')}
                      </p>
                    )}
                    {saved.judgeRationale && (
                      <p className="text-[11px] text-[#1B4332] border-t border-[#EFECE4] pt-1">
                        Rubric {saved.score}/5: {saved.judgeRationale}
                      </p>
                    )}
                    {ablated && (
                      <p className="text-[11px] text-[#92400E] border-t border-[#EFECE4] pt-1">
                        <span className="font-semibold">Ablated condition:</span> {ablated.answer}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
