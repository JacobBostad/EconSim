import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { landValueAt, landCostMultiplier } from '../core/LandValue';
import { totalMoneySupply } from '../core/GameState';
import { getFacilityDef } from '../data/facilityDefinitions';

describe('Land value & location economics', () => {
  it('ground near homes is worth more than the outskirts', () => {
    const sim = newSim(1);
    const state = sim.getState();
    // Homes sit around y >= 60; the far corner is empty.
    const downtown = landValueAt(state, { x: 40, y: 58 });
    const outskirts = landValueAt(state, { x: 120, y: 8 });
    expect(downtown).toBeGreaterThan(outskirts);
    expect(outskirts).toBeLessThan(0.1);
    expect(landCostMultiplier(0)).toBeCloseTo(0.8);
    expect(landCostMultiplier(1)).toBeCloseTo(1.6);
  });

  it('building downtown costs more and carries higher rent', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const supply0 = totalMoneySupply(state);
    const def = getFacilityDef('retail');

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 43, y: 57 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 124, y: 4 } });

    const [downtown, remote] = player.facilities.map((id) => state.facilities[id]!);
    expect(downtown!.buildCost).toBeGreaterThan(remote!.buildCost);
    expect(downtown!.buildCost).toBeGreaterThan(def.buildCost); // premium over list
    expect(remote!.buildCost).toBeLessThan(def.buildCost); // discount over list
    expect(downtown!.operatingCostPerDay).toBeGreaterThan(remote!.operatingCostPerDay);
    expect(player.cash).toBe(100000_00 - downtown!.buildCost - remote!.buildCost);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
