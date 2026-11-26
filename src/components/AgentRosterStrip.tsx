import { useMemo, useState } from 'react';
import { getShortFirstName } from '../simulation/memory';
import type { AgentAppearance, AgentState, AgentTier, LocationZone } from '../simulation/types';

export function AgentPortrait({
  appearance,
  size = 28,
}: {
  appearance: AgentAppearance;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0 rounded-md border border-[#DEDAD0] bg-[#EFECE3]"
    >
      <path d="M6 32 C6 23, 26 23, 26 32 Z" fill={appearance.shirt} />
      {appearance.accessory === 'apron' && (
        <rect x="11" y="25" width="10" height="7" fill="#FAF8F4" opacity="0.9" />
      )}
      {appearance.accessory === 'scarf' && (
        <path d="M10 23 Q16 27 22 23 L21 26 Q16 29 11 26 Z" fill="#D97706" />
      )}
      <rect x="14" y="19" width="4" height="5" fill={appearance.skin} />
      <circle cx="16" cy="14" r="6.5" fill={appearance.skin} />
      <path
        d="M9.5 13 C9.5 7.5, 22.5 7.5, 22.5 13 C21 10.5, 11 10.5, 9.5 13 Z"
        fill={appearance.hair}
      />
      <circle cx="13.7" cy="14" r="0.9" fill="#1D2420" />
      <circle cx="18.3" cy="14" r="0.9" fill="#1D2420" />
      {appearance.accessory === 'glasses' && (
        <g stroke="#1D2420" strokeWidth="0.9" fill="none">
          <rect x="11.8" y="12.6" width="3.6" height="2.8" rx="0.6" />
          <rect x="16.6" y="12.6" width="3.6" height="2.8" rx="0.6" />
          <line x1="15.4" y1="13.8" x2="16.6" y2="13.8" />
        </g>
      )}
      {appearance.accessory === 'hat' && (
        <g>
          <rect x="9" y="8" width="14" height="2.2" rx="1" fill="#475569" />
          <rect x="11" y="5" width="10" height="3.5" rx="1" fill="#334155" />
        </g>
      )}
      {appearance.accessory === 'beret' && (
        <ellipse cx="16.5" cy="8" rx="7" ry="2.6" fill="#581C87" />
      )}
    </svg>
  );
}

interface AgentRosterStripProps {
  agents: AgentState[];
  locations: LocationZone[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

export function AgentRosterStrip({
  agents,
  locations,
  selectedAgentId,
  onSelectAgent,
}: AgentRosterStripProps) {
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | AgentTier>('all');
  const isLargePopulation = agents.length > 18;

  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l.shortName])),
    [locations],
  );

  const filteredAgents = useMemo(() => {
    if (!isLargePopulation) return agents;
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (tierFilter !== 'all' && (a.tier ?? 'focal') !== tierFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.occupation.toLowerCase().includes(q) ||
        (a.currentAreaLabel ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, isLargePopulation, search, tierFilter]);

  return (
    <div
      className="shrink-0 border-b border-[#E2DFD5] bg-[#FAF8F4] px-3 py-2 space-y-1.5"
      role="region"
      aria-label="Smallville residents"
    >
      {isLargePopulation && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="search"
              aria-label="Filter residents by name or role"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${agents.length} residents…`}
              className="w-44 rounded border border-[#D5D0C3] bg-white px-2 py-0.5 text-xs text-[#1D2420] placeholder:text-[#8A918B] focus:border-[#2D6A4F] focus:outline-none"
            />
            <div className="flex items-center rounded border border-[#D5D0C3] bg-white p-0.5">
              {(['all', 'focal', 'active', 'ambient'] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setTierFilter(tier)}
                  className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors whitespace-nowrap shrink-0 ${
                    tierFilter === tier
                      ? 'bg-[#2D6A4F] font-medium text-white'
                      : 'text-[#5C645E] hover:text-[#1D2420]'
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>
          <span className="font-mono tabular-nums text-[#5C645E]">
            Showing {filteredAgents.length}/{agents.length}
          </span>
        </div>
      )}

      <div
        className={
          isLargePopulation
            ? 'flex gap-1.5 overflow-x-auto smallville-scroll pb-0.5'
            : 'flex gap-1.5 overflow-x-auto smallville-scroll sm:grid sm:grid-cols-6 xl:grid-cols-9'
        }
      >
        {filteredAgents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          const firstName = getShortFirstName(agent.name);
          const locName =
            (agent.currentLocationId ? locMap.get(agent.currentLocationId) : undefined) ??
            agent.currentAreaLabel ??
            'Outdoors';
          const tier = agent.tier ?? 'focal';
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              aria-label={`Inspect ${agent.name}`}
              aria-pressed={isSelected}
              className={`flex items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors ${
                isLargePopulation ? 'min-w-[136px] shrink-0' : 'min-w-[122px] shrink-0 sm:min-w-0 sm:shrink'
              } ${
                isSelected
                  ? 'border-[#2D6A4F] bg-[#EAF2ED] text-[#1D2420]'
                  : 'border-[#E5E2D9] bg-white text-[#2F3833] hover:border-[#C8C3B4]'
              }`}
            >
              <AgentPortrait appearance={agent.appearance} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1 text-xs font-semibold leading-tight">
                  <span className="truncate">{firstName}</span>
                  <span aria-hidden="true" className="shrink-0 text-[11px]">
                    {agent.isThinking ? '✨' : agent.illness === 'mild_cold' ? '🤒' : agent.actionEmoji}
                  </span>
                </div>
                <div className="truncate text-[10px] text-[#5C645E] leading-tight">
                  {agent.isThinking
                    ? 'Thinking…'
                    : isLargePopulation
                      ? `${locName} · ${tier}`
                      : `${locName} · ${agent.mood.label}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
