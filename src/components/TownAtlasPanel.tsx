import { ArrowUpRight, Compass, LineChart, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  computeExplorerPoints,
  computeResidentPictograms,
  computeTownAdvisors,
  EXPLORER_METRICS,
  type ExplorerMetricId,
  type MapLensId,
  type PictogramTone,
} from '../simulation/spatialAnalytics';
import type { WorldState } from '../simulation/types';

export type AtlasTabId = 'pictograms' | 'advisors' | 'explorer';

interface TownAtlasPanelProps {
  world: WorldState;
  selectedAgentId: string;
  activeMemeId?: string;
  activeProposalId?: string;
  onChangeMemeId: (memeId: string) => void;
  onChangeProposalId: (proposalId: string) => void;
  onFocusAgent: (agentId: string) => void;
  onFocusLocation: (locationId: string) => void;
  onActivateLens: (lens: MapLensId) => void;
  onClose: () => void;
}

function toneFill(tone: PictogramTone): string {
  switch (tone) {
    case 'emerald':
      return '#2D6A4F';
    case 'amber':
      return '#D97706';
    case 'rose':
      return '#DC2626';
    default:
      return '#C7C3B8';
  }
}

function toneDotClass(tone: PictogramTone): string {
  switch (tone) {
    case 'emerald':
      return 'bg-[#2D6A4F]';
    case 'amber':
      return 'bg-[#D97706]';
    case 'rose':
      return 'bg-[#DC2626]';
    default:
      return 'bg-[#C7C3B8]';
  }
}

function ResidentSilhouette({
  fill,
  selected,
}: {
  fill: string;
  selected: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 20"
      className={`h-5 w-4 transition-transform ${selected ? 'scale-115' : 'group-hover:scale-110'}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="4.2" r="2.7" fill={fill} />
      <path
        d="M3.4 17.5C3.4 12.6 5.2 9.4 8 9.4C10.8 9.4 12.6 12.6 12.6 17.5H3.4Z"
        fill={fill}
      />
      {selected && (
        <rect
          x="1"
          y="0.8"
          width="14"
          height="18.2"
          rx="3"
          fill="none"
          stroke="#1D2420"
          strokeWidth="1.3"
        />
      )}
    </svg>
  );
}

export function TownAtlasPanel({
  world,
  selectedAgentId,
  activeMemeId,
  activeProposalId,
  onChangeMemeId,
  onChangeProposalId,
  onFocusAgent,
  onFocusLocation,
  onActivateLens,
  onClose,
}: TownAtlasPanelProps) {
  const [tab, setTab] = useState<AtlasTabId>('pictograms');
  const [xMetric, setXMetric] = useState<ExplorerMetricId>('wallet');
  const [yMetric, setYMetric] = useState<ExplorerMetricId>('avgTrust');
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);

  const pictograms = useMemo(
    () =>
      computeResidentPictograms(world, {
        memeId: activeMemeId,
        proposalId: activeProposalId,
      }),
    [world, activeMemeId, activeProposalId],
  );

  const advisors = useMemo(() => computeTownAdvisors(world), [world]);

  const explorer = useMemo(
    () => computeExplorerPoints(world, xMetric, yMetric),
    [world, xMetric, yMetric],
  );

  const sortedPoints = useMemo(
    () => [...explorer.points].sort((a, b) => b.xVal - a.xVal),
    [explorer.points],
  );

  const hoveredPoint = hoveredPointId
    ? explorer.points.find((p) => p.agentId === hoveredPointId)
    : undefined;

  const memes = useMemo(
    () =>
      [...(world.memes ?? [])].sort(
        (a, b) => Object.keys(b.knownBy).length - Object.keys(a.knownBy).length,
      ),
    [world.memes],
  );
  const proposals = useMemo(() => {
    const list = [...(world.proposals ?? [])];
    return list.sort((a, b) => {
      if (a.status === 'open' && b.status !== 'open') return -1;
      if (b.status === 'open' && a.status !== 'open') return 1;
      return (
        b.votesFor.length + b.votesAgainst.length - (a.votesFor.length + a.votesAgainst.length)
      );
    });
  }, [world.proposals]);

  const resolvedMemeId = activeMemeId ?? memes[0]?.id ?? '';
  const resolvedProposalId = activeProposalId ?? proposals[0]?.id ?? '';

  return (
    <section
      aria-label="Town Atlas"
      className="pointer-events-auto absolute top-3 right-3 z-20 flex max-h-[calc(100%-7.5rem)] w-[380px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-[#D5D0C3] bg-[#FAF8F4] text-[#1D2420] shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E5E2D9] px-3.5 py-2.5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#2D6A4F]">
            Spatial Atlas · {world.agents.length} Citizens
          </div>
          <h2 className="font-display text-sm font-semibold text-[#1D2420]">
            Smallville Town Briefing
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Town Atlas"
          className="rounded p-1 text-[#5C645E] hover:bg-[#ECE8DD] hover:text-[#1D2420]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Mode Tabs */}
      <div
        role="tablist"
        aria-label="Atlas sections"
        className="grid grid-cols-3 border-b border-[#E5E2D9] bg-[#F4F1EA] p-1 gap-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pictograms'}
          onClick={() => setTab('pictograms')}
          className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
            tab === 'pictograms'
              ? 'bg-[#FAF8F4] text-[#1B4332] shadow-xs border border-[#D5D0C3]'
              : 'text-[#5C645E] hover:text-[#1D2420]'
          }`}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Pictograms</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'advisors'}
          onClick={() => setTab('advisors')}
          className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
            tab === 'advisors'
              ? 'bg-[#FAF8F4] text-[#1B4332] shadow-xs border border-[#D5D0C3]'
              : 'text-[#5C645E] hover:text-[#1D2420]'
          }`}
        >
          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Advisors</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'explorer'}
          onClick={() => setTab('explorer')}
          className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
            tab === 'explorer'
              ? 'bg-[#FAF8F4] text-[#1B4332] shadow-xs border border-[#D5D0C3]'
              : 'text-[#5C645E] hover:text-[#1D2420]'
          }`}
        >
          <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Explorer</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        {tab === 'pictograms' && (
          <div className="space-y-3.5">
            {/* Optional Rumor / Proposal Selectors */}
            {(memes.length > 1 || proposals.length > 1) && (
              <div className="grid grid-cols-1 gap-2 rounded border border-[#E5E2D9] bg-[#F4F1EA] p-2">
                {memes.length > 1 && (
                  <label className="flex flex-col gap-0.5 text-[10px] font-medium text-[#5C645E]">
                    <span>Rumor Tracked</span>
                    <select
                      value={resolvedMemeId}
                      onChange={(e) => onChangeMemeId(e.target.value)}
                      className="rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] text-[#1D2420]"
                    >
                      {memes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.topic.slice(0, 52)} ({Object.keys(m.knownBy).length}/{world.agents.length})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {proposals.length > 1 && (
                  <label className="flex flex-col gap-0.5 text-[10px] font-medium text-[#5C645E]">
                    <span>Civic Ballot Tracked</span>
                    <select
                      value={resolvedProposalId}
                      onChange={(e) => onChangeProposalId(e.target.value)}
                      className="rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] text-[#1D2420]"
                    >
                      {proposals.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.votesFor.length}–{p.votesAgainst.length})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {pictograms.map((row) => (
              <div
                key={row.id}
                className="rounded-md border border-[#E5E2D9] bg-white p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#1D2420]">
                    {row.title}
                  </h3>
                  <span className="font-mono text-[11px] font-semibold text-[#1B4332] tabular-nums">
                    {row.ratioLabel}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[#5C645E]" title={row.subtitle}>
                  {row.subtitle}
                </p>

                {/* 18-Resident Interactive Pictogram Row */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {row.cells.map((cell) => {
                    const isSel = cell.agentId === selectedAgentId;
                    return (
                      <button
                        key={`${row.id}_${cell.agentId}`}
                        type="button"
                        onClick={() => onFocusAgent(cell.agentId)}
                        onMouseEnter={() =>
                          setHoveredCell(`${cell.name} (${cell.bucket}) — ${cell.detail}`)
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                        aria-label={`Inspect ${cell.name}: ${cell.bucket}, ${cell.detail}`}
                        title={`${cell.name} · ${cell.bucket} · ${cell.detail}`}
                        className="group rounded p-0.5 hover:bg-[#F4F1EA] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#2D6A4F]"
                      >
                        <ResidentSilhouette fill={toneFill(cell.tone)} selected={isSel} />
                      </button>
                    );
                  })}
                </div>

                {/* Compact Legend */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#F0EDE5] pt-1.5 text-[10px] text-[#5C645E]">
                  {row.legend.map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 rounded-xs ${toneDotClass(item.tone)}`}
                      />
                      <span>
                        {item.label}: {item.count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}

            <div className="min-h-[18px] text-[11px] text-[#4A544E]">
              {hoveredCell ?? 'Click any citizen silhouette to focus them on the 3D map.'}
            </div>
          </div>
        )}

        {tab === 'advisors' && (
          <div className="space-y-2.5">
            {advisors.map((adv) => (
              <article
                key={adv.id}
                className="rounded-md border border-[#E5E2D9] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5C645E]">
                      {adv.role}
                    </div>
                    <h3 className="font-display text-sm font-semibold text-[#1D2420]">
                      {adv.title}
                    </h3>
                  </div>
                  <span
                    className={`font-mono text-[11px] font-semibold tabular-nums ${
                      adv.status === 'alert'
                        ? 'text-[#B91C1C]'
                        : adv.status === 'watch'
                          ? 'text-[#B45309]'
                          : 'text-[#1B4332]'
                    }`}
                  >
                    {adv.headlineMetric}
                  </span>
                </div>

                <ul className="mt-2 space-y-1 text-[11px] leading-snug text-[#3C4640]">
                  {adv.bullets.map((b, idx) => (
                    <li key={idx} className="flex gap-1.5">
                      <span aria-hidden="true" className="text-[#9BA29C]">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-2.5 flex justify-end border-t border-[#F0EDE5] pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onActivateLens(adv.action.lens);
                      if (adv.action.focusLocationId) {
                        onFocusLocation(adv.action.focusLocationId);
                      } else if (adv.action.focusAgentId) {
                        onFocusAgent(adv.action.focusAgentId);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded border border-[#2D6A4F] bg-[#EAF2ED] px-2.5 py-1 text-[11px] font-medium text-[#1B4332] hover:bg-[#2D6A4F] hover:text-white transition-colors"
                  >
                    <span>{adv.action.label}</span>
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'explorer' && (
          <div className="space-y-3">
            {/* Axis Selectors */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5C645E]">
                <span>X Axis</span>
                <select
                  aria-label="Explorer X Axis metric"
                  value={xMetric}
                  onChange={(e) => setXMetric(e.target.value as ExplorerMetricId)}
                  className="rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-[#1D2420]"
                >
                  {EXPLORER_METRICS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5C645E]">
                <span>Y Axis</span>
                <select
                  aria-label="Explorer Y Axis metric"
                  value={yMetric}
                  onChange={(e) => setYMetric(e.target.value as ExplorerMetricId)}
                  className="rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-[#1D2420]"
                >
                  {EXPLORER_METRICS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Linked Scatter Plot */}
            <div className="rounded-md border border-[#E5E2D9] bg-white p-2">
              <svg
                viewBox="0 0 320 185"
                className="h-[185px] w-full"
                role="img"
                aria-label={`Scatter plot of ${explorer.xMetric.label} versus ${explorer.yMetric.label}`}
              >
                {/* Plot gridlines */}
                {[0, 0.5, 1].map((t) => {
                  const gx = 38 + t * 264;
                  const gy = 152 - t * 134;
                  return (
                    <g key={t}>
                      <line
                        x1={gx}
                        y1={18}
                        x2={gx}
                        y2={152}
                        stroke="#EFECE3"
                        strokeWidth="1"
                      />
                      <line
                        x1={38}
                        y1={gy}
                        x2={302}
                        y2={gy}
                        stroke="#EFECE3"
                        strokeWidth="1"
                      />
                    </g>
                  );
                })}

                {/* Axes */}
                <line x1="38" y1="152" x2="302" y2="152" stroke="#C7C3B8" strokeWidth="1.2" />
                <line x1="38" y1="18" x2="38" y2="152" stroke="#C7C3B8" strokeWidth="1.2" />

                {/* Axis labels */}
                <text x="38" y="168" fontSize="9" fill="#6B736E" fontFamily="monospace">
                  {explorer.xMetric.format(explorer.xMin)}
                </text>
                <text
                  x="302"
                  y="168"
                  textAnchor="end"
                  fontSize="9"
                  fill="#6B736E"
                  fontFamily="monospace"
                >
                  {explorer.xMetric.format(explorer.xMax)}
                </text>
                <text x="170" y="180" textAnchor="middle" fontSize="9.5" fill="#4A544E">
                  {explorer.xMetric.label}
                </text>

                <text x="34" y="154" textAnchor="end" fontSize="9" fill="#6B736E" fontFamily="monospace">
                  {explorer.yMetric.format(explorer.yMin)}
                </text>
                <text x="34" y="22" textAnchor="end" fontSize="9" fill="#6B736E" fontFamily="monospace">
                  {explorer.yMetric.format(explorer.yMax)}
                </text>

                {/* Resident Points */}
                {explorer.points.map((pt) => {
                  const cx = 38 + pt.xNorm * 264;
                  const cy = 152 - pt.yNorm * 134;
                  const isSel = pt.agentId === selectedAgentId;
                  const isHov = pt.agentId === hoveredPointId;
                  return (
                    <g
                      key={pt.agentId}
                      className="cursor-pointer"
                      onClick={() => onFocusAgent(pt.agentId)}
                      onMouseEnter={() => setHoveredPointId(pt.agentId)}
                      onMouseLeave={() => setHoveredPointId(null)}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSel ? 7 : isHov ? 6.5 : 4.8}
                        fill={pt.colorHex}
                        fillOpacity={isSel || isHov ? 0.95 : 0.78}
                        stroke={isSel ? '#1D2420' : '#FAF8F4'}
                        strokeWidth={isSel ? 2 : 1.2}
                      />
                      {(isSel || isHov) && (
                        <text
                          x={cx}
                          y={Math.max(12, cy - 10)}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="600"
                          fill="#1D2420"
                        >
                          {pt.shortName}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              <div className="mt-1 flex items-center justify-between border-t border-[#F0EDE5] pt-1 text-[10px] text-[#5C645E]">
                {hoveredPoint ? (
                  <span className="truncate font-medium text-[#1D2420]">
                    {hoveredPoint.name} · {explorer.xMetric.format(hoveredPoint.xVal)} /{' '}
                    {explorer.yMetric.format(hoveredPoint.yVal)} ({hoveredPoint.locationName})
                  </span>
                ) : (
                  <span>Click any resident dot or row to glide the 3D camera there.</span>
                )}
              </div>
            </div>

            {/* Linked Compact Table */}
            <div className="overflow-hidden rounded-md border border-[#E5E2D9] bg-white">
              <div className="grid grid-cols-[1fr_72px_68px] gap-2 border-b border-[#E5E2D9] bg-[#F4F1EA] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5C645E]">
                <span>Resident</span>
                <span className="text-right">{explorer.xMetric.label}</span>
                <span className="text-right">{explorer.yMetric.label}</span>
              </div>
              <div className="max-h-[180px] divide-y divide-[#F0EDE5] overflow-y-auto">
                {sortedPoints.map((pt) => {
                  const isSel = pt.agentId === selectedAgentId;
                  return (
                    <button
                      key={pt.agentId}
                      type="button"
                      onClick={() => onFocusAgent(pt.agentId)}
                      onMouseEnter={() => setHoveredPointId(pt.agentId)}
                      onMouseLeave={() => setHoveredPointId(null)}
                      className={`grid w-full grid-cols-[1fr_72px_68px] items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                        isSel
                          ? 'bg-[#EAF2ED] font-semibold text-[#1B4332]'
                          : 'hover:bg-[#FAF8F4] text-[#1D2420]'
                      }`}
                    >
                      <span className="truncate">
                        {pt.name}
                        <span className="ml-1.5 text-[10px] font-normal text-[#6B736E]">
                          {pt.locationName}
                        </span>
                      </span>
                      <span className="text-right font-mono text-[11px] tabular-nums">
                        {explorer.xMetric.format(pt.xVal)}
                      </span>
                      <span className="text-right font-mono text-[11px] tabular-nums text-[#4A544E]">
                        {explorer.yMetric.format(pt.yVal)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
