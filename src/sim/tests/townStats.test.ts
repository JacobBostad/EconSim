import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { cyclePhase, type TownDay } from '../systems/TownStatsSystem';
import { serialize, deserialize } from '../persistence/saveLoad';

describe('Town history', () => {
  it('appends one bounded record per day with sane vitals', () => {
    const sim = newSim(2);
    const state = sim.getState();
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 10 + 1);
    expect(state.townHistory.length).toBe(10);
    const last = state.townHistory[state.townHistory.length - 1]!;
    expect(last.population).toBe(Object.keys(state.citizens).length);
    expect(last.avgSatisfaction).toBeGreaterThan(0);
    expect(last.avgSatisfaction).toBeLessThanOrEqual(100);
    expect(last.employed).toBeLessThanOrEqual(last.population);

    // Bounded by config.
    sim.run(ticksPerDay(state.config) * (state.config.maxDailyHistory + 20));
    expect(state.townHistory.length).toBeLessThanOrEqual(state.config.maxDailyHistory);
  });

  it('old saves get an empty history', () => {
    const sim = newSim(2);
    const raw = JSON.parse(serialize(sim.getState()));
    delete raw.townHistory;
    const reloaded = deserialize(JSON.stringify(raw));
    expect(reloaded.townHistory).toEqual([]);
  });

  it('classifies the cycle phase from the employment trend', () => {
    const mk = (rates: number[]): TownDay[] =>
      rates.map((r, i) => ({ day: i, population: 100, employed: Math.round(r * 100), avgSatisfaction: 60, avgCash: 1000 }));
    expect(cyclePhase(mk(Array(20).fill(0.6)))).toBe('steady');
    expect(cyclePhase(mk([...Array(15).fill(0.5), ...Array(5).fill(0.6)]))).toBe('boom');
    expect(cyclePhase(mk([...Array(15).fill(0.7), ...Array(5).fill(0.55)]))).toBe('absorbing');
    expect(cyclePhase(mk([0.6, 0.6]))).toBe('steady'); // too little data
  });
});
