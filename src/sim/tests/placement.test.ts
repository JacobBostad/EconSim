import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { placementBlocker, MIN_BUILD_SPACING } from '../core/Placement';

describe('Placement clearance', () => {
  it('rejects a manual build on top of an existing facility (no charge)', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const supply0 = totalMoneySupply(state);

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    const count = player.facilities.length;
    const cash = player.cash;

    // Same spot and a nearly-same spot both bounce.
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 41, y: 41 } });

    expect(player.facilities.length).toBe(count);
    expect(player.cash).toBe(cash);
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(state.events.some((e) => e.message.includes('Too close'))).toBe(true);
  });

  it('allows building just beyond the spacing ring', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    const count = player.facilities.length;
    sim.dispatch({
      type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm',
      location: { x: 40 + MIN_BUILD_SPACING + 0.1, y: 40 },
    });
    expect(player.facilities.length).toBe(count + 1);
  });

  it('placementBlocker names the facility in the way', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    const store = state.facilities[player.facilities[player.facilities.length - 1]!]!;

    const hit = placementBlocker(state, { x: 40.5, y: 40.5 });
    expect(hit?.id).toBe(store.id);
    expect(placementBlocker(state, { x: 40 + MIN_BUILD_SPACING + 1, y: 40 })).not.toBe(store);
  });
});
