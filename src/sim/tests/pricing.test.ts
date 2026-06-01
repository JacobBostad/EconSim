import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { addStock } from '../entities/Inventory';

describe('AIStrategySystem pricing', () => {
  it('raises price after sellouts / lost sales', () => {
    const sim = newSim(31);
    const state = sim.getState();
    state.tick = state.config.ticksPerHour * 24; // day boundary
    const shop = findFacilityByName(state, 'Granite Hardware');
    const firm = state.firms[shop.ownerFirmId]!;
    firm.pricesByProduct.tools = 900;
    // Was actively selling and then ran out: genuine excess demand.
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'tools', 2, 65);
    shop.dailyStats.unitsSold = 8;
    shop.dailyStats.lostSales = 6;

    runAIStrategySystem(makeContext(state));

    expect(firm.pricesByProduct.tools!).toBeGreaterThan(900);
  });

  it('lowers price when inventory is glutted', () => {
    const sim = newSim(32);
    const state = sim.getState();
    state.tick = state.config.ticksPerHour * 24;
    const shop = findFacilityByName(state, 'Granite Hardware');
    const firm = state.firms[shop.ownerFirmId]!;
    firm.pricesByProduct.tools = 900;
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'tools', Math.ceil(shop.storageCapacity * 0.7), 65);
    shop.dailyStats.lostSales = 0;

    runAIStrategySystem(makeContext(state));

    expect(firm.pricesByProduct.tools!).toBeLessThan(900);
  });

  it('keeps prices within configured bounds', () => {
    const sim = newSim(33);
    const state = sim.getState();
    const shop = findFacilityByName(state, 'Granite Hardware');
    const firm = state.firms[shop.ownerFirmId]!;
    const base = 900;
    firm.pricesByProduct.tools = base * 5; // absurd
    shop.dailyStats.lostSales = 10;
    state.tick = state.config.ticksPerHour * 24;

    runAIStrategySystem(makeContext(state));

    expect(firm.pricesByProduct.tools!).toBeLessThanOrEqual(base * state.config.aiPriceCeilMult);
  });
});
