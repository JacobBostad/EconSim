import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { totalMoneySupply } from '../core/GameState';

describe('Stability', () => {
  it('survives 365 in-game days at high speed without crashing', () => {
    const sim = newSim(2026);
    const state = sim.getState();
    const ticks = state.config.ticksPerHour * 24 * 365;
    const moneyBefore = totalMoneySupply(state);

    expect(() => sim.run(ticks)).not.toThrow();

    const after = sim.getState();
    // Economy is still intact and consistent.
    expect(Object.keys(after.citizens).length).toBeGreaterThan(0);
    expect(after.firms[after.playerFirmId]).toBeTruthy();
    expect(totalMoneySupply(after)).toBe(moneyBefore);
    // Bounded logs never exploded.
    expect(after.events.length).toBeLessThanOrEqual(after.config.maxEvents);
    expect(after.transactions.length).toBeLessThanOrEqual(after.config.maxTransactions);
    // Perf budget: measured ~0.2ms avg/tick at max town size; 2ms is a 10×
    // headroom alarm line before playback smoothness is ever at risk.
    expect(after.perf.avgTickMs).toBeLessThan(2);
  }, 30000);
});
