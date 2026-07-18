import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';

/**
 * Closed-door visits vs stockouts: both cost the shopper the trip (and keep
 * feeding the measured lostSales equilibrium), but the daily digest must not
 * report a fully stocked store as "stockouts".
 */
describe('Closed-door visits', () => {
  function storeWithStats(lost: number, closed: number) {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 43, y: 57 } });
    const store = state.facilities[player.facilities[0]!]!;
    store.retailProductIds = ['bread'];
    const tpd = ticksPerDay(state.config);
    sim.run(tpd - (state.tick % tpd) - 1); // stop just before the boundary
    store.dailyStats.lostSales = lost;
    store.dailyStats.closedDoorVisits = closed;
    sim.run(1); // EventLog digests the day before stats reset
    return { state, store };
  }

  it('all-closed-door losses report the clock, not a stockout', () => {
    const { state } = storeWithStats(5, 5);
    const msg = state.events.map((e) => e.message).filter((m) => m.includes('after closing'));
    expect(msg.some((m) => m.includes('shelves were stocked'))).toBe(true);
    expect(state.events.some((e) => e.message.includes('sales to stockouts'))).toBe(false);
  });

  it('mixed losses report real stockouts with the after-closing share noted', () => {
    const { state } = storeWithStats(8, 3);
    const msg = state.events.find((e) => e.message.includes('sales to stockouts'));
    expect(msg).toBeTruthy();
    expect(msg!.message).toContain('lost 5');
    expect(msg!.message).toContain('+3 shoppers arrived after closing');
  });

  it('the sim counts closed-door arrivals into the counter during real play', () => {
    const sim = newSim(5);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 5);
    // Somewhere in 5 days some AI store had an after-hours arrival; the
    // counter stays within lostSales.
    for (const fid in state.facilities) {
      const f = state.facilities[fid]!;
      expect(f.dailyStats.closedDoorVisits ?? 0).toBeLessThanOrEqual(f.dailyStats.lostSales);
      expect((f.yesterdayStats.closedDoorVisits ?? 0)).toBeLessThanOrEqual(f.yesterdayStats.lostSales);
    }
  });
});
