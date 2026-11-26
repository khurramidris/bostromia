/**
 * Phase 4 ("Open Genesis") — Deterministic Counterfactual Society Experiment Runner.
 *
 * Runs side-by-side simulations from the same starting seed while varying governance/
 * epistemic/shock conditions (`genesisMode`, `injectShockOnDay`, `ablations`) so researchers
 * can observe exact causal deltas across Gini, diversity, false beliefs, norms & orgs.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { runHeadless, type HeadlessOptions } from './headless';
import { computeMacroSnapshot } from './institutions';
import type { AblationSettings, GenesisMode, TownShockKind } from './types';

export interface CounterfactualCondition {
  id: string;
  label: string;
  genesisMode?: GenesisMode;
  injectShockOnDay?: { day: number; kind: TownShockKind };
  ablations?: Partial<AblationSettings>;
}

export interface CounterfactualRunMetrics {
  conditionId: string;
  label: string;
  giniIndex: number;
  avgWealth: number;
  tradeVolume: number;
  lexicalDiversity: number;
  trustPolarization: number;
  falseBeliefRate: number;
  normCohesionAvg: number;
  orgsCount: number;
  emergentNormsCount: number;
  openActionsArbitrated: number;
  disputesResolved: number;
  validationIssues: number;
}

export interface CounterfactualComparisonResult {
  days: number;
  seed: number;
  baselineId: string;
  runs: CounterfactualRunMetrics[];
  deltasFromBaseline: Array<{
    conditionId: string;
    label: string;
    deltaGini: number;
    deltaTradeVolume: number;
    deltaFalseBeliefRate: number;
    deltaNormCohesion: number;
    deltaOrgsCount: number;
    deltaOpenActions: number;
  }>;
}

export function runCounterfactualComparison(
  conditions: readonly CounterfactualCondition[],
  baseOptions: Partial<Omit<HeadlessOptions, 'genesisMode' | 'injectShockOnDay' | 'ablations'>> = {},
): CounterfactualComparisonResult {
  const days = Math.max(1, Math.min(7, baseOptions.days ?? 3));
  const seed = baseOptions.seed ?? 42;
  const activeConditions = conditions.slice(0, 4);

  const runs: CounterfactualRunMetrics[] = activeConditions.map((cond) => {
    const res = runHeadless({
      days,
      speed: baseOptions.speed ?? 2,
      latencyMs: baseOptions.latencyMs ?? 4000,
      mode: baseOptions.mode ?? 'scheduler',
      preset: baseOptions.preset ?? 'balanced',
      scenario: baseOptions.scenario ?? 'default',
      seed,
      genesisMode: cond.genesisMode,
      injectShockOnDay: cond.injectShockOnDay,
      ablations: cond.ablations,
    });
    const fw = res.endOfRun.finalWorld;
    const macro = computeMacroSnapshot(fw);
    const div = res.endOfRun.diversity;
    return {
      conditionId: cond.id,
      label: cond.label,
      giniIndex: macro.giniIndex,
      avgWealth: macro.avgWealth,
      tradeVolume: macro.tradeVolume,
      lexicalDiversity: div.lexicalDiversity,
      trustPolarization: div.trustPolarization,
      falseBeliefRate: div.falseBeliefRate ?? 0,
      normCohesionAvg: div.normCohesionAvg ?? 60,
      orgsCount: (fw.organizations ?? []).filter((o) => o.active).length,
      emergentNormsCount: (fw.emergentNorms ?? []).filter((n) => n.active).length,
      openActionsArbitrated: fw.stats.openActionsArbitrated ?? 0,
      disputesResolved: fw.stats.disputesResolved ?? 0,
      validationIssues: res.endOfRun.validationIssuesCount,
    };
  });

  const base = runs[0];
  const deltasFromBaseline = runs.slice(1).map((r) => ({
    conditionId: r.conditionId,
    label: r.label,
    deltaGini: Number((r.giniIndex - base.giniIndex).toFixed(3)),
    deltaTradeVolume: Math.round(r.tradeVolume - base.tradeVolume),
    deltaFalseBeliefRate: Number((r.falseBeliefRate - base.falseBeliefRate).toFixed(3)),
    deltaNormCohesion: Number((r.normCohesionAvg - base.normCohesionAvg).toFixed(1)),
    deltaOrgsCount: r.orgsCount - base.orgsCount,
    deltaOpenActions: r.openActionsArbitrated - base.openActionsArbitrated,
  }));

  return {
    days,
    seed,
    baselineId: base?.conditionId ?? '',
    runs,
    deltasFromBaseline,
  };
}
