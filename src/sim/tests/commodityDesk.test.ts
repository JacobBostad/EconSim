import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { cityPrice, exportFreightFee, impactedFillPrice } from '../core/Trade';
import { getQuantity, totalUnits } from '../entities/Inventory';
import { getProduct } from '../data/products';
import type { Simulation } from '../core/Simulation';

function playerWarehouse(sim: Simulation) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 100000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 70, y: 30 } });
  return state.facilities[player.facilities[player.facilities.length - 1]!]!;
}

describe('Commodity desk', () => {
  it('buys at city price plus freight, conserves money, books importPurchase', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const wh = playerWarehouse(sim);
    const supply0 = totalMoneySupply(state);
    const cash0 = player.cash;

    const unit = Math.round(
      impactedFillPrice(cityPrice(state, 'ironvale', 'grain'), 40, 1) *
        (1 + exportFreightFee(state, 'ironvale')),
    );
    sim.dispatch({
      type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id,
      productId: 'grain', quantity: 40, cityId: 'ironvale',
    });

    expect(getQuantity(wh.inputInventory, 'grain')).toBe(40);
    expect(player.cash).toBe(cash0 - unit * 40);
    expect(totalMoneySupply(state)).toBe(supply0);
    // Goods arrive at the product's standard quality (importer convention).
    expect(wh.inputInventory['grain']!.quality).toBe(getProduct('grain').defaultQuality);
  });

  it('storage is the position limit', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const wh = playerWarehouse(sim);
    const room = wh.storageCapacity - totalUnits(wh.inputInventory) - totalUnits(wh.outputInventory);
    sim.dispatch({
      type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id,
      productId: 'grain', quantity: room + 500, cityId: 'port_rosa',
    });
    expect(totalUnits(wh.inputInventory) + totalUnits(wh.outputInventory)).toBe(wh.storageCapacity);
  });

  it('only warehouses take positions, and broke firms cannot', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 66, y: 28 } });
    const shop = state.facilities[player.facilities[player.facilities.length - 1]!]!;
    sim.dispatch({
      type: 'BUY_FROM_CITY', firmId: player.id, facilityId: shop.id,
      productId: 'grain', quantity: 20, cityId: 'port_rosa',
    });
    expect(getQuantity(shop.inputInventory, 'grain')).toBe(0);

    const wh = playerWarehouse(sim);
    player.cash = 10; // can't afford a single unit
    const cash0 = player.cash;
    sim.dispatch({
      type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id,
      productId: 'grain', quantity: 20, cityId: 'port_rosa',
    });
    expect(getQuantity(wh.inputInventory, 'grain')).toBe(0);
    expect(player.cash).toBe(cash0);
  });

  it('round trip: buy the dip here, sell the spike there', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const wh = playerWarehouse(sim);
    // Pin a fat spread: Port Rosa cheap, Ironvale rich.
    state.tradeCities['port_rosa']!.pricesByProduct['tools'] = Math.round(getProduct('tools').basePrice * 0.7);
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = Math.round(getProduct('tools').basePrice * 1.6);
    const cash0 = player.cash;
    sim.dispatch({
      type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id,
      productId: 'tools', quantity: 50, cityId: 'port_rosa',
    });
    sim.dispatch({
      type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id,
      productId: 'tools', quantity: 50, cityId: 'ironvale',
    });
    expect(getQuantity(wh.inputInventory, 'tools')).toBe(0);
    expect(player.cash).toBeGreaterThan(cash0); // the spread beat two freights
  });
});
