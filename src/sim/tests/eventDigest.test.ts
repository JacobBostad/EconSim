import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext } from '../core/GameState';
import { runEventLogSystem } from '../systems/EventLogSystem';
import { ticksPerDay } from '../core/Tick';

/**
 * The daily production digest reads YESTERDAY'S dailyStats, not the
 * instantaneous facility status — the EventLog pass runs at midnight, when
 * every facility is off-shift and status would always read idle.
 */
describe('Daily production digest', () => {
  function playerFacility(seed: number) {
    const sim = newSim(seed);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    const farm = player.facilities
      .map((id) => state.facilities[id]!)
      .find((f) => f.type === 'farm')!;
    state.tick = ticksPerDay(state.config); // day boundary
    return { state, farm };
  }

  it('reports a facility that was blocked all day, with the reason', () => {
    const { state, farm } = playerFacility(11);
    farm.dailyStats.ticksActive = 0;
    farm.dailyStats.bottleneck = 'No workers present (need 2)';
    runEventLogSystem(makeContext(state));
    expect(
      state.events.some((e) => e.message.includes('produced nothing yesterday — No workers present')),
    ).toBe(true);
  });

  it('suggests exports/assortment when output storage keeps filling up', () => {
    const { state, farm } = playerFacility(12);
    farm.dailyStats.ticksActive = 40; // ran part of the day, then filled up
    farm.dailyStats.bottleneck = 'Output storage full';
    runEventLogSystem(makeContext(state));
    expect(state.events.some((e) => e.message.includes('producing more than you sell'))).toBe(true);
  });

  it('stays quiet about a facility that ran clean', () => {
    const { state, farm } = playerFacility(13);
    farm.dailyStats.ticksActive = 60;
    farm.dailyStats.bottleneck = null;
    runEventLogSystem(makeContext(state));
    expect(state.events.some((e) => e.message.includes(farm.name) && e.category === 'production')).toBe(
      false,
    );
  });
});
