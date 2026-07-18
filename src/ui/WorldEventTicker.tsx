import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { activeWorldEvents } from '../sim/data/worldEvents';
import { computeTime } from '../sim/core/Tick';
import { getProduct } from '../sim/data/products';
import { getTradeCity } from '../sim/data/tradeCities';
import { formatMoney } from '../utils/formatMoney';

/**
 * News ticker for active world events (booms, droughts, fads...) plus the
 * active rush order, if any. Sits at the top-left of the map. Each chip
 * shows the event icon, name, and days left; hover for the full description
 * and how to respond.
 */
export function WorldEventTicker(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const active = activeWorldEvents(state);
  const rush = state.rushOrder;
  if (active.length === 0 && !rush) return null;

  const day = computeTime(state.tick, state.config).day;

  return (
    <div className="world-events">
      {rush && (
        <div
          className="world-event sev-success"
          title={`Rush order from ${getTradeCity(rush.cityId).name}\n\nDeliver ${rush.quantity} ${getProduct(rush.productId).name} to the ports (any port counts) by day ${rush.deadlineDay + 1} and the buyer pays a ${formatMoney(rush.bonusCents)} bonus on top of normal export revenue. Ship from a warehouse with the Export button or a standing order.`}
        >
          <span className="icon">🚚</span>
          <span className="name">
            Rush: {rush.filled}/{rush.quantity} {getProduct(rush.productId).name}
          </span>
          <span className="days">{Math.max(0, rush.deadlineDay - day + 1)}d left</span>
        </div>
      )}
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
