import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { gazetteEditions } from '../sim/selectors/gazetteSelectors';

/** The Town Gazette — a daily-newspaper view of the event stream. */
export function GazetteDashboard(): React.ReactElement {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const editions = gazetteEditions(sim.getState(), 7);

  return (
    <div className="gazette">
      <div className="gazette-masthead">
        <div className="gazette-title">The Town Gazette</div>
        <div className="muted small">All the news that's fit to simulate — last 7 days</div>
      </div>
      {editions.map((ed) => (
        <div className="gazette-day card" key={ed.day}>
          <div className="gazette-dateline">Day {ed.day + 1}</div>
          {ed.lead ? (
            <div className={`gazette-lead sev-${ed.lead.severity}`}>{ed.lead.text}</div>
          ) : (
            <div className="gazette-lead muted">A quiet day in town.</div>
          )}
          {ed.ticker.length > 0 && (
            <div className="gazette-ticker mono small">{ed.ticker.join('  ·  ')}</div>
          )}
          {ed.briefs.length > 0 && (
            <ul className="gazette-briefs">
              {ed.briefs.map((b, i) => (
                <li key={i} className={`small sev-${b.severity}`}>{b.text}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {editions.length === 0 && <p className="muted">The presses are warming up — play a day or two.</p>}
    </div>
  );
}
