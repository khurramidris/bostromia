import { Clock, MapPin, Store, Users, X } from 'lucide-react';
import type { BuildingYieldCardData } from '../simulation/spatialAnalytics';
import { formatSimTime } from '../simulation/memory';

interface BuildingYieldCardProps {
  data: BuildingYieldCardData;
  onClose: () => void;
  onSelectAgent: (agentId: string) => void;
}

function toneClass(tone: 'emerald' | 'amber' | 'rose' | 'slate'): string {
  switch (tone) {
    case 'emerald':
      return 'text-[#1B4332]';
    case 'amber':
      return 'text-[#B45309]';
    case 'rose':
      return 'text-[#B91C1C]';
    default:
      return 'text-[#1D2420]';
  }
}

export function BuildingYieldCard({
  data,
  onClose,
  onSelectAgent,
}: BuildingYieldCardProps) {
  const {
    location,
    specialization,
    openStatus,
    hoursLabel,
    ownerName,
    yields,
    inventory,
    ventures,
    clubs,
    staff,
    presentAgents,
    objects,
    recentEvents,
  } = data;

  return (
    <aside
      aria-label={`${location.name} Building Yield Card`}
      className="pointer-events-auto absolute top-3 left-3 z-20 flex max-h-[calc(100%-7.5rem)] w-[332px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-[#D5D0C3] bg-[#FAF8F4] text-[#1D2420] shadow-lg"
    >
      {/* Header */}
      <div className="border-b border-[#E5E2D9] px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2D6A4F]">
              <span>{specialization}</span>
              <span aria-hidden="true" className="text-[#C6C1B5]">·</span>
              <span
                className={
                  openStatus === 'closed' ? 'text-[#B91C1C]' : 'text-[#4A544E]'
                }
              >
                {openStatus === 'closed' ? 'Closed' : openStatus === 'open' ? 'Open' : 'Commons'}
              </span>
            </div>
            <h3 className="mt-0.5 truncate font-display text-base font-semibold tracking-tight text-[#1D2420]">
              {location.name}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#5C645E]">
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {hoursLabel}
              </span>
              {ownerName && <span>Owner: {ownerName}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${location.name} details`}
            className="shrink-0 rounded p-1 text-[#5C645E] hover:bg-[#ECE8DD] hover:text-[#1D2420]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[#4A544E]">
          {location.description}
        </p>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 space-y-3">
        {/* Civ-Style Yield Strip */}
        <div className="grid grid-cols-2 gap-2">
          {yields.map((y) => (
            <div
              key={y.label}
              className="rounded border border-[#E5E2D9] bg-[#F4F1EA] px-2.5 py-1.5"
            >
              <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6B736E]">
                {y.label}
              </div>
              <div
                className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${toneClass(y.tone)}`}
              >
                {y.value}
              </div>
            </div>
          ))}
        </div>

        {/* Present Residents */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C645E]">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden="true" />
              Present Now ({presentAgents.length})
            </span>
          </div>
          {presentAgents.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#6B736E]">No residents currently inside.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {presentAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAgent(a.id)}
                  className="inline-flex items-center gap-1.5 rounded border border-[#D5D0C3] bg-white px-2 py-1 text-[11px] font-medium text-[#1D2420] hover:border-[#2D6A4F] hover:bg-[#EAF2ED] transition-colors"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      a.moodTone === 'emerald'
                        ? 'bg-[#2D6A4F]'
                        : a.moodTone === 'rose'
                          ? 'bg-[#DC2626]'
                          : 'bg-[#D97706]'
                    }`}
                  />
                  <span>{a.shortName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Commercial Inventory & Prices */}
        {inventory.length > 0 && (
          <div className="border-t border-[#E5E2D9] pt-2.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C645E]">
              <Store className="h-3 w-3" aria-hidden="true" />
              <span>Counter Stock & Prices</span>
            </div>
            <div className="mt-1.5 divide-y divide-[#ECE9E0] rounded border border-[#E5E2D9] bg-white">
              {inventory.map((item) => (
                <div
                  key={item.kind}
                  className="flex items-center justify-between px-2.5 py-1 text-[11px]"
                >
                  <span className="font-medium text-[#1D2420]">{item.label}</span>
                  <span className="font-mono text-[#4A544E] tabular-nums">
                    {item.qty} in stock · ${item.price}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Pop-Up Micro-Ventures & Clubs */}
        {(ventures.length > 0 || clubs.length > 0) && (
          <div className="border-t border-[#E5E2D9] pt-2.5 space-y-1.5">
            {ventures.map((v) => (
              <div
                key={v.id}
                className="rounded border border-[#D5D0C3] bg-[#F4F1EA] px-2.5 py-1.5 text-[11px]"
              >
                <div className="font-semibold text-[#1B4332]">Pop-Up: {v.name}</div>
                <div className="font-mono text-[10px] text-[#5C645E] tabular-nums">
                  {v.founderName} · ${v.revenue} rev · {v.stock} stock
                </div>
              </div>
            ))}
            {clubs.map((c) => (
              <div
                key={c.id}
                className="rounded border border-[#E5E2D9] bg-white px-2.5 py-1.5 text-[11px]"
              >
                <div className="font-semibold text-[#1D2420]">{c.name}</div>
                <div className="font-mono text-[10px] text-[#5C645E] tabular-nums">
                  {c.memberCount} members · Meets {c.scheduleLabel}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Staff */}
        {staff.length > 0 && (
          <div className="border-t border-[#E5E2D9] pt-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C645E]">
              Assigned Staff ({staff.length})
            </div>
            <div className="mt-1 space-y-1">
              {staff.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-[11px]"
                >
                  <button
                    type="button"
                    onClick={() => onSelectAgent(s.id)}
                    className="font-medium text-[#2D6A4F] hover:underline text-left"
                  >
                    {s.name}
                  </button>
                  <span className="font-mono text-[10px] text-[#5C645E] tabular-nums">
                    ${s.wagePerHour}/hr · {s.present ? 'On site' : 'Away'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fixtures / Objects */}
        {objects.length > 0 && (
          <div className="border-t border-[#E5E2D9] pt-2.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C645E]">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              <span>Fixtures ({objects.length})</span>
            </div>
            <div className="mt-1 space-y-1">
              {objects.slice(0, 4).map((obj) => (
                <div key={obj.id} className="text-[11px] text-[#3C4640]">
                  <span aria-hidden="true">{obj.emoji}</span>{' '}
                  <span className="font-medium text-[#1D2420]">{obj.name}:</span>{' '}
                  {obj.state}
                  {obj.persistentNote && (
                    <span className="text-[#5C645E]"> — {obj.persistentNote}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Building Chronicle */}
        {recentEvents.length > 0 && (
          <div className="border-t border-[#E5E2D9] pt-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5C645E]">
              Recent Chronicle
            </div>
            <div className="mt-1 space-y-1.5">
              {recentEvents.map((ev) => (
                <div key={ev.id} className="text-[11px] leading-snug text-[#3C4640]">
                  <span className="font-mono text-[10px] text-[#6B736E] tabular-nums">
                    {formatSimTime(ev.simMinutes).timeLabel}
                  </span>{' '}
                  <span className="font-medium text-[#1D2420]">{ev.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
