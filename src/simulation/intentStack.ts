/**
 * Phase 1 — PIANO-Style Continuous Intent Stack & Executive Triggering.
 *
 * Replaces static schedule-only behavior with multi-day ambitions, live
 * social/civic commitments, and continuous completion/surprise/mail-driven
 * executive forks—while honoring legacy_schedule ablations for reproducibility.
 *
 * Pure TypeScript: no React, no fetch, no Date.now(), no Math.random().
 */

import { getActiveBeliefs } from './cognitiveDepth';
import { formatSimTime } from './memory';
import type {
  AgentAmbition,
  AgentCommitment,
  AgentIntentStack,
  AgentState,
  WorldActionKind,
  WorldState,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function inferDomain(text: string): AgentAmbition['domain'] {
  const low = text.toLowerCase();
  if (/shop|cafe|market|bakery|loan|sav|money|venture|business|wage|rent/.test(low)) return 'economic';
  if (/mayor|town|civic|petition|council|library|clinic|tax|policy|vote/.test(low)) return 'civic';
  if (/friend|neighbor|family|eddy|community|club|party|music|gather/.test(low)) return 'social';
  if (/paint|book|essay|compose|bake|carpentry|study|research|craft|garden/.test(low)) return 'craft';
  return 'personal';
}

function actionDomain(action: WorldActionKind): AgentAmbition['domain'] {
  switch (action) {
    case 'work_shift':
    case 'launch_venture':
    case 'propose_loan':
    case 'transfer_money':
    case 'buy_item':
    case 'propose_contract':
      return 'economic';
    case 'seek_person':
    case 'socialize':
    case 'send_letter':
    case 'spread_rumor':
      return 'social';
    case 'vote_proposal':
    case 'vote_election':
    case 'declare_candidacy':
    case 'sign_petition':
    case 'start_petition':
    case 'post_notice':
    case 'file_dispute':
    case 'form_coalition':
    case 'join_coalition':
    case 'call_boycott':
    case 'fact_check':
    case 'endorse_norm':
      return 'civic';
    case 'advance_project':
      return 'craft';
    default:
      return 'personal';
  }
}

export function hydrateIntentStackForAgent(
  agent: AgentState,
  simMinutes: number,
  allocId: (prefix: string) => string,
): AgentState {
  if (agent.intentStack && agent.intentStack.ambitions.length > 0) {
    return agent;
  }

  const ambitions: AgentAmbition[] = [];
  const seenTitles = new Set<string>();

  const pushAmbition = (
    title: string | undefined,
    domain: AgentAmbition['domain'],
    priority: number,
    progress = 10,
    targetLocationId?: string,
  ) => {
    const clean = title?.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seenTitles.has(key)) return;
    seenTitles.add(key);
    ambitions.push({
      id: allocId(`amb_${agent.id}`),
      title: clean.slice(0, 140),
      domain,
      priority: clamp(priority, 0.2, 1),
      progress: clamp(progress, 0, 100),
      createdAt: simMinutes,
      status: 'active',
      targetLocationId,
    });
  };

  if (agent.dossier?.privateAgenda) {
    pushAmbition(
      agent.dossier.privateAgenda,
      inferDomain(agent.dossier.privateAgenda),
      0.9,
      15,
      agent.employerLocationId,
    );
  }

  for (const proj of (agent.projects ?? []).filter((p) => p.status === 'active').slice(0, 2)) {
    pushAmbition(
      proj.title,
      proj.category === 'civic' ? 'civic' : proj.category === 'business' ? 'economic' : 'craft',
      0.78,
      proj.progress,
      proj.targetLocationId,
    );
  }

  for (const goal of (agent.goals ?? []).slice(0, 2)) {
    pushAmbition(goal, inferDomain(goal), 0.65, 10);
  }

  if (ambitions.length === 0) {
    pushAmbition(
      `Thrive as ${agent.occupation} in Smallville`,
      'economic',
      0.62,
      10,
      agent.employerLocationId ?? agent.homeLocationId,
    );
  }

  const commitments: AgentCommitment[] = agent.dailySchedule
    .filter((b) => b.fixed || b.source === 'social_commitment')
    .slice(0, 8)
    .map((b) => ({
      id: `cmt_${b.id}`,
      title: b.activity,
      locationId: b.locationId,
      dueDay: b.day,
      dueMinute: b.startMinute,
      urgency: b.fixed ? 0.85 : 0.72,
      status: 'pending',
      source: b.source === 'social_commitment' ? 'conversation' : 'self',
    }));

  return {
    ...agent,
    intentStack: {
      ambitions: ambitions.slice(0, 5),
      commitments,
    },
  };
}

export function hydrateWorldIntentStacks(
  agents: AgentState[],
  simMinutes: number,
  allocId: (prefix: string) => string,
): AgentState[] {
  return agents.map((ag) => hydrateIntentStackForAgent(ag, simMinutes, allocId));
}

export function syncAgentCommitments(
  agent: AgentState,
  world: WorldState,
): AgentState {
  if (!agent.intentStack) return agent;
  const now = formatSimTime(world.simMinutes);
  const existingMap = new Map<string, AgentCommitment>(
    agent.intentStack.commitments.map((c) => [c.id, c]),
  );

  for (const blk of agent.dailySchedule) {
    if (!blk.fixed && blk.source !== 'social_commitment') continue;
    const cid = `cmt_${blk.id}`;
    if (!existingMap.has(cid)) {
      existingMap.set(cid, {
        id: cid,
        title: blk.activity,
        locationId: blk.locationId,
        dueDay: blk.day,
        dueMinute: blk.startMinute,
        urgency: blk.fixed ? 0.85 : 0.72,
        status: 'pending',
        source: blk.source === 'social_commitment' ? 'conversation' : 'self',
      });
    }
  }

  let changed = false;
  const updatedCommitments: AgentCommitment[] = [];
  for (const c of existingMap.values()) {
    if (c.status === 'pending') {
      const isPast =
        now.day > c.dueDay || (now.day === c.dueDay && now.minuteOfDay > c.dueMinute + 30);
      const isAtLoc =
        now.day === c.dueDay &&
        now.minuteOfDay >= c.dueMinute &&
        now.minuteOfDay <= c.dueMinute + 45 &&
        agent.currentLocationId === c.locationId;
      if (isAtLoc) {
        updatedCommitments.push({ ...c, status: 'fulfilled' });
        changed = true;
        continue;
      }
      if (isPast) {
        updatedCommitments.push({ ...c, status: 'missed' });
        changed = true;
        continue;
      }
    }
    // Prune resolved commitments older than 2 days
    if (c.status !== 'pending' && now.day - c.dueDay > 2) {
      changed = true;
      continue;
    }
    updatedCommitments.push(c);
  }

  if (!changed && updatedCommitments.length === agent.intentStack.commitments.length) {
    return agent;
  }

  return {
    ...agent,
    intentStack: {
      ...agent.intentStack,
      commitments: updatedCommitments.slice(-16),
    },
  };
}

export function advanceAmbitionFromAction(
  agent: AgentState,
  action: WorldActionKind,
  newAmbitionTitle: string | undefined,
  simMinutes: number,
  allocId: (prefix: string) => string,
): AgentIntentStack {
  const baseStack: AgentIntentStack = agent.intentStack ?? {
    ambitions: [],
    commitments: [],
  };
  const domain = actionDomain(action);
  let matched = false;
  const nextAmbitions = baseStack.ambitions.map((amb) => {
    if (amb.status !== 'active') return amb;
    if (!matched && amb.domain === domain) {
      matched = true;
      const nextProgress = clamp(amb.progress + 12, 0, 100);
      return {
        ...amb,
        progress: nextProgress,
        status: nextProgress >= 100 ? ('achieved' as const) : ('active' as const),
      };
    }
    return amb;
  });

  if (newAmbitionTitle && newAmbitionTitle.trim().length > 4) {
    const clean = newAmbitionTitle.trim().slice(0, 140);
    if (!nextAmbitions.some((a) => a.title.toLowerCase() === clean.toLowerCase())) {
      nextAmbitions.unshift({
        id: allocId(`amb_${agent.id}`),
        title: clean,
        domain: inferDomain(clean),
        priority: 0.88,
        progress: 5,
        createdAt: simMinutes,
        status: 'active',
      });
    }
  }

  return {
    ...baseStack,
    ambitions: nextAmbitions.slice(0, 6),
    lastExecutiveDecisionSimMin: simMinutes,
  };
}

export function evaluateIntentStackExecutiveTrigger(
  world: WorldState,
  agent: AgentState,
): { agentId: string; forkReason: string; urgency: number } | null {
  if (world.ablations?.noPlanning) return null;
  if (agent.isThinking || agent.inConversationWith) return null;

  const now = formatSimTime(world.simMinutes);
  if (now.hour24 < 7 || now.hour24 >= 22) return null;

  const sinceLast = world.simMinutes - (agent.lastDecisionSimMin ?? -999);
  if (sinceLast < 90) return null;

  // 1. Delivered private letters addressed to this resident (delivered and unread, or recently read)
  const pendingLetter = (world.letters ?? []).find(
    (l) =>
      l.toAgentId === agent.id &&
      l.deliveredAt <= world.simMinutes &&
      (!l.readAt || world.simMinutes - l.readAt <= 60) &&
      !(world.letters ?? []).some((rep) => rep.replyToLetterId === l.id),
  );
  if (pendingLetter) {
    return {
      agentId: agent.id,
      forkReason: `Received private letter from ${pendingLetter.fromName} ("${pendingLetter.subject}": "${pendingLetter.body.slice(0, 90)}") — decide whether to send_letter in reply, seek_person (${pendingLetter.fromAgentId}), or adjust plans.`,
      urgency: 0.85,
    };
  }

  // 2. Approaching pending social/civic commitment within 45 minutes
  const stack = agent.intentStack;
  if (stack) {
    const approaching = stack.commitments.find(
      (c) =>
        c.status === 'pending' &&
        c.dueDay === now.day &&
        c.dueMinute >= now.minuteOfDay &&
        c.dueMinute - now.minuteOfDay <= 45 &&
        agent.currentLocationId !== c.locationId,
    );
    if (approaching) {
      const locName =
        world.locations.find((l) => l.id === approaching.locationId)?.name ??
        approaching.locationId;
      return {
        agentId: agent.id,
        forkReason: `Upcoming commitment "${approaching.title}" at ${locName} (${approaching.locationId}) in ${approaching.dueMinute - now.minuteOfDay} min — decide whether to head over (socialize/work_shift) or send_letter to reschedule.`,
        urgency: 0.87,
      };
    }
  }

  // 3. Epistemic surprise / fresh belief revision in last 90 sim-min
  if (sinceLast >= 120 && world.simMinutes > 560) {
    const freshBelief = getActiveBeliefs(agent.beliefs, undefined, 8).find(
      (b) => world.simMinutes - b.validFromSimMin <= 90 && b.validFromSimMin > 540,
    );
    if (freshBelief) {
      return {
        agentId: agent.id,
        forkReason: `Recent belief shift ("${freshBelief.claim.slice(0, 90)}") — decide how to act on this insight (seek_person, avoid_person, send_letter, post_notice, or adjust_goal).`,
        urgency: 0.81,
      };
    }
  }

  // 4. Continuous ambition continuation (disabled in legacy_schedule mode so ablation benchmarks remain exact)
  if (world.autonomyMode !== 'legacy_schedule' && sinceLast >= 180 && stack) {
    const topAmbition = stack.ambitions
      .filter((a) => a.status === 'active' && a.priority >= 0.6)
      .sort((a, b) => b.priority - a.priority)[0];
    const inNonSleepFreeWindow = !agent.dailySchedule.some(
      (b) =>
        b.day === now.day &&
        now.minuteOfDay >= b.startMinute &&
        now.minuteOfDay < b.startMinute + b.durationMinutes &&
        (b.fixed || b.kind === 'sleep'),
    );
    if (topAmbition && inNonSleepFreeWindow && now.hour24 >= 9 && now.hour24 <= 20) {
      return {
        agentId: agent.id,
        forkReason: `Intent executive check: top ambition "${topAmbition.title}" (${topAmbition.progress}% progress) — choose your next self-directed move (work_shift, advance_project, seek_person, send_letter, launch_venture, or adjust_goal).`,
        urgency: 0.56,
      };
    }
  }

  return null;
}
