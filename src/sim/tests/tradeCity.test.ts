import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { getProduct, ALL_PRODUCT_IDS } from '../data/products';
import { getQuantity, addStock } from '../entities/Inventory';
import { deserialize, serialize } from '../persistence/saveLoad';
import {
  TRADE_PRICE_MIN_MULT,
  TRADE_PRICE_MAX_MULT,
  EXPORT_FREIGHT_FEE,
} from '../data/constants';

describe('Port Rosa trade', () => {
  it('prices random-walk daily within bounds, deterministically', () => {
    const a = newSim(11);
    const b = newSim(11);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 30 + 1);
    b.run(tpd * 30 + 1);

    let moved = false;
    for (const pid of ALL_PRODUCT_IDS) {
      const base = getProduct(pid).basePrice;
      const price = a.getState().tradeCity.pricesByProduct[pid]!;
      expect(price).toBeGreaterThanOrEqual(Math.round(base * TRADE_PRICE_MIN_MULT));
      expect(price).toBeLessThanOrEqual(Math.round(base * TRADE_PRICE_MAX_MULT));
      expect(b.getState().tradeCity.pricesByProduct[pid]).toBe(price);
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
    const price = state.tradeCity.pricesByProduct['bread']!;

    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 30 });

    const expected = Math.round(30 * price * (1 - EXPORT_FREIGHT_FEE));
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
    delete raw.tradeCity;
    const loaded = deserialize(JSON.stringify(raw));
    for (const pid of ALL_PRODUCT_IDS) {
      expect(loaded.tradeCity.pricesByProduct[pid]).toBe(getProduct(pid).basePrice);
    }
  });
});
