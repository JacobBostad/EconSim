import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { makeContext } from '../core/GameState';
import { runProductionSystem } from '../systems/ProductionSystem';
import { getQuantity, addStock } from '../entities/Inventory';

describe('ProductionSystem', () => {
  it('consumes inputs and creates outputs', () => {
    const sim = newSim(42);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.presentWorkers = 3; // full labor
    // Ensure plenty of grain, empty bread for a clean measurement.
    bakery.inputInventory = {};
    bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 30, 50);

    const startGrain = getQuantity(bakery.inputInventory, 'grain');
    for (let i = 0; i < 4; i++) runProductionSystem(makeContext(state)); // ticksRequired = 3

    expect(getQuantity(bakery.outputInventory, 'bread')).toBeGreaterThan(0);
    expect(getQuantity(bakery.inputInventory, 'grain')).toBeLessThan(startGrain);
  });

  it('does not produce without required inputs', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.presentWorkers = 3;
    bakery.inputInventory = {}; // no grain
    bakery.outputInventory = {};

    for (let i = 0; i < 10; i++) runProductionSystem(makeContext(state));

    expect(getQuantity(bakery.outputInventory, 'bread')).toBe(0);
    expect(bakery.status).toBe('input-starved');
    expect(bakery.bottleneckReason).toContain('Grain');
  });

  it('stops producing without workers', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.presentWorkers = 0; // no labor
    bakery.inputInventory = {};
    bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 30, 50);

    // Mid-morning: an empty floor during the shift is a real staffing alarm.
    state.tick = state.config.ticksPerHour * 10;
    for (let i = 0; i < 10; i++) runProductionSystem(makeContext(state));

    expect(getQuantity(bakery.outputInventory, 'bread')).toBe(0);
    expect(bakery.status).toBe('labor-starved');
  });

  it('a staffed facility reads idle overnight, not labor-starved', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.presentWorkers = 0;
    bakery.inputInventory = {};
    bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 30, 50);
    expect(bakery.employees.length).toBeGreaterThan(0);

    // Midnight: the crew is home in bed — that's a shift break, no alarm.
    state.tick = 0;
    runProductionSystem(makeContext(state));
    expect(bakery.status).toBe('idle');
    expect(bakery.bottleneckReason).toBeNull();

    // An unstaffed facility is a real problem at any hour.
    bakery.employees = [];
    runProductionSystem(makeContext(state));
    expect(bakery.status).toBe('labor-starved');
  });

  it('produces slower with partial labor', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.inputInventory = {};
    bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 300, 50);

    // Full labor for 3 ticks should complete at least one batch (ticksRequired 3).
    bakery.presentWorkers = 3;
    bakery.productionProgress = 0;
    for (let i = 0; i < 3; i++) runProductionSystem(makeContext(state));
    const fullBatches = getQuantity(bakery.outputInventory, 'bread');

    // Reset and use 1/3 labor: 3 ticks should NOT complete a batch.
    bakery.outputInventory = {};
    bakery.productionProgress = 0;
    bakery.presentWorkers = 1;
    for (let i = 0; i < 3; i++) runProductionSystem(makeContext(state));
    const partialBatches = getQuantity(bakery.outputInventory, 'bread');

    expect(fullBatches).toBeGreaterThan(partialBatches);
  });
});
