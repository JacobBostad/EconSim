import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { worldTradePriceMult } from '../data/worldEvents';
import { runTradeCitySystem } from '../systems/TradeCitySystem';
import { performExport, impactedFillPrice, exportFreightFee } from '../core/Trade';
import { getProduct } from '../data/products';
import { addStock } from '../entities/Inventory';
import { createFacility } from '../entities/factories';
import { EXPORT_FREIGHT_FEE } from '../data/constants';

describe('Port Rosa follows world news', () => {
  it('worldTradePriceMult composes event biases', () => {
    const sim = newSim(4);
    const state = sim.getState();
    expect(worldTradePriceMult(state, 'grain')).toBe(1);
    state.worldEvents.push({ defId: 'drought', startDay: 0, endDay: 10 });
    expect(worldTradePriceMult(state, 'grain')).toBeCloseTo(1.5);
    expect(worldTradePriceMult(state, 'tools')).toBe(1);
    state.worldEvents.push({ defId: 'recession', startDay: 0, endDay: 10 });
    expect(worldTradePriceMult(state, 'grain')).toBeCloseTo(1.5 * 0.8);
    expect(worldTradePriceMult(state, 'tools')).toBeCloseTo(0.8);
  });

  it('a drought pulls Port Rosa grain prices up over a week', () => {
    const sim = newSim(4);
    const state = sim.getState();
    const base = getProduct('grain').basePrice;
    state.tradeCities['port_rosa']!.pricesByProduct['grain'] = base;
    state.worldEvents.push({ defId: 'drought', startDay: 0, endDay: 60 });
    const tpd = ticksPerDay(state.config);
    for (let d = 1; d <= 10; d++) {
      state.tick = tpd * d;
      runTradeCitySystem(makeContext(state));
    }
    // Reversion pulls toward 1.5× base; ten days is plenty to clear 1.15×.
    expect(state.tradeCities['port_rosa']!.pricesByProduct['grain']!).toBeGreaterThan(base * 1.15);
  });

  it('fuel spikes scale the export freight fee', () => {
    const sim = newSim(4);
    const state = sim.getState();
    expect(exportFreightFee(state)).toBeCloseTo(EXPORT_FREIGHT_FEE);
    state.worldEvents.push({ defId: 'fuel_spike', startDay: 0, endDay: 10 });
    expect(exportFreightFee(state)).toBeCloseTo(EXPORT_FREIGHT_FEE * 2.2);

    // And the fee actually bites on an export.
    const player = state.firms[state.playerFirmId]!;
    const wh = createFacility(state, 'warehouse', player.id, { x: 40, y: 40 });
    player.facilities.push(wh.id);
    addStock(wh.inputInventory, 'bread', 10, 60);
    state.tradeCities['port_rosa']!.pricesByProduct['bread'] = 1000;
    const revenue = performExport(state, player.id, wh.id, 'bread', 10);
    expect(revenue).toBe(Math.round(10 * impactedFillPrice(1000, 10, -1) * (1 - EXPORT_FREIGHT_FEE * 2.2)));
  });
});
