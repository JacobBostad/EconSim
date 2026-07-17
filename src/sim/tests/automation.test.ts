import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { CHAIN_BLUEPRINTS, chainCost } from '../data/chains';
import { getProduct } from '../data/products';

describe('Chain wizard & auto-pricing', () => {
  it('BUILD_CHAIN stands up a wired, staffed producer→factory→store', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const cost = chainCost(CHAIN_BLUEPRINTS['bread']!);
    const cashBefore = player.cash;
    const supplyBefore = totalMoneySupply(state);

    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });

    expect(player.facilities.length).toBe(3);
    expect(player.cash).toBe(cashBefore - cost);
    expect(totalMoneySupply(state)).toBe(supplyBefore);

    const facs = player.facilities.map((id) => state.facilities[id]!);
    const producer = facs.find((f) => f.type === 'farm')!;
    const factory = facs.find((f) => f.type === 'factory')!;
    const store = facs.find((f) => f.type === 'retail')!;
    expect(producer.activeRecipeId).toBe('grow_grain');
    expect(factory.activeRecipeId).toBe('bake_bread');
    expect(store.retailProductId).toBe('bread');
    expect(producer.employees.length).toBeGreaterThan(0);
    expect(store.employees.length).toBe(1);
    expect(player.pricesByProduct['bread']).toBe(getProduct('bread').basePrice);

    const mine = new Set(player.facilities);
    const contracts = Object.values(state.contracts).filter((c) => mine.has(c.destinationFacilityId));
    expect(contracts.length).toBe(2);

    // The chain actually produces and sells within a few days.
    sim.run(ticksPerDay(state.config) * 4 + 1);
    expect(player.accounting.lifetime.revenue).toBeGreaterThan(0);
  });

  it('BUILD_CHAIN refuses politely without cash', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'tools' });
    expect(player.facilities.length).toBe(0);
    expect(player.cash).toBe(100);
  });

  it('auto-price raises the player price after a sellout day', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    const store = player.facilities
      .map((id) => state.facilities[id]!)
      .find((f) => f.type === 'retail')!;

    sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: player.id, productId: 'bread', enabled: true });
    const before = player.pricesByProduct['bread']!;

    // Forge a sellout day and run the daily strategy pass directly.
    store.dailyStats.unitsSold = 30;
    store.dailyStats.lostSales = 12;
    store.inputInventory = {}; // empty shelves
    state.tick = ticksPerDay(state.config);
    runAIStrategySystem(makeContext(state));
    expect(player.pricesByProduct['bread']!).toBeGreaterThan(before);

    // Toggle off: price stays put on the next forged sellout.
    sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: player.id, productId: 'bread', enabled: false });
    const frozen = player.pricesByProduct['bread']!;
    store.dailyStats.unitsSold = 30;
    store.dailyStats.lostSales = 12;
    state.tick = ticksPerDay(state.config) * 2;
    runAIStrategySystem(makeContext(state));
    expect(player.pricesByProduct['bread']!).toBe(frozen);
  });
});
