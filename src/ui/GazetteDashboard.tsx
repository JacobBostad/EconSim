import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { gazetteEditions, tradeDesk } from '../sim/selectors/gazetteSelectors';
import { formatMoney } from '../utils/formatMoney';
import { TRADE_POOL_THIN_COVER_DAYS, TRADE_POOL_GLUT_COVER_DAYS } from '../sim/data/constants';
import { townOf } from '../sim/core/Town';

/** A cover reading as a compact chip: 🔥 thin (premium) / 🧊 glutted, then days. */
function coverChip(emoji: string, cover: number): string {
  const icon = cover < TRADE_POOL_THIN_COVER_DAYS ? '🔥 ' : cover > TRADE_POOL_GLUT_COVER_DAYS ? '🧊 ' : '';
  const days = cover >= 100 ? '99+' : cover.toFixed(1);
  return `${emoji} ${icon}${days}d`;
}

/** The Town Gazette — a daily-newspaper view of the event stream. */
export function GazetteDashboard(): React.ReactElement {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  // The gazette renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
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
                {r.bestCover !== undefined && (
                  <span className="muted">
                    {' '}· cover {coverChip(r.bestCityEmoji, r.bestCover)}
                    {r.otherCover !== undefined && `  ${coverChip(r.otherCityEmoji, r.otherCover)}`}
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 4 }}>
            Net of each port's freight. Exports and standing orders route to the best port automatically.
          </div>
        </div>
      )}
      {(() => {
        const cits = Object.values(town.citizens);
        if (cits.length === 0) return null;
        const counts = { worker: 0, comfortable: 0, affluent: 0 };
        let climber: (typeof cits)[number] | null = null;
        for (const c of cits) {
          counts[c.tier] += 1;
          if (c.tierStreak > 0 && (!climber || c.tierStreak > climber.tierStreak)) climber = c;
        }
        const newestAffluent = [...state.events].reverse().find((e) => e.message.includes('is prospering'));
        return (
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>🎩 Society</div>
            <div className="small">
              The ladder today: {counts.worker} working, {counts.comfortable} comfortable, {counts.affluent} affluent.
              {counts.comfortable + counts.affluent > counts.worker && ' A comfortable majority — the good life is winning.'}
            </div>
            {climber && (
              <div className="small" style={{ marginTop: 2 }}>
                📈 One to watch: <strong>{climber.name}</strong> — {climber.tierStreak} straight good day{climber.tierStreak === 1 ? '' : 's'} toward the next rung.
              </div>
            )}
            {newestAffluent && (
              <div className="small muted" style={{ marginTop: 2 }}>{newestAffluent.message}</div>
            )}
          </div>
        );
      })()}
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
