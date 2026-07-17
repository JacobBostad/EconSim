import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName, findFacilityByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { getQuantity, addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';

describe('AI exports to Port Rosa', () => {
  it('a glutted AI facility exports when the trade price is high', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    addStock(bakery.outputInventory, 'bread', 80, 60);
    state.tradeCity.pricesByProduct['bread'] = Math.round(getProduct('bread').basePrice * 1.5);
    const cashBefore = foods.cash;
    const supply0 = totalMoneySupply(state);

    state.tick = ticksPerDay(state.config); // day boundary
    runAIStrategySystem(makeContext(state));

    expect(foods.cash).toBeGreaterThan(cashBefore);
    expect(foods.exportRevenue).toBeGreaterThan(0);
    expect(getQuantity(bakery.outputInventory, 'bread')).toBeLessThan(80 + 24);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('no export when Port Rosa prices are unattractive', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    addStock(bakery.outputInventory, 'bread', 80, 60);
    state.tradeCity.pricesByProduct['bread'] = getProduct('bread').basePrice; // 1.0×
    state.tick = ticksPerDay(state.config);
    runAIStrategySystem(makeContext(state));
    expect(foods.exportRevenue).toBe(0);
  });
});
