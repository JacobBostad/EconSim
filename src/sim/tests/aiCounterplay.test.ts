import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';

describe('AI counterplay', () => {
  it('raises ad budgets when losing the market and flush', () => {
    // Drive the system directly: in a live tick MarketStats would recompute
    // the (real) 100% share before the AI acts, overwriting the setup.
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    foods.cash = 50000_00;
    foods.marketShareByProduct['bread'] = 0.2; // losing badly
    const before = foods.adBudgetByProduct['bread'] ?? 0;
    state.tick = ticksPerDay(state.config); // a day boundary
    runAIStrategySystem(makeContext(state));
    expect(foods.adBudgetByProduct['bread']!).toBeGreaterThan(before);
  });

  it('cuts ad spend toward the floor when dominant', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    foods.cash = 50000_00;
    foods.adBudgetByProduct['bread'] = 30_00;
    foods.marketShareByProduct['bread'] = 0.95;
    sim.run(ticksPerDay(state.config) + 1);
    expect(foods.adBudgetByProduct['bread']!).toBeLessThan(30_00);
  });

  it('answers a rival quality lead with R&D', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    foods.cash = 60000_00;
    // Player leaps ahead on bread quality.
    state.firms[state.playerFirmId]!.qualityByProduct['bread'] = 90;
    const before = foods.qualityByProduct['bread']!;
    sim.run(ticksPerDay(state.config) * 3 + 1);
    expect(foods.qualityByProduct['bread']!).toBeGreaterThan(before);
  });

  it('flush AI firms buy rival stakes over time (money conserved)', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    for (const f of Object.values(state.firms)) {
      if (f.ownerType === 'ai') f.cash = 120000_00;
    }
    const supplyFunded = totalMoneySupply(state);
    expect(supplyFunded).toBeGreaterThan(supply0);
    sim.run(ticksPerDay(state.config) * 40 + 1);

    const stakes = Object.values(state.firms)
      .filter((f) => f.ownerType === 'ai')
      .flatMap((f) => Object.values(f.sharesHeld));
    expect(stakes.some((pct) => pct > 0)).toBe(true);
    expect(stakes.every((pct) => pct <= 25)).toBe(true);
    expect(totalMoneySupply(state)).toBe(supplyFunded);
  });
});
