/**
 * Phase I — Population Diversity & Persona Collapse Diagnostics.
 * Implements quantitative metrics from 2025–2026 LLM multi-agent critique literature
 * (Distinct-2 Lexical Diversity, Mood/Opinion Dispersion, Trust Polarization,
 * Refusal/Friction Rate, Contract Fulfillment, and Collapse Risk Classification).
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { formatSimTime } from './memory';
import type {
  AgentState,
  CollapseRiskLevel,
  ConversationRecord,
  DiversitySnapshot,
  WorldState,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Distinct-2 bigram diversity across recent conversation turns (0..1).
 * Low values (< 0.45) indicate repetitive RLHF phrasing / lexical homogenization.
 */
export function computeLexicalDiversity(conversations: readonly ConversationRecord[]): number {
  const recent = conversations.slice(0, 24);
  const totalBigrams: string[] = [];

  for (const conv of recent) {
    for (const turn of conv.turns) {
      const tokens = turn.text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);
      for (let i = 0; i < tokens.length - 1; i++) {
        totalBigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
      }
    }
  }

  if (totalBigrams.length < 4) return 0.78; // baseline before dialogues accumulate
  const unique = new Set(totalBigrams).size;
  return Number(clamp(unique / totalBigrams.length, 0, 1).toFixed(3));
}

/**
 * Standard deviation of PAD mood valence across the population.
 * Healthy diverse societies exhibit sustained emotional variance rather than flat uniformity.
 */
export function computeMoodStdDev(agents: readonly AgentState[]): number {
  if (agents.length < 2) return 0;
  const vals = agents.map((a) => a.mood.valence);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length;
  return Number(Math.sqrt(variance).toFixed(3));
}

/**
 * Trust Polarization & Variance Index (0..1) across all directed Theory-of-Mind edges.
 */
export function computeTrustPolarization(agents: readonly AgentState[]): number {
  const trusts: number[] = [];
  for (const ag of agents) {
    for (const edge of Object.values(ag.socialGraph)) {
      trusts.push(edge.trust);
    }
  }
  if (trusts.length < 2) return 0.2;
  const mean = trusts.reduce((s, v) => s + v, 0) / trusts.length;
  const std = Math.sqrt(
    trusts.reduce((s, v) => s + (v - mean) * (v - mean), 0) / trusts.length,
  );
  // Normalize 0..45 std-dev onto 0..1 scale
  return Number(clamp(std / 45, 0, 1).toFixed(3));
}

/**
 * Computes a complete live Population Realism & Persona Collapse diagnostic snapshot.
 */
export function computeDiversitySnapshot(world: WorldState): DiversitySnapshot {
  const { day } = formatSimTime(world.simMinutes);
  const lexicalDiversity = computeLexicalDiversity(world.conversations);
  const moodStdDev = computeMoodStdDev(world.agents);
  const trustPolarization = computeTrustPolarization(world.agents);

  const loans = world.loans ?? [];
  const activeLoans = loans.filter((l) => l.status === 'active').length;
  const resolvedLoans = loans.filter((l) => l.status === 'repaid' || l.status === 'defaulted');
  const defaultedLoans = resolvedLoans.filter((l) => l.status === 'defaulted').length;
  const loanDefaultRate =
    resolvedLoans.length > 0 ? Number((defaultedLoans / resolvedLoans.length).toFixed(3)) : 0;

  const activePetitions = (world.petitions ?? []).filter((p) => p.status === 'gathering').length;
  const activeVentures = (world.ventures ?? []).filter((v) => v.active).length;
  const activeServiceContracts = (world.serviceContracts ?? []).filter(
    (c) => c.status === 'active',
  ).length;
  const activeContractsCount = activeLoans + activePetitions + activeVentures + activeServiceContracts;

  const refusals = world.stats.refusalsAndDisagreements ?? 0;
  const cumulativeConversations = Math.max(
    world.conversations.length,
    world.stats.conversationsTotal ?? 0,
  );
  const totalSocialInteractions = Math.max(
    1,
    cumulativeConversations +
      (world.stats.civicVotesCast ?? 0) +
      (world.stats.loansIssued ?? 0) +
      refusals,
  );
  const refusalDisagreementRate = Number(
    clamp(refusals / totalSocialInteractions, 0, 1).toFixed(3),
  );

  // Classify collapse risk from lexical diversity + trust spread + emotional dispersion
  let riskScore = 0;
  if (lexicalDiversity < 0.45) riskScore += 2;
  else if (lexicalDiversity < 0.6) riskScore += 1;

  if (trustPolarization < 0.14) riskScore += 2;
  else if (trustPolarization < 0.24) riskScore += 1;

  if (moodStdDev < 0.05) riskScore += 1;

  const collapseRiskLevel: CollapseRiskLevel =
    riskScore >= 3 ? 'collapse_risk' : riskScore >= 1 ? 'narrowing' : 'healthy';

  let activeBeliefTotal = 0;
  let falseBeliefCount = 0;
  for (const ag of world.agents) {
    for (const b of ag.beliefs ?? []) {
      if (b.invalidatedAtSimMin !== undefined) continue;
      activeBeliefTotal += 1;
      if (b.groundTruthStatus === 'false') falseBeliefCount += 1;
    }
  }
  const falseBeliefRate =
    activeBeliefTotal > 0 ? Number((falseBeliefCount / activeBeliefTotal).toFixed(3)) : 0;
  const activeRumorsCount = (world.rumors ?? []).filter((r) => !r.debunked).length;
  const norms = world.culturalNorms ?? [];
  const normCohesionAvg =
    norms.length > 0
      ? Number((norms.reduce((s, n) => s + n.strength, 0) / norms.length).toFixed(1))
      : 60;

  return {
    day,
    simMinutes: world.simMinutes,
    lexicalDiversity,
    moodStdDev,
    trustPolarization,
    refusalDisagreementRate,
    activeContractsCount,
    loanDefaultRate,
    householdMobilityEvents: (world.stats.housingMoves ?? 0) + (world.stats.careerPromotions ?? 0),
    beliefRevisionCount: world.stats.beliefRevisions ?? 0,
    collapseRiskLevel,
    falseBeliefRate,
    activeRumorsCount,
    normCohesionAvg,
  };
}

export function getCollapseDiagnosticLabel(level: CollapseRiskLevel): {
  label: string;
  detail: string;
} {
  if (level === 'collapse_risk') {
    return {
      label: 'Consensus Risk',
      detail: 'Dialogue phrasing or social trust spread is converging too narrowly.',
    };
  }
  if (level === 'narrowing') {
    return {
      label: 'Narrowing Variance',
      detail: 'Moderate behavioral variance; competing incentives are keeping consensus in check.',
    };
  }
  return {
    label: 'Healthy Spread',
    detail: 'Distinct voices, asymmetric trust, and divergent moods indicate low persona collapse.',
  };
}
