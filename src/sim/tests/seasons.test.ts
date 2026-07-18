import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import {
  seasonOfDay,
  seasonProductionMult,
  seasonDemandMult,
  seasonTransportMult,
  SEASON_LENGTH_DAYS,
} from '../data/seasons';

describe('Seasons', () => {
  it('cycle spring → summer → autumn → winter every 30 days', () => {
    expect(seasonOfDay(0)).toBe('spring');
    expect(seasonOfDay(SEASON_LENGTH_DAYS)).toBe('summer');
    expect(seasonOfDay(SEASON_LENGTH_DAYS * 2)).toBe('autumn');
    expect(seasonOfDay(SEASON_LENGTH_DAYS * 3)).toBe('winter');
    expect(seasonOfDay(SEASON_LENGTH_DAYS * 4)).toBe('spring');
  });

  it('winter slows farms, raises clothes demand and freight', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);

    state.tick = 0; // spring
    expect(seasonProductionMult(state, 'farm')).toBeCloseTo(1.1);
    expect(seasonDemandMult(state, 'clothes')).toBe(1);
    expect(seasonTransportMult(state)).toBe(1);

    state.tick = tpd * SEASON_LENGTH_DAYS * 3; // winter day 90
    expect(seasonProductionMult(state, 'farm')).toBeCloseTo(0.65);
    expect(seasonProductionMult(state, 'mine')).toBe(1);
    expect(seasonDemandMult(state, 'clothes')).toBeCloseTo(1.35);
    expect(seasonDemandMult(state, 'bread')).toBeCloseTo(1.1);
    expect(seasonTransportMult(state)).toBeCloseTo(1.25);
  });

  it('season turnovers are announced in the news', () => {
    const sim = newSim(1);
    sim.run(ticksPerDay(sim.getState().config) * (SEASON_LENGTH_DAYS + 1));
    const news = sim.getState().events.filter((e) => e.message.includes('Summer begins'));
    expect(news.length).toBe(1);
  });
});
