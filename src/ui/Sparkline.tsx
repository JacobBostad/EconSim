import React from 'react';

/**
 * Sparkline — a small dependency-free SVG trend chart.
 *
 * Renders a line with a soft area fill, an optional dashed zero line when the
 * series crosses zero, and a dot on the latest value. Used by the dashboard
 * "Trends" cards. Pure display: all data comes in via props.
 */
export function Sparkline({
  points,
  width = 168,
  height = 44,
  color = 'var(--accent)',
  showZeroLine = false,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  showZeroLine?: boolean;
}): React.ReactElement | null {
  if (points.length < 2) {
    return (
      <div className="muted small" style={{ height, display: 'flex', alignItems: 'center' }}>
        Collecting data…
      </div>
    );
  }

  const pad = 3;
  let min = Math.min(...points);
  let max = Math.max(...points);
  if (showZeroLine) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const x = (i: number): number =>
    pad + (i / (points.length - 1)) * (width - 2 * pad);
  const y = (v: number): number =>
    pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);

  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${(height - pad).toFixed(1)} ${line} ${x(points.length - 1).toFixed(1)},${(height - pad).toFixed(1)}`;
  const last = points[points.length - 1]!;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polygon points={area} fill={color} opacity={0.12} />
      {showZeroLine && min < 0 && max > 0 && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          opacity={0.25}
          strokeDasharray="3,3"
        />
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={x(points.length - 1)} cy={y(last)} r={2.4} fill={color} />
    </svg>
  );
}

/** A labeled sparkline card for the dashboard "Trends" rows. */
export function TrendCard({
  label,
  latest,
  points,
  color,
  showZeroLine,
}: {
  label: string;
  latest: string;
  points: number[];
  color?: string;
  showZeroLine?: boolean;
}): React.ReactElement {
  return (
    <div className="card trend-card">
      <div className="row between">
        <span className="muted small">{label}</span>
        <span className="mono small">{latest}</span>
      </div>
      <Sparkline points={points} color={color} showZeroLine={showZeroLine} />
    </div>
  );
}
