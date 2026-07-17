import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENT_DEFS } from '../sim/data/achievements';

/** Awards tab — unlocked achievements in color, locked ones dimmed with hints. */
export function AwardsDashboard(): React.ReactElement {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const unlockedBy = new Map(state.achievements.map((a) => [a.id, a.day]));
  const unlockedCount = state.achievements.length;

  return (
    <div>
      <p className="muted small">
        {unlockedCount}/{ACHIEVEMENT_DEFS.length} unlocked. Achievements are permanent for this town
        and are saved with the game.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {ACHIEVEMENT_DEFS.map((def) => {
          const day = unlockedBy.get(def.id);
          const unlocked = day !== undefined;
          return (
            <div
              key={def.id}
              className="card award-card"
              style={{ opacity: unlocked ? 1 : 0.45 }}
            >
              <div className="award-icon">{unlocked ? def.icon : '🔒'}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{def.name}</div>
                <div className="muted small">{unlocked ? def.description : def.hint}</div>
                {unlocked && <div className="small" style={{ color: 'var(--green)' }}>Unlocked on day {day + 1}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
