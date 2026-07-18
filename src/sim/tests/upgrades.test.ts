import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { upgradeCost, MAX_FACILITY_LEVEL } from '../core/Upgrades';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { getFacilityDef } from '../data/facilityDefinitions';

describe('Facility upgrades', () => {
  it('upgrading raises level, storage, and worker capacity for a price', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 100, y: 20 } });
    const fac = state.facilities[player.facilities[0]!]!;
    const def = getFacilityDef('factory');
    const supply0 = totalMoneySupply(state);

    const cost1 = upgradeCost(state, fac.id);
    expect(cost1).toBeGreaterThan(0);
    const cashBefore = player.cash;
    sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: player.id, facilityId: fac.id });

    expect(fac.level).toBe(2);
    expect(player.cash).toBe(cashBefore - cost1);
    expect(fac.storageCapacity).toBe(Math.round(def.storageCapacity * 1.4));
    expect(fac.workerCapacity).toBe(def.workerCapacity + 1);
    expect(totalMoneySupply(state)).toBe(supply0);

    // Level 3 is the cap.
    sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: player.id, facilityId: fac.id });
    expect(fac.level).toBe(3);
    const cashAt3 = player.cash;
    sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: player.id, facilityId: fac.id });
    expect(fac.level).toBe(MAX_FACILITY_LEVEL);
    expect(player.cash).toBe(cashAt3);
  });

  it('flush AI firms upgrade production facilities over time', () => {
    const sim = newSim(4);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    foods.cash = 200000_00;
    let upgraded = false;
    for (let day = 1; day <= 40 && !upgraded; day++) {
      state.tick = ticksPerDay(state.config) * day;
      runAIStrategySystem(makeContext(state));
      upgraded = foods.facilities.some((id) => (state.facilities[id]?.level ?? 1) > 1);
    }
    expect(upgraded).toBe(true);
  });
});
