import {
  Brain,
  Calendar,
  HeartHandshake,
  MessageSquare,
  Mic,
  Moon,
  Search,
  Sparkles,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatSimTime, inferMemorySource, retrieveMemories } from '../simulation/memory';
import type {
  AgentState,
  AgentTier,
  ConversationRecord,
  LoanContract,
  LocationZone,
  MemoryType,
  RetrievedMemory,
} from '../simulation/types';
import type { ActionStatusEntry } from '../store/smallvilleStore';
import { AgentPortrait } from './AgentRosterStrip';
import { VirtualList, type VirtualListHandle } from './VirtualList';

export type InspectorTab = 'plan' | 'memory' | 'social' | 'dialogues' | 'interview';

interface AgentInspectorProps {
  agent: AgentState;
  allAgents: AgentState[];
  locations: LocationZone[];
  conversations: ConversationRecord[];
  loans?: LoanContract[];
  simMinutes: number;
  reflectionThreshold: number;
  isBusy: boolean;
  actionStates?: Record<string, ActionStatusEntry>;
  onTriggerReflection: (agentId: string) => Promise<void>;
  onTriggerConsolidation: (agentId: string) => Promise<void>;
  onTriggerReplan: (agentId: string) => Promise<void>;
  onTriggerConversation: (agentAId: string, agentBId: string) => Promise<void>;
  onSemanticSearch: (agentId: string, query: string) => Promise<number[] | null>;
  onInterviewAgent: (
    agentId: string,
    question: string,
  ) => Promise<{ answer: string; citedMemoryIds: string[] } | null>;
  onWhisperAgent: (agentId: string, thought: string) => Promise<void>;
  onChangeTier?: (agentId: string, tier: AgentTier) => void;
}

function formatMinuteOfDay(minOfDay: number): string {
  const h24 = Math.floor(minOfDay / 60) % 24;
  const m = minOfDay % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function driveBarColor(value: number): string {
  if (value < 30) return 'bg-[#B91C1C]';
  if (value < 55) return 'bg-[#D97706]';
  return 'bg-[#2D6A4F]';
}

function formatActionLabel(
  entry: ActionStatusEntry | undefined,
  idleLabel: string,
): { text: string; isError: boolean; errorMsg?: string } {
  if (!entry) return { text: idleLabel, isError: false };
  if (entry.status === 'queued') return { text: 'Queued…', isError: false };
  if (entry.status === 'running') return { text: 'Running…', isError: false };
  return { text: 'Failed (Retry)', isError: true, errorMsg: entry.error };
}

export const AgentInspector = memo(function AgentInspector({
  agent,
  allAgents,
  locations,
  conversations,
  loans = [],
  simMinutes,
  reflectionThreshold,
  isBusy,
  actionStates = {},
  onTriggerReflection,
  onTriggerConsolidation,
  onTriggerReplan,
  onTriggerConversation,
  onSemanticSearch,
  onInterviewAgent,
  onWhisperAgent,
  onChangeTier,
}: AgentInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('plan');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryFilter, setMemoryFilter] = useState<'all' | MemoryType>('all');
  const [memoryViewMode, setMemoryViewMode] = useState<'episodic' | 'beliefs'>('episodic');
  const [beliefFilter, setBeliefFilter] = useState<'active' | 'superseded'>('active');
  const [searchMode, setSearchMode] = useState<'lexical' | 'semantic'>('lexical');
  const [showPrivateThoughts, setShowPrivateThoughts] = useState<boolean>(true);
  const [highlightedMemoryId, setHighlightedMemoryId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const memoryListRef = useRef<VirtualListHandle | null>(null);
  const [semanticEmbedding, setSemanticEmbedding] = useState<{
    agentId: string;
    query: string;
    vector: number[];
  } | null>(null);
  const [partnerId, setPartnerId] = useState<string>(() => {
    const other = allAgents.find((a) => a.id !== agent.id);
    return other?.id ?? 'maria';
  });

  // Interview & Whisper form state
  const [interviewQuestion, setInterviewQuestion] = useState('');
  const [interviewTranscript, setInterviewTranscript] = useState<
    Array<{
      agentId: string;
      question: string;
      answer: string;
      citedMemoryIds: string[];
    }>
  >([]);
  const [whisperThought, setWhisperThought] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const currentLoc = agent.currentLocationId
    ? locations.find((l) => l.id === agent.currentLocationId)
    : undefined;
  const currentTime = formatSimTime(simMinutes);
  const otherAgents = allAgents.filter((a) => a.id !== agent.id);
  const effectivePartnerId =
    partnerId !== agent.id && otherAgents.some((a) => a.id === partnerId)
      ? partnerId
      : (otherAgents[0]?.id ?? '');

  const agentConversations = useMemo(
    () => conversations.filter((c) => c.participantIds.includes(agent.id)),
    [conversations, agent.id],
  );

  const activeQueryEmbedding =
    searchMode === 'semantic' &&
    semanticEmbedding &&
    semanticEmbedding.agentId === agent.id &&
    semanticEmbedding.query === memoryQuery.trim()
      ? semanticEmbedding.vector
      : undefined;

  const scoredMemories = useMemo(() => {
    const filtered =
      memoryFilter === 'all'
        ? agent.memories
        : agent.memories.filter((m) => m.type === memoryFilter);
    const q = memoryQuery.trim() || agent.currently;
    return retrieveMemories(
      filtered,
      q,
      simMinutes,
      filtered.length,
      undefined,
      activeQueryEmbedding,
    );
  }, [agent.memories, agent.currently, memoryFilter, memoryQuery, simMinutes, activeQueryEmbedding]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const idx = scoredMemories.findIndex((r) => r.node.id === pendingScrollId);
    if (idx >= 0) {
      memoryListRef.current?.scrollToIndex(idx);
      setHighlightedMemoryId(pendingScrollId);
      setPendingScrollId(null);
      const t = setTimeout(() => setHighlightedMemoryId(null), 2400);
      return () => clearTimeout(t);
    }
    setPendingScrollId(null);
  }, [pendingScrollId, scoredMemories]);

  const handleJumpToEvidence = useCallback(
    (evidenceId: string) => {
      if (memoryFilter !== 'all') {
        setMemoryFilter('all');
      }
      setMemoryViewMode('episodic');
      setTab('memory');
      setPendingScrollId(evidenceId);
    },
    [memoryFilter],
  );

  const agentBeliefs = useMemo(() => agent.beliefs ?? [], [agent.beliefs]);
  const activeBeliefsList = useMemo(
    () => agentBeliefs.filter((b) => b.invalidatedAtSimMin === undefined),
    [agentBeliefs],
  );
  const supersededBeliefsList = useMemo(
    () => agentBeliefs.filter((b) => b.invalidatedAtSimMin !== undefined),
    [agentBeliefs],
  );
  const agentLoans = useMemo(
    () => loans.filter((l) => l.lenderId === agent.id || l.borrowerId === agent.id),
    [loans, agent.id],
  );

  const getMemoryKey = useCallback((r: RetrievedMemory) => r.node.id, []);
  const estimateMemoryHeight = useCallback(
    (r: RetrievedMemory) =>
      92 +
      Math.ceil(r.node.description.length / 44) * 18 +
      (r.node.evidenceIds && r.node.evidenceIds.length > 0 ? 28 : 0),
    [],
  );

  const socialEdges = useMemo(() => {
    return Object.values(agent.socialGraph).sort((a, b) => b.familiarity - a.familiarity);
  }, [agent.socialGraph]);

  const agentTranscripts = interviewTranscript.filter((t) => t.agentId === agent.id);

  const handleSemanticProbe = async () => {
    const q = memoryQuery.trim() || agent.currently;
    setSearchMode('semantic');
    setLocalError(null);
    const vec = await onSemanticSearch(agent.id, q);
    if (vec) {
      setSemanticEmbedding({
        agentId: agent.id,
        query: memoryQuery.trim(),
        vector: vec,
      });
    }
  };

  const replanBtn = formatActionLabel(actionStates[`replan:${agent.id}`], 'Re-plan Day');
  const reflectBtn = formatActionLabel(actionStates[`reflection:${agent.id}`], 'Reflect Now');
  const consolidateBtn = formatActionLabel(
    actionStates[`consolidation:${agent.id}`],
    'Sleep Consolidate',
  );
  const converseBtn = formatActionLabel(actionStates[`conversation:${agent.id}`], 'Converse');
  const interviewBtn = formatActionLabel(
    actionStates[`interview:${agent.id}`],
    isBusy ? 'Queue Question' : 'Ask Question',
  );
  const whisperBtn = formatActionLabel(actionStates[`whisper:${agent.id}`], 'Inject Thought');

  const handleInterviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = interviewQuestion.trim();
    if (!q) {
      setLocalError('Enter a question to interview this resident.');
      return;
    }
    setLocalError(null);
    const result = await onInterviewAgent(agent.id, q);
    if (result) {
      setInterviewTranscript((prev) => [
        { agentId: agent.id, question: q, ...result },
        ...prev,
      ]);
      setInterviewQuestion('');
    }
  };

  const handleWhisperSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const thought = whisperThought.trim();
    if (!thought) {
      setLocalError('Enter an inner thought to whisper to this resident.');
      return;
    }
    setLocalError(null);
    await onWhisperAgent(agent.id, thought);
    setWhisperThought('');
  };

  const valenceSign = agent.mood.valence >= 0 ? '+' : '';

  return (
    <aside
      aria-label={`Resident inspector: ${agent.name}`}
      className="flex h-full flex-col border-l border-[#E2DFD5] bg-[#FAF8F4]"
    >
      {/* Resident Identity Header */}
      <div className="border-b border-[#E2DFD5] px-5 py-3.5">
        <div className="flex items-start gap-3">
          <AgentPortrait appearance={agent.appearance} size={46} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-[#1D2420] truncate">
                {agent.name}
              </h2>
              <span className="font-mono text-xs text-[#5C645E] tabular-nums shrink-0">
                Age {agent.age}
              </span>
            </div>
            <div className="text-xs text-[#4A534D] mt-0.5 truncate">
              <span>{agent.occupation}</span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-medium text-[#2D6A4F]">
                {currentLoc?.name ?? agent.currentAreaLabel ?? 'Outdoors'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#5C645E] truncate">
              {agent.mood.label}
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums text-[#1D2420] font-medium">
                ${Math.round(agent.wallet ?? 0)}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums">
                Rep {Math.round(agent.reputation ?? 55)}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span
                className={`font-mono tabular-nums ${
                  agent.illness === 'mild_cold' ? 'text-[#B91C1C] font-medium' : ''
                }`}
              >
                {agent.illness === 'mild_cold'
                  ? `Cold (${Math.round(agent.health ?? 70)}%)`
                  : `Health ${Math.round(agent.health ?? 94)}%`}
              </span>
              <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                ·
              </span>
              <span className="font-mono tabular-nums">
                V {valenceSign}
                {agent.mood.valence.toFixed(2)}
              </span>
              {(agent.careerTier || agent.housingStatus) && (
                <>
                  <span aria-hidden="true" className="mx-1.5 text-[#9BA29C]">
                    ·
                  </span>
                  <span className="capitalize">
                    {agent.careerTier ?? 'practitioner'}
                    {agent.housingStatus ? ` · ${agent.housingStatus}` : ''}
                  </span>
                </>
              )}
            </p>
            {onChangeTier && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                <span className="text-[#5C645E]">Cognition Tier:</span>
                {(['focal', 'active', 'ambient'] as const).map((t) => {
                  const active = (agent.tier ?? 'focal') === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onChangeTier(agent.id, t)}
                      aria-pressed={active}
                      className={`rounded border px-1.5 py-0.5 capitalize transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'border-[#2D6A4F] bg-[#EAF2ED] font-medium text-[#1B4332]'
                          : 'border-[#E2DFD5] bg-white text-[#5C645E] hover:text-[#1D2420]'
                      }`}
                    >
                      {t === 'focal' ? 'Focal (LLM)' : t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Homeostatic Drives Strip */}
        <dl
          aria-label="Homeostatic drives"
          className="mt-3 grid grid-cols-4 gap-2 border-t border-[#ECE8DD] pt-2.5"
        >
          {(
            [
              { key: 'energy', label: 'Energy', val: agent.drives.energy },
              { key: 'hunger', label: 'Hunger', val: agent.drives.hunger },
              { key: 'social', label: 'Social', val: agent.drives.social },
              { key: 'purpose', label: 'Purpose', val: agent.drives.purpose },
            ] as const
          ).map((d) => {
            const pct = Math.round(d.val);
            return (
              <div key={d.key}>
                <div className="flex items-baseline justify-between text-[10px] text-[#5C645E]">
                  <dt>{d.label}</dt>
                  <dd className="font-mono font-medium text-[#1D2420] tabular-nums">{pct}</dd>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#E5E2D9]">
                  <div
                    className={`h-full transition-all ${driveBarColor(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>

        {/* Current Activity + Micro-Step */}
        <div className="mt-2.5 rounded-lg border border-[#E6E3D8] bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-[#5C645E]">
            <span>Current Activity</span>
            <span className="font-mono tabular-nums">
              {agent.isThinking ? 'LLM Cognition…' : agent.actionEmoji}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-medium text-[#1D2420] leading-snug">
            {agent.currentAction}
          </p>
          {agent.currentSubStep && (
            <p className="mt-0.5 text-[11px] text-[#5C645E] leading-snug">
              Step: {agent.currentSubStep}
            </p>
          )}
        </div>
      </div>

      {/* Sub-Tabs */}
      <div
        role="tablist"
        aria-label="Inspector sections"
        className="grid grid-cols-5 border-b border-[#E2DFD5] bg-[#F2EFE7] px-2 pt-1.5 gap-1"
      >
        {(
          [
            { id: 'plan', label: 'Plan', icon: Calendar },
            { id: 'memory', label: 'Memory', icon: Brain },
            { id: 'social', label: 'Social', icon: HeartHandshake },
            { id: 'dialogues', label: 'Talks', icon: MessageSquare },
            { id: 'interview', label: 'Interact', icon: Mic },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-1 rounded-t-md px-1.5 py-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#FAF8F4] text-[#1D2420] border-t border-x border-[#E2DFD5]'
                  : 'text-[#5C645E] hover:text-[#1D2420]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 smallville-scroll">
        {tab === 'plan' && (
          <div className="space-y-5">
            <section>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  Current Intention
                </h3>
                <button
                  type="button"
                  onClick={() => onTriggerReplan(agent.id)}
                  title={replanBtn.errorMsg}
                  className={`flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    replanBtn.isError
                      ? 'border-[#DC2626]/40 bg-[#FEF2F2] text-[#991B1B]'
                      : 'border-[#D5D0C3] bg-white text-[#2F3833] hover:bg-[#EFECE3]'
                  }`}
                >
                  <Sparkles className="h-3 w-3 text-[#2D6A4F]" aria-hidden="true" />
                  <span>{replanBtn.text}</span>
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#3C4640]">
                {agent.currently}
              </p>
              {agent.goals && agent.goals.length > 0 && (
                <p className="mt-1.5 text-[11px] text-[#3C4640]">
                  <span className="font-semibold text-[#1D2420]">Goals:</span>{' '}
                  {agent.goals.join(' · ')}
                </p>
              )}
              <p className="mt-1 text-[11px] text-[#5C645E]">
                Traits: {agent.traits.join(' · ')}
              </p>
              {agent.inventory && agent.inventory.length > 0 && (
                <p className="mt-1 text-[11px] text-[#5C645E]">
                  Carrying: {agent.inventory.join(' · ')}
                </p>
              )}
              {agent.goods && Object.entries(agent.goods).some(([, qty]) => qty > 0) && (
                <p className="mt-1 text-[11px] text-[#5C645E] font-mono tabular-nums">
                  <span className="font-sans font-medium text-[#3C4640]">Household Goods:</span>{' '}
                  {Object.entries(agent.goods)
                    .filter(([, qty]) => qty > 0)
                    .map(([kind, qty]) => `${kind.replace('_', ' ')} ×${qty}`)
                    .join(' · ')}
                </p>
              )}
            </section>

            {agent.dossier && (
              <section className="border-t border-[#E5E2D9] pt-4 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#1D2420]">
                    Biographical Dossier &amp; Temperament
                  </h3>
                  <span className="font-mono text-[10px] text-[#5C645E] tabular-nums capitalize">
                    {agent.dossier.civicWorldview.replace('_', ' ')} · {agent.dossier.financialPosture}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#3C4640]">
                  {agent.dossier.background}
                </p>
                <p className="text-[11px] text-[#3C4640]">
                  <span className="font-semibold text-[#1D2420]">Private Agenda:</span>{' '}
                  {agent.dossier.privateAgenda}
                </p>
                {agent.dossier.redLines.length > 0 && (
                  <p className="text-[11px] text-[#5C645E]">
                    <span className="font-medium text-[#1D2420]">Red Lines:</span>{' '}
                    {agent.dossier.redLines.join(' · ')}
                  </p>
                )}
                {agent.temperament && (
                  <p className="font-mono text-[10px] text-[#5C645E] tabular-nums pt-0.5">
                    Stubborn {Math.round(agent.temperament.stubbornness * 100)}% · Risk{' '}
                    {Math.round(agent.temperament.riskTolerance * 100)}% · Ambition{' '}
                    {Math.round(agent.temperament.ambition * 100)}% · Decoding T{' '}
                    {agent.temperament.decoding.temperature.toFixed(2)} / p{' '}
                    {agent.temperament.decoding.topP.toFixed(2)}
                  </p>
                )}
              </section>
            )}

            {agent.projects && agent.projects.length > 0 && (
              <section className="border-t border-[#E5E2D9] pt-4">
                <h3 className="text-xs font-semibold text-[#1D2420] mb-2">
                  Multi-Day Projects
                </h3>
                <ul className="space-y-2">
                  {agent.projects.map((proj) => {
                    const pct = Math.max(0, Math.min(100, Math.round(proj.progress)));
                    return (
                      <li
                        key={proj.id}
                        className="rounded-lg border border-[#E6E3D8] bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-[#1D2420]">{proj.title}</span>
                          <span className="font-mono text-[11px] text-[#2D6A4F] tabular-nums shrink-0">
                            {proj.status === 'completed' ? 'Completed' : `${pct}%`}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#E5E2D9]">
                          <div
                            className={`h-full transition-all ${
                              proj.status === 'completed' ? 'bg-[#1B4332]' : 'bg-[#2D6A4F]'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section className="border-t border-[#E5E2D9] pt-4">
              <h3 className="text-xs font-semibold text-[#1D2420] mb-2.5">
                Hierarchical Daily Schedule
              </h3>
              <ol className="space-y-2">
                {agent.dailySchedule.map((block) => {
                  const isActive = block.id === agent.activeScheduleId;
                  const blockLoc = locations.find((l) => l.id === block.locationId);
                  const sourceNote =
                    block.source === 'drive_interrupt'
                      ? 'Detour'
                      : block.source === 'social_commitment'
                        ? 'Commitment'
                        : block.source === 'morning_plan'
                          ? 'Morning Plan'
                          : block.source === 'llm_replan'
                            ? 'Re-plan'
                            : null;
                  return (
                    <li
                      key={block.id}
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        isActive
                          ? 'border-[#2D6A4F] bg-[#EAF2ED]'
                          : 'border-[#E6E3D8] bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-medium text-[#2F3833] tabular-nums">
                          D{block.day} · {formatMinuteOfDay(block.startMinute)}
                          {` · ${block.kind}`}
                          {sourceNote ? ` · ${sourceNote}` : ''}
                          {block.fixed ? ' · Fixed' : ''}
                          {block.oneOff ? ' · One-off' : ''}
                        </span>
                        <span className="text-[11px] text-[#5C645E] truncate">
                          {blockLoc?.shortName ?? block.locationId}
                          {' · '}
                          <span aria-hidden="true">{block.emoji}</span>
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#1D2420] leading-snug">
                        {block.activity}
                      </p>
                      {isActive && block.subSteps && block.subSteps.length > 0 && (
                        <p className="mt-1 text-[11px] text-[#2D6A4F]">
                          Sub-steps: {block.subSteps.join(' → ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        )}

        {tab === 'memory' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  {memoryViewMode === 'episodic'
                    ? `Memory Stream (${agent.memories.length})`
                    : `Bi-Temporal Belief Graph (${activeBeliefsList.length} active)`}
                </h3>
                <p className="text-[11px] text-[#5C645E] font-mono tabular-nums mt-0.5">
                  Reflection Poignancy: {agent.importanceAccumulator} / {reflectionThreshold}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onTriggerReflection(agent.id)}
                title={reflectBtn.errorMsg}
                className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 ${
                  reflectBtn.isError
                    ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                    : 'bg-[#2D6A4F] hover:bg-[#23533D]'
                }`}
              >
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{reflectBtn.text}</span>
              </button>
            </div>

            <div
              role="group"
              aria-label="Memory view mode"
              className="flex items-center gap-1 rounded-md border border-[#DEDAD0] bg-[#F2EFE7] p-0.5"
            >
              <button
                type="button"
                onClick={() => setMemoryViewMode('episodic')}
                aria-pressed={memoryViewMode === 'episodic'}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  memoryViewMode === 'episodic'
                    ? 'bg-white text-[#1D2420] shadow-xs'
                    : 'text-[#5C645E] hover:text-[#1D2420]'
                }`}
              >
                Episodic Stream ({agent.memories.length})
              </button>
              <button
                type="button"
                onClick={() => setMemoryViewMode('beliefs')}
                aria-pressed={memoryViewMode === 'beliefs'}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  memoryViewMode === 'beliefs'
                    ? 'bg-white text-[#2D6A4F] shadow-xs'
                    : 'text-[#5C645E] hover:text-[#1D2420]'
                }`}
              >
                Belief Graph ({activeBeliefsList.length}/{agentBeliefs.length})
              </button>
            </div>

            {memoryViewMode === 'beliefs' ? (
              <div className="space-y-3" data-testid="belief-graph-panel">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[#5C645E]">
                    Structured claims with validity intervals &amp; superseding history.
                  </span>
                  <div className="inline-flex rounded border border-[#D5D0C3] bg-[#F2EFE7] p-0.5 text-[10px] shrink-0">
                    <button
                      type="button"
                      onClick={() => setBeliefFilter('active')}
                      className={`rounded px-2 py-0.5 font-medium whitespace-nowrap ${
                        beliefFilter === 'active'
                          ? 'bg-white text-[#1D2420] shadow-xs'
                          : 'text-[#5C645E]'
                      }`}
                    >
                      Active ({activeBeliefsList.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBeliefFilter('superseded')}
                      className={`rounded px-2 py-0.5 font-medium whitespace-nowrap ${
                        beliefFilter === 'superseded'
                          ? 'bg-white text-[#1D2420] shadow-xs'
                          : 'text-[#5C645E]'
                      }`}
                    >
                      Superseded ({supersededBeliefsList.length})
                    </button>
                  </div>
                </div>

                {(beliefFilter === 'active' ? activeBeliefsList : supersededBeliefsList).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#D5D0C3] px-4 py-6 text-center text-xs text-[#5C645E]">
                    {beliefFilter === 'active'
                      ? 'No active beliefs recorded yet.'
                      : 'No beliefs have been superseded yet. Revisions appear here when trust or evidence shifts.'}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {(beliefFilter === 'active' ? activeBeliefsList : supersededBeliefsList).map(
                      (b) => {
                        const subjAgent = allAgents.find((a) => a.id === b.subjectId);
                        const fromT = formatSimTime(b.validFromSimMin);
                        const invT =
                          b.invalidatedAtSimMin !== undefined
                            ? formatSimTime(b.invalidatedAtSimMin)
                            : null;
                        return (
                          <li
                            key={b.id}
                            className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${
                              invT
                                ? 'border-[#E5E2D9] bg-[#F5F3EC] text-[#5C645E]'
                                : 'border-[#E5E2D9] bg-white text-[#1D2420]'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="font-semibold capitalize text-[#2D6A4F]">
                                {b.predicate.replace('_', ' ')} ·{' '}
                                <span className="text-[#1D2420]">
                                  {subjAgent?.name ?? b.subjectId.replace('_', ' ')}
                                </span>
                              </span>
                              <span className="font-mono text-[10px] text-[#5C645E] tabular-nums shrink-0">
                                {Math.round(b.confidence * 100)}% conf
                              </span>
                            </div>
                            <p className={`leading-relaxed ${invT ? 'line-through opacity-80' : ''}`}>
                              {b.claim}
                            </p>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[#6B736D] tabular-nums pt-0.5">
                              <span>
                                Valid D{fromT.day} {fromT.timeLabel}
                                {invT ? ` → Invalidated D${invT.day} ${invT.timeLabel}` : ' · Current'}
                              </span>
                              {b.sourceMemoryId && (
                                <button
                                  type="button"
                                  onClick={() => handleJumpToEvidence(b.sourceMemoryId!)}
                                  className="text-[#2D6A4F] hover:underline whitespace-nowrap"
                                >
                                  Source: {b.sourceMemoryId}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      },
                    )}
                  </ul>
                )}
              </div>
            ) : (
            <>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="memory-retrieval-query"
                  className="text-[11px] font-medium text-[#4A534D]"
                >
                  Retrieval Probe (Recency + Importance + Relevance)
                </label>
                <div
                  role="group"
                  aria-label="Memory search mode"
                  className="inline-flex items-center rounded border border-[#D5D0C3] bg-[#F2EFE7] p-0.5 text-[10px]"
                >
                  <button
                    type="button"
                    onClick={() => setSearchMode('lexical')}
                    className={`rounded px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                      searchMode === 'lexical'
                        ? 'bg-white text-[#1D2420] shadow-xs'
                        : 'text-[#5C645E] hover:text-[#1D2420]'
                    }`}
                  >
                    Lexical
                  </button>
                  <button
                    type="button"
                    onClick={handleSemanticProbe}
                    className={`rounded px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                      searchMode === 'semantic'
                        ? 'bg-white text-[#2D6A4F] shadow-xs'
                        : 'text-[#5C645E] hover:text-[#1D2420]'
                    }`}
                  >
                    Semantic
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  id="memory-retrieval-query"
                  type="text"
                  value={memoryQuery}
                  onChange={(e) => setMemoryQuery(e.target.value)}
                  placeholder="Query (e.g. Valentine party, Maria, mayor)…"
                  className="min-w-0 flex-1 rounded-md border border-[#D5D0C3] bg-white px-2.5 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleSemanticProbe}
                  title="Compute dense semantic vectors with gemini-embedding-2"
                  className="flex items-center gap-1 rounded-md border border-[#D5D0C3] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2F3833] hover:bg-[#EFECE3] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Search className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                  <span>Embed Query</span>
                </button>
              </div>
            </div>

            <div
              role="group"
              aria-label="Filter memory type"
              className="flex items-center gap-1 rounded-md border border-[#DEDAD0] bg-[#F2EFE7] p-0.5"
            >
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'observation', label: 'Obs' },
                  { id: 'reflection', label: 'Refl' },
                  { id: 'plan', label: 'Plans' },
                  { id: 'consolidated', label: 'Sleep' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMemoryFilter(item.id)}
                  className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    memoryFilter === item.id
                      ? 'bg-white text-[#1D2420] shadow-xs'
                      : 'text-[#5C645E] hover:text-[#1D2420]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {scoredMemories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D5D0C3] px-4 py-6 text-center text-xs text-[#5C645E]">
                No memories match this filter.
              </div>
            ) : (
              <VirtualList
                ref={memoryListRef}
                items={scoredMemories}
                getKey={getMemoryKey}
                estimateHeight={estimateMemoryHeight}
                maxHeightClassName="max-h-[430px]"
                ariaLabel="Memory stream entries"
                renderItem={({
                  node,
                  score,
                  recencyScore,
                  importanceScore,
                  relevanceScore,
                  usedEmbedding,
                }) => {
                  const t = formatSimTime(node.createdAt);
                  const memSource = node.source ?? inferMemorySource(node);
                  const isHighlighted = highlightedMemoryId === node.id;
                  return (
                    <div
                      data-memory-id={node.id}
                      className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                        isHighlighted
                          ? 'border-[#2D6A4F] bg-[#EAF2ED]'
                          : 'border-[#E5E2D9] bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C645E]">
                        <span className="flex items-center gap-1.5 font-medium capitalize text-[#2D6A4F]">
                          <span>{node.type}</span>
                          <span aria-hidden="true" className="text-[#9BA29C]">
                            ·
                          </span>
                          <span className="font-mono text-[10px] text-[#4A534D]">
                            {memSource}
                          </span>
                          <span aria-hidden="true" className="text-[#9BA29C]">
                            ·
                          </span>
                          <span className="font-normal text-[#5C645E] font-mono tabular-nums">
                            D{t.day} {t.timeLabel}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums text-[#3C4640]">
                          Imp {node.importance}/10
                          {node.timesCited ? ` · Cited ${node.timesCited}×` : ''}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#1D2420] leading-relaxed">
                        {node.description}
                      </p>
                      {node.evidenceIds && node.evidenceIds.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span className="font-medium text-[#4A534D]">Evidence:</span>
                          {node.evidenceIds.map((evId) => (
                            <button
                              key={evId}
                              type="button"
                              onClick={() => handleJumpToEvidence(evId)}
                              className="rounded border border-[#D5D0C3] bg-[#FAF8F4] px-1.5 py-0.5 font-mono text-[#2D6A4F] hover:bg-[#EAF2ED] hover:border-[#2D6A4F] transition-colors whitespace-nowrap"
                            >
                              {evId}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-[#6B736D] tabular-nums">
                        <span>Score {score.toFixed(2)}</span>
                        <span aria-hidden="true">·</span>
                        <span>R {recencyScore.toFixed(2)}</span>
                        <span aria-hidden="true">·</span>
                        <span>I {importanceScore.toFixed(1)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Rel {relevanceScore.toFixed(2)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Accessed {formatSimTime(node.lastAccessed).timeLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className={usedEmbedding ? 'text-[#2D6A4F] font-semibold' : ''}>
                          {usedEmbedding ? 'Semantic' : 'Lexical'}
                        </span>
                        {node.linkedMemoryIds && node.linkedMemoryIds.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{node.linkedMemoryIds.length} assoc. links</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            )}
            </>
            )}
          </div>
        )}

        {tab === 'social' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  Theory of Mind Social Ledger
                </h3>
                <p className="text-[11px] text-[#5C645E] mt-0.5">
                  Directed trust, affection &amp; inferred neighbor intentions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onTriggerConsolidation(agent.id)}
                title={consolidateBtn.errorMsg}
                className={`flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  consolidateBtn.isError
                    ? 'border-[#DC2626]/40 bg-[#FEF2F2] text-[#991B1B]'
                    : 'border-[#D5D0C3] bg-white text-[#2F3833] hover:bg-[#EFECE3]'
                }`}
              >
                <Moon className="h-3.5 w-3.5 text-[#2D6A4F]" aria-hidden="true" />
                <span>{consolidateBtn.text}</span>
              </button>
            </div>

            {socialEdges.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D5D0C3] px-4 py-6 text-center text-xs text-[#5C645E]">
                No social mental models formed yet. Trigger a conversation to populate Theory of Mind beliefs.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {socialEdges.map((edge) => {
                  const person = allAgents.find((a) => a.id === edge.targetId);
                  return (
                    <li
                      key={edge.targetId}
                      className="rounded-lg border border-[#E5E2D9] bg-white p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-[#1D2420]">
                          {person?.name ?? edge.targetId}
                        </span>
                        <span className="text-[11px] text-[#5C645E]">{edge.roleLabel}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-[11px] text-[#3C4640] tabular-nums">
                        <span>Trust {edge.trust}</span>
                        <span aria-hidden="true" className="text-[#9BA29C]">
                          ·
                        </span>
                        <span>Affection {edge.affection}</span>
                        <span aria-hidden="true" className="text-[#9BA29C]">
                          ·
                        </span>
                        <span>Familiarity {edge.familiarity}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-[#2F3833] border-t border-[#EFECE3] pt-1.5">
                        <span className="font-medium text-[#2D6A4F]">Inferred goal:</span>{' '}
                        {edge.inferredGoal}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}

            {((agent.householdPartnerIds && agent.householdPartnerIds.length > 0) ||
              agentLoans.length > 0) && (
              <div className="border-t border-[#E5E2D9] pt-3 space-y-2.5 text-xs">
                {agent.householdPartnerIds && agent.householdPartnerIds.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-[#1D2420]">Household Ties</h4>
                    <p className="mt-0.5 text-[11px] text-[#5C645E]">
                      Shares home ({agent.housingStatus ?? 'renter'}
                      {agent.monthlyRent ? `, $${agent.monthlyRent}/cycle` : ''}) with{' '}
                      {agent.householdPartnerIds
                        .map((pid) => allAgents.find((a) => a.id === pid)?.name ?? pid)
                        .join(', ')}
                      .
                    </p>
                  </div>
                )}
                {agentLoans.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="font-semibold text-[#1D2420]">
                      Peer Credit Contracts ({agentLoans.length})
                    </h4>
                    <ul className="space-y-1.5">
                      {agentLoans.map((loan) => {
                        const isLender = loan.lenderId === agent.id;
                        const counterparty = allAgents.find(
                          (a) => a.id === (isLender ? loan.borrowerId : loan.lenderId),
                        );
                        return (
                          <li
                            key={loan.id}
                            className="rounded border border-[#E5E2D9] bg-white px-2.5 py-2 text-[11px] flex items-baseline justify-between gap-2"
                          >
                            <span className="text-[#1D2420]">
                              {isLender ? 'Lent to ' : 'Borrowed from '}
                              <strong>{counterparty?.name ?? 'Neighbor'}</strong>
                              <span className="text-[#5C645E]"> · Due D{loan.dueDay}</span>
                            </span>
                            <span
                              className={`font-mono tabular-nums font-medium shrink-0 ${
                                loan.status === 'defaulted'
                                  ? 'text-[#B91C1C]'
                                  : loan.status === 'repaid'
                                    ? 'text-[#2D6A4F]'
                                    : 'text-[#1D2420]'
                              }`}
                            >
                              ${loan.principal} · {loan.status}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'dialogues' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#E5E2D9] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  Initiate Conversation
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPrivateThoughts((v) => !v)}
                  aria-pressed={showPrivateThoughts}
                  className="text-[11px] font-medium text-[#2D6A4F] hover:underline whitespace-nowrap"
                >
                  {showPrivateThoughts ? 'Hide inner thoughts' : 'Show inner thoughts'}
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-[#5C645E]">
                Trigger an LLM-powered dialogue between {agent.name.split(' ')[0]} and another Smallville resident.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <label htmlFor="dialogue-partner-select" className="sr-only">
                  Conversation partner
                </label>
                <select
                  id="dialogue-partner-select"
                  value={effectivePartnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  className="flex-1 rounded-md border border-[#D5D0C3] bg-[#FAF8F4] px-2.5 py-1.5 text-xs text-[#1D2420] focus:border-[#2D6A4F] focus:outline-none"
                >
                  {otherAgents.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!effectivePartnerId}
                  onClick={() => onTriggerConversation(agent.id, effectivePartnerId)}
                  title={converseBtn.errorMsg}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 ${
                    converseBtn.isError
                      ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                      : 'bg-[#2D6A4F] hover:bg-[#23533D]'
                  }`}
                >
                  {converseBtn.text}
                </button>
              </div>
            </div>

            {agentConversations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#D5D0C3] px-4 py-6 text-center text-xs text-[#5C645E]">
                No dialogues recorded yet for {agent.name.split(' ')[0]}. Conversations trigger automatically when residents encounter each other or when you click Converse above.
              </div>
            ) : (
              <div className="space-y-3">
                {agentConversations.map((conv) => {
                  const t = formatSimTime(conv.simMinutes);
                  return (
                    <article
                      key={conv.id}
                      className="rounded-lg border border-[#E5E2D9] bg-white p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C645E]">
                        <span className="font-semibold text-[#1D2420]">
                          {conv.participantNames.join(', ')}
                          {conv.participantIds.length > 2 ? ' (Group)' : ''}
                        </span>
                        <span className="font-mono tabular-nums">
                          {t.timeLabel} · {conv.locationName}
                        </span>
                      </div>
                      {(conv.reason ||
                        conv.endedBy ||
                        conv.agreement ||
                        (conv.overheardByIds && conv.overheardByIds.length > 0) ||
                        (conv.gossipUpdates && conv.gossipUpdates.length > 0)) && (
                        <div className="mt-1.5 space-y-1 text-[11px] text-[#4A534D]">
                          {(conv.reason || conv.endedBy) && (
                            <p className="leading-snug">
                              {conv.reason ? <span>Reason: {conv.reason}</span> : null}
                              {conv.reason && conv.endedBy ? ' · ' : null}
                              {conv.endedBy ? (
                                <span className="font-mono text-[10px] text-[#5C645E]">
                                  Ended: {conv.endedBy}
                                </span>
                              ) : null}
                            </p>
                          )}
                          {conv.overheardByIds && conv.overheardByIds.length > 0 && (
                            <p className="text-[10px] text-[#5C645E]">
                              Overheard nearby by:{' '}
                              {conv.overheardByIds
                                .map((oid) => allAgents.find((a) => a.id === oid)?.name.split(' ')[0] ?? oid)
                                .join(', ')}
                            </p>
                          )}
                          {conv.gossipUpdates && conv.gossipUpdates.length > 0 && (
                            <p className="text-[10px] text-[#92400E]">
                              Word spread about{' '}
                              {conv.gossipUpdates
                                .map(
                                  (g) =>
                                    `${allAgents.find((a) => a.id === g.aboutAgentId)?.name.split(' ')[0] ?? g.aboutAgentId} (${g.deltaTrust >= 0 ? '+' : ''}${g.deltaTrust} trust)`,
                                )
                                .join(', ')}
                            </p>
                          )}
                          {conv.agreement && (
                            <div className="rounded border border-[#2D6A4F]/25 bg-[#EAF2ED] px-2 py-1 text-[11px] text-[#1B4332]">
                              Agreed: Day {conv.agreement.day} ·{' '}
                              {formatMinuteOfDay(conv.agreement.minuteOfDay)} ·{' '}
                              {conv.agreement.locationName ?? conv.agreement.locationId} —{' '}
                              {conv.agreement.activity}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 space-y-2 border-t border-[#EFECE3] pt-2">
                        {conv.turns.map((turn, idx) => (
                          <div key={idx} className="space-y-0.5">
                            <p className="leading-relaxed text-[#2F3833]">
                              <span className="font-semibold text-[#1D2420]">
                                {turn.speakerName.split(' ')[0]}:
                              </span>{' '}
                              {turn.text}
                            </p>
                            {showPrivateThoughts && turn.privateThought && (
                              <p className="text-[11px] italic text-[#5C645E] leading-snug pl-2">
                                Inner thought: “{turn.privateThought}”
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'interview' && (
          <div className="space-y-5">
            {localError && (
              <div
                role="alert"
                className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]"
              >
                {localError}
              </div>
            )}

            {/* Reporter Interview */}
            <form onSubmit={handleInterviewSubmit} className="space-y-2.5">
              <div>
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  Interview as Gazette Reporter
                </h3>
                <p className="mt-0.5 text-[11px] text-[#5C645E]">
                  Ask {agent.name.split(' ')[0]} a question at {currentTime.timeLabel}. Answers reflect mood, drives, and cited Memory Stream entries.
                </p>
              </div>
              <label htmlFor="interview-input" className="sr-only">
                Interview question
              </label>
              <textarea
                id="interview-input"
                rows={2}
                value={interviewQuestion}
                onChange={(e) => setInterviewQuestion(e.target.value)}
                placeholder={`Ask ${agent.name.split(' ')[0]} about their plans, friends, or Smallville news…`}
                className="w-full rounded-md border border-[#D5D0C3] bg-white px-3 py-2 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'What are your plans for 5 PM?',
                    'How do you feel about the mayor race?',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setInterviewQuestion(preset)}
                      className="text-[11px] text-[#2D6A4F] hover:underline"
                    >
                      “{preset}”
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  title={interviewBtn.errorMsg}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap ${
                    interviewBtn.isError
                      ? 'bg-[#B91C1C] hover:bg-[#991B1B]'
                      : 'bg-[#2D6A4F] hover:bg-[#23533D]'
                  }`}
                >
                  {interviewBtn.text}
                </button>
              </div>
            </form>

            {agentTranscripts.length > 0 && (
              <div className="space-y-2.5">
                {agentTranscripts.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-[#E5E2D9] bg-white p-3 text-xs space-y-1.5"
                  >
                    <div className="font-medium text-[#5C645E]">
                      Reporter: “{item.question}”
                    </div>
                    <p className="text-[#1D2420] leading-relaxed">
                      <span className="font-semibold">
                        {agent.name.split(' ')[0]}:
                      </span>{' '}
                      {item.answer}
                    </p>
                    {item.citedMemoryIds.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-[#6B736D]">
                        <span>Cited memories:</span>
                        {item.citedMemoryIds.map((cid) => (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => handleJumpToEvidence(cid)}
                            className="rounded border border-[#D5D0C3] bg-[#FAF8F4] px-1.5 py-0.5 text-[#2D6A4F] hover:bg-[#EAF2ED] transition-colors"
                          >
                            {cid}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Whisper Inner Thought */}
            <form
              onSubmit={handleWhisperSubmit}
              className="space-y-2.5 border-t border-[#E5E2D9] pt-4"
            >
              <div>
                <h3 className="text-xs font-semibold text-[#1D2420]">
                  Whisper Inner Thought
                </h3>
                <p className="mt-0.5 text-[11px] text-[#5C645E]">
                  Inject a sudden thought or impulse into {agent.name.split(' ')[0]}’s consciousness and watch them react on the map.
                </p>
              </div>
              <label htmlFor="whisper-input" className="sr-only">
                Inner thought to whisper
              </label>
              <input
                id="whisper-input"
                type="text"
                value={whisperThought}
                onChange={(e) => setWhisperThought(e.target.value)}
                placeholder="e.g. I should walk over to Hobbs Cafe and check on Isabella."
                className="w-full rounded-md border border-[#D5D0C3] bg-white px-3 py-1.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  title={whisperBtn.errorMsg}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap ${
                    whisperBtn.isError
                      ? 'border-[#B91C1C] bg-[#B91C1C] hover:bg-[#991B1B]'
                      : 'border-[#B45309] bg-[#B45309] hover:bg-[#92400E]'
                  }`}
                >
                  {whisperBtn.text}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
});
