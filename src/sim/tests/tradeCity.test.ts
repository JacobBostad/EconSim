import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { getProduct, PRODUCT_IDS_BY_PRESET } from '../data/products';
// Village sims: trade cities price only the products present at the Village
// preset (the Arc C1 breadth is metropolis-only — see products.ts). Iterate the
// preset catalog, not the whole table, or the C1 ids have no Village trade book.
import { getQuantity, addStock } from '../entities/Inventory';
import { deserialize, serialize } from '../persistence/saveLoad';
import {
  TRADE_PRICE_MIN_MULT,
  TRADE_PRICE_MAX_MULT,
  EXPORT_FREIGHT_FEE,
} from '../data/constants';
import { cityBias } from '../data/tradeCities';
import { pickBestCity, impactedFillPrice } from '../core/Trade';

describe('Port Rosa trade', () => {
  it('prices random-walk daily within bounds, deterministically', () => {
    const a = newSim(11);
    const b = newSim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30 + 1);
    b.run(tpd * 30 + 1);

    let moved = false;
    for (const pid of PRODUCT_IDS_BY_PRESET['village']) {
      const base = getProduct(pid).basePrice;
      const price = a.getState().tradeCities['port_rosa']!.pricesByProduct[pid]!;
      expect(price).toBeGreaterThanOrEqual(Math.round(base * TRADE_PRICE_MIN_MULT));
      expect(price).toBeLessThanOrEqual(Math.round(base * TRADE_PRICE_MAX_MULT));
      expect(b.getState().tradeCities['port_rosa']!.pricesByProduct[pid]).toBe(price);
      if (price !== base) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('exporting from a warehouse pays trade price minus freight, conserved', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
    const wh = state.facilities[player.facilities[0]!]!;
    addStock(wh.inputInventory, 'bread', 30, 60);
    const supply0 = totalMoneySupply(state);
    const cashBefore = player.cash;
    const price = state.tradeCities['port_rosa']!.pricesByProduct['bread']!;

    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 30 });

    const expected = Math.round(30 * impactedFillPrice(price, 30, -1) * (1 - EXPORT_FREIGHT_FEE));
    expect(player.cash).toBe(cashBefore + expected);
    expect(getQuantity(wh.inputInventory, 'bread')).toBe(0);
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.accounting.today.revenue).toBeGreaterThanOrEqual(expected);
  });

  it('exports only ship from warehouses; old saves get trade prices', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 100, y: 20 } });
    const store = state.facilities[player.facilities[0]!]!;
    addStock(store.inputInventory, 'bread', 10, 60);
    const cashBefore = player.cash;
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: store.id, productId: 'bread', quantity: 10 });
    expect(player.cash).toBe(cashBefore);
    expect(getQuantity(store.inputInventory, 'bread')).toBe(10);

    const raw = JSON.parse(serialize(state));
    delete raw.tradeCities;
    const loaded = deserialize(JSON.stringify(raw));
    for (const pid of PRODUCT_IDS_BY_PRESET['village']) {
      expect(loaded.tradeCities['port_rosa']!.pricesByProduct[pid]).toBe(getProduct(pid).basePrice);
      expect(loaded.tradeCities['ironvale']!.pricesByProduct[pid]).toBe(
        Math.round(getProduct(pid).basePrice * cityBias('ironvale', pid)),
      );
    }
  });

  it('single-city legacy saves migrate their Port Rosa book into tradeCities', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    // Reconstruct the pre-Ironvale shape: a lone `tradeCity` field.
    raw.tradeCity = { pricesByProduct: { bread: 1234 } };
    delete raw.tradeCities;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.tradeCities['port_rosa']!.pricesByProduct['bread']).toBe(1234);
    expect((loaded as unknown as { tradeCity?: unknown }).tradeCity).toBeUndefined();
    expect(loaded.tradeCities['ironvale']).toBeTruthy();
  });
});

describe('Ironvale — the second trade city', () => {
  it('walks its own biased prices, anti-correlated with Port Rosa, deterministically', () => {
    const a = newSim(11);
    const b = newSim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30 + 1);
    b.run(tpd * 30 + 1);

    let differs = false;
    for (const pid of PRODUCT_IDS_BY_PRESET['village']) {
      const base = getProduct(pid).basePrice;
      const bias = cityBias('ironvale', pid);
      const price = a.getState().tradeCities['ironvale']!.pricesByProduct[pid]!;
      expect(price).toBeGreaterThanOrEqual(Math.round(base * bias * TRADE_PRICE_MIN_MULT));
      expect(price).toBeLessThanOrEqual(Math.round(base * bias * TRADE_PRICE_MAX_MULT));
      expect(b.getState().tradeCities['ironvale']!.pricesByProduct[pid]).toBe(price);
      if (price !== a.getState().tradeCities['port_rosa']!.pricesByProduct[pid]) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('exports route to the better-paying city after freight', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
    const wh = state.facilities[player.facilities[0]!]!;
    addStock(wh.inputInventory, 'tools', 20, 60);

    // Make Ironvale clearly better for tools despite its higher freight.
    const base = getProduct('tools').basePrice;
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = Math.round(base * 1.6);
    state.tradeCities['port_rosa']!.pricesByProduct['tools'] = base;

    expect(pickBestCity(state, 'tools').cityId).toBe('ironvale');
    const cashBefore = player.cash;
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'tools', quantity: 20 });
    const fee = Math.min(0.5, EXPORT_FREIGHT_FEE * 1.15);
    expect(player.cash).toBe(
      cashBefore + Math.round(20 * impactedFillPrice(Math.round(base * 1.6), 20, -1) * (1 - fee)),
    );
  });
});
