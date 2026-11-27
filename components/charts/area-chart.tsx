'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn, formatDate, formatExact } from '@/lib/utils';
import type { TimeseriesPoint } from '@/lib/types';

interface AreaChartProps {
  data: TimeseriesPoint[];
  interval: 'hour' | 'day';
  /** Which series to draw. Visitors is only shown for the day granularity. */
  showVisitors?: boolean;
  className?: string;
}

const HEIGHT = 220;
const PADDING = { top: 12, right: 8, bottom: 28, left: 44 };

/**
 * A dependency-free area chart.
 *
 * Hand-rolled rather than pulling in a charting library: the shape needed here
 * is a single (occasionally double) series over at most 90 points, and the
 * libraries that do this well are several hundred kilobytes. This also keeps
 * full control of the aria description and the tooltip.
 *
 * Accessibility: the SVG is `role="img"` with a summary label, and the same
 * numbers are available as a visually-hidden table so screen readers are not
 * forced to interpret a path.
 */
export function AreaChart({ data, interval, showVisitors = false, className }: AreaChartProps) {
  // Draw in real pixels. The chart used to render in a fixed 800-unit space and
  // stretch it to the card (preserveAspectRatio="none"), which squashed the axis
  // text whenever the card was not 800px wide. Measuring the container keeps the
  // SVG's units equal to screen pixels, so text is never distorted.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
    // The container only exists once there is data to draw.
  }, [data.length > 0]);

  const gradientId = useId();
  const visitorGradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (data.length === 0) return null;

    const maxValue = Math.max(
      1,
      ...data.map((point) => Math.max(point.pageviews, showVisitors ? point.visitors : 0))
    );
    // Round the axis ceiling up to a friendly number so gridline labels are not
    // arbitrary values like 137.
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
    const ceiling = Math.ceil(maxValue / magnitude) * magnitude;

    return { maxValue, ceiling, series: data };
  }, [data, showVisitors]);

  if (!geometry) {
    return (
      <div className={cn('flex h-[220px] items-center justify-center', className)}>
        <p className="text-sm text-muted-foreground">No data in this range yet.</p>
      </div>
    );
  }

  const { ceiling, series } = geometry;
  const innerWidth = width - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number) =>
    PADDING.left + (series.length <= 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth);
  const y = (value: number) => PADDING.top + innerHeight - (value / ceiling) * innerHeight;

  const linePath = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.pageviews)}`)
    .join(' ');

  const areaPath =
    `${linePath} L ${x(series.length - 1)} ${PADDING.top + innerHeight} ` +
    `L ${x(0)} ${PADDING.top + innerHeight} Z`;

  const visitorsPath = showVisitors
    ? series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.visitors)}`).join(' ')
    : null;

  // Five gridlines is enough to read a value without cluttering the plot.
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = (ceiling / 4) * index;
    return { value, y: y(value) };
  });

  const totalPageviews = series.reduce((sum, point) => sum + point.pageviews, 0);
  const active = hoverIndex !== null ? series[hoverIndex] : undefined;

  const labelFor = (bucket: string) =>
    interval === 'hour'
      ? new Date(bucket).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : formatDate(bucket);

  // Label every nth tick, as many as fit (about 72px each) so a narrow card
  // never overlaps its own labels.
  const maxLabels = Math.max(2, Math.floor(innerWidth / 72));
  const tickStep = Math.max(1, Math.ceil(series.length / maxLabels));

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-[220px] w-full"
        role="img"
        aria-label={`Pageviews over time. ${formatExact(totalPageviews)} total across ${series.length} ${
          interval === 'hour' ? 'hours' : 'days'
        }.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={visitorGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines with value labels */}
        {gridLines.map((line) => (
          <g key={line.value}>
            <line
              x1={PADDING.left}
              y1={line.y}
              x2={width - PADDING.right}
              y2={line.y}
              stroke="hsl(var(--border))"
              strokeWidth="1"
              strokeDasharray={line.value === 0 ? undefined : '3 5'}
            />
            <text
              x={PADDING.left - 8}
              y={line.y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
              style={{ fontSize: 11 }}
            >
              {formatExact(line.value)}
            </text>
          </g>
        ))}

        {showVisitors && visitorsPath && (
          <>
            <path
              d={`${visitorsPath} L ${x(series.length - 1)} ${PADDING.top + innerHeight} L ${x(0)} ${
                PADDING.top + innerHeight
              } Z`}
              fill={`url(#${visitorGradientId})`}
            />
            <path
              d={visitorsPath}
              fill="none"
              stroke="hsl(var(--chart-2))"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke="hsl(var(--chart-1))"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover target: one full-height band per point, easier to hit than the line */}
        {series.map((point, index) => (
          <rect
            key={point.bucket}
            x={x(index) - innerWidth / series.length / 2}
            y={PADDING.top}
            width={Math.max(4, innerWidth / series.length)}
            height={innerHeight}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
          />
        ))}

        {hoverIndex !== null && (
          <>
            <line
              x1={x(hoverIndex)}
              y1={PADDING.top}
              x2={x(hoverIndex)}
              y2={PADDING.top + innerHeight}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hoverIndex)}
              cy={y(series[hoverIndex]?.pageviews ?? 0)}
              r="4"
              fill="hsl(var(--chart-1))"
              stroke="hsl(var(--background))"
              strokeWidth="2"
            />
          </>
        )}

        {/* X-axis labels. The last label is right-aligned so it stays inside the
            plot instead of being clipped by the right edge, and a regular tick
            that would collide with it is dropped. */}
        {series.map((point, index) => {
          const isLast = index === series.length - 1;
          const isRegularTick = index % tickStep === 0;
          const collidesWithLast = !isLast && series.length - 1 - index < tickStep * 0.6;
          if (!isLast && (!isRegularTick || collidesWithLast)) return null;
          return (
            <text
              key={`tick-${point.bucket}`}
              x={isLast && series.length > 1 ? width - PADDING.right : x(index)}
              y={HEIGHT - 6}
              textAnchor={isLast && series.length > 1 ? 'end' : 'middle'}
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {labelFor(point.bucket)}
            </text>
          );
        })}
      </svg>

      {active && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(x(hoverIndex ?? 0) / width) * 100}%`,
            // Flip the tooltip to the left of the cursor past the midpoint so it
            // never overflows the card.
            transform: (hoverIndex ?? 0) > series.length / 2 ? 'translateX(-100%)' : 'none',
          }}
        >
          <div className="font-medium">{labelFor(active.bucket)}</div>
          <div className="tabular mt-1 text-muted-foreground">
            {formatExact(active.pageviews)} pageviews
          </div>
          <div className="tabular text-muted-foreground">{formatExact(active.visitors)} visitors</div>
        </div>
      )}

      {showVisitors && (
        <div className="mt-1 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-chart-1" aria-hidden="true" />
            Pageviews
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-chart-2" aria-hidden="true" />
            Visitors
          </span>
        </div>
      )}

      {/* The same data as text, for assistive technology. */}
      <table className="sr-only">
        <caption>Pageviews and visitors over time</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Pageviews</th>
            <th scope="col">Visitors</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.bucket}>
              <th scope="row">{labelFor(point.bucket)}</th>
              <td>{point.pageviews}</td>
              <td>{point.visitors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
