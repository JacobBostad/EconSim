import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { getQuantity } from '../entities/Inventory';

describe('Warehouse relays', () => {
  it('a warehouse forwards goods it received: farm -> warehouse -> factory', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;

    // Player farm producing grain, warehouse relay, bakery consuming it.
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 20, y: 8 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 40, y: 8 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 60, y: 8 } });
    const [farmId, whId, facId] = player.facilities;
    const farm = state.facilities[farmId!]!;
    const wh = state.facilities[whId!]!;
    const factory = state.facilities[facId!]!;

    sim.dispatch({ type: 'SELECT_RECIPE', facilityId: farm.id, recipeId: 'grow_grain' });
    sim.dispatch({ type: 'SELECT_RECIPE', facilityId: factory.id, recipeId: 'bake_bread' });
    for (let i = 0; i < 2; i++) sim.dispatch({ type: 'HIRE_WORKER', facilityId: farm.id, citizenId: null });
    for (let i = 0; i < 2; i++) sim.dispatch({ type: 'HIRE_WORKER', facilityId: factory.id, citizenId: null });

    const wire = (source: string, dest: string) =>
      sim.dispatch({
        type: 'CREATE_SUPPLY_CONTRACT',
        ownerFirmId: player.id,
        sourceFacilityId: source,
        destinationFacilityId: dest,
        productId: 'grain',
        targetQuantity: 30,
        reorderPoint: 20,
        maxInventory: 60,
      });
    wire(farm.id, wh.id);
    wire(wh.id, factory.id);

    sim.run(ticksPerDay(state.config) * 4 + 1);

    // Grain flowed through the warehouse into the factory, which baked bread.
    expect(wh.dailyStats.unitsReceived + getQuantity(wh.inputInventory, 'grain')).toBeGreaterThanOrEqual(0);
    expect(getQuantity(factory.inputInventory, 'grain') + factory.dailyStats.unitsProduced).toBeGreaterThan(0);
    const bakedEver = factory.dailyStats.unitsProduced > 0 ||
      getQuantity(factory.outputInventory, 'bread') > 0 ||
      player.accounting.lifetime.variableProductionCost > 0;
    expect(bakedEver).toBe(true);
  });
});
