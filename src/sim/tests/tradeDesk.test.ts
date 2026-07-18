import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { getProduct } from '../data/products';
import { addStock } from '../entities/Inventory';
import { tradeDesk } from '../selectors/gazetteSelectors';
import { getAchievementDef } from '../data/achievements';
import { getMissionDef } from '../data/missions';
import { serialize, deserialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';

describe('Trade desk & arbitrage content', () => {
  it('ranks products by the spread between the ports, net of freight', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const base = getProduct('tools').basePrice;
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = Math.round(base * 1.7);
    state.tradeCities['port_rosa']!.pricesByProduct['tools'] = base;

    // High-base products (jewelry, Ironvale bias 1.25) can out-spread the
    // inflated tools price in absolute cents — ask for enough rows to find it.
    const rows = tradeDesk(state, 20);
    const tools = rows.find((r) => r.productId === 'tools')!;
    expect(tools.bestCityId).toBe('ironvale');
    expect(tools.spread).toBeGreaterThan(0);
    // Sorted by spread descending.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.spread).toBeGreaterThanOrEqual(rows[i]!.spread);
    }
  });

  it('exports stamp per-city revenue; achievement and mission read it', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
    const wh = state.facilities[player.facilities[0]!]!;
    addStock(wh.inputInventory, 'tools', 30, 60);
    const base = getProduct('tools').basePrice;
    state.tradeCities['ironvale']!.pricesByProduct['tools'] = Math.round(base * 1.7);

    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'tools', quantity: 30 });
    expect(player.exportRevenueByCity['ironvale'] ?? 0).toBeGreaterThan(0);

    // Mission: $500 from Ironvale.
    const mission = getMissionDef('best_port_broker')!;
    player.exportRevenueByCity['ironvale'] = dollars(500);
    expect(mission.check(state)).toBe(true);

    // Achievement: $500 from each city.
    const ach = getAchievementDef('arbitrageur')!;
    expect(ach.check(state)).toBe(false);
    player.exportRevenueByCity['port_rosa'] = dollars(500);
    expect(ach.check(state)).toBe(true);
  });

  it('old saves default exportRevenueByCity to empty', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    for (const fid in raw.firms) delete raw.firms[fid].exportRevenueByCity;
    const loaded = deserialize(JSON.stringify(raw));
    for (const fid in loaded.firms) {
      expect(loaded.firms[fid]!.exportRevenueByCity).toEqual({});
    }
  });
});
