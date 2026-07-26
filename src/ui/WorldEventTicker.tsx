import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { activeWorldEvents } from '../sim/data/worldEvents';
import { computeTime } from '../sim/core/Tick';
import { getProduct } from '../sim/data/products';
import { getTradeCity } from '../sim/data/tradeCities';
import { formatMoney } from '../utils/formatMoney';
import { townOf } from '../sim/core/Town';

/**
 * News ticker for active world events (booms, droughts, fads...) plus the
 * active rush order, if any. Sits at the top-left of the map. Each chip
 * shows the event icon, name, and days left; hover for the full description
 * and how to respond.
 */
export function WorldEventTicker(): React.ReactElement | null {
  useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const dispatch = useGameStore((s) => s.dispatch);
  const state = sim.getState();
  // The ticker renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  const active = activeWorldEvents(state);
  const rush = state.rushOrder;
  const offer = state.facilityOffer;
  const ann = state.tradeAnnouncement;
  const offerFac = offer ? town.facilities[offer.facilityId] : null;
  const offerSeller = offer ? town.firms[offer.sellerFirmId] : null;
  const playerCash = town.firms[state.playerFirmId]?.cash ?? 0;
  if (active.length === 0 && !rush && !offer && !ann) return null;

  const day = computeTime(state.tick, state.config).day;

  return (
    <div className="world-events">
      {ann && (
        <div
          className={`world-event ${ann.mult > 1 ? 'sev-success' : 'sev-warning'}`}
          title={`${getTradeCity(ann.cityId).name} ${ann.mult > 1 ? 'tender' : 'glut'}: ${getProduct(ann.productId).name}\n\n${day < ann.effectDay ? `Announced — prices expected to move to ~${ann.mult}× from day ${ann.effectDay + 1} for ${ann.durationDays} days. Position on the commodity desk or lock a forward before the move.` : `In effect through day ${ann.effectDay + ann.durationDays}. The city's quote is being pulled toward ${ann.mult}× its normal center.`}`}
        >
          <span className="icon">📯</span>
          <span className="name">
            {getTradeCity(ann.cityId).emoji} {getProduct(ann.productId).name} {ann.mult > 1 ? '▲' : '▼'} {ann.mult}×
          </span>
          <span className="days">
            {day < ann.effectDay ? `in ${ann.effectDay - day}d` : `${Math.max(0, ann.effectDay + ann.durationDays - day)}d left`}
          </span>
        </div>
      )}
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
      {offer && offerFac && (
        <div
          className="world-event sev-warning"
          title={`Fire sale from ${offerSeller?.name ?? 'a rival'}\n\n${offerFac.name} is on the block for ${formatMoney(offer.askCents)} (75% of build cost) until day ${offer.deadlineDay + 1}. Accepting transfers the building, its crew, and its supply lines to you.`}
        >
          <span className="icon">🏷️</span>
          <span className="name">
            {offerFac.name} — {formatMoney(offer.askCents)}
          </span>
          <span className="days">{Math.max(0, offer.deadlineDay - day + 1)}d</span>
          <button
            disabled={playerCash < offer.askCents}
            title={playerCash < offer.askCents ? 'Not enough cash' : 'Buy it — crew and supply lines included'}
            onClick={() => dispatch({ type: 'ACCEPT_FACILITY_OFFER' })}
            style={{ marginLeft: 6 }}
          >
            Buy
          </button>
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
