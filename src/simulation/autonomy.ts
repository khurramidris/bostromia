import { compactMemories, createMemoryNode } from './memory';
import { attachAssociativeLinks } from './cognitiveDepth';
import {
  advanceAmbitionFromAction,
  evaluateIntentStackExecutiveTrigger,
} from './intentStack';
import {
  executePeerTransfer,
  issueBilateralLoan,
  launchMicroVenture,
  signCitizenPetition,
  startCitizenPetition,
} from './contractsAndLife';
import { castElectionVote, declareMayoralCandidacy } from './institutions';
import {
  advanceAgentProject,
  executeConsumeItemAction,
  executePurchaseAction,
  findNearestOpenFoodVenue,
  findObjectForLocation,
  getCalendarInfo,
  isBusinessOpen,
  ITEM_CATALOG,
} from './worldEconomy';
import {
  createOrSpreadRumor,
  endorseCulturalNorm,
  factCheckRumor,
} from './epistemicCulture';
import {
  applyArbitratedOpenAction,
  compileOfflineOpenAction,
} from './openGenesis';
import {
  areRivalCoalitionMembers,
  callEconomicBoycott,
  createServiceContract,
  fileCivicDispute,
  formCivicCoalition,
  joinCivicCoalition,
} from './powerAndInstitutions';
import { castCivicVote, postPublicNotice } from './socialFabric';
import {
  DEFAULT_MEMORY_CAP,
  type ActiveSocialTarget,
  type AgentState,
  type BdiDecisionResult,
  type ChronicleEvent,
  type PendingBdiAction,
  type PrivateLetter,
  type ScheduleBlock,
  type WorldState,
} from './types';

export function isHighStakesEncounter(
  world: WorldState,
  agentAId: string,
  agentBId: string,
  startReason?: string,
): boolean {
  if (startReason && /^intentional visit:/i.test(startReason)) return true;
  const a = world.agents.find((x) => x.id === agentAId);
  const b = world.agents.find((x) => x.id === agentBId);
  if (!a || !b) return false;

  if (
    (a.socialTarget?.mode === 'seek' && a.socialTarget.targetAgentId === b.id) ||
    (b.socialTarget?.mode === 'seek' && b.socialTarget.targetAgentId === a.id)
  ) {
    return true;
  }

  const trustAB = a.socialGraph[b.id]?.trust ?? 50;
  const trustBA = b.socialGraph[a.id]?.trust ?? 50;
  if (trustAB < 35 || trustBA < 35) return true;

  const activeOrDefaultedLoan = (world.loans ?? []).some(
    (l) =>
      (l.status === 'active' || l.status === 'defaulted') &&
      ((l.lenderId === a.id && l.borrowerId === b.id) ||
        (l.lenderId === b.id && l.borrowerId === a.id)),
  );
  if (activeOrDefaultedLoan) return true;

  if (world.election && world.election.status !== 'completed') {
    const cIds = new Set(world.election.candidates.map((c) => c.agentId));
    if (cIds.has(a.id) && cIds.has(b.id)) return true;
  }

  const openDispute = (world.disputes ?? []).some(
    (d) =>
      d.status === 'open' &&
      ((d.claimantId === a.id && d.respondentId === b.id) ||
        (d.claimantId === b.id && d.respondentId === a.id)),
  );
  if (openDispute || areRivalCoalitionMembers(world, a.id, b.id)) return true;

  const activeRumorConflict = (world.rumors ?? []).some(
    (r) =>
      !r.debunked &&
      ((r.subjectAgentId === a.id && (r.believerIds.includes(b.id) || r.originAgentId === b.id)) ||
        (r.subjectAgentId === b.id && (r.believerIds.includes(a.id) || r.originAgentId === a.id))),
  );
  if (activeRumorConflict) return true;

  return false;
}

export function sendPrivateLetter(
  world: WorldState,
  params: {
    fromAgentId: string;
    toAgentId: string;
    subject: string;
    body: string;
    replyToLetterId?: string;
  },
  allocId: (prefix: string) => string,
): { world: WorldState; letter?: PrivateLetter; ok: boolean } {
  const fromAg = world.agents.find((a) => a.id === params.fromAgentId);
  const toAg = world.agents.find((a) => a.id === params.toAgentId);
  if (!fromAg || !toAg || fromAg.id === toAg.id) {
    return { world, ok: false };
  }

  const subject = params.subject.trim().slice(0, 110) || 'A quiet note';
  const body = params.body.trim().slice(0, 340) || `Thinking of catching up with you soon.`;
  const letter: PrivateLetter = {
    id: allocId('ltr'),
    fromAgentId: fromAg.id,
    fromName: fromAg.name,
    toAgentId: toAg.id,
    toName: toAg.name,
    subject,
    body,
    sentAt: world.simMinutes,
    deliveredAt: world.simMinutes + 25,
    ...(params.replyToLetterId ? { replyToLetterId: params.replyToLetterId } : {}),
  };

  const sentMem = createMemoryNode({
    id: allocId(`mem_ltr_sent_${fromAg.id}`),
    createdAt: world.simMinutes,
    type: 'observation',
    source: 'letter',
    description: `${fromAg.name} sent a private letter to ${toAg.name} ("${subject}"): ${body}`,
    importance: 6,
  });

  const nextAgents = world.agents.map((ag) => {
    if (ag.id !== fromAg.id) return ag;
    const linked = attachAssociativeLinks(sentMem, ag.memories);
    return {
      ...ag,
      memories: compactMemories(
        [linked.linkedNode, ...linked.updatedExisting],
        DEFAULT_MEMORY_CAP,
        world.simMinutes,
        allocId,
      ),
    };
  });

  const chr: ChronicleEvent = {
    id: allocId('chr_ltr'),
    simMinutes: world.simMinutes,
    type: 'notice',
    title: `${fromAg.name.split(' ')[0]} sent a private letter to ${toAg.name.split(' ')[0]}`,
    detail: `Subject: "${subject}" (courier ETA ~25m).`,
    agentIds: [fromAg.id, toAg.id],
    locationName: world.locations.find((l) => l.id === fromAg.currentLocationId)?.name ?? 'Town',
  };

  return {
    ok: true,
    letter,
    world: {
      ...world,
      agents: nextAgents,
      letters: [letter, ...(world.letters ?? [])].slice(0, 120),
      chronicle: [chr, ...world.chronicle].slice(0, 140),
      stats: {
        ...world.stats,
        lettersSent: (world.stats.lettersSent ?? 0) + 1,
      },
    },
  };
}

export interface BdiDecisionTrigger {
  agentId: string;
  forkReason: string;
  urgency: number; // 0..1
}

/**
 * Evaluates whether an agent has reached a genuine Belief-Desire-Intention decision fork
 * warranting an autonomous LLM strategic decision (instead of mindlessly obeying
 * a static timetable or deterministic fallback).
 */
export function detectBdiDecisionFork(
  world: WorldState,
  agent: AgentState,
): BdiDecisionTrigger | null {
  if (world.ablations?.noPlanning) return null;
  if (agent.isThinking || agent.inConversationWith) return null;

  const calendar = getCalendarInfo(world.simMinutes);
  // Don't interrupt overnight sleep
  if (calendar.hour24 < 7 || calendar.hour24 >= 22) return null;

  // Responsive cooldown (>= 90 sim-min between strategic LLM forks per agent)
  const sinceLast = world.simMinutes - (agent.lastDecisionSimMin ?? -999);
  if (sinceLast < 90) return null;

  const wallet = agent.wallet ?? 120;
  const openProposals = (world.proposals ?? []).filter(
    (p) =>
      p.status === 'open' &&
      !p.votesFor.includes(agent.id) &&
      !p.votesAgainst.includes(agent.id),
  );
  const openPetitions = (world.petitions ?? []).filter(
    (p) => p.status === 'gathering' && !p.signerIds.includes(agent.id),
  );
  const activeProject = agent.projects?.find((p) => p.status === 'active');

  // Fork 1: Health shock (illness or low health)
  if ((agent.illness && agent.illness !== 'none') || (agent.health ?? 100) < 65) {
    const clinicLoc = world.locations.find((l) => l.id === 'smallville_clinic' || l.name.toLowerCase().includes('clinic'));
    const clinicHint = clinicLoc ? `${clinicLoc.name} (${clinicLoc.id})` : 'the town clinic';
    return {
      agentId: agent.id,
      forkReason: `Health alert (${agent.illness && agent.illness !== 'none' ? agent.illness.replace(/_/g, ' ') : 'low vitality'}, health ${Math.round(agent.health ?? 60)}/100) — decide whether to visit ${clinicHint} to buy medicine/seek care, rest at home, or scale back today's shifts.`,
      urgency: 0.94,
    };
  }

  // Fork 2: Financial distress or jobless cash crunch
  if (wallet < 75 || (!agent.employerLocationId && wallet < 90)) {
    return {
      agentId: agent.id,
      forkReason: !agent.employerLocationId
        ? `Unemployed with tight reserves ($${wallet.toFixed(0)} remaining) — decide whether to take a paid shift (work_shift), request a peer loan (propose_loan), launch a micro-venture, or post a job notice (post_notice).`
        : `Savings are running tight ($${wallet.toFixed(0)} remaining) — decide whether to pick up a paid work shift (work_shift), request a peer loan (propose_loan), or adjust spending.`,
      urgency: 0.9,
    };
  }

  // Fork 3: Betrayal, defaulted loan, breached contract, or sharp interpersonal trust rupture
  const recentDefaultAgainst = (world.loans ?? []).find(
    (l) =>
      l.lenderId === agent.id &&
      l.status === 'defaulted' &&
      calendar.day - (l.resolvedDay ?? calendar.day) <= 2,
  );
  const recentBreachAgainst = (world.serviceContracts ?? []).find(
    (c) =>
      c.proposerId === agent.id &&
      c.status === 'breached' &&
      calendar.day - (c.resolvedDay ?? calendar.day) <= 2,
  );
  const sharpConflictEntry = Object.entries(agent.socialGraph).find(
    ([, edge]) =>
      edge.trust < 28 &&
      world.simMinutes - edge.lastUpdatedSimMin <= 180,
  );
  if (recentDefaultAgainst || recentBreachAgainst || sharpConflictEntry) {
    const subjectId =
      recentDefaultAgainst?.borrowerId ??
      recentBreachAgainst?.counterpartyId ??
      sharpConflictEntry![0];
    const subjectName = world.agents.find((a) => a.id === subjectId)?.name ?? subjectId;
    return {
      agentId: agent.id,
      forkReason: recentDefaultAgainst
        ? `${subjectName} defaulted on your $${recentDefaultAgainst.principal} loan — decide whether to file_dispute at Town Hall, avoid_person, post_notice, or call_boycott if they run a business.`
        : recentBreachAgainst
          ? `${subjectName} breached your ${recentBreachAgainst.kind.replace(/_/g, ' ')} contract — decide whether to file_dispute, post_notice, or adjust plans.`
          : `Trust with ${subjectName} dropped sharply (${Math.round(sharpConflictEntry![1].trust)}) — decide whether to avoid_person, send_letter, or file_dispute.`,
      urgency: 0.86,
    };
  }

  // Fork 4: Active Mayoral Election voting opportunity (focal residents cast their own LLM ballot)
  if (
    world.election?.status === 'voting' &&
    !world.election.votersCast.includes(agent.id) &&
    calendar.hour24 >= 8 &&
    calendar.hour24 <= 19
  ) {
    const names = world.election.candidates.map((c) => c.name).join(', ');
    return {
      agentId: agent.id,
      forkReason: `Town Mayoral Election polls are open (${names}) and you have not voted yet — decide which candidate to vote for (vote_election) or whether to abstain.`,
      urgency: 0.88,
    };
  }

  // Fork 5: Encountered a closed business when planning to shop/eat/work there
  if (agent.currentLocationId && world.businesses?.[agent.currentLocationId]) {
    const biz = world.businesses[agent.currentLocationId];
    if (!isBusinessOpen(biz, calendar, world.townModifiers) && biz.ownerId !== agent.id) {
      return {
        agentId: agent.id,
        forkReason: `${biz.name} is currently closed (${biz.openHour}:00–${biz.closeHour}:00) — decide what alternative activity or venue to pursue.`,
        urgency: 0.8,
      };
    }
  }

  // Fork 5b: Active un-debunked rumor targeting self or a trusted peer -> fact_check or respond
  const troublingRumor = (world.rumors ?? []).find(
    (r) =>
      !r.debunked &&
      (r.subjectAgentId === agent.id ||
        (r.subjectAgentId !== undefined && (agent.socialGraph[r.subjectAgentId]?.trust ?? 45) >= 60)) &&
      (r.believerIds.includes(agent.id) || r.skepticIds.includes(agent.id) || r.subjectAgentId === agent.id),
  );
  if (troublingRumor && calendar.hour24 >= 8 && calendar.hour24 <= 20) {
    return {
      agentId: agent.id,
      forkReason: `Active rumor "${troublingRumor.currentClaim}" (rumorId=${troublingRumor.id}) affects you or a close peer — decide whether to investigate and fact_check at Town Hall/Library, file_dispute, or post_notice.`,
      urgency: 0.83,
    };
  }

  // Check high-urgency continuous intent-stack triggers (unread letters, approaching commitments)
  const intentTrigger = evaluateIntentStackExecutiveTrigger(world, agent);
  if (intentTrigger && intentTrigger.urgency >= 0.84) {
    return intentTrigger;
  }

  // Fork 6..10: Proactive opportunity forks use a slightly wider 150-min cadence so they don't crowd out conversations
  if (sinceLast < 150) {
    return intentTrigger && intentTrigger.urgency >= 0.8 ? intentTrigger : null;
  }

  // Fork 6: Organic Mayoral candidacy opportunity during campaigning for ambitious residents
  if (
    world.election?.status === 'campaigning' &&
    (agent.temperament?.ambition ?? 0.5) >= 0.72 &&
    !world.election.candidates.some((c) => c.agentId === agent.id) &&
    world.election.candidates.length < 5 &&
    calendar.hour24 >= 9 &&
    calendar.hour24 <= 18
  ) {
    return {
      agentId: agent.id,
      forkReason: `A Town Mayoral Election is approaching (Day ${world.election.electionDay}) — given your ambition and worldview, decide whether to declare candidacy (declare_candidacy), start a petition, or focus on your work.`,
      urgency: 0.76,
    };
  }

  // Fork 6b: Scheduled club meeting starting soon or currently underway
  const upcomingClub = (world.clubs ?? []).find(
    (c) =>
      c.memberIds.includes(agent.id) &&
      c.meetingWeekday === calendar.weekdayIndex &&
      (calendar.hour24 === c.meetingHour - 1 || calendar.hour24 === c.meetingHour) &&
      agent.currentLocationId !== c.locationId,
  );
  if (upcomingClub) {
    const clubVenue = world.locations.find((l) => l.id === upcomingClub.locationId)?.name ?? upcomingClub.locationId;
    return {
      agentId: agent.id,
      forkReason: `Your club "${upcomingClub.name}" meets at ${clubVenue} (${upcomingClub.locationId}) at ${upcomingClub.meetingHour}:00 — decide whether to head over (socialize at ${upcomingClub.locationId}) or stay on task.`,
      urgency: 0.74,
    };
  }

  // Fork 7: Open civic proposals or grassroots petitions — evaluate critically against worldview & budget
  if (
    (openProposals.length > 0 || openPetitions.length > 0) &&
    calendar.hour24 >= 9 &&
    calendar.hour24 <= 20
  ) {
    const proposalSummary = openProposals
      .slice(0, 2)
      .map((p) => `"${p.title}" (cost $${p.cost}, ${p.votesFor.length} for / ${p.votesAgainst.length} against)`)
      .join('; ');
    const worldviewNote = agent.dossier?.civicWorldview
      ? ` Your civic worldview is ${agent.dossier.civicWorldview}.`
      : '';
    return {
      agentId: agent.id,
      forkReason: `Town civic agenda has ${openProposals.length} open proposal(s)${proposalSummary ? ` [${proposalSummary}]` : ''} and ${openPetitions.length} petition(s).${worldviewNote} Decide whether to vote_proposal (support OR oppose), sign_petition, post_notice, or abstain.`,
      urgency: 0.75,
    };
  }

  // Fork 8: Entrepreneurial opportunity for well-funded, enterprising residents
  const hasActiveVenture = (world.ventures ?? []).some(
    (v) => v.founderId === agent.id && v.active,
  );
  if (
    wallet >= 185 &&
    (agent.temperament?.ambition ?? 0.5) >= 0.58 &&
    !hasActiveVenture &&
    calendar.hour24 >= 9 &&
    calendar.hour24 <= 18
  ) {
    return {
      agentId: agent.id,
      forkReason:
        world.genesisMode === 'open_genesis'
          ? `Healthy cash reserves ($${wallet.toFixed(0)}) create an opening — decide whether to launch a pop-up micro-venture (launch_venture), lend funds, or pursue an open_action initiative (e.g. founding a guild, credit fund, or custom service).`
          : `Healthy cash reserves ($${wallet.toFixed(0)}) create an opening — decide whether to launch a pop-up micro-venture (launch_venture), lend/transfer funds to a neighbor, or invest in your craft.`,
      urgency: 0.73,
    };
  }

  // Fork 9: Strong emotional tension or loneliness during midday/evening
  if (agent.drives.social < 38 && calendar.hour24 >= 10 && calendar.hour24 <= 21) {
    return {
      agentId: agent.id,
      forkReason: `Feeling isolated (social ${Math.round(agent.drives.social)}/100) — decide who to seek out (socialize) or whether to join a public gathering.`,
      urgency: 0.68,
    };
  }

  // Fork 9b: Active Town Shock or Civic Coalition Recruitment
  const activeShock = (world.activeShocks ?? []).find((s) => s.active);
  const activeCoalition = (world.coalitions ?? []).find(
    (c) => c.active && !c.memberIds.includes(agent.id),
  );
  const inAnyCoalition = (world.coalitions ?? []).some(
    (c) => c.active && c.memberIds.includes(agent.id),
  );
  if (
    (activeShock || activeCoalition || ((agent.temperament?.ambition ?? 0.5) >= 0.72 && !inAnyCoalition && (world.coalitions?.length ?? 0) < 3)) &&
    calendar.hour24 >= 10 &&
    calendar.hour24 <= 19 &&
    sinceLast >= 200
  ) {
    return {
      agentId: agent.id,
      forkReason: activeShock
        ? `Town condition alert ("${activeShock.title}") — decide whether to propose_contract for supply/patronage, join_coalition/form_coalition to coordinate town policy, or buy_item/work_shift.`
        : activeCoalition
          ? `Civic coalition "${activeCoalition.name}" (${activeCoalition.agenda.replace(/_/g, ' ')}) is active in town — decide whether to join_coalition, form_coalition of your own, or focus elsewhere.`
          : `Given your strong civic/economic ambition, decide whether to form_coalition, propose_contract with a neighbor, or advance your current projects.`,
      urgency: 0.67,
    };
  }

  // Fork 9c: High-importance recent memory warrants a public town notice or grassroots petition
  const salientRecentMem = agent.memories.find(
    (m) => m.importance >= 7 && world.simMinutes - m.createdAt <= 180,
  );
  const postedRecently = (world.notices ?? []).some(
    (n) => n.authorId === agent.id && world.simMinutes - n.createdAt < 720,
  );
  if (salientRecentMem && !postedRecently && calendar.hour24 >= 9 && calendar.hour24 <= 19) {
    return {
      agentId: agent.id,
      forkReason: `Recent salient event ("${salientRecentMem.description.slice(0, 90)}") — decide whether to inform neighbors via post_notice, organize a start_petition, or follow up personally.`,
      urgency: 0.65,
    };
  }

  // Fork 10: Mid-afternoon strategic project / ambition checkpoint (wider cadence so it doesn't monopolize BDI)
  if (
    sinceLast >= 220 &&
    activeProject &&
    activeProject.progress < 100 &&
    calendar.hour24 >= 13 &&
    calendar.hour24 <= 18 &&
    agent.drives.energy > 45
  ) {
    return {
      agentId: agent.id,
      forkReason: `Mid-day autonomy checkpoint: active project "${activeProject.title}" is at ${activeProject.progress}%, wallet is $${wallet.toFixed(0)} — decide your most meaningful next move (work_shift, socialize, post_notice, advance_project, or adjust_goal).`,
      urgency: 0.5,
    };
  }

  if (intentTrigger) {
    return intentTrigger;
  }

  return null;
}

/**
 * Applies an LLM (or offline utility) BDI autonomous decision directly to WorldState:
 * mutates real world mechanics (purchases, peer transfers, loans, ventures, petitions,
 * candidacies, election ballots, civic votes, public notices, project advancement,
 * goal revisions) AND schedules the corresponding grounded block.
 */
export function executePendingBdiAction(
  world: WorldState,
  agentId: string,
  pending: PendingBdiAction,
  allocId: (prefix: string) => string,
): { world: WorldState; summary: string; executed: boolean } {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return { world, summary: pending.reason, executed: false };
  let nextWorld = world;
  let summary = pending.reason;
  let executed = false;

  switch (pending.action) {
    case 'buy_item': {
      const itemKind = pending.itemKind ?? 'meal';
      const edible = ITEM_CATALOG[itemKind]?.edible ?? false;
      if (nextWorld.businesses?.[pending.targetLocationId]) {
        const res = executePurchaseAction(
          nextWorld,
          agentId,
          pending.targetLocationId,
          itemKind,
          edible,
          allocId,
        );
        if (res.ok) {
          nextWorld = res.world;
          summary = `Purchased ${itemKind} at ${nextWorld.businesses?.[pending.targetLocationId]?.name ?? pending.targetLocationId}`;
          executed = true;
        }
      }
      break;
    }

    case 'vote_proposal': {
      const openProp =
        (nextWorld.proposals ?? []).find(
          (p) => p.id === pending.proposalId && p.status === 'open',
        ) ??
        (nextWorld.proposals ?? []).find(
          (p) =>
            p.status === 'open' &&
            !p.votesFor.includes(agentId) &&
            !p.votesAgainst.includes(agentId),
        );
      if (openProp) {
        const res = castCivicVote(nextWorld, agentId, openProp.id, pending.voteSupport, allocId);
        nextWorld = res.world;
        summary = `Voted ${pending.voteSupport === false ? 'against' : 'for'} "${openProp.title}"`;
        executed = res.voted;
      }
      break;
    }

    case 'post_notice': {
      const title = (pending.noticeTitle ?? `${agent.name.split(' ')[0]}'s Community Update`).slice(0, 110);
      const body = (pending.noticeBody ?? pending.reason).slice(0, 360);
      nextWorld = postPublicNotice(
        nextWorld,
        {
          authorId: agent.id,
          authorName: agent.name,
          category: pending.noticeCategory ?? 'news',
          title,
          body,
          locationId: pending.targetLocationId,
        },
        allocId,
      );
      summary = `Posted public notice: "${title}"`;
      executed = true;
      break;
    }

    case 'advance_project': {
      const activeProj = agent.projects?.find((p) => p.status === 'active');
      if (activeProj) {
        const res = advanceAgentProject(nextWorld, agentId, 12, allocId);
        nextWorld = res.world;
        summary = `Made progress on "${activeProj.title}"`;
        executed = true;
      }
      break;
    }

    case 'transfer_money': {
      const targetRecipient =
        (pending.targetAgentId
          ? nextWorld.agents.find((a) => a.id === pending.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort((a, b) => {
            const scoreA = (agent.socialGraph[a.id]?.trust ?? 40) - (a.wallet ?? 120) * 0.2;
            const scoreB = (agent.socialGraph[b.id]?.trust ?? 40) - (b.wallet ?? 120) * 0.2;
            return scoreB - scoreA;
          })[0];
      if (targetRecipient) {
        const transferRes = executePeerTransfer(
          nextWorld,
          agent.id,
          targetRecipient.id,
          pending.transferAmount ?? 25,
          pending.reason,
          allocId,
        );
        nextWorld = transferRes.world;
        summary = transferRes.ok
          ? `Transferred $${pending.transferAmount ?? 25} to ${targetRecipient.name}`
          : `Transfer to ${targetRecipient.name} skipped: ${transferRes.reason}`;
        executed = transferRes.ok;
      }
      break;
    }

    case 'propose_loan': {
      const targetLender =
        (pending.targetAgentId
          ? nextWorld.agents.find((a) => a.id === pending.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id && (a.wallet ?? 0) >= 180)
          .sort(
            (a, b) =>
              (b.socialGraph[agent.id]?.trust ?? 40) - (a.socialGraph[agent.id]?.trust ?? 40),
          )[0];
      if (targetLender) {
        const res = issueBilateralLoan(
          nextWorld,
          targetLender.id,
          agent.id,
          pending.loanAmount ?? 50,
          3,
          allocId,
        );
        nextWorld = res.world;
        summary = res.ok
          ? `Secured a $${pending.loanAmount ?? 50} bilateral loan from ${targetLender.name}`
          : `Loan request declined by ${targetLender.name}: ${res.reason}`;
        executed = res.ok;
      }
      break;
    }

    case 'launch_venture': {
      const res = launchMicroVenture(nextWorld, agent.id, allocId, {
        name: pending.ventureName,
        locationId: pending.targetLocationId,
        itemKind: pending.itemKind,
      });
      nextWorld = res.world;
      summary = res.ok
        ? `Launched resident micro-venture "${res.venture?.name ?? 'Town Pop-Up'}"`
        : `Venture launch deferred: ${res.reason}`;
      executed = res.ok;
      break;
    }

    case 'sign_petition': {
      const targetPet =
        (pending.petitionId
          ? (nextWorld.petitions ?? []).find(
              (p) => p.id === pending.petitionId && p.status === 'gathering',
            )
          : undefined) ??
        (nextWorld.petitions ?? []).find(
          (p) => p.status === 'gathering' && !p.signerIds.includes(agent.id),
        );
      if (targetPet) {
        const res = signCitizenPetition(nextWorld, agent.id, targetPet.id, allocId, false);
        nextWorld = res.world;
        summary = res.signed
          ? `Signed grassroots petition "${targetPet.title}"${res.escalated ? ' (reached quorum!)' : ''}`
          : `Declined petition "${targetPet.title}": ${res.reason}`;
        executed = res.signed;
      }
      break;
    }

    case 'start_petition': {
      const res = startCitizenPetition(
        nextWorld,
        agent.id,
        {
          title: pending.petitionTitle ?? `${agent.name.split(' ')[0]}'s Civic Initiative`,
          description: pending.petitionDescription ?? pending.reason,
          effectKey: pending.petitionEffect ?? 'communityClinic',
        },
        allocId,
      );
      nextWorld = res.world;
      summary = res.ok
        ? `Started grassroots petition "${res.petition?.title ?? 'Town Petition'}"`
        : `Petition creation deferred: ${res.reason}`;
      executed = res.ok;
      break;
    }

    case 'declare_candidacy': {
      const res = declareMayoralCandidacy(
        nextWorld,
        agent.id,
        pending.platform ?? pending.reason,
        allocId,
      );
      nextWorld = res.world;
      summary = res.ok
        ? `Declared candidacy for Mayor on platform: "${(pending.platform ?? pending.reason).slice(0, 120)}"`
        : `Candidacy deferred: ${res.reason}`;
      executed = res.ok;
      break;
    }

    case 'vote_election': {
      const preferredId = pending.candidateId ?? pending.targetAgentId;
      const res = castElectionVote(nextWorld, agent.id, allocId, preferredId);
      nextWorld = res.world;
      const chosenName =
        nextWorld.election?.candidates.find((c) => c.agentId === res.votedForId)?.name ??
        res.votedForId;
      summary = res.votedForId
        ? `Cast mayoral election ballot for ${chosenName}`
        : 'Visited polls during election window';
      executed = Boolean(res.votedForId);
      break;
    }

    case 'send_letter': {
      const recipientId = pending.targetAgentId;
      if (recipientId) {
        const recentReply = (nextWorld.letters ?? []).find(
          (l) =>
            l.toAgentId === agent.id &&
            l.fromAgentId === recipientId &&
            l.deliveredAt <= nextWorld.simMinutes &&
            !(nextWorld.letters ?? []).some((r) => r.replyToLetterId === l.id),
        );
        const res = sendPrivateLetter(
          nextWorld,
          {
            fromAgentId: agent.id,
            toAgentId: recipientId,
            subject: pending.letterSubject ?? 'A note from Smallville',
            body: pending.letterBody ?? pending.reason,
            replyToLetterId: recentReply?.id,
          },
          allocId,
        );
        nextWorld = res.world;
        executed = res.ok;
        summary = res.ok
          ? `Sent private letter to ${nextWorld.agents.find((a) => a.id === recipientId)?.name ?? recipientId}`
          : 'Could not send private letter';
      }
      break;
    }

    case 'propose_contract': {
      const counterpartyId = pending.targetAgentId;
      if (counterpartyId) {
        const res = createServiceContract(
          nextWorld,
          {
            proposerId: agent.id,
            counterpartyId,
            kind: pending.contractKind ?? 'patronage',
            terms: pending.contractTerms ?? pending.reason,
            agreedAmount: pending.contractAmount ?? 40,
            locationId: pending.targetLocationId,
            itemKind: pending.itemKind,
          },
          allocId,
        );
        nextWorld = res.world;
        executed = res.ok;
        summary = res.ok
          ? `Signed ${(pending.contractKind ?? 'patronage').replace(/_/g, ' ')} contract with ${nextWorld.agents.find((a) => a.id === counterpartyId)?.name ?? counterpartyId}`
          : `Contract deferred: ${res.reason}`;
      }
      break;
    }

    case 'file_dispute': {
      const respondentId = pending.targetAgentId;
      if (respondentId) {
        const res = fileCivicDispute(
          nextWorld,
          {
            claimantId: agent.id,
            respondentId,
            category: pending.disputeCategory,
            claimSummary: pending.disputeClaim ?? pending.reason,
            claimedAmount: pending.disputeAmount,
          },
          allocId,
        );
        nextWorld = res.world;
        executed = res.ok;
        summary = res.ok
          ? `Filed civic dispute against ${nextWorld.agents.find((a) => a.id === respondentId)?.name ?? respondentId}`
          : `Dispute filing skipped: ${res.reason}`;
      }
      break;
    }

    case 'form_coalition': {
      const res = formCivicCoalition(
        nextWorld,
        {
          founderId: agent.id,
          name: pending.coalitionName,
          agenda: pending.coalitionAgenda,
        },
        allocId,
      );
      nextWorld = res.world;
      executed = res.ok;
      summary = res.ok
        ? `Founded civic coalition "${res.coalition?.name ?? 'Town Bloc'}"`
        : `Coalition deferred: ${res.reason}`;
      break;
    }

    case 'join_coalition': {
      const targetCoal =
        (pending.coalitionId
          ? (nextWorld.coalitions ?? []).find((c) => c.id === pending.coalitionId && c.active)
          : undefined) ??
        (nextWorld.coalitions ?? []).find(
          (c) => c.active && !c.memberIds.includes(agent.id),
        );
      if (targetCoal) {
        const res = joinCivicCoalition(nextWorld, agent.id, targetCoal.id, allocId, false);
        nextWorld = res.world;
        executed = res.ok;
        summary = res.ok
          ? `Joined coalition "${targetCoal.name}"`
          : `Declined coalition "${targetCoal.name}": ${res.reason}`;
      }
      break;
    }

    case 'call_boycott': {
      const locId = pending.boycottLocationId ?? pending.targetLocationId;
      if (nextWorld.businesses?.[locId]) {
        const res = callEconomicBoycott(
          nextWorld,
          {
            organizerId: agent.id,
            targetLocationId: locId,
            reason: pending.boycottReason ?? pending.reason,
          },
          allocId,
        );
        nextWorld = res.world;
        executed = res.ok;
        summary = res.ok
          ? `Called consumer boycott of ${nextWorld.businesses?.[locId]?.name ?? locId}`
          : `Boycott skipped: ${res.reason}`;
      }
      break;
    }

    case 'spread_rumor': {
      const claim = pending.rumorClaim ?? pending.reason;
      const res = createOrSpreadRumor(
        nextWorld,
        {
          speakerId: agent.id,
          targetAgentId: pending.targetAgentId,
          subjectAgentId: pending.targetAgentId,
          subjectLocationId: pending.targetLocationId,
          claim,
          isDeceptive: Boolean(pending.isDeceptive),
          existingRumorId: pending.rumorId,
        },
        allocId,
      );
      nextWorld = res.world;
      executed = res.ok;
      summary = res.ok
        ? `Circulated town rumor: "${claim.slice(0, 90)}"`
        : 'Skipped spreading rumor';
      break;
    }

    case 'fact_check': {
      const targetRumor =
        (pending.rumorId
          ? (nextWorld.rumors ?? []).find((r) => r.id === pending.rumorId && !r.debunked)
          : undefined) ??
        (nextWorld.rumors ?? []).find((r) => !r.debunked);
      if (targetRumor) {
        const res = factCheckRumor(nextWorld, agent.id, targetRumor.id, allocId);
        nextWorld = res.world;
        executed = res.ok;
        summary = res.summary;
      }
      break;
    }

    case 'endorse_norm': {
      const normKey = pending.normKey ?? 'civic_duty';
      const res = endorseCulturalNorm(nextWorld, agent.id, normKey, allocId);
      nextWorld = res.world;
      executed = res.ok;
      summary = res.reason;
      break;
    }

    case 'open_action': {
      const intent = pending.reason;
      const ops =
        pending.openOps && pending.openOps.length > 0
          ? pending.openOps
          : compileOfflineOpenAction(nextWorld, agent.id, intent);
      const res = applyArbitratedOpenAction(nextWorld, agent.id, intent, ops, allocId);
      nextWorld = res.world;
      executed = res.appliedCount > 0;
      summary = res.record?.narrative ?? `Pursued open initiative: ${intent.slice(0, 90)}`;
      break;
    }
  }

  return { world: nextWorld, summary, executed };
}

/**
 * Applies an LLM (or offline utility) BDI autonomous decision directly to WorldState:
 * mutates real world mechanics (purchases, peer transfers, loans, ventures, petitions,
 * candidacies, election ballots, civic votes, public notices, project advancement,
 * goal revisions) AND schedules the corresponding grounded block.
 * When `options.deferUntilArrival` is true, location-grounded actions wait until physical arrival.
 */
export function applyBdiDecisionResult(
  world: WorldState,
  agentId: string,
  decision: BdiDecisionResult,
  allocId: (prefix: string) => string,
  patchSchedule: (schedule: ScheduleBlock[], block: ScheduleBlock) => ScheduleBlock[],
  options?: { deferUntilArrival?: boolean },
): WorldState {
  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return world;

  let nextWorld = world;
  const calendar = getCalendarInfo(world.simMinutes);
  let actionSummary = decision.reason;
  let targetLocationId =
    decision.locationId && world.locations.some((l) => l.id === decision.locationId)
      ? decision.locationId
      : agent.currentLocationId ?? agent.homeLocationId;
  let blockKind: ScheduleBlock['kind'] = 'work';
  let emoji = decision.emoji ?? '🧭';
  let activity = decision.activity ?? decision.reason;
  let pendingAction: PendingBdiAction | undefined;
  let nextSocialTarget: ActiveSocialTarget | undefined = undefined;
  const deferOnDistance = Boolean(options?.deferUntilArrival);
  const duration = Math.max(30, Math.min(120, Math.round(decision.durationMinutes ?? 55)));

  const maybeExecuteOrDefer = (pending: PendingBdiAction) => {
    if (deferOnDistance && agent.currentLocationId !== pending.targetLocationId) {
      pendingAction = pending;
    } else {
      const res = executePendingBdiAction(nextWorld, agentId, pending, allocId);
      nextWorld = res.world;
      actionSummary = res.summary;
    }
  };

  // Execute or queue real typed world side-effects
  switch (decision.action) {
    case 'buy_item': {
      const foodVenue = findNearestOpenFoodVenue(nextWorld, agent);
      const buyLocId =
        decision.locationId && nextWorld.businesses?.[decision.locationId]
          ? decision.locationId
          : foodVenue.locationId;
      const itemKind = decision.itemKind ?? foodVenue.itemKind ?? 'meal';
      const pendingBuy: PendingBdiAction = {
        action: 'buy_item',
        targetLocationId: buyLocId,
        itemKind,
        reason: decision.reason,
      };
      if (agent.currentLocationId === buyLocId && nextWorld.businesses?.[buyLocId]) {
        const res = executePendingBdiAction(nextWorld, agentId, pendingBuy, allocId);
        nextWorld = res.world;
        actionSummary = res.summary;
      } else {
        pendingAction = pendingBuy;
      }
      targetLocationId = buyLocId;
      blockKind = ITEM_CATALOG[itemKind]?.edible ? 'meal' : 'errand';
      emoji = decision.emoji ?? '🛍️';
      activity = decision.activity ?? `Picking up ${itemKind} at ${nextWorld.locations.find((l) => l.id === buyLocId)?.name ?? 'town shop'}`;
      break;
    }

    case 'consume_item': {
      const res = executeConsumeItemAction(nextWorld, agentId, decision.itemKind);
      nextWorld = res.world;
      targetLocationId = agent.homeLocationId;
      blockKind = 'meal';
      emoji = decision.emoji ?? '🍲';
      activity = decision.activity ?? 'Preparing and eating a home-cooked meal';
      break;
    }

    case 'vote_proposal': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'vote_proposal',
        targetLocationId,
        proposalId: decision.proposalId,
        voteSupport: decision.voteSupport,
        reason: decision.reason,
      });
      blockKind = 'errand';
      emoji = decision.emoji ?? '🗳️';
      activity = decision.activity ?? 'Participating in town civic ballot';
      break;
    }

    case 'post_notice': {
      const title = (decision.noticeTitle ?? decision.activity ?? `${agent.name.split(' ')[0]}'s Community Update`).slice(0, 110);
      const body = (decision.noticeBody ?? decision.reason).slice(0, 360);
      maybeExecuteOrDefer({
        action: 'post_notice',
        targetLocationId,
        noticeTitle: title,
        noticeBody: body,
        noticeCategory: decision.noticeCategory ?? 'news',
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '📌';
      activity = decision.activity ?? `Posting notice: ${title}`;
      break;
    }

    case 'advance_project': {
      const activeProj = agent.projects?.find((p) => p.status === 'active');
      if (activeProj) {
        targetLocationId = activeProj.targetLocationId;
        maybeExecuteOrDefer({
          action: 'advance_project',
          targetLocationId,
          reason: decision.reason,
        });
      }
      blockKind = 'work';
      emoji = decision.emoji ?? '🛠️';
      activity = decision.activity ?? (activeProj ? `Advancing project: ${activeProj.title}` : 'Focused craft session');
      break;
    }

    case 'work_shift': {
      targetLocationId = agent.employerLocationId ?? targetLocationId;
      blockKind = 'work';
      emoji = decision.emoji ?? '💼';
      activity = decision.activity ?? `Working a paid shift at ${nextWorld.locations.find((l) => l.id === targetLocationId)?.name ?? 'workplace'}`;
      break;
    }

    case 'socialize': {
      if (decision.targetAgentId) {
        const targetAg = nextWorld.agents.find(
          (a) => a.id === decision.targetAgentId && a.id !== agent.id,
        );
        if (targetAg) {
          if (targetAg.currentLocationId) targetLocationId = targetAg.currentLocationId;
          nextSocialTarget = {
            mode: 'seek',
            targetAgentId: targetAg.id,
            reason: decision.reason.slice(0, 140),
            expiresAtSimMin: nextWorld.simMinutes + duration,
          };
        }
      }
      blockKind = 'social';
      emoji = decision.emoji ?? '💬';
      activity = decision.activity ?? 'Meeting neighbors to talk and catch up';
      break;
    }

    case 'seek_person': {
      const targetAg =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort(
            (a, b) =>
              (agent.socialGraph[b.id]?.affection ?? 40) -
              (agent.socialGraph[a.id]?.affection ?? 40),
          )[0];
      if (targetAg) {
        if (targetAg.currentLocationId) targetLocationId = targetAg.currentLocationId;
        nextSocialTarget = {
          mode: 'seek',
          targetAgentId: targetAg.id,
          reason: decision.reason.slice(0, 140),
          expiresAtSimMin: nextWorld.simMinutes + duration,
        };
        actionSummary = `Seeking out ${targetAg.name}: ${decision.reason}`;
        activity = decision.activity ?? `Walking to meet ${targetAg.name.split(' ')[0]}`;
      }
      blockKind = 'social';
      emoji = decision.emoji ?? '🚶';
      break;
    }

    case 'avoid_person': {
      const avoidAg =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort(
            (a, b) =>
              (agent.socialGraph[a.id]?.trust ?? 50) - (agent.socialGraph[b.id]?.trust ?? 50),
          )[0];
      if (avoidAg) {
        nextSocialTarget = {
          mode: 'avoid',
          targetAgentId: avoidAg.id,
          reason: decision.reason.slice(0, 140),
          expiresAtSimMin: nextWorld.simMinutes + duration,
        };
        if (
          targetLocationId === avoidAg.currentLocationId ||
          agent.currentLocationId === avoidAg.currentLocationId
        ) {
          targetLocationId =
            agent.homeLocationId !== avoidAg.currentLocationId
              ? agent.homeLocationId
              : 'harvey_library';
        }
        actionSummary = `Keeping distance from ${avoidAg.name}`;
        activity = decision.activity ?? `Stepping away for quiet focus`;
      }
      blockKind = 'leisure';
      emoji = decision.emoji ?? '🫥';
      break;
    }

    case 'send_letter': {
      const recipient =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents.find((a) => a.id !== agent.id);
      if (recipient) {
        const res = executePendingBdiAction(
          nextWorld,
          agentId,
          {
            action: 'send_letter',
            targetLocationId: agent.currentLocationId ?? agent.homeLocationId,
            targetAgentId: recipient.id,
            letterSubject: decision.letterSubject ?? decision.activity ?? 'A private note',
            letterBody: decision.letterBody ?? decision.reason,
            reason: decision.reason,
          },
          allocId,
        );
        nextWorld = res.world;
        actionSummary = res.summary;
        activity = decision.activity ?? `Writing a private letter to ${recipient.name.split(' ')[0]}`;
      }
      blockKind = 'errand';
      emoji = decision.emoji ?? '✉️';
      break;
    }

    case 'rest': {
      targetLocationId = agent.homeLocationId;
      blockKind = 'rest';
      emoji = decision.emoji ?? '🛋️';
      activity = decision.activity ?? 'Taking a restorative break at home';
      break;
    }

    case 'adjust_goal': {
      blockKind = 'leisure';
      emoji = decision.emoji ?? '🧭';
      activity = decision.activity ?? decision.reason;
      break;
    }

    case 'transfer_money': {
      const targetRecipient =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort((a, b) => {
            const scoreA = (agent.socialGraph[a.id]?.trust ?? 40) - (a.wallet ?? 120) * 0.2;
            const scoreB = (agent.socialGraph[b.id]?.trust ?? 40) - (b.wallet ?? 120) * 0.2;
            return scoreB - scoreA;
          })[0];
      if (targetRecipient) {
        if (targetRecipient.currentLocationId) {
          targetLocationId = targetRecipient.currentLocationId;
        }
        maybeExecuteOrDefer({
          action: 'transfer_money',
          targetLocationId,
          targetAgentId: targetRecipient.id,
          transferAmount: decision.transferAmount ?? 25,
          reason: decision.reason,
        });
      }
      blockKind = 'errand';
      emoji = decision.emoji ?? '🤝';
      activity = decision.activity ?? actionSummary;
      break;
    }

    case 'propose_loan': {
      const targetLender =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id && (a.wallet ?? 0) >= 180)
          .sort(
            (a, b) =>
              (b.socialGraph[agent.id]?.trust ?? 40) - (a.socialGraph[agent.id]?.trust ?? 40),
          )[0];
      if (targetLender) {
        if (targetLender.currentLocationId) {
          targetLocationId = targetLender.currentLocationId;
        }
        maybeExecuteOrDefer({
          action: 'propose_loan',
          targetLocationId,
          targetAgentId: targetLender.id,
          loanAmount: decision.loanAmount ?? 50,
          reason: decision.reason,
        });
      }
      blockKind = 'errand';
      emoji = decision.emoji ?? '🧾';
      activity = decision.activity ?? 'Negotiating a peer credit agreement';
      break;
    }

    case 'launch_venture': {
      const ventureLoc =
        decision.locationId && nextWorld.locations.some((l) => l.id === decision.locationId)
          ? decision.locationId
          : 'johnson_park';
      targetLocationId = ventureLoc;
      maybeExecuteOrDefer({
        action: 'launch_venture',
        targetLocationId,
        ventureName: decision.ventureName,
        itemKind: decision.itemKind,
        reason: decision.reason,
      });
      blockKind = 'work';
      emoji = decision.emoji ?? '🏪';
      activity = decision.activity ?? `Setting up ${decision.ventureName ?? 'pop-up micro-venture'}`;
      break;
    }

    case 'sign_petition': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'sign_petition',
        targetLocationId,
        petitionId: decision.petitionId,
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '✍️';
      activity = decision.activity ?? 'Reviewing grassroots community petitions';
      break;
    }

    case 'start_petition': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'start_petition',
        targetLocationId,
        petitionTitle: decision.petitionTitle ?? decision.activity ?? `${agent.name.split(' ')[0]}'s Civic Initiative`,
        petitionDescription: decision.petitionDescription ?? decision.reason,
        petitionEffect: decision.petitionEffect ?? 'communityClinic',
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '📣';
      activity = decision.activity ?? `Organizing petition: ${decision.petitionTitle ?? 'Community Initiative'}`;
      break;
    }

    case 'declare_candidacy': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'declare_candidacy',
        targetLocationId,
        platform: decision.platform ?? decision.reason,
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '🏛️';
      activity = decision.activity ?? 'Announcing mayoral campaign platform at Town Hall';
      break;
    }

    case 'vote_election': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'vote_election',
        targetLocationId,
        candidateId: decision.candidateId ?? decision.targetAgentId,
        reason: decision.reason,
      });
      blockKind = 'errand';
      emoji = decision.emoji ?? '🗳️';
      activity = decision.activity ?? `Casting ballot in the Town Mayoral Election`;
      break;
    }

    case 'propose_contract': {
      const counterparty =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort(
            (a, b) =>
              (agent.socialGraph[b.id]?.trust ?? 40) - (agent.socialGraph[a.id]?.trust ?? 40),
          )[0];
      if (counterparty) {
        if (counterparty.currentLocationId) targetLocationId = counterparty.currentLocationId;
        maybeExecuteOrDefer({
          action: 'propose_contract',
          targetLocationId,
          targetAgentId: counterparty.id,
          contractKind: decision.contractKind ?? 'patronage',
          contractTerms: decision.contractTerms ?? decision.reason,
          contractAmount: decision.contractAmount ?? 40,
          itemKind: decision.itemKind,
          reason: decision.reason,
        });
      }
      blockKind = 'social';
      emoji = decision.emoji ?? '📜';
      activity = decision.activity ?? 'Negotiating a formal bilateral service contract';
      break;
    }

    case 'file_dispute': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      const respondent =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents
          .filter((a) => a.id !== agent.id)
          .sort(
            (a, b) =>
              (agent.socialGraph[a.id]?.trust ?? 50) - (agent.socialGraph[b.id]?.trust ?? 50),
          )[0];
      if (respondent) {
        maybeExecuteOrDefer({
          action: 'file_dispute',
          targetLocationId,
          targetAgentId: respondent.id,
          disputeCategory: decision.disputeCategory,
          disputeClaim: decision.disputeClaim ?? decision.reason,
          disputeAmount: decision.disputeAmount,
          reason: decision.reason,
        });
      }
      blockKind = 'errand';
      emoji = decision.emoji ?? '⚖️';
      activity = decision.activity ?? 'Filing a formal dispute at Town Hall';
      break;
    }

    case 'form_coalition': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'form_coalition',
        targetLocationId,
        coalitionName: decision.coalitionName,
        coalitionAgenda: decision.coalitionAgenda,
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '🏴';
      activity = decision.activity ?? `Organizing coalition: ${decision.coalitionName ?? 'Civic Bloc'}`;
      break;
    }

    case 'join_coalition': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'join_coalition',
        targetLocationId,
        coalitionId: decision.coalitionId,
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '🤝';
      activity = decision.activity ?? 'Joining a neighborhood civic coalition';
      break;
    }

    case 'call_boycott': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      const targetBizLocId =
        decision.boycottLocationId && nextWorld.businesses?.[decision.boycottLocationId]
          ? decision.boycottLocationId
          : decision.locationId && nextWorld.businesses?.[decision.locationId]
            ? decision.locationId
            : Object.values(nextWorld.businesses ?? {}).find((b) => b.ownerId !== agent.id)?.locationId;
      targetLocationId = civicLoc?.id ?? targetLocationId;
      if (targetBizLocId) {
        maybeExecuteOrDefer({
          action: 'call_boycott',
          targetLocationId,
          boycottLocationId: targetBizLocId,
          boycottReason: decision.boycottReason ?? decision.reason,
          reason: decision.reason,
        });
      }
      blockKind = 'social';
      emoji = decision.emoji ?? '🪧';
      activity = decision.activity ?? 'Organizing a consumer boycott notice';
      break;
    }

    case 'spread_rumor': {
      const peer =
        (decision.targetAgentId
          ? nextWorld.agents.find((a) => a.id === decision.targetAgentId && a.id !== agent.id)
          : undefined) ??
        nextWorld.agents.find((a) => a.id !== agent.id && a.currentLocationId === agent.currentLocationId);
      if (peer?.currentLocationId) targetLocationId = peer.currentLocationId;
      maybeExecuteOrDefer({
        action: 'spread_rumor',
        targetLocationId,
        targetAgentId: peer?.id,
        rumorId: decision.rumorId,
        rumorClaim: decision.rumorClaim ?? decision.reason,
        isDeceptive: decision.isDeceptive,
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '🗣️';
      activity = decision.activity ?? 'Sharing neighborhood word around town';
      break;
    }

    case 'fact_check': {
      const civicOrLib =
        nextWorld.locations.find((l) => l.category === 'civic') ??
        nextWorld.locations.find((l) => l.category === 'college');
      targetLocationId = civicOrLib?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'fact_check',
        targetLocationId,
        rumorId: decision.rumorId,
        reason: decision.reason,
      });
      blockKind = 'errand';
      emoji = decision.emoji ?? '🔎';
      activity = decision.activity ?? 'Checking public records to verify a town rumor';
      break;
    }

    case 'endorse_norm': {
      const civicLoc = nextWorld.locations.find((l) => l.category === 'civic');
      targetLocationId = civicLoc?.id ?? targetLocationId;
      maybeExecuteOrDefer({
        action: 'endorse_norm',
        targetLocationId,
        normKey: decision.normKey ?? 'civic_duty',
        reason: decision.reason,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '🏛️';
      activity = decision.activity ?? 'Championing shared town standards at Town Hall';
      break;
    }

    case 'open_action': {
      const openIntent = decision.openIntent ?? decision.reason;
      maybeExecuteOrDefer({
        action: 'open_action',
        targetLocationId,
        openIntent,
        openOps: decision.openOps,
        reason: openIntent,
      });
      blockKind = 'social';
      emoji = decision.emoji ?? '✨';
      activity = decision.activity ?? `Pursuing initiative: ${openIntent.slice(0, 90)}`;
      break;
    }
  }

  const resolvedObj =
    decision.objectId &&
    nextWorld.objects.some((o) => o.id === decision.objectId && o.locationId === targetLocationId)
      ? decision.objectId
      : findObjectForLocation(nextWorld.objects, targetLocationId, ['desk', 'counter', 'table', 'bench', 'workbench'])?.id;

  const newBlock: ScheduleBlock = {
    id: allocId(`bdi_${agent.id}`),
    day: calendar.day,
    kind: blockKind,
    oneOff: true,
    startMinute: calendar.minuteOfDay,
    durationMinutes: duration,
    locationId: targetLocationId,
    objectId: resolvedObj,
    activity: activity.slice(0, 140),
    subSteps: [actionSummary.slice(0, 90), 'Evaluating outcome and next priority'],
    emoji,
    source: 'bdi_decision',
    ...(pendingAction ? { pendingAction } : {}),
  };

  const decisionMem = createMemoryNode({
    id: allocId(`dec_${agent.id}`),
    createdAt: nextWorld.simMinutes,
    type: 'plan',
    source: 'decision',
    description: `${agent.name} autonomously decided (${decision.action}): ${actionSummary}.`,
    importance: 6,
  });

  const nextAgents = nextWorld.agents.map((a) => {
    if (a.id !== agentId) return a;
    const nextGoals =
      decision.newGoal && decision.newGoal.trim().length > 4
        ? [decision.newGoal.trim().slice(0, 140), ...a.goals.filter((g) => g !== decision.newGoal)].slice(0, 4)
        : a.goals;
    const linkRes = attachAssociativeLinks(decisionMem, a.memories);
    return {
      ...a,
      isThinking: false,
      currently: activity.slice(0, 160),
      goals: nextGoals,
      lastDecisionSimMin: nextWorld.simMinutes,
      socialTarget: nextSocialTarget ?? (decision.action === 'work_shift' || decision.action === 'rest' ? undefined : a.socialTarget),
      intentStack: advanceAmbitionFromAction(
        a,
        decision.action,
        decision.ambitionTitle ?? decision.newGoal,
        nextWorld.simMinutes,
        allocId,
      ),
      dailySchedule: patchSchedule(a.dailySchedule, newBlock),
      memories: compactMemories(
        [linkRes.linkedNode, ...linkRes.updatedExisting],
        DEFAULT_MEMORY_CAP,
        nextWorld.simMinutes,
        allocId,
      ),
      importanceAccumulator: a.importanceAccumulator + decisionMem.importance,
    };
  });

  const locName = nextWorld.locations.find((l) => l.id === targetLocationId)?.name ?? 'Town';
  const chr: ChronicleEvent = {
    id: allocId('chr_bdi'),
    simMinutes: nextWorld.simMinutes,
    type: 'plan',
    title: `${agent.name} decided to ${decision.action.replace(/_/g, ' ')}`,
    detail: `${actionSummary} (${locName})`,
    agentIds: [agent.id],
    locationName: locName,
  };

  return {
    ...nextWorld,
    agents: nextAgents,
    chronicle: [chr, ...nextWorld.chronicle].slice(0, 140),
    stats: {
      ...nextWorld.stats,
      bdiDecisions: (nextWorld.stats.bdiDecisions ?? 0) + 1,
    },
  };
}
