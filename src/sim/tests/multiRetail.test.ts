import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { deserialize, serialize } from '../persistence/saveLoad';
import { addStock } from '../entities/Inventory';

describe('Multi-product retail', () => {
  it('TOGGLE_RETAIL_PRODUCT manages an assortment capped at 3', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 50, y: 55 } });
    const store = state.facilities[player.facilities[0]!]!;

    for (const pid of ['bread', 'tools', 'clothes', 'pastries']) {
      sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: pid });
    }
    expect(store.retailProductIds).toEqual(['bread', 'tools', 'clothes']); // 4th rejected
    expect(player.pricesByProduct['bread']).toBeGreaterThan(0); // prices seeded

    sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: 'tools' });
    expect(store.retailProductIds).toEqual(['bread', 'clothes']);

    // Legacy single-set command replaces the assortment.
    sim.dispatch({ type: 'SET_RETAIL_PRODUCT', facilityId: store.id, productId: 'tools' });
    expect(store.retailProductIds).toEqual(['tools']);
  });

  it('a stocked multi-product store earns more than a single-product one', () => {
    const run = (products: string[]): number => {
      const sim = newSim(9);
      const state = sim.getState();
      const player = state.firms[state.playerFirmId]!;
      player.cash = 50000_00;
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 44, y: 55 } });
      const store = state.facilities[player.facilities[0]!]!;
      for (const pid of products) {
        sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: pid });
      }
      sim.dispatch({ type: 'HIRE_WORKER', facilityId: store.id, citizenId: null });
      for (let d = 0; d < 12; d++) {
        for (const pid of products) addStock(store.inputInventory, pid, 40, 60);
        sim.run(ticksPerDay(state.config));
      }
      return player.accounting.lifetime.revenue;
    };
    const single = run(['bread']);
    const triple = run(['bread', 'tools', 'clothes']);
    expect(triple).toBeGreaterThan(single * 1.5); // basket effect is material
  });

  it('old saves wrap legacy retailProductId into the array', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    const homeTown = raw.towns.home; // the six families live under towns.home now
    for (const fid in homeTown.facilities) {
      const f = homeTown.facilities[fid];
      const first = Array.isArray(f.retailProductIds) ? f.retailProductIds[0] : null;
      delete f.retailProductIds;
      f.retailProductId = first ?? null; // simulate a pre-migration save
    }
    const loaded = deserialize(JSON.stringify(raw));
    const breadShop = Object.values(loaded.facilities).find((f) => f.name === 'Sunrise Bread Shop')!;
    expect(breadShop.retailProductIds).toEqual(['bread']);
    const home = Object.values(loaded.facilities).find((f) => f.type === 'home')!;
    expect(home.retailProductIds).toEqual([]);
  });
});
