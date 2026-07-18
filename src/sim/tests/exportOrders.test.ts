import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock, getQuantity } from '../entities/Inventory';
import { getProduct } from '../data/products';
import { deserialize, serialize } from '../persistence/saveLoad';

function setup() {
  const sim = newSim(1);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 50000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[0]!]!;
  addStock(wh.inputInventory, 'bread', 50, 60);
  return { sim, state, player, wh };
}

describe('Standing export orders', () => {
  it('auto-exports surplus when the price target is met, keeping the reserve', () => {
    const { sim, state, player, wh } = setup();
    sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.3, keep: 10 });
    const supply0 = totalMoneySupply(state);

    // Pin the price above target right before the day boundary fires.
    const tpd = ticksPerDay(state.config);
    sim.run(tpd - state.tick % tpd - 1);
    state.tradeCity.pricesByProduct['bread'] = Math.round(getProduct('bread').basePrice * 1.79);
    const exportRevBefore = player.exportRevenue;
    sim.run(1); // day boundary: price walk (stays within bounds) + standing orders

    expect(player.exportRevenue).toBeGreaterThan(exportRevBefore);
    expect(getQuantity(wh.inputInventory, 'bread')).toBe(10);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('holds when the price is below target, and clears cleanly', () => {
    const { sim, state, wh, player } = setup();
    sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.5, keep: 0 });
    const tpd = ticksPerDay(state.config);
    sim.run(tpd - state.tick % tpd - 1);
    state.tradeCity.pricesByProduct['bread'] = getProduct('bread').basePrice; // 1.0x
    sim.run(1);
    // Walk step is ±12%, so it cannot reach 1.5× in one day from 1.0×.
    expect(getQuantity(wh.inputInventory, 'bread')).toBe(50);
    expect(player.exportRevenue).toBe(0);

    sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: null, keep: 0 });
    expect(wh.exportOrders['bread']).toBeUndefined();
  });

  it('orders persist through save/load; old saves default empty', () => {
    const { sim, wh } = setup();
    sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.3, keep: 5 });
    const loaded = deserialize(serialize(sim.getState()));
    const loadedWh = Object.values(loaded.facilities).find((f) => f.type === 'warehouse' && f.ownerFirmId === loaded.playerFirmId)!;
    expect(loadedWh.exportOrders['bread']).toEqual({ minMult: 1.3, keep: 5 });

    const raw = JSON.parse(serialize(sim.getState()));
    for (const fid in raw.facilities) delete raw.facilities[fid].exportOrders;
    const migrated = deserialize(JSON.stringify(raw));
    for (const fid in migrated.facilities) {
      expect(migrated.facilities[fid]!.exportOrders).toEqual({});
    }
  });
});
