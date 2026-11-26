import { Check, CloudDownload, CloudUpload, Copy, Play, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BudgetPreset } from '../simulation/cognitionScheduler';
import {
  computeDiversitySnapshot,
  getCollapseDiagnosticLabel,
} from '../simulation/diversityMetrics';
import {
  runHeadless,
  type HeadlessMode,
  type HeadlessOptions,
  type HeadlessResult,
} from '../simulation/headless';
import type {
  HeadlessWorkerError,
  HeadlessWorkerRequest,
  HeadlessWorkerResponse,
} from '../simulation/headless.worker';
import type { ScenarioId, WorldState } from '../simulation/types';
import { validateWorld, type WorldValidationIssue } from '../simulation/validateWorld';

interface DiagnosticsViewProps {
  world: WorldState;
  serverSavesEnabled?: boolean;
  onSaveServerSnapshot?: () => Promise<string>;
  onLoadServerSnapshot?: () => Promise<string>;
}

export function DiagnosticsView({
  world,
  serverSavesEnabled = false,
  onSaveServerSnapshot,
  onLoadServerSnapshot,
}: DiagnosticsViewProps) {
  const [validationResult, setValidationResult] = useState<{
    checkedAt: string;
    issues: WorldValidationIssue[];
  } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const liveDiversity = useMemo(() => computeDiversitySnapshot(world), [world]);
  const liveDiversityLabel = getCollapseDiagnosticLabel(liveDiversity.collapseRiskLevel);

  const [days, setDays] = useState<number>(4);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [latencyMs, setLatencyMs] = useState<number>(4000);
  const [mode, setMode] = useState<HeadlessMode>('scheduler');
  const [preset, setPreset] = useState<BudgetPreset>('balanced');
  const [scenario, setScenario] = useState<ScenarioId>('default');
  const [failFirstResident, setFailFirstResident] = useState<boolean>(false);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<HeadlessResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleValidateWorld = () => {
    const issues = validateWorld(world);
    setValidationResult({
      checkedAt: new Date().toLocaleTimeString(),
      issues,
    });
  };

  const handleServerSave = async () => {
    if (!onSaveServerSnapshot) return;
    setIsSyncing(true);
    try {
      const msg = await onSaveServerSnapshot();
      setSyncMessage(msg);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleServerLoad = async () => {
    if (!onLoadServerSnapshot) return;
    setIsSyncing(true);
    try {
      const msg = await onLoadServerSnapshot();
      setSyncMessage(msg);
    } finally {
      setIsSyncing(false);
    }
  };

  const executeHeadless = (options: HeadlessOptions): Promise<HeadlessResult> => {
    return new Promise((resolve, reject) => {
      if (typeof Worker !== 'undefined') {
        try {
          const worker = new Worker(
            new URL('../simulation/headless.worker.ts', import.meta.url),
            { type: 'module' },
          );
          const reqId = 1;
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
            // Graceful non-worker fallback if worker loading fails
            setTimeout(() => {
              try {
                resolve(runHeadless(options));
              } catch (innerErr) {
                reject(innerErr);
              }
            }, 0);
          };
          const req: HeadlessWorkerRequest = { id: reqId, options };
          worker.postMessage(req);
          return;
        } catch {
          // Fall through to async timeout execution
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
  };

  const handleRunHeadless = async () => {
    setIsRunning(true);
    setRunError(null);
    setCopied(false);
    try {
      const clampedDays = Math.max(1, Math.min(7, Number(days) || 4));
      const clampedLatency = Math.max(0, Math.min(20000, Number(latencyMs) || 0));
      const firstId = world.agents[0]?.id ?? 'isabella';
      const out = await executeHeadless({
        days: clampedDays,
        speed,
        latencyMs: clampedLatency,
        mode,
        preset,
        scenario,
        failAgentIds: failFirstResident ? [firstId] : [],
        failKinds: failFirstResident ? ['plan'] : undefined,
        seed: 42,
      });
      setResult(out);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Headless diagnostics run failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setRunError('Clipboard write failed in this browser context.');
    }
  };

  // Compute benchmark checklist against Phase 1-5 Target Metrics
  const benchmarkChecks = result
    ? (() => {
        const fullDays = result.perDay.slice(0, result.options.days);
        const day2Plus = fullDays.filter((d) => d.day >= 2);
        const avgConvs =
          fullDays.reduce((s, d) => s + d.conversations, 0) / Math.max(1, fullDays.length);
        const minMorningPlans =
          day2Plus.length > 0
            ? Math.min(...day2Plus.map((d) => d.morningPlansCount))
            : null;
        const maxMorningSim = day2Plus
          .map((d) => (d.lastMorningPlanSimMin ?? 0) % 1440)
          .reduce((a, b) => Math.max(a, b), 0);
        const consolidationsPerNight =
          day2Plus.length > 0
            ? Math.min(...day2Plus.map((d) => d.consolidations))
            : null;
        const maxReflections = Math.max(...fullDays.map((d) => d.reflections));
        const focalTotal = Math.max(
          1,
          result.endOfRun.finalWorld?.agents.filter((a) => (a.tier ?? 'focal') === 'focal')
            .length ??
            result.endOfRun.residentsHomeAt0300ByNight[0]?.total ??
            18,
        );
        const totalAgents = Math.max(
          1,
          result.endOfRun.finalWorld?.agents.length ??
            result.endOfRun.residentsHomeAt0300ByNight[0]?.total ??
            18,
        );
        const convTarget = result.options.speed === 5 ? 20 : 40;
        const planTarget =
          result.options.failAgentIds.length > 0 ? Math.max(1, focalTotal - 1) : focalTotal;
        const consolidationTarget = Math.max(1, Math.floor(focalTotal * 0.88));
        const homeTarget = Math.max(1, totalAgents - 1);

        const minHome0300 =
          result.endOfRun.residentsHomeAt0300ByNight.length > 0
            ? Math.min(...result.endOfRun.residentsHomeAt0300ByNight.map((n) => n.count))
            : totalAgents;
        const maxResidentMem = Math.max(
          0,
          ...Object.values(result.endOfRun.memoriesPerResident),
        );
        const saveMb = (result.endOfRun.estimatedSaveBytes / (1024 * 1024)).toFixed(2);

        const checks: Array<{ label: string; value: string; pass: boolean }> = [];

        if (result.mode !== 'llm_off') {
          checks.push(
            {
              label: `Conversations / day >= ${convTarget}`,
              value: `${avgConvs.toFixed(1)} avg`,
              pass: avgConvs >= convTarget,
            },
            {
              label: `Morning plans >= ${planTarget}/${focalTotal} before 08:00 (Day 2+)`,
              value:
                minMorningPlans !== null
                  ? `min ${minMorningPlans}/${focalTotal}, latest ${Math.floor(maxMorningSim / 60)}:${String(Math.round(maxMorningSim % 60)).padStart(2, '0')}`
                  : 'N/A (1 day)',
              pass:
                minMorningPlans === null ||
                (minMorningPlans >= planTarget && maxMorningSim < 8 * 60),
            },
            {
              label: `Overnight consolidations >= ${consolidationTarget}/${focalTotal} per night`,
              value:
                consolidationsPerNight !== null
                  ? `min ${consolidationsPerNight}/${focalTotal}`
                  : `${fullDays[0]?.consolidations ?? 0}/${focalTotal} (night 1)`,
              pass: (consolidationsPerNight ?? fullDays[0]?.consolidations ?? 0) >= consolidationTarget,
            },
            {
              label: 'Reflections / resident / day in 1.5–3.0',
              value: `${result.endOfRun.reflectionsPerResidentPerDay.toFixed(2)}/res/day (max ${maxReflections}/d)`,
              pass:
                result.endOfRun.reflectionsPerResidentPerDay >= 1.5 &&
                result.endOfRun.reflectionsPerResidentPerDay <= 3.0 &&
                maxReflections <= focalTotal * 3,
            },
            {
              label: 'Morning plans include sleep + >= 2 meals',
              value: `${result.endOfRun.morningPlansWithMealsAndSleep}/${result.endOfRun.morningPlansTotal}`,
              pass:
                result.endOfRun.morningPlansTotal === 0 ||
                result.endOfRun.morningPlansWithMealsAndSleep === result.endOfRun.morningPlansTotal,
            },
            {
              label: '0 commitments lost & <= 4 reactions/res/day',
              value: `lost ${result.endOfRun.commitmentsLostToReplan} · react ${result.endOfRun.maxReactionsPerResidentPerDay}/d`,
              pass:
                result.endOfRun.commitmentsLostToReplan === 0 &&
                result.endOfRun.maxReactionsPerResidentPerDay <= 4,
            },
            {
              label: 'Calls / conversation <= 8 avg & max',
              value: `${result.endOfRun.avgCallsPerConv.toFixed(1)} avg / ${result.endOfRun.maxCallsPerConv} max`,
              pass:
                result.endOfRun.avgCallsPerConv <= 8 && result.endOfRun.maxCallsPerConv <= 8,
            },
          );
        }

        checks.push(
          {
            label: `03:00 home occupancy >= ${homeTarget}/${totalAgents} every night`,
            value:
              result.endOfRun.residentsHomeAt0300ByNight.length > 0
                ? `min ${minHome0300}/${totalAgents}`
                : 'N/A',
            pass:
              result.endOfRun.residentsHomeAt0300ByNight.length === 0 || minHome0300 >= homeTarget,
          },
          {
            label: 'No repeated detours, Day-2 party blocks, wall talks, or past agreements',
            value: `det ${result.endOfRun.repeatedDetours} · pty ${result.endOfRun.day2PartyBlockCount} · wall ${result.endOfRun.wallCrossingConversations} · past ${result.endOfRun.pastAgreementsCount}`,
            pass:
              result.endOfRun.repeatedDetours === 0 &&
              result.endOfRun.day2PartyBlockCount === 0 &&
              result.endOfRun.wallCrossingConversations === 0 &&
              result.endOfRun.pastAgreementsCount === 0,
          },
          {
            label: 'Memory noise <= 30 obs/res/day & perception <= 50%',
            value: `${result.endOfRun.observationsPerResidentPerDay.toFixed(1)} obs · ${(result.endOfRun.perceptionShare * 100).toFixed(1)}%`,
            pass:
              result.endOfRun.observationsPerResidentPerDay <= 30 &&
              result.endOfRun.perceptionShare <= 0.5,
          },
          {
            label: 'Memory cap <= 300, seed imp>=8 kept, 0 dup IDs, save < 5 MB',
            value: `max ${maxResidentMem} · dup ${result.endOfRun.duplicateMemoryIds} · ${saveMb} MB`,
            pass:
              maxResidentMem <= 300 &&
              result.endOfRun.allSeedImp8Survived &&
              result.endOfRun.duplicateMemoryIds === 0 &&
              result.endOfRun.estimatedSaveBytes < 5_000_000,
          },
          {
            label: 'World validation issues == 0',
            value: String(result.endOfRun.validationIssuesCount),
            pass: result.endOfRun.validationIssuesCount === 0,
          },
        );

        return checks;
      })()
    : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
      <div className="border-b border-[#E2DFD5] pb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#1D2420]">
            Simulation Diagnostics &amp; Validator
          </h1>
          <p className="mt-1 text-sm text-[#5C645E]">
            Validate map, object affordances, and memory integrity, or run multi-day headless simulations against a deterministic mock LLM inside a Web Worker.
          </p>
        </div>

        <button
          type="button"
          onClick={handleValidateWorld}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3.5 py-2 text-xs font-semibold text-[#1D2420] hover:bg-[#EFECE3] transition-colors whitespace-nowrap shrink-0"
        >
          <ShieldCheck className="h-4 w-4 text-[#2D6A4F]" aria-hidden="true" />
          <span>Validate world</span>
        </button>
      </div>

      {/* World Validation Results */}
      {validationResult && (
        <section
          data-testid="validation-output"
          className={`rounded-lg border p-4 text-xs ${
            validationResult.issues.length === 0
              ? 'border-[#2D6A4F]/30 bg-[#EAF2ED] text-[#1B4332]'
              : 'border-[#DC2626]/30 bg-[#FEF2F2] text-[#991B1B]'
          }`}
        >
          <div className="flex items-center justify-between font-semibold">
            <span>
              {validationResult.issues.length === 0
                ? `World integrity passed (0 issues across ${world.agents.length} residents, ${world.locations.length} locations, ${world.objects.length} objects).`
                : `Found ${validationResult.issues.length} world validation issues:`}
            </span>
            <span className="font-mono text-[11px] opacity-80">{validationResult.checkedAt}</span>
          </div>
          {validationResult.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {validationResult.issues.map((issue, idx) => (
                <li key={idx}>
                  <span className="font-mono">[{issue.category}]</span> {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Live Population Diversity & Server Snapshot Sync */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 rounded-lg border border-[#E5E2D9] bg-white p-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold text-[#1D2420]">
              Live Population Diversity &amp; Persona-Collapse Check
            </h2>
            <span
              className={`font-mono text-[11px] font-semibold ${
                liveDiversity.collapseRiskLevel === 'healthy'
                  ? 'text-[#2D6A4F]'
                  : liveDiversity.collapseRiskLevel === 'narrowing'
                    ? 'text-[#B45309]'
                    : 'text-[#B91C1C]'
              }`}
            >
              {liveDiversityLabel.label}
            </span>
          </div>
          <p className="font-mono text-xs text-[#3C4640] tabular-nums">
            Distinct-2 {liveDiversity.lexicalDiversity.toFixed(2)} · Mood σ{' '}
            {liveDiversity.moodStdDev.toFixed(2)} · Trust σ{' '}
            {liveDiversity.trustPolarization.toFixed(1)} · Friction{' '}
            {Math.round(liveDiversity.refusalDisagreementRate * 100)}% · Active Contracts{' '}
            {liveDiversity.activeContractsCount} · Belief Revisions{' '}
            {liveDiversity.beliefRevisionCount}
          </p>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-[#E5E2D9] bg-white p-4 flex flex-col justify-between gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold text-[#1D2420]">Server Snapshot Sync</h2>
            <span className="font-mono text-[10px] text-[#5C645E]">
              {serverSavesEnabled ? 'Disk persistence on' : 'Browser local primary'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSyncing || !onSaveServerSnapshot}
              onClick={handleServerSave}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#1D2420] hover:bg-[#EFECE3] disabled:opacity-50 whitespace-nowrap"
            >
              <CloudUpload className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
              <span>Save to Server</span>
            </button>
            <button
              type="button"
              disabled={isSyncing || !onLoadServerSnapshot}
              onClick={handleServerLoad}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-3 py-1.5 text-xs font-medium text-[#1D2420] hover:bg-[#EFECE3] disabled:opacity-50 whitespace-nowrap"
            >
              <CloudDownload className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
              <span>Load from Server</span>
            </button>
          </div>
          {syncMessage && (
            <p className="text-[11px] text-[#4A534D] leading-snug" role="status">
              {syncMessage}
            </p>
          )}
        </div>
      </section>

      {/* Headless Benchmark Runner Form */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Sim Days (1–7)</span>
            <input
              type="number"
              min={1}
              max={7}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
              className="w-24 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Speed</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as 1 | 2 | 5)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={5}>5×</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">LLM Latency (ms)</span>
            <input
              type="number"
              min={0}
              max={20000}
              step={500}
              value={latencyMs}
              onChange={(e) => setLatencyMs(Math.max(0, Number(e.target.value) || 0))}
              className="w-28 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 font-mono text-xs text-[#1D2420]"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Policy</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as HeadlessMode)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="scheduler">Scheduler v2 (Auto LLM)</option>
              <option value="llm_off">LLM Off (Schedules + Physics)</option>
              <option value="baseline">Baseline 1-lane (Phase 0)</option>
            </select>
          </label>

          {mode === 'scheduler' && (
            <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
              <span className="font-medium">Budget Preset</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as BudgetPreset)}
                className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
              >
                <option value="thrifty">Thrifty (~150/day)</option>
                <option value="balanced">Balanced (~420/day)</option>
                <option value="research">Research (~600/day)</option>
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-[#3C4640]">
            <span className="font-medium">Scenario</span>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioId)}
              className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420]"
            >
              <option value="default">Standard Smallville</option>
              <option value="paper_valentine">Valentine&apos;s Party (Paper)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 py-1.5 text-xs text-[#1D2420] cursor-pointer">
            <input
              type="checkbox"
              checked={failFirstResident}
              onChange={(e) => setFailFirstResident(e.target.checked)}
              className="h-4 w-4 rounded border-[#D5D0C3] accent-[#2D6A4F]"
            />
            <span>Make the first resident&apos;s plan calls fail</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            {result && (
              <button
                type="button"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#D5D0C3] bg-white px-3 py-2 text-xs font-medium text-[#2F3833] hover:bg-[#EFECE3] whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              disabled={isRunning}
              onClick={handleRunHeadless}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#2D6A4F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#23533D] disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isRunning ? 'Running headless...' : 'Run headless test'}</span>
            </button>
          </div>
        </div>

        {runError && (
          <p className="text-xs text-[#991B1B]" role="alert">
            {runError}
          </p>
        )}
      </section>

      {/* Output Tables & Target Metric Checks */}
      {result && (
        <div className="space-y-6" data-testid="diagnostics-results">
          {result.mode !== 'baseline' && (
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {benchmarkChecks.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-lg border p-3.5 text-xs ${
                    item.pass
                      ? 'border-[#2D6A4F]/30 bg-[#EAF2ED] text-[#1B4332]'
                      : 'border-[#B45309]/40 bg-[#FEF3C7] text-[#92400E]'
                  }`}
                >
                  <div className="font-mono text-[11px] font-semibold">
                    {item.pass ? 'PASS' : 'CHECK'} · {item.value}
                  </div>
                  <div className="mt-1 leading-snug">{item.label}</div>
                </div>
              ))}
            </section>
          )}

          {/* Per-Day Table */}
          <section className="rounded-lg border border-[#E5E2D9] bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E5E2D9] bg-[#FAF8F4] text-[#5C645E]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Day</th>
                  <th className="px-3 py-2.5 font-medium">Convs</th>
                  <th className="px-3 py-2.5 font-medium">Avg Turns</th>
                  <th className="px-3 py-2.5 font-medium">Avg Calls/Conv</th>
                  <th className="px-3 py-2.5 font-medium">Refls</th>
                  <th className="px-3 py-2.5 font-medium">Morning Plans</th>
                  <th className="px-3 py-2.5 font-medium">Last Plan</th>
                  <th className="px-3 py-2.5 font-medium">Sleep Cons.</th>
                  <th className="px-3 py-2.5 font-medium">Unique Pairs</th>
                  <th className="px-3 py-2.5 font-medium">Percep.</th>
                  <th className="px-3 py-2.5 font-medium">Detours</th>
                  <th className="px-3 py-2.5 font-medium">Fails</th>
                  <th className="px-3 py-2.5 font-medium">03:00 Home</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EDE5] font-mono tabular-nums text-[#1D2420]">
                {result.perDay.map((d) => (
                  <tr key={d.day}>
                    <td className="px-3 py-2 font-semibold">Day {d.day}</td>
                    <td className="px-3 py-2">{d.conversations}</td>
                    <td className="px-3 py-2">{d.avgTurnsPerConv.toFixed(1)}</td>
                    <td className="px-3 py-2">{d.avgCallsPerConv.toFixed(1)}</td>
                    <td className="px-3 py-2">{d.reflections}</td>
                    <td className="px-3 py-2">{d.morningPlansCount}</td>
                    <td className="px-3 py-2 text-[#5C645E]">
                      {d.lastMorningPlanTimeLabel ?? '—'}
                    </td>
                    <td className="px-3 py-2">{d.consolidations}</td>
                    <td className="px-3 py-2">{d.uniqueConversationPairs}</td>
                    <td className="px-3 py-2">{d.perceptionEvents}</td>
                    <td className="px-3 py-2">{d.driveDetours}</td>
                    <td className="px-3 py-2">{d.failedCalls}</td>
                    <td className="px-3 py-2">
                      {d.residentsAtHome0300 !== null
                        ? `${d.residentsAtHome0300}/${result.endOfRun.finalWorld?.agents.length ?? 18}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* End-of-run Audit Counters */}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Avg Memories / Resident</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.avgMemoriesPerResident}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Obs / Resident / Day</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.observationsPerResidentPerDay.toFixed(1)}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Room-Perception Share</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {(result.endOfRun.perceptionShare * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Saved World Size</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {(result.endOfRun.estimatedSaveBytes / (1024 * 1024)).toFixed(2)} MB
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Avg / Max Calls per Conv</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.avgCallsPerConv.toFixed(1)} / {result.endOfRun.maxCallsPerConv}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Wall-Cross / Past Agr.</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.wallCrossingConversations} / {result.endOfRun.pastAgreementsCount}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Day-2+ Party / Repeat Detours</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.day2PartyBlockCount} / {result.endOfRun.repeatedDetours}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
              <dt className="text-xs text-[#5C645E]">Seed Imp &gt;= 8 Survived</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.seedImp8Survived.filter((s) => s.survived).length} /{' '}
                {result.endOfRun.seedImp8Survived.length}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3 sm:col-span-2">
              <dt className="text-xs text-[#5C645E]">Peak Concurrent / Calls/Min · Validate Issues</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-[#1D2420] tabular-nums">
                {result.endOfRun.maxConcurrentObserved} / {result.endOfRun.maxCallsPerMinuteObserved} ·{' '}
                {result.endOfRun.validationIssuesCount} issues
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3 sm:col-span-2">
              <dt className="text-xs text-[#5C645E]">03:00 Home Occupancy by Night</dt>
              <dd className="mt-1 font-mono text-sm font-medium text-[#1D2420] tabular-nums">
                {result.endOfRun.residentsHomeAt0300ByNight.length > 0
                  ? result.endOfRun.residentsHomeAt0300ByNight
                      .map((n) => `D${n.day}: ${n.count}/${n.total}`)
                      .join(' · ')
                  : 'N/A'}
              </dd>
            </div>
            {result.endOfRun.diversity && (
              <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3 sm:col-span-4">
                <dt className="text-xs text-[#5C645E]">
                  End-of-Run Behavioral Diversity ({getCollapseDiagnosticLabel(result.endOfRun.diversity.collapseRiskLevel).label})
                </dt>
                <dd className="mt-1 font-mono text-xs font-medium text-[#1D2420] tabular-nums">
                  Distinct-2 {result.endOfRun.diversity.lexicalDiversity.toFixed(2)} · Mood σ{' '}
                  {result.endOfRun.diversity.moodStdDev.toFixed(2)} · Trust σ{' '}
                  {result.endOfRun.diversity.trustPolarization.toFixed(1)} · Friction{' '}
                  {Math.round(result.endOfRun.diversity.refusalDisagreementRate * 100)}% · Loans/Petitions{' '}
                  {result.endOfRun.diversity.activeContractsCount} · Housing Moves{' '}
                  {result.endOfRun.diversity.householdMobilityEvents} · Belief Revisions{' '}
                  {result.endOfRun.diversity.beliefRevisionCount}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
