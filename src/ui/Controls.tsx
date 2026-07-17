import React from 'react';
import { useGameStore } from '../store/useGameStore';
import type { Speed } from '../sim/core/Commands';

const SPEEDS: Speed[] = [1, 5, 20, 100];

export function Controls(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);
  const save = useGameStore((s) => s.save);
  const load = useGameStore((s) => s.load);
  const setShowNewGame = useGameStore((s) => s.setShowNewGame);
  const hasSaveFn = useGameStore((s) => s.hasSave);
  const state = sim.getState();

  return (
    <div>
      <div className="section-title">Simulation</div>
      <div className="row">
        <button className={state.paused ? 'active' : ''} onClick={togglePause}>
          {state.paused ? '▶ Play' : '⏸ Pause'}
        </button>
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            className={!state.paused && state.speed === sp ? 'active' : ''}
            onClick={() => setSpeed(sp)}
          >
            {sp}×
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={save}>💾 Save</button>
        <button onClick={load} disabled={!hasSaveFn()}>📂 Load</button>
        <button onClick={() => setShowNewGame(true)}>🔄 New</button>
      </div>
    </div>
  );
}
