import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { makeContext } from '../core/GameState';
import { runLogisticsSystem } from '../systems/LogisticsSystem';
import { getQuantity, addStock } from '../entities/Inventory';

describe('LogisticsSystem', () => {
  it('ships goods from source to destination via a contract', () => {
    const sim = newSim(51);
    const state = sim.getState();
    state.tick = 2; // an hour boundary (ticksPerHour = 2)
    const farm = findFacilityByName(state, 'Sunrise Farm');
    const bakery = findFacilityByName(state, 'Sunrise Bakery');

    farm.outputInventory = {};
    addStock(farm.outputInventory, 'grain', 60, 50);
    bakery.inputInventory = {}; // below reorder point -> should trigger

    const farmGrainBefore = getQuantity(farm.outputInventory, 'grain');
    runLogisticsSystem(makeContext(state));

    const veh = Object.values(state.vehicles).find(
      (v) => v.destinationFacilityId === bakery.id && v.cargo.productId === 'grain',
    );
    expect(veh).toBeTruthy();
    expect(getQuantity(farm.outputInventory, 'grain')).toBeLessThan(farmGrainBefore);

    // Deliver and process arrival.
    veh!.status = 'delivered';
    runLogisticsSystem(makeContext(state));
    expect(getQuantity(bakery.inputInventory, 'grain')).toBeGreaterThan(0);
  });

  it('sources from the importer and charges the buyer', () => {
    const sim = newSim(52);
    const state = sim.getState();
    const importer = findFacilityByName(state, 'Import Terminal');
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    const firm = state.firms[bakery.ownerFirmId]!;

    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT',
      ownerFirmId: firm.id,
      sourceFacilityId: importer.id,
      destinationFacilityId: bakery.id,
      productId: 'grain',
      targetQuantity: 10,
      reorderPoint: 1000, // force a reorder regardless of stock
      maxInventory: 2000,
    });
    bakery.inputInventory = {};
    state.tick = 2;
    const cashBefore = firm.cash;

    runLogisticsSystem(makeContext(state));
    const veh = Object.values(state.vehicles).find(
      (v) => v.originFacilityId === importer.id && v.cargo.productId === 'grain',
    );
    expect(veh).toBeTruthy();
    expect(firm.cash).toBeLessThan(cashBefore); // paid the importer at dispatch
  });
});
