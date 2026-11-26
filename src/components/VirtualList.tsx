import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface VirtualListHandle {
  scrollToIndex: (index: number) => void;
}

interface VirtualListProps<T> {
  items: T[];
  getKey: (item: T) => string;
  estimateHeight: (item: T) => number;
  renderItem: (item: T, index: number) => ReactNode;
  maxHeightClassName?: string;
  overscan?: number;
  gapPx?: number;
  ariaLabel?: string;
}

function VirtualListInner<T>(
  {
    items,
    getKey,
    estimateHeight,
    renderItem,
    maxHeightClassName = 'max-h-[540px]',
    overscan = 5,
    gapPx = 10,
    ariaLabel,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [scrollTop, setScrollTop] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  const layout = useMemo(() => {
    void measureVersion;
    const offsets: number[] = [];
    const heights: number[] = [];
    let cursor = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = getKey(item);
      const h = measuredHeightsRef.current.get(key) ?? estimateHeight(item);
      offsets.push(cursor);
      heights.push(h);
      cursor += h + (i < items.length - 1 ? gapPx : 0);
    }
    return { offsets, heights, totalHeight: cursor };
  }, [items, getKey, estimateHeight, gapPx, measureVersion]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index: number) {
        const el = containerRef.current;
        if (!el || index < 0 || index >= layout.offsets.length) return;
        const top = Math.max(0, layout.offsets[index] - 48);
        el.scrollTop = top;
        setScrollTop(top);
      },
    }),
    [layout.offsets],
  );

  const viewportH = containerRef.current?.clientHeight || 520;
  const visibleBottom = scrollTop + viewportH;

  let startIdx = 0;
  while (
    startIdx < items.length &&
    layout.offsets[startIdx] + layout.heights[startIdx] < scrollTop
  ) {
    startIdx += 1;
  }
  let endIdx = startIdx;
  while (endIdx < items.length && layout.offsets[endIdx] <= visibleBottom) {
    endIdx += 1;
  }

  const renderStart = Math.max(0, startIdx - overscan);
  const renderEnd = Math.min(items.length, endIdx + overscan);

  const measureNode = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (!el) return;
      const measured = Math.ceil(el.getBoundingClientRect().height);
      if (measured > 0 && Math.abs((measuredHeightsRef.current.get(key) ?? -1) - measured) > 2) {
        measuredHeightsRef.current.set(key, measured);
        setMeasureVersion((v) => v + 1);
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      role="list"
      aria-label={ariaLabel}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={`overflow-y-auto smallville-scroll pr-1 ${maxHeightClassName}`}
    >
      <div className="relative w-full" style={{ height: `${layout.totalHeight}px` }}>
        {items.slice(renderStart, renderEnd).map((item, relIdx) => {
          const idx = renderStart + relIdx;
          const key = getKey(item);
          return (
            <div
              key={key}
              role="listitem"
              ref={measureNode(key)}
              className="absolute left-0 right-0"
              style={{ top: `${layout.offsets[idx]}px` }}
            >
              {renderItem(item, idx)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<VirtualListHandle> },
) => React.ReactElement;
