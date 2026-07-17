import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { activeWorldEvents } from '../sim/data/worldEvents';

/**
 * News ticker for active world events (booms, droughts, fads...). Sits at the
 * top-left of the map. Each chip shows the event icon, name, and days left;
 * hover for the full description and how to respond.
 */
export function WorldEventTicker(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const active = activeWorldEvents(sim.getState());
  if (active.length === 0) return null;

  return (
    <div className="world-events">
      {active.map((ev) => (
        <div
          key={ev.def.id}
          className={`world-event sev-${ev.def.severity}`}
          title={`${ev.def.headline}\n\n${ev.def.description}`}
        >
          <span className="icon">{ev.def.icon}</span>
          <span className="name">{ev.def.name}</span>
          <span className="days">
            {ev.daysRemaining}d left
          </span>
        </div>
      ))}
    </div>
  );
}
