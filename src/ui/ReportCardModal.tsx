import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import {
  completedQuarters,
  quarterReport,
  type QuarterReport,
} from '../sim/selectors/reportSelectors';
import { Sparkline } from './Sparkline';
import { formatMoney } from '../utils/formatMoney';

const GRADE_COLORS: Record<string, string> = {
  'A+': 'var(--green)', A: 'var(--green)', B: 'var(--accent)',
  C: 'var(--amber)', D: 'var(--amber)', F: 'var(--red)',
};

/**
 * Every 30 in-game days, pops a report card for the completed quarter:
 * valuation curve, P&L, market share moves, unlocks, and a letter grade.
 * Baselines on mount so loading an old town doesn't replay past quarters.
 */
export function ReportCardModal(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const quarters = completedQuarters(state);
  const seen = useRef<number | null>(null);
  const [report, setReport] = useState<QuarterReport | null>(null);

  useEffect(() => {
    if (seen.current === null || quarters < seen.current) {
      seen.current = quarters; // baseline on mount / new game / load
      return;
    }
    if (quarters > seen.current) {
      seen.current = quarters;
      setReport(quarterReport(sim.getState(), quarters));
    }
  }, [quarters]);

  if (!report) return null;
  const growth = report.valuationEnd - report.valuationStart;

  return (
    <div className="intro-backdrop" onClick={() => setReport(null)}>
      <div className="intro-card" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>📋 Quarter {report.quarter} Report Card</h2>
          <span
            className="report-grade"
            style={{ color: GRADE_COLORS[report.grade] ?? 'var(--text)' }}
          >
            {report.grade}
          </span>
        </div>
        <p className="muted small" style={{ margin: '4px 0 10px' }}>
          Days {report.startDay + 1}–{report.endDay + 1} · score {report.score.toFixed(0)}/100
        </p>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: 1, minWidth: 210, marginBottom: 0 }}>
            <div className="muted small">Company value</div>
            <div className="mono" style={{ fontSize: 16 }}>
              {formatMoney(report.valuationEnd)}{' '}
              <span className="small" style={{ color: growth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                ({growth >= 0 ? '+' : ''}{formatMoney(growth)})
              </span>
            </div>
            {report.valuationSeries.length >= 2 && (
              <Sparkline points={report.valuationSeries} width={200} color="var(--accent)" />
            )}
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
            <div className="kv small"><span className="k">Net profit (quarter)</span>
              <span className="mono" style={{ color: report.netProfitTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {formatMoney(report.netProfitTotal)}
              </span>
            </div>
            <div className="kv small"><span className="k">Revenue</span><span className="mono">{formatMoney(report.revenueTotal)}</span></div>
            <div className="kv small"><span className="k">Employees</span><span className="mono">{report.employees}</span></div>
            {report.acquisitions.length > 0 && (
              <div className="kv small"><span className="k">Acquired</span><span>{report.acquisitions.join(', ')}</span></div>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <div className="card" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>Market share</div>
            {report.shares.map((s) => (
              <div className="kv small" key={s.productId}>
                <span className="k">{s.name}</span>
                <span className="mono">
                  {(s.shareStart * 100).toFixed(0)}% → {(s.shareNow * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
          {(report.achievementNames.length > 0 || report.missionNames.length > 0) && (
            <div className="card" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>Earned this quarter</div>
              {[...report.missionNames, ...report.achievementNames].map((n, i) => (
                <div className="small" key={i}>{n}</div>
              ))}
            </div>
          )}
        </div>

        <button className="intro-go" onClick={() => setReport(null)}>
          Back to business →
        </button>
      </div>
    </div>
  );
}
