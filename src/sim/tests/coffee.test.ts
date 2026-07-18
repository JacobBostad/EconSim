import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { makeContext } from '../core/GameState';
import { runProductionSystem } from '../systems/ProductionSystem';
import { addStock, getQuantity } from '../entities/Inventory';
import { serialize, deserialize } from '../persistence/saveLoad';
import { CONSUMER_PRODUCT_IDS } from '../data/products';
import { ticksPerDay } from '../core/Tick';

describe('Coffee', () => {
  it('is a consumer product and every fresh citizen wants it', () => {
    expect(CONSUMER_PRODUCT_IDS).toContain('coffee');
    const sim = newSim(2);
    for (const cit of Object.values(sim.getState().citizens)) {
      expect(cit.needs.some((n) => n.productId === 'coffee')).toBe(true);
    }
  });

  it('old saves gain the coffee need on load', () => {
    const sim = newSim(2);
    const raw = JSON.parse(serialize(sim.getState()));
    for (const cid in raw.citizens) {
      raw.citizens[cid].needs = raw.citizens[cid].needs.filter(
        (n: { productId: string }) => n.productId !== 'coffee',
      );
    }
    const reloaded = deserialize(JSON.stringify(raw));
    for (const cit of Object.values(reloaded.citizens)) {
      expect(cit.needs.some((n) => n.productId === 'coffee')).toBe(true);
    }
  });

  it('stores are allowed to carry coffee (the whitelist gap that blocked v1)', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 50, y: 52 } });
    const store = state.facilities[player.facilities[0]!]!;
    sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: 'coffee' });
    expect(store.retailProductIds).toContain('coffee');
    expect(player.pricesByProduct['coffee']).toBeGreaterThan(0);
  });

  it('a player coffee shop actually sells (importer grain -> roast -> retail)', () => {
    const sim = newSim(11);
    const state = sim.getState();
    const p = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'factory', location: { x: 56, y: 40 } });
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'retail', location: { x: 50, y: 52 } });
    const facs = p.facilities.map((id) => state.facilities[id]!);
    const factory = facs.find((f) => f.type === 'factory')!;
    const store = facs.find((f) => f.type === 'retail')!;
    sim.dispatch({ type: 'SELECT_RECIPE', facilityId: factory.id, recipeId: 'roast_coffee' });
    sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: 'coffee' });
    for (let i = 0; i < 2; i++) sim.dispatch({ type: 'HIRE_WORKER', facilityId: factory.id, citizenId: null });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: store.id, citizenId: null });
    const importer = Object.values(state.facilities).find((f) => f.type === 'importer')!;
    sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: p.id, sourceFacilityId: importer.id, destinationFacilityId: factory.id, productId: 'grain', targetQuantity: 30, reorderPoint: 12, maxInventory: 60 });
    sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: p.id, sourceFacilityId: factory.id, destinationFacilityId: store.id, productId: 'coffee', targetQuantity: 40, reorderPoint: 16, maxInventory: 80 });
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 12 + 1);
    const sold = state.marketStats['coffee']!.history.reduce((a, h) => a + h.unitsSold, 0);
    expect(sold).toBeGreaterThan(0);
    expect(p.accounting.lifetime.revenue).toBeGreaterThan(0);
  });

  it('a factory roasts grain into coffee', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    expect(bakery.recipes).toContain('roast_coffee');
    bakery.activeRecipeId = 'roast_coffee';
    bakery.presentWorkers = 2;
    bakery.inputInventory = {};
    bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 20, 50);
    state.tick = state.config.ticksPerHour * 10; // work hours
    for (let i = 0; i < 4; i++) runProductionSystem(makeContext(state));
    expect(getQuantity(bakery.outputInventory, 'coffee')).toBeGreaterThan(0);
  });
});
