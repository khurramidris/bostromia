import { useCallback, useMemo, useState } from 'react';
import { formatSimTime } from '../simulation/memory';
import type { AgentState, ChronicleEvent, ChronicleEventType, ConversationRecord } from '../simulation/types';
import { VirtualList } from './VirtualList';

interface ChronicleViewProps {
  chronicle: ChronicleEvent[];
  conversations: ConversationRecord[];
  agents: AgentState[];
  onSelectAgentAndMap: (agentId: string) => void;
}

export function ChronicleView({
  chronicle,
  conversations,
  agents,
  onSelectAgentAndMap,
}: ChronicleViewProps) {
  const [filter, setFilter] = useState<'all' | ChronicleEventType>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? chronicle : chronicle.filter((e) => e.type === filter)),
    [chronicle, filter],
  );

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const getChronicleKey = useCallback((ev: ChronicleEvent) => ev.id, []);
  const estimateChronicleHeight = useCallback(
    (ev: ChronicleEvent) => 92 + Math.ceil(ev.detail.length / 72) * 18 + (ev.agentIds.length > 0 ? 24 : 0),
    [],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2DFD5] pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#1D2420]">
            Smallville Town Chronicle
          </h1>
          <p className="mt-1 text-sm text-[#5C645E]">
            Live record of emergent conversations, reflections, reactions, whispers, and community events across Smallville.
          </p>
        </div>

        <div
          role="group"
          aria-label="Filter chronicle events"
          className="flex flex-wrap items-center gap-1 rounded-md border border-[#DEDAD0] bg-[#F2EFE7] p-0.5"
        >
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'conversation', label: 'Dialogues' },
              { id: 'economy', label: 'Economy' },
              { id: 'civic', label: 'Civic' },
              { id: 'notice', label: 'Notices' },
              { id: 'project', label: 'Projects' },
              { id: 'reflection', label: 'Reflections' },
              { id: 'reaction', label: 'Reactions' },
              { id: 'plan', label: 'Plans' },
              { id: 'consolidation', label: 'Sleep' },
              { id: 'world_event', label: 'Events' },
              { id: 'whisper', label: 'Whispers' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-[#1D2420] shadow-xs'
                  : 'text-[#5C645E] hover:text-[#1D2420]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Chronological Event Feed (Virtualized) */}
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-semibold text-[#4A534D]">
            Event Timeline ({filtered.length})
          </h2>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#D5D0C3] bg-white px-4 py-8 text-center text-sm text-[#5C645E]">
              No chronicle entries match this category yet.
            </div>
          ) : (
            <VirtualList
              items={filtered}
              getKey={getChronicleKey}
              estimateHeight={estimateChronicleHeight}
              maxHeightClassName="max-h-[680px]"
              ariaLabel="Chronicle event timeline"
              renderItem={(ev) => {
                const t = formatSimTime(ev.simMinutes);
                return (
                  <article className="rounded-lg border border-[#E5E2D9] bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C645E]">
                      <span className="font-mono tabular-nums">
                        {t.fullLabel}
                        {ev.locationName ? ` · ${ev.locationName}` : ''}
                      </span>
                      <span className="capitalize font-medium text-[#2D6A4F]">
                        {ev.type.replace('_', ' ')}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-[#1D2420]">
                      {ev.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#3C4640]">
                      {ev.detail}
                    </p>
                    {ev.agentIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        {ev.agentIds.map((aid) => {
                          const ag = agentById.get(aid);
                          if (!ag) return null;
                          return (
                            <button
                              key={aid}
                              type="button"
                              onClick={() => onSelectAgentAndMap(aid)}
                              className="font-medium text-[#2D6A4F] hover:underline"
                            >
                              Inspect {ag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              }}
            />
          )}
        </section>

        {/* Recent Full Dialogues Column */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[#4A534D]">
            Recent Conversations ({conversations.length})
          </h2>
          {conversations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#D5D0C3] bg-white px-4 py-8 text-center text-xs text-[#5C645E]">
              Conversations appear here automatically when residents encounter each other or when triggered from the Inspector.
            </div>
          ) : (
            <div className="space-y-3">
              {conversations.slice(0, 8).map((conv) => {
                const t = formatSimTime(conv.simMinutes);
                return (
                  <article
                    key={conv.id}
                    className="rounded-lg border border-[#E5E2D9] bg-white p-3.5 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C645E]">
                      <span className="font-semibold text-[#1D2420]">
                        {conv.participantNames.join(', ')}
                      </span>
                      <span className="font-mono tabular-nums">{t.timeLabel}</span>
                    </div>
                    <div className="space-y-1 border-t border-[#EFECE3] pt-2">
                      {conv.turns.map((turn, i) => (
                        <p key={i} className="leading-relaxed text-[#2F3833]">
                          <span className="font-semibold text-[#1D2420]">
                            {turn.speakerName.split(' ')[0]}:
                          </span>{' '}
                          {turn.text}
                        </p>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
