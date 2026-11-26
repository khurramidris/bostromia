import { Pause, Play, SkipForward } from 'lucide-react';

export type WorkspaceView =
  | 'town'
  | 'chronicle'
  | 'society'
  | 'experiments'
  | 'architecture'
  | 'diagnostics';

interface TownHeaderProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  worldName?: string;
  weekdayShort?: string;
  timeLabel: string;
  day: number;
  dilationRate?: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  speed: 1 | 2 | 5;
  onSelectSpeed: (speed: 1 | 2 | 5) => void;
  onStepForward: () => void;
}

export function TownHeader({
  activeView,
  onSelectView,
  worldName = 'Smallville',
  weekdayShort,
  timeLabel,
  day,
  dilationRate = 1,
  isPlaying,
  onTogglePlay,
  speed,
  onSelectSpeed,
  onStepForward,
}: TownHeaderProps) {
  const isSlowed = isPlaying && dilationRate < 0.99;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2DFD5] bg-[#FAF8F4] px-5 py-3">
      {/* Zone 1: Single-element display wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('town')}
        className="font-display text-xl font-semibold tracking-tight text-[#1D2420] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D6A4F]"
      >
        {worldName}
      </button>

      {/* Zone 2: Clean view links & tabular simulation clock */}
      <nav aria-label="Primary sections" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 sm:gap-5 max-w-full">
        {(
          [
            { id: 'town', label: 'Town Map' },
            { id: 'chronicle', label: 'Chronicle' },
            { id: 'society', label: 'Society' },
            { id: 'experiments', label: 'Experiments' },
            { id: 'architecture', label: 'Architecture' },
            { id: 'diagnostics', label: 'Diagnostics' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectView(item.id)}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b-2 ${
              activeView === item.id
                ? 'text-[#1D2420] border-[#2D6A4F]'
                : 'text-[#5C645E] border-transparent hover:text-[#1D2420]'
            }`}
          >
            {item.label}
          </button>
        ))}

        <div
          className="hidden sm:flex items-center gap-2 pl-4 border-l border-[#E2DFD5] font-mono text-xs text-[#3C4640] tabular-nums whitespace-nowrap shrink-0"
          data-testid="sim-clock"
        >
          {weekdayShort && (
            <>
              <span className="font-medium text-[#2D6A4F]">{weekdayShort}</span>
              <span aria-hidden="true" className="text-[#9BA29C]">
                ·
              </span>
            </>
          )}
          <span>Day {day}</span>
          <span aria-hidden="true" className="text-[#9BA29C]">
            ·
          </span>
          <span className="font-medium text-[#1D2420]">{timeLabel}</span>
          {isSlowed && (
            <span
              data-testid="time-dilation-indicator"
              className="ml-1 text-[11px] font-medium text-[#92400E]"
            >
              Slowed for thinking ×{dilationRate.toFixed(1)}
            </span>
          )}
        </div>
      </nav>

      {/* Zone 3: Playback & Time Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          role="group"
          aria-label="Simulation speed"
          className="flex items-center rounded-md border border-[#DEDAD0] bg-[#F2EFE7] p-0.5"
        >
          {([1, 2, 5] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectSpeed(s)}
              aria-label={`Set speed ${s}x`}
              className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded transition-colors whitespace-nowrap shrink-0 ${
                speed === s
                  ? 'bg-white text-[#1D2420] font-semibold shadow-xs'
                  : 'text-[#5C645E] hover:text-[#1D2420]'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onStepForward}
          aria-label="Advance 15 minutes"
          className="flex items-center gap-1.5 rounded-md border border-[#DEDAD0] bg-white px-3 py-1.5 text-xs font-medium text-[#2F3833] hover:bg-[#F2EFE7] transition-colors whitespace-nowrap shrink-0"
        >
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
          <span>+15m</span>
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="flex items-center gap-1.5 rounded-md bg-[#2D6A4F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#23533D] transition-colors whitespace-nowrap shrink-0"
        >
          {isPlaying ? (
            <>
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Play</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
