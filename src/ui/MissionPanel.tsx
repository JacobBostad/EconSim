import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { eligibleMissions, activeMission } from '../sim/data/missions';
import { formatMoney } from '../utils/formatMoney';

/** Left-panel card showing the current guided mission and chain progress. */
export function MissionPanel(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  // Total counts only the missions THIS game offers (Village drops the era
  // missions), so the progress fraction reads correctly per preset.
  const total = eligibleMissions(state).length;
  const done = Math.min(state.missions.length, total);
  const current = activeMission(state);

  return (
    <div>
      <div className="section-title">
        Missions ({done}/{total})
      </div>
      {current ? (
        <div className="card mission-card">
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontSize: 18 }}>{current.icon}</span>
            <strong>{current.name}</strong>
          </div>
          <div className="small" style={{ margin: '4px 0 6px' }}>{current.description}</div>
          <div className="small">
            Reward: <span className="mono" style={{ color: 'var(--green)' }}>{formatMoney(current.reward)}</span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <span style={{ width: `${(done / total) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="card mission-card">
          <strong>🎓 All missions complete!</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            The town is yours to conquer — chase the valuation objective and the Awards.
          </div>
        </div>
      )}
    </div>
  );
}
