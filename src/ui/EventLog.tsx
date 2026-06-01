import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { computeTime } from '../sim/core/Tick';

export function EventLog(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const events = state.events.slice(-120).reverse();

  return (
    <div className="eventlog">
      {events.length === 0 && <div className="muted small">No events yet. Press Play.</div>}
      {events.map((e) => {
        const t = computeTime(e.tick, state.config);
        return (
          <div
            className="event small"
            key={e.id}
            style={{ cursor: e.entityId ? 'pointer' : 'default' }}
            onClick={() => e.entityId && select(e.entityId)}
          >
            <span className="when mono">D{t.day + 1} {String(t.hour).padStart(2, '0')}:00</span>
            <span className={`sev-${e.severity}`}>{e.message}</span>
          </div>
        );
      })}
    </div>
  );
}
