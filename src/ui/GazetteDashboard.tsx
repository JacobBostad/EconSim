import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { gazetteEditions, tradeDesk } from '../sim/selectors/gazetteSelectors';
import { formatMoney } from '../utils/formatMoney';

/** The Town Gazette — a daily-newspaper view of the event stream. */
export function GazetteDashboard(): React.ReactElement {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const editions = gazetteEditions(state, 7);
  const desk = tradeDesk(state);

  return (
    <div className="gazette">
      <div className="gazette-masthead">
        <div className="gazette-title">The Town Gazette</div>
        <div className="muted small">All the news that's fit to simulate — last 7 days</div>
      </div>
      {desk.length > 0 && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>⚖ Trade Desk — where to ship today</div>
          {desk.map((r) => (
            <div className="row between small" key={r.productId}>
              <span>{r.productName}</span>
              <span className="mono">
                {r.bestCityEmoji} {r.bestCityName} nets {formatMoney(r.bestNet)}/u
                {r.spread > 0 && (
                  <span className="muted"> (+{formatMoney(r.spread)} vs the other port)</span>
                )}
              </span>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 4 }}>
            Net of each port's freight. Exports and standing orders route to the best port automatically.
          </div>
        </div>
      )}
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
