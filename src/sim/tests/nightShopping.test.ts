import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';

/**
 * Urgent needs must not send citizens to closed stores at night: those trips
 * bounced off closed doors all night, inflating every store's lostSales
 * (~25/day of phantom "stockouts" on a fully stocked store) and draining
 * satisfaction. The signal feeds the whole AI supply-elasticity ladder, so
 * phantom demand meant phantom overbuilding.
 */
describe('Night shopping', () => {
  it('closed-hours trips no longer register lost sales (except closing-time stragglers)', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 5); // let the economy warm up

    const stores = Object.values(state.facilities).filter((f) => f.type === 'retail');
    let nightLost = 0;
    let prev = new Map(stores.map((s) => [s.id, s.dailyStats.lostSales]));
    for (let t = 0; t < tpd * 2; t++) {
      sim.run(1);
      const hour = computeTime(state.tick, state.config).hour;
      for (const s of stores) {
        const cur = s.dailyStats.lostSales;
        const before = prev.get(s.id) ?? 0;
        // Deep night only — hour 22 still catches legitimate stragglers who
        // started their commute before closing.
        if (cur > before && hour >= 23) nightLost += cur - before;
        if (cur > before && hour < state.config.storeOpenHour) nightLost += cur - before;
        prev.set(s.id, cur >= before ? cur : 0);
      }
    }
    // A handful of long-commute stragglers may still arrive after 23:00.
    // Before the fix this was ~25/day per store (hundreds over this window).
    expect(nightLost).toBeLessThan(15);
  });
});
