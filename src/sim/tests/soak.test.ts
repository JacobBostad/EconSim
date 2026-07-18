import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

/**
 * Long-run soak: 600 in-game days with the player running two wizard chains
 * and every AI behavior live (personalities, wage market, supply elasticity,
 * coffee/luxury entries, landlording, exports). Catches slow-burn drift the
 * 120/250-day tests can't see.
 */
describe('600-day soak', () => {
  it('the full economy stays sane for 600 days', () => {
    const sim = newSim(2027);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 60000_00;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'coffee' });
    sim.dispatch({ type: 'CIVIC_ACTION', firmId: player.id, action: 'fund_home' });

    const popStart = Object.keys(state.citizens).length;
    const supply = totalMoneySupply(state);
    sim.dispatch({ type: 'RESUME' });
    const tpd = ticksPerDay(state.config);

    // A mature town rides real employment cycles, so satisfaction is judged
    // as a time average over the back half of the run, not one instant.
    const samples: number[] = [];
    expect(() => {
      sim.run(tpd * 300 + 1);
      for (let d = 0; d < 30; d++) {
        sim.run(tpd * 10);
        const cs = Object.values(sim.getState().citizens);
        samples.push(cs.reduce((a, c) => a + c.satisfaction, 0) / cs.length);
      }
    }).not.toThrow();

    const st = sim.getState();
    expect(totalMoneySupply(st)).toBe(supply);
    const cits = Object.values(st.citizens);
    const avgSat = samples.reduce((a, v) => a + v, 0) / samples.length;
    expect(avgSat).toBeGreaterThan(40);
    expect(cits.length).toBeGreaterThan(popStart);
    expect(Object.values(st.firms).filter((f) => f.ownerType === 'ai').length).toBeGreaterThanOrEqual(2);
    expect(st.events.length).toBeLessThanOrEqual(st.config.maxEvents);
    expect(st.transactions.length).toBeLessThanOrEqual(st.config.maxTransactions);
    expect(st.perf.avgTickMs).toBeLessThan(2);
  }, 60000);
});
