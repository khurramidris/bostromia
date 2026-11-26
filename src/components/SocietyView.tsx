import { memo, useMemo, useState } from 'react';
import {
  computeDiversitySnapshot,
  getCollapseDiagnosticLabel,
} from '../simulation/diversityMetrics';
import { computeMacroSnapshot } from '../simulation/institutions';
import { formatSimTime, getShortFirstName } from '../simulation/memory';
import { ALLOWED_SCALE_PRESETS, getTierCounts } from '../simulation/scaleGenerator';
import type { NoticeCategory, TownModifierKey, WorldState } from '../simulation/types';
import { getCalendarInfo, isBusinessOpen } from '../simulation/worldEconomy';

interface SocietyViewProps {
  world: WorldState;
  llmCallsToday?: number;
  onSelectAgentAndMap: (agentId: string) => void;
  onPostNotice?: (params: {
    title: string;
    body: string;
    category: NoticeCategory;
    locationId?: string;
  }) => void;
  onCreateProposal?: (params: {
    title: string;
    description: string;
    cost: number;
    effectKey: TownModifierKey;
  }) => void;
  onToggleCompressedScenes?: (enabled: boolean) => void;
  onScalePopulation?: (targetCount: number) => void;
  onOpenElection?: () => void;
  onFinalizeElection?: () => void;
  onSponsorPetition?: (petitionId: string) => void;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function formatHour(h: number): string {
  const norm = ((Math.floor(h) % 24) + 24) % 24;
  const ampm = norm >= 12 ? 'PM' : 'AM';
  const h12 = norm % 12 === 0 ? 12 : norm % 12;
  return `${h12}${ampm}`;
}

export const SocietyView = memo(function SocietyView({
  world,
  llmCallsToday,
  onSelectAgentAndMap,
  onPostNotice,
  onCreateProposal,
  onToggleCompressedScenes,
  onScalePopulation,
  onOpenElection,
  onFinalizeElection,
  onSponsorPetition,
}: SocietyViewProps) {
  const [focusAgentId, setFocusAgentId] = useState<string>(world.agents[0]?.id ?? 'isabella');

  // Notice composer state
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeCategory, setNoticeCategory] = useState<NoticeCategory>('event');

  // Civic proposal composer state
  const [propTitle, setPropTitle] = useState('');
  const [propDesc, setPropDesc] = useState('');
  const [propCost, setPropCost] = useState('140');
  const [propEffect, setPropEffect] = useState<TownModifierKey>('streetLighting');

  const agentById = useMemo(
    () => new Map(world.agents.map((a) => [a.id, a])),
    [world.agents],
  );

  const focusAgent = agentById.get(focusAgentId) ?? world.agents[0];
  const stats = world.stats ?? {
    system1Greetings: 0,
    driveInterrupts: 0,
    perceptionEvents: 0,
    socialCommitments: 0,
    llmCallsSaved: 0,
    llmCallsMade: 0,
    tokensUsed: 0,
  };
  const llmCallsMade = Math.max(stats.llmCallsMade ?? 0, llmCallsToday ?? 0);
  const calendar = getCalendarInfo(world.simMinutes);
  const businesses = useMemo(
    () => Object.values(world.businesses ?? {}),
    [world.businesses],
  );
  const notices = world.notices ?? [];
  const proposals = world.proposals ?? [];
  const modifiers = world.townModifiers ?? {
    streetLighting: false,
    marketStipend: false,
    extendedLibrary: false,
    communityClinic: false,
  };

  const openBusinessesCount = useMemo(
    () => businesses.filter((b) => isBusinessOpen(b, calendar, modifiers)).length,
    [businesses, calendar, modifiers],
  );

  const liveMacro = useMemo(() => computeMacroSnapshot(world), [world]);
  const liveDiversity = useMemo(() => computeDiversitySnapshot(world), [world]);
  const diversityLabel = getCollapseDiagnosticLabel(liveDiversity.collapseRiskLevel);
  const tierCounts = useMemo(() => getTierCounts(world.agents), [world.agents]);
  const macroHistory = world.macroHistory ?? [];
  const leadership = world.leadership;
  const election = world.election;
  const jobPostings = world.jobPostings ?? [];
  const clubs = world.clubs ?? [];
  const loans = world.loans ?? [];
  const petitions = world.petitions ?? [];
  const ventures = world.ventures ?? [];
  const housingSummary = useMemo(() => {
    const counts = { owner: 0, renter: 0, shared: 0 };
    const tiers = { master: 0, senior: 0, practitioner: 0, apprentice: 0 };
    let sharedPartners = 0;
    for (const ag of world.agents) {
      const h = ag.housingStatus ?? 'renter';
      counts[h] += 1;
      const c = ag.careerTier ?? 'practitioner';
      tiers[c] += 1;
      if ((ag.householdPartnerIds?.length ?? 0) > 0) sharedPartners += 1;
    }
    return { counts, tiers, sharedPartners };
  }, [world.agents]);
  const locationNameById = useMemo(
    () => new Map(world.locations.map((l) => [l.id, l.name])),
    [world.locations],
  );

  // Cap SVG social network nodes to 18 at high population scales so labels stay crisp
  const graphAgents = useMemo(() => {
    if (world.agents.length <= 24) return world.agents;
    const picked = new Map<string, (typeof world.agents)[number]>();
    if (focusAgent) picked.set(focusAgent.id, focusAgent);
    if (focusAgent) {
      const peers = Object.values(focusAgent.socialGraph)
        .sort((a, b) => b.familiarity + b.trust - (a.familiarity + a.trust))
        .map((e) => agentById.get(e.targetId))
        .filter((a): a is (typeof world.agents)[number] => Boolean(a));
      for (const peer of peers) {
        if (picked.size >= 18) break;
        picked.set(peer.id, peer);
      }
    }
    for (const ag of world.agents) {
      if (picked.size >= 18) break;
      if ((ag.tier ?? 'focal') === 'focal') picked.set(ag.id, ag);
    }
    for (const ag of world.agents) {
      if (picked.size >= 18) break;
      picked.set(ag.id, ag);
    }
    return Array.from(picked.values());
  }, [world.agents, focusAgent, agentById]);

  // Layout residents evenly on a circular social network diagram (SVG 640x480)
  const nodePositions = useMemo(() => {
    const cx = 320;
    const cy = 240;
    const rx = 246;
    const ry = 184;
    const map = new Map<string, { x: number; y: number }>();
    graphAgents.forEach((ag, idx) => {
      const angle = (idx / Math.max(1, graphAgents.length)) * Math.PI * 2 - Math.PI / 2;
      map.set(ag.id, {
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      });
    });
    return map;
  }, [graphAgents]);

  const directedEdges = useMemo(() => {
    const all: Array<{
      fromId: string;
      toId: string;
      trust: number;
      affection: number;
      familiarity: number;
      inferredGoal: string;
    }> = [];
    for (const ag of graphAgents) {
      for (const edge of Object.values(ag.socialGraph)) {
        if (nodePositions.has(ag.id) && nodePositions.has(edge.targetId)) {
          all.push({
            fromId: ag.id,
            toId: edge.targetId,
            trust: edge.trust,
            affection: edge.affection,
            familiarity: edge.familiarity,
            inferredGoal: edge.inferredGoal,
          });
        }
      }
    }
    return all;
  }, [graphAgents, nodePositions]);

  const outgoingFromFocus = useMemo(
    () =>
      Object.values(focusAgent?.socialGraph ?? {}).sort(
        (a, b) => b.trust + b.affection - (a.trust + a.affection),
      ),
    [focusAgent],
  );

  const reputationStandings = useMemo(
    () =>
      [...world.agents]
        .sort((a, b) => (b.reputation ?? 55) - (a.reputation ?? 55))
        .slice(0, 6),
    [world.agents],
  );

  const memes = world.memes ?? [];

  const handleNoticeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onPostNotice || !noticeTitle.trim() || !noticeBody.trim()) return;
    onPostNotice({
      title: noticeTitle.trim(),
      body: noticeBody.trim(),
      category: noticeCategory,
    });
    setNoticeTitle('');
    setNoticeBody('');
  };

  const handleProposalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateProposal || !propTitle.trim() || !propDesc.trim()) return;
    const parsedCost = Math.max(0, Math.min(2000, Math.round(Number(propCost) || 120)));
    onCreateProposal({
      title: propTitle.trim(),
      description: propDesc.trim(),
      cost: parsedCost,
      effectKey: propEffect,
    });
    setPropTitle('');
    setPropDesc('');
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2DFD5] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#1D2420]">
            Society, Economy &amp; Civic Governance
          </h1>
          <p className="mt-1 text-sm text-[#5C645E] max-w-3xl">
            {calendar.weekdayFull} · Day {calendar.day} ({calendar.isWeekend ? 'Weekend' : 'Workday'}) — Live household finances, local commerce, town notice board, civic voting, and directed Theory of Mind relationships.
          </p>
        </div>

        {onToggleCompressedScenes && (
          <button
            type="button"
            aria-pressed={Boolean(world.compressedConversations)}
            onClick={() => onToggleCompressedScenes(!world.compressedConversations)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              world.compressedConversations
                ? 'border-[#2D6A4F] bg-[#EAF2ED] text-[#1B4332]'
                : 'border-[#D5D0C3] bg-white text-[#3C4640] hover:bg-[#EFECE3]'
            }`}
          >
            1-Call Scenes &amp; Groups: {world.compressedConversations ? 'On' : 'Off'}
          </button>
        )}
      </div>

      {/* Society & Macro-Economy Summary Strip */}
      <dl
        aria-label="Society macro summary"
        className="grid grid-cols-2 gap-4 sm:grid-cols-6 border-b border-[#E2DFD5] pb-6"
      >
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Town Treasury</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#2D6A4F] tabular-nums">
            ${Math.round(world.townTreasury ?? 0)}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Trade Volume</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            ${Math.round(stats.totalTradeVolume ?? 0)}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Open Shops</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {openBusinessesCount}/{businesses.length}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">Civic Votes</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {stats.civicVotesCast ?? 0}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">BDI Decisions</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {stats.bdiDecisions ?? 0}
          </dd>
        </div>
        <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
          <dt className="text-xs text-[#5C645E]">LLM Calls</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1D2420] tabular-nums">
            {llmCallsMade}
          </dd>
        </div>
      </dl>

      {/* Society Scale & Multi-Tier Cognitive Fidelity */}
      {onScalePopulation && (
        <section
          aria-label="Society scale and cognitive tiers"
          className="rounded-lg border border-[#E5E2D9] bg-white px-5 py-4 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Society Scale &amp; Multi-Tier Fidelity
            </h2>
            <p className="text-xs text-[#5C645E]">
              <span className="font-mono font-semibold text-[#1D2420] tabular-nums">
                {world.agents.length}
              </span>{' '}
              residents active
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#2D6A4F] font-medium">
                {tierCounts.focal} Focal (LLM)
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#3C4640]">
                {tierCounts.active} Active
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#5C645E]">
                {tierCounts.ambient} Ambient (0 LLM)
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Target town population">
            {ALLOWED_SCALE_PRESETS.map((preset) => {
              const active = world.agents.length === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onScalePopulation(preset)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 font-mono tabular-nums ${
                    active
                      ? 'border-[#2D6A4F] bg-[#2D6A4F] text-white'
                      : 'border-[#D5D0C3] bg-[#FAF8F4] text-[#2F3833] hover:bg-[#EFECE3]'
                  }`}
                >
                  {preset} Residents
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Macro-Economy, Inequality & Public Health */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1D2420]">
              Macro-Economy, Inequality &amp; Public Health
            </h2>
            <p className="text-xs text-[#5C645E]">
              Live wealth distribution, supply-demand price index, labor participation, and Smallville Clinic health monitoring.
            </p>
          </div>
          <span className="font-mono text-xs text-[#5C645E] tabular-nums">
            {stats.clinicTreatments ?? 0} clinic visits · {stats.jobsFilled ?? 0} hires · {stats.clubGatherings ?? 0} club meetings
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
          <dl className="lg:col-span-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-3.5 py-3">
              <dt className="text-[11px] text-[#5C645E]">Avg Wealth</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                ${Math.round(liveMacro.avgWealth)}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-3.5 py-3">
              <dt className="text-[11px] text-[#5C645E]">Gini Index</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#1D2420] tabular-nums">
                {liveMacro.giniIndex.toFixed(2)}
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-3.5 py-3">
              <dt className="text-[11px] text-[#5C645E]">Employment</dt>
              <dd className="mt-1 font-mono text-xl font-semibold text-[#2D6A4F] tabular-nums">
                {liveMacro.employmentRatePct}%
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-3.5 py-3">
              <dt className="text-[11px] text-[#5C645E]">Price Index</dt>
              <dd
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  liveMacro.priceIndex > 1.08
                    ? 'text-[#B45309]'
                    : liveMacro.priceIndex < 0.94
                      ? 'text-[#2D6A4F]'
                      : 'text-[#1D2420]'
                }`}
              >
                {liveMacro.priceIndex.toFixed(2)}×
              </dd>
            </div>
            <div className="rounded-lg border border-[#E5E2D9] bg-white px-3.5 py-3">
              <dt className="text-[11px] text-[#5C645E]">Active Illness</dt>
              <dd
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  liveMacro.sickCount > 0 ? 'text-[#B45309]' : 'text-[#2D6A4F]'
                }`}
              >
                {liveMacro.sickCount}
              </dd>
            </div>
          </dl>

          <div className="lg:col-span-4 rounded-lg border border-[#E5E2D9] bg-white px-4 py-3 flex flex-col justify-between">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#1D2420]">Daily Wealth Trend</span>
              <span className="font-mono text-[10px] text-[#5C645E] tabular-nums">
                {macroHistory.length} day{macroHistory.length === 1 ? '' : 's'} logged
              </span>
            </div>
            {macroHistory.length >= 2 ? (
              (() => {
                const points = macroHistory.slice(-14);
                const vals = points.map((p) => p.avgWealth);
                const minV = Math.min(...vals);
                const maxV = Math.max(...vals);
                const span = Math.max(10, maxV - minV);
                const poly = points
                  .map((p, i) => {
                    const x = 6 + (i / Math.max(1, points.length - 1)) * 228;
                    const y = 38 - ((p.avgWealth - minV) / span) * 30;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(' ');
                return (
                  <svg
                    viewBox="0 0 240 44"
                    role="img"
                    aria-label="Daily average household wealth sparkline"
                    className="mt-1.5 h-11 w-full"
                  >
                    <polyline
                      fill="none"
                      stroke="#2D6A4F"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={poly}
                    />
                  </svg>
                );
              })()
            ) : (
              <p className="mt-2 text-[11px] text-[#5C645E] leading-snug">
                Daily snapshots record automatically at midnight rollover. Total household liquidity:{' '}
                <span className="font-mono font-semibold text-[#1D2420] tabular-nums">
                  ${Math.round(liveMacro.avgWealth * liveMacro.populationCount)}
                </span>
                .
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Civic Leadership & Mayoral Election */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#EFECE3] pb-3.5">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Civic Leadership &amp; Mayoral Election
            </h2>
            <p className="text-xs text-[#5C645E]">
              Mayor:{' '}
              <span className="font-semibold text-[#1D2420]">
                {leadership?.mayorName ?? 'Office Vacant (Election Pending)'}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums">
                Approval {leadership?.approvalRating ?? 60}%
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums">
                Tax {leadership?.taxRatePct ?? 8}%
              </span>
              {leadership?.mayorName && (
                <>
                  <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">
                    Term through Day {leadership.termEndsDay}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {election?.status === 'voting' && onFinalizeElection ? (
              <button
                type="button"
                onClick={onFinalizeElection}
                className="rounded-md bg-[#2D6A4F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#23533D] transition-colors whitespace-nowrap shrink-0"
              >
                Tally &amp; Inaugurate
              </button>
            ) : (
              onOpenElection && (
                <button
                  type="button"
                  onClick={onOpenElection}
                  className="rounded-md border border-[#2D6A4F] bg-[#EAF2ED] px-3 py-1.5 text-xs font-medium text-[#1B4332] hover:bg-[#DCECE3] transition-colors whitespace-nowrap shrink-0"
                >
                  Call Town Election
                </button>
              )
            )}
          </div>
        </div>

        {election && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-[#1D2420]">
                Cycle #{election.cycleNumber}
                <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                  ·
                </span>
                <span
                  className={`font-mono uppercase text-[11px] font-semibold ${
                    election.status === 'voting'
                      ? 'text-[#B45309]'
                      : election.status === 'completed'
                        ? 'text-[#2D6A4F]'
                        : 'text-[#5C645E]'
                  }`}
                >
                  {election.status === 'voting'
                    ? 'Polls Open'
                    : election.status === 'completed'
                      ? `Won by ${election.winnerName ?? 'Candidate'}`
                      : `Campaigning (Polls Day ${election.electionDay})`}
                </span>
              </span>
              <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
                Ballots cast: {election.votersCast.length}/{world.agents.length}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {election.candidates.map((cand) => {
                const totalBallots = Math.max(1, election.votersCast.length);
                const pct =
                  election.votersCast.length > 0
                    ? Math.round((cand.votes / totalBallots) * 100)
                    : 0;
                const isWinner =
                  election.status === 'completed' && election.winnerId === cand.agentId;
                return (
                  <div
                    key={cand.agentId}
                    className={`rounded-md border p-3 text-xs space-y-2 ${
                      isWinner
                        ? 'border-[#2D6A4F] bg-[#F2F7F4]'
                        : 'border-[#E5E2D9] bg-[#FAF8F4]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectAgentAndMap(cand.agentId)}
                        className="font-semibold text-[#1D2420] hover:text-[#2D6A4F] hover:underline text-left"
                      >
                        {cand.name}
                      </button>
                      <span className="font-mono text-[11px] font-semibold text-[#2D6A4F] tabular-nums shrink-0">
                        {cand.votes} ({pct}%)
                      </span>
                    </div>
                    <p className="text-[11px] text-[#4A534D] leading-snug">{cand.platform}</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E2D9]">
                      <div
                        className="h-full bg-[#2D6A4F] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Dynamic Labor Market & Community Clubs Split */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        <div className="lg:col-span-6 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-2.5">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1D2420]">
                Dynamic Labor Market
              </h2>
              <p className="text-xs text-[#5C645E]">
                Solvent businesses open postings; residents seeking income get hired into real daily shifts.
              </p>
            </div>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums shrink-0">
              {jobPostings.filter((j) => j.status === 'open').length} open
            </span>
          </div>

          {jobPostings.length === 0 ? (
            <p className="text-xs text-[#5C645E]">
              No active job postings right now. Businesses post new roles at daily rollover when reserves grow.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[260px] overflow-y-auto smallville-scroll pr-1">
              {jobPostings.map((job) => {
                const filledBy = job.hiredAgentId
                  ? agentById.get(job.hiredAgentId)?.name
                  : null;
                return (
                  <li
                    key={job.id}
                    className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5 text-xs flex items-baseline justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1D2420] truncate">
                        {job.roleTitle}
                      </div>
                      <div className="text-[11px] text-[#5C645E]">
                        {job.businessName}
                        {filledBy ? ` · Hired ${filledBy}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px] tabular-nums shrink-0">
                      <div className="font-semibold text-[#1D2420]">${job.wagePerHour}/hr</div>
                      <div
                        className={
                          job.status === 'open'
                            ? 'text-[#2D6A4F] uppercase text-[10px] font-semibold'
                            : 'text-[#5C645E] uppercase text-[10px]'
                        }
                      >
                        {job.status}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="lg:col-span-6 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-2.5">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1D2420]">
                Community Clubs &amp; Associations
              </h2>
              <p className="text-xs text-[#5C645E]">
                Weekly civic, literary, merchant, and garden gatherings deepen shared identity and trust.
              </p>
            </div>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums shrink-0">
              {clubs.length} clubs
            </span>
          </div>

          <ul className="space-y-2 max-h-[260px] overflow-y-auto smallville-scroll pr-1">
            {clubs.map((club) => (
              <li
                key={club.id}
                className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5 text-xs space-y-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[#1D2420]">{club.name}</span>
                  <span className="font-mono text-[11px] text-[#2D6A4F] tabular-nums shrink-0">
                    {club.memberIds.length} members
                  </span>
                </div>
                <p className="text-[11px] text-[#4A534D] leading-snug">{club.description}</p>
                <p className="text-[11px] text-[#5C645E] font-mono tabular-nums">
                  Meets {WEEKDAY_SHORT[club.meetingWeekday % 7]} {formatHour(club.meetingHour)} ·{' '}
                  <span className="font-sans">
                    {locationNameById.get(club.locationId) ?? club.locationId}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Behavioral Realism & Population Diversity Health (Phase I) */}
      <section
        aria-label="Behavioral realism and diversity health"
        className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Behavioral Realism &amp; Population Diversity Health
            </h2>
            <p className="text-xs text-[#5C645E]">
              Monitors lexical originality, emotional spread, trust polarization, and friction to detect single-model persona collapse.
            </p>
          </div>
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              liveDiversity.collapseRiskLevel === 'healthy'
                ? 'text-[#2D6A4F]'
                : liveDiversity.collapseRiskLevel === 'narrowing'
                  ? 'text-[#B45309]'
                  : 'text-[#B91C1C]'
            }`}
          >
            Status: {diversityLabel.label}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
            <dt className="text-[11px] text-[#5C645E]">Lexical Distinct-2</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {liveDiversity.lexicalDiversity.toFixed(2)}
            </dd>
          </div>
          <div className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
            <dt className="text-[11px] text-[#5C645E]">Mood Spread (σ)</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {liveDiversity.moodStdDev.toFixed(2)}
            </dd>
          </div>
          <div className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
            <dt className="text-[11px] text-[#5C645E]">Trust Polarization</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {liveDiversity.trustPolarization.toFixed(1)}
            </dd>
          </div>
          <div className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
            <dt className="text-[11px] text-[#5C645E]">Friction / Refusal</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {Math.round(liveDiversity.refusalDisagreementRate * 100)}%
            </dd>
          </div>
          <div className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5">
            <dt className="text-[11px] text-[#5C645E]">Belief Revisions</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-[#2D6A4F] tabular-nums">
              {liveDiversity.beliefRevisionCount}
            </dd>
          </div>
        </dl>
      </section>

      {/* Emergent Contracts, Grassroots Petitions & Resident Micro-Ventures (Phase G) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        <div className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-2.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Bilateral Peer Credit
            </h2>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
              {loans.filter((l) => l.status === 'active').length} active · {loans.filter((l) => l.status === 'defaulted').length} defaulted
            </span>
          </div>
          {loans.length === 0 ? (
            <p className="text-xs text-[#5C645E]">
              No bilateral loans issued yet. Cash-strained residents negotiate peer credit with trusted neighbors during daily cycles or BDI forks.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[240px] overflow-y-auto smallville-scroll pr-1">
              {loans.slice(0, 8).map((loan) => {
                const lender = agentById.get(loan.lenderId)?.name ?? loan.lenderId;
                const borrower = agentById.get(loan.borrowerId)?.name ?? loan.borrowerId;
                return (
                  <li
                    key={loan.id}
                    className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2 text-xs space-y-0.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-[#1D2420] truncate">
                        {getShortFirstName(lender)} → {getShortFirstName(borrower)}
                      </span>
                      <span className="font-mono font-semibold text-[#1D2420] tabular-nums shrink-0">
                        ${loan.principal}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-[#5C645E] tabular-nums">
                      <span>Due Day {loan.dueDay}</span>
                      <span
                        className={`uppercase font-semibold ${
                          loan.status === 'defaulted'
                            ? 'text-[#B91C1C]'
                            : loan.status === 'repaid'
                              ? 'text-[#2D6A4F]'
                              : 'text-[#3C4640]'
                        }`}
                      >
                        {loan.status}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-2.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Grassroots Petitions
            </h2>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
              {petitions.filter((p) => p.status === 'escalated').length} escalated
            </span>
          </div>
          {petitions.length === 0 ? (
            <p className="text-xs text-[#5C645E]">No grassroots petitions circulating.</p>
          ) : (
            <ul className="space-y-2.5 max-h-[240px] overflow-y-auto smallville-scroll pr-1">
              {petitions.map((pet) => {
                const pct = Math.min(
                  100,
                  Math.round((pet.signerIds.length / Math.max(1, pet.targetSignatures)) * 100),
                );
                return (
                  <li
                    key={pet.id}
                    className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-[#1D2420]">{pet.title}</span>
                      <span className="font-mono text-[10px] text-[#2D6A4F] tabular-nums shrink-0">
                        {pet.signerIds.length}/{pet.targetSignatures}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#4A534D] leading-snug">{pet.description}</p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E2D9]">
                      <div
                        className="h-full bg-[#2D6A4F] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-[#5C645E]">
                      <span className="uppercase font-mono">
                        {pet.status === 'escalated' ? 'On Town Ballot' : 'Gathering Signatures'}
                      </span>
                      {pet.status === 'gathering' && onSponsorPetition && (
                        <button
                          type="button"
                          onClick={() => onSponsorPetition(pet.id)}
                          className="rounded border border-[#2D6A4F] bg-white px-2 py-0.5 font-medium text-[#1B4332] hover:bg-[#EAF2ED] transition-colors whitespace-nowrap"
                        >
                          Canvas Resident
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-2.5">
            <h2 className="font-display text-base font-semibold text-[#1D2420]">
              Resident Micro-Ventures
            </h2>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
              {ventures.filter((v) => v.active).length} pop-ups
            </span>
          </div>
          {ventures.length === 0 ? (
            <p className="text-xs text-[#5C645E]">
              No resident-founded pop-ups open yet. Enterprising residents with savings ≥ $240 launch stalls during autonomous cycles.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[240px] overflow-y-auto smallville-scroll pr-1">
              {ventures.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] px-3 py-2 text-xs space-y-0.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#1D2420] truncate">{v.name}</span>
                    <span className="font-mono text-[11px] font-semibold text-[#2D6A4F] tabular-nums shrink-0">
                      ${Math.round(v.revenue)} rev
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5C645E] font-mono tabular-nums">
                    {v.founderName.split(' ')[0]} · {locationNameById.get(v.locationId) ?? v.locationId} · ${v.unitPrice} · {v.stock} left
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Housing Tenure, Households & Career Mobility (Phase H) */}
      <section className="rounded-lg border border-[#E5E2D9] bg-white px-5 py-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="space-y-0.5">
          <h2 className="font-display text-base font-semibold text-[#1D2420]">
            Housing Tenure, Households &amp; Career Ladders
          </h2>
          <p className="text-[#5C645E] font-mono tabular-nums">
            Owners {housingSummary.counts.owner} · Renters {housingSummary.counts.renter} · Shared{' '}
            {housingSummary.counts.shared} · Household ties {housingSummary.sharedPartners} · Moves{' '}
            {stats.housingMoves ?? 0}
          </p>
        </div>
        <div className="font-mono text-[11px] text-[#3C4640] tabular-nums">
          Master {housingSummary.tiers.master} · Senior {housingSummary.tiers.senior} · Practitioner{' '}
          {housingSummary.tiers.practitioner} · Apprentice {housingSummary.tiers.apprentice} ·{' '}
          <span className="text-[#2D6A4F] font-semibold">
            {stats.careerPromotions ?? 0} promotions
          </span>
        </div>
      </section>

      {/* Local Economy & Business Ledger */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1D2420]">
              Local Economy &amp; Business Ledger
            </h2>
            <p className="text-xs text-[#5C645E]">
              Operating hours, cash reserves, real-time inventory stock, and supply-chain restocking across town businesses.
            </p>
          </div>
          <span className="font-mono text-xs text-[#5C645E] tabular-nums">
            {stats.economicTransactions ?? 0} settled transactions
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {businesses.map((biz) => {
            const openNow = isBusinessOpen(biz, calendar, modifiers);
            const stockEntries = Object.entries(biz.stock).filter(
              (pair): pair is [string, NonNullable<(typeof pair)[1]>] => Boolean(pair[1]),
            );
            const staffNames = [biz.ownerId, ...biz.employeeIds]
              .filter((id, idx, arr) => id && arr.indexOf(id) === idx)
              .map((eid) => getShortFirstName(agentById.get(eid)?.name ?? eid))
              .join(', ');
            return (
              <article
                key={biz.locationId}
                className="rounded-lg border border-[#E5E2D9] bg-white p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[#1D2420] text-sm">{biz.name}</h3>
                    <p className="text-[11px] text-[#5C645E] mt-0.5 font-mono tabular-nums">
                      {formatHour(biz.openHour)}–{formatHour(biz.closeHour)}
                      {' · '}
                      <span className={openNow ? 'text-[#2D6A4F] font-semibold' : 'text-[#8A918B]'}>
                        {openNow ? 'Open' : 'Closed'}
                      </span>
                      {' · '}
                      ${biz.wagePerHour}/hr
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-sm font-semibold text-[#1D2420]">
                      ${Math.round(biz.treasury)}
                    </div>
                    <div className="text-[10px] text-[#5C645E]">
                      Rev ${Math.round(biz.dailyRevenue)}
                    </div>
                  </div>
                </div>

                {staffNames && (
                  <p className="text-[11px] text-[#4A534D]">
                    Staff: <span className="text-[#1D2420]">{staffNames}</span>
                  </p>
                )}

                {stockEntries.length > 0 && (
                  <div className="border-t border-[#EFECE3] pt-2 space-y-1">
                    {stockEntries.map(([kind, entry]) => (
                      <div
                        key={kind}
                        className="flex items-center justify-between font-mono text-[11px] tabular-nums text-[#3C4640]"
                      >
                        <span className="font-sans capitalize text-[#2F3833]">
                          {kind.replace('_', ' ')}
                        </span>
                        <span>
                          ${entry.price} ·{' '}
                          <span className={entry.quantity <= 2 ? 'text-[#B45309] font-semibold' : ''}>
                            {entry.quantity}/{entry.maxStock}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Public Notice Board & Civic Governance Split */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Public Notice Board */}
        <div className="lg:col-span-6 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1D2420]">
                Public Notice Board &amp; Gazette
              </h2>
              <p className="text-xs text-[#5C645E]">
                Residents read posted notices asynchronously when visiting town hubs.
              </p>
            </div>
            <span className="font-mono text-[11px] text-[#5C645E] tabular-nums">
              {notices.length} notices · {stats.noticesRead ?? 0} reads
            </span>
          </div>

          {onPostNotice && (
            <form onSubmit={handleNoticeSubmit} className="space-y-2 border-b border-[#EFECE3] pb-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  aria-label="Notice title"
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder="Notice headline…"
                  className="sm:col-span-2 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                />
                <select
                  aria-label="Notice category"
                  value={noticeCategory}
                  onChange={(e) => setNoticeCategory(e.target.value as NoticeCategory)}
                  className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] focus:border-[#2D6A4F] focus:outline-none"
                >
                  <option value="event">Event</option>
                  <option value="market">Market</option>
                  <option value="civic">Civic</option>
                  <option value="job">Job Opening</option>
                  <option value="news">Town News</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Notice details"
                  value={noticeBody}
                  onChange={(e) => setNoticeBody(e.target.value)}
                  placeholder="Write details residents will discover when passing town hubs…"
                  className="flex-1 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md bg-[#2D6A4F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#23533D] transition-colors whitespace-nowrap shrink-0"
                >
                  Post Notice
                </button>
              </div>
            </form>
          )}

          <ul className="space-y-2.5 max-h-[340px] overflow-y-auto smallville-scroll pr-1">
            {notices.map((n) => {
              const t = formatSimTime(n.createdAt);
              return (
                <li
                  key={n.id}
                  className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] p-3 text-xs space-y-1"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#1D2420]">{n.title}</span>
                    <span className="font-mono text-[10px] text-[#5C645E] capitalize tabular-nums shrink-0">
                      {n.category.replace('_', ' ')} · D{t.day} {t.timeLabel}
                    </span>
                  </div>
                  <p className="text-[#3C4640] leading-relaxed">{n.body}</p>
                  <p className="text-[11px] text-[#5C645E]">
                    By {n.authorName} · Read by{' '}
                    <span className="font-mono tabular-nums">
                      {n.readByAgentIds.length}/{world.agents.length}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Civic Governance & Town Proposals */}
        <div className="lg:col-span-6 rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#EFECE3] pb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1D2420]">
                Civic Governance &amp; Proposals
              </h2>
              <p className="text-xs text-[#5C645E]">
                Residents weigh costs, treasury health, and community needs to vote autonomously.
              </p>
            </div>
            <span className="font-mono text-[11px] text-[#2D6A4F] tabular-nums">
              Treasury ${Math.round(world.townTreasury ?? 0)}
            </span>
          </div>

          <div className="text-[11px] text-[#4A534D] border-b border-[#EFECE3] pb-3">
            <span className="font-semibold text-[#1D2420]">Active Town Policies:</span>{' '}
            {(
              [
                ['streetLighting', 'Street Lighting'],
                ['marketStipend', 'Market Stipend'],
                ['extendedLibrary', 'Extended Library'],
                ['communityClinic', 'Community Clinic'],
              ] as const
            )
              .filter(([key]) => modifiers[key])
              .map(([, label]) => label)
              .join(' · ') || 'None enacted yet (awaiting resident quorum)'}
          </div>

          {onCreateProposal && (
            <form onSubmit={handleProposalSubmit} className="space-y-2 border-b border-[#EFECE3] pb-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  aria-label="Proposal title"
                  value={propTitle}
                  onChange={(e) => setPropTitle(e.target.value)}
                  placeholder="New civic proposal title…"
                  className="sm:col-span-2 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                />
                <input
                  type="number"
                  aria-label="Proposal cost in dollars"
                  min={0}
                  max={2000}
                  value={propCost}
                  onChange={(e) => setPropCost(e.target.value)}
                  placeholder="Cost ($)"
                  className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#1D2420] focus:border-[#2D6A4F] focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="Proposal description"
                  value={propDesc}
                  onChange={(e) => setPropDesc(e.target.value)}
                  placeholder="Describe why this benefits residents…"
                  className="min-w-[160px] flex-1 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                />
                <select
                  aria-label="Policy effect"
                  value={propEffect}
                  onChange={(e) => setPropEffect(e.target.value as TownModifierKey)}
                  className="rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2 py-1.5 text-xs text-[#1D2420] focus:border-[#2D6A4F] focus:outline-none"
                >
                  <option value="streetLighting">Street Lighting</option>
                  <option value="marketStipend">Market Stipend</option>
                  <option value="extendedLibrary">Extended Library</option>
                  <option value="communityClinic">Community Clinic</option>
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-[#2D6A4F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#23533D] transition-colors whitespace-nowrap shrink-0"
                >
                  Propose
                </button>
              </div>
            </form>
          )}

          <ul className="space-y-2.5 max-h-[300px] overflow-y-auto smallville-scroll pr-1">
            {proposals.map((p) => {
              const yes = p.votesFor.length;
              const no = p.votesAgainst.length;
              const totalVotes = yes + no;
              const quorum = Math.max(4, Math.ceil(world.agents.length * 0.34));
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#1D2420]">{p.title}</span>
                    <span
                      className={`font-mono text-[10px] uppercase font-semibold tabular-nums shrink-0 ${
                        p.status === 'passed'
                          ? 'text-[#2D6A4F]'
                          : p.status === 'rejected'
                            ? 'text-[#B91C1C]'
                            : 'text-[#92400E]'
                      }`}
                    >
                      {p.status} · ${p.cost}
                    </span>
                  </div>
                  <p className="text-[#3C4640] leading-relaxed">{p.description}</p>
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#5C645E]">
                    <span>
                      For {yes} · Against {no}
                    </span>
                    <span>Quorum {totalVotes}/{quorum}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Interactive Theory of Mind Network + Outgoing Mental Models */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 rounded-lg border border-[#E5E2D9] bg-white p-5 flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#1D2420]">
                Directed Theory of Mind Graph
              </h2>
              <p className="text-xs text-[#5C645E]">
                Click any resident to inspect their outgoing mental models, trust polarity, and reputation.
              </p>
            </div>
            <div className="text-[11px] text-[#5C645E] font-mono tabular-nums">
              {graphAgents.length < world.agents.length
                ? `Showing ${graphAgents.length}/${world.agents.length} · `
                : ''}
              {directedEdges.length} directed edges · {stats.gossipUpdatesApplied ?? 0} gossip shifts
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center rounded-md border border-[#EFECE3] bg-[#FAF8F4] p-2">
            <svg
              viewBox="0 0 640 480"
              role="img"
              aria-label={`Directed social network of ${graphAgents.length} residents`}
              className="w-full max-w-[640px] h-auto"
            >
              {directedEdges.map((edge) => {
                if (edge.fromId === focusAgent?.id) return null;
                const p1 = nodePositions.get(edge.fromId);
                const p2 = nodePositions.get(edge.toId);
                if (!p1 || !p2) return null;
                return (
                  <line
                    key={`bg_${edge.fromId}_${edge.toId}`}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="#DDD8CC"
                    strokeWidth={1}
                    strokeOpacity={0.65}
                  />
                );
              })}

              {directedEdges
                .filter((e) => e.fromId === focusAgent?.id)
                .map((edge) => {
                  const p1 = nodePositions.get(edge.fromId);
                  const p2 = nodePositions.get(edge.toId);
                  if (!p1 || !p2) return null;
                  const strokeColor =
                    edge.trust >= 75
                      ? '#2D6A4F'
                      : edge.trust >= 40
                        ? '#D97706'
                        : '#B91C1C';
                  const width = Math.max(1.5, Math.min(4, edge.familiarity / 26));
                  return (
                    <line
                      key={`fg_${edge.fromId}_${edge.toId}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={strokeColor}
                      strokeWidth={width}
                      strokeOpacity={0.85}
                    />
                  );
                })}

              {graphAgents.map((ag) => {
                const pos = nodePositions.get(ag.id);
                if (!pos) return null;
                const isSelected = ag.id === focusAgent?.id;
                const isNeighbor = outgoingFromFocus.some((e) => e.targetId === ag.id);
                return (
                  <g
                    key={ag.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => setFocusAgentId(ag.id)}
                    className="cursor-pointer"
                  >
                    <circle
                      r={isSelected ? 19 : 15}
                      fill={isSelected ? '#2D6A4F' : isNeighbor ? '#EAF2ED' : '#FFFFFF'}
                      stroke={isSelected ? '#1B4332' : isNeighbor ? '#2D6A4F' : '#8C8A80'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <text
                      textAnchor="middle"
                      dy="3.5"
                      fontSize="10"
                      fontWeight={600}
                      fill={isSelected ? '#FFFFFF' : '#1D2420'}
                    >
                      {getShortFirstName(ag.name)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Selected Resident Outgoing Mental Models + Reputation Standings */}
        <div className="lg:col-span-5 rounded-lg border border-[#E5E2D9] bg-white p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-[#EFECE3] pb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-[#1D2420]">
                  {focusAgent?.name}’s Mental Models
                </h2>
                <p className="text-xs text-[#5C645E] mt-0.5 font-mono tabular-nums">
                  <span className="font-sans">{focusAgent?.occupation}</span> · ${Math.round(focusAgent?.wallet ?? 0)} · Rep {Math.round(focusAgent?.reputation ?? 55)}
                </p>
              </div>
              {focusAgent && (
                <button
                  type="button"
                  onClick={() => onSelectAgentAndMap(focusAgent.id)}
                  className="rounded border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1 text-xs font-medium text-[#2D6A4F] hover:bg-[#EFECE3] transition-colors whitespace-nowrap shrink-0"
                >
                  Inspect on Map
                </button>
              )}
            </div>

            {outgoingFromFocus.length === 0 ? (
              <p className="text-xs text-[#5C645E]">
                No social edges formed yet for this resident.
              </p>
            ) : (
              <ul className="space-y-2 max-h-[260px] overflow-y-auto smallville-scroll pr-1">
                {outgoingFromFocus.map((edge) => {
                  const target = agentById.get(edge.targetId);
                  return (
                    <li
                      key={edge.targetId}
                      className="rounded-md border border-[#E5E2D9] bg-[#FAF8F4] p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setFocusAgentId(edge.targetId)}
                          className="font-semibold text-[#1D2420] hover:text-[#2D6A4F] hover:underline text-left"
                        >
                          {target?.name ?? edge.targetId}
                        </button>
                        <span className="font-mono text-[11px] text-[#3C4640] tabular-nums">
                          Trust {edge.trust} · Aff {edge.affection}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[#3C4640]">
                        Believes goal: “{edge.inferredGoal}”
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-[#EFECE3] pt-3">
            <h3 className="text-xs font-semibold text-[#1D2420] mb-2">
              Highest Community Standing
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {reputationStandings.map((ag) => (
                <div key={ag.id} className="flex items-baseline justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => setFocusAgentId(ag.id)}
                    className="truncate text-[#2F3833] hover:text-[#2D6A4F] hover:underline"
                  >
                    {ag.name}
                  </button>
                  <span className="font-mono tabular-nums text-[#2D6A4F] shrink-0">
                    {Math.round(ag.reputation ?? 55)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* District Spatial Distribution */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#1D2420]">
            District Occupancy &amp; Town Geography
          </h2>
          <p className="text-xs text-[#5C645E]">
            Live spatial distribution across North Ridge, Main Street, and Southside Creek ({world.locations.length} landmarks, {world.objects.length} interactive props).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(['North Ridge', 'Main Street', 'Southside Creek'] as const).map((districtName) => {
            const locIds = new Set(
              world.locations.filter((l) => l.district === districtName).map((l) => l.id),
            );
            const here = world.agents.filter(
              (a) => a.currentLocationId !== null && locIds.has(a.currentLocationId),
            );
            return (
              <div
                key={districtName}
                className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3 space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#1D2420]">{districtName}</h3>
                  <span className="font-mono text-xs text-[#2D6A4F] tabular-nums">
                    {here.length} present
                  </span>
                </div>
                <p className="text-[11px] text-[#5C645E] leading-relaxed">
                  {here.length > 0
                    ? here.map((a) => getShortFirstName(a.name)).join(', ')
                    : 'Quiet pathways — residents en route elsewhere.'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Information Diffusion & Rumor Tracker */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#1D2420]">
            Information Diffusion &amp; Meme Spread
          </h2>
          <p className="text-xs text-[#5C645E]">
            Tracks how town news, invitations, and bulletins travel from resident to resident through conversations.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {memes.map((meme) => {
            const knowEntries = Object.entries(meme.knownBy).sort(
              (a, b) => a[1].simMinutes - b[1].simMinutes,
            );
            const pct = Math.round(
              (knowEntries.length / Math.max(1, world.agents.length)) * 100,
            );
            return (
              <article
                key={meme.id}
                className="rounded-lg border border-[#E5E2D9] bg-white p-5 space-y-3"
              >
                <div>
                  <h3 className="text-sm font-semibold text-[#1D2420]">{meme.topic}</h3>
                  <p className="text-[11px] text-[#5C645E] mt-0.5">
                    Origin: {agentById.get(meme.originAgentId)?.name ?? 'Town Bulletin'}
                    <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                      ·
                    </span>
                    <span className="font-mono tabular-nums">
                      {knowEntries.length}/{world.agents.length} residents ({pct}%)
                    </span>
                  </p>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E2D9]">
                  <div
                    className="h-full bg-[#2D6A4F] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <ul className="space-y-1.5 border-t border-[#EFECE3] pt-2.5 text-xs">
                  {knowEntries.map(([agentId, info]) => {
                    const who = agentById.get(agentId)?.name.split(' ')[0] ?? agentId;
                    const from =
                      info.heardFromId === agentId
                        ? 'origin'
                        : info.heardFromId === 'bulletin'
                          ? 'town bulletin'
                          : `via ${agentById.get(info.heardFromId)?.name.split(' ')[0] ?? info.heardFromId}`;
                    const t = formatSimTime(info.simMinutes);
                    return (
                      <li key={agentId} className="text-[#2F3833] leading-snug">
                        <span className="font-semibold text-[#1D2420]">{who}</span>{' '}
                        <span className="text-[11px] text-[#5C645E]">
                          ({from} · <span className="font-mono tabular-nums">{t.timeLabel}</span>):
                        </span>{' '}
                        <span className="text-[11px] text-[#3C4640]">“{info.snippet}”</span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      {/* Open Genesis Observatory: Emergent Orgs, Free-Text Norms, Epistemic & Institutional Pulse */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#1D2420]">
            Open Genesis Observatory &amp; Epistemic Culture
          </h2>
          <p className="text-xs text-[#5C645E]">
            Live view of agent-authored organizations, free-text community norms, disputes, boycotts, rumors, and arbitrated open initiatives ({world.genesisMode === 'structured_polis' ? 'Path B: Structured Polis' : 'Path A Trial: Open Genesis'}).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
            <div className="text-[11px] text-[#5C645E]">Emergent Orgs</div>
            <div className="font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {(world.organizations ?? []).filter((o) => o.active).length}
            </div>
          </div>
          <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
            <div className="text-[11px] text-[#5C645E]">Free-Text Norms</div>
            <div className="font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {(world.emergentNorms ?? []).filter((n) => n.active).length}
            </div>
          </div>
          <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
            <div className="text-[11px] text-[#5C645E]">False-Belief Rate</div>
            <div className="font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {Math.round((liveDiversity.falseBeliefRate ?? 0) * 100)}%
            </div>
          </div>
          <div className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
            <div className="text-[11px] text-[#5C645E]">Active Rumors / Disputes</div>
            <div className="font-mono text-lg font-semibold text-[#1D2420] tabular-nums">
              {(world.rumors ?? []).filter((r) => !r.debunked).length} /{' '}
              {(world.disputes ?? []).filter((d) => d.status === 'open').length}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <article className="rounded-lg border border-[#E5E2D9] bg-white p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5C645E]">
              Resident-Founded Organizations
            </h3>
            {(world.organizations ?? []).length === 0 ? (
              <p className="text-xs text-[#5C645E]">
                No agent-authored organizations yet. Residents can found guilds, mutual-aid pools, unions, or papers via open actions.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {(world.organizations ?? []).slice(0, 6).map((org) => (
                  <li key={org.id} className="rounded border border-[#EFECE3] p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#1D2420]">{org.name}</span>
                      <span className="font-mono text-[11px] text-[#2D6A4F] tabular-nums">
                        ${org.treasury} pool · {Object.keys(org.memberRoles).length} members
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5C645E]">{org.charter}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-lg border border-[#E5E2D9] bg-white p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5C645E]">
              Emergent Norms &amp; Recent Open Arbitrations
            </h3>
            {(world.emergentNorms ?? []).length === 0 && (world.arbitratedActions ?? []).length === 0 ? (
              <p className="text-xs text-[#5C645E]">
                No free-text norms or arbitrated open actions recorded yet.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {(world.emergentNorms ?? []).slice(0, 4).map((n) => (
                  <li key={n.id} className="rounded border border-[#EFECE3] p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[#1D2420]">“{n.statement}”</span>
                      <span className="font-mono text-[11px] text-[#2D6A4F] tabular-nums">
                        {n.strength}/100 ({n.adopterIds.length} adopters)
                      </span>
                    </div>
                  </li>
                ))}
                {(world.arbitratedActions ?? []).slice(0, 3).map((arb) => (
                  <li key={arb.id} className="rounded border border-[#EFECE3] bg-[#FAF8F4] p-2 text-[11px]">
                    <span className="font-semibold text-[#1D2420]">{arb.actorName.split(' ')[0]}</span>:{' '}
                    <span className="text-[#3C4640]">{arb.narrative}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </div>
  );
});
