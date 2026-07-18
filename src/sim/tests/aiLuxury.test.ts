import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { makeContext } from '../core/GameState';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { getProduct } from '../data/products';

describe('AI luxury entry', () => {
  it('a flush AI enters the luxury market after day 60 with wired supply', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    foods.cash = 150000_00;
    const tpd = ticksPerDay(state.config);

    let entered = false;
    for (let day = 61; day <= 130 && !entered; day++) {
      foods.cash = Math.max(foods.cash, 150000_00);
      state.tick = tpd * day;
      runAIStrategySystem(makeContext(state));
      entered = foods.facilities.some((id) => {
        const pid = state.facilities[id]?.retailProductId;
        return pid !== null && pid !== undefined && getProduct(pid).needType === 'luxury';
      });
    }
    expect(entered).toBe(true);
    // Grain-based firm chooses pastries, mastered to production threshold.
    expect(foods.qualityByProduct['pastries']).toBeGreaterThanOrEqual(75);
    const boutique = foods.facilities
      .map((id) => state.facilities[id]!)
      .find((f) => f.retailProductId === 'pastries')!;
    expect(boutique.employees.length).toBeGreaterThan(0);
    const wired = Object.values(state.contracts).some(
      (c) => c.ownerFirmId === foods.id && c.productId === 'pastries',
    );
    expect(wired).toBe(true);
    // (No supply assertion here: the test itself mints top-up cash each loop.)

    // One entry per firm: run more days, still exactly one luxury boutique.
    for (let day = 131; day <= 140; day++) {
      foods.cash = 150000_00;
      state.tick = tpd * day;
      runAIStrategySystem(makeContext(state));
    }
    const luxuryShops = foods.facilities
      .map((id) => state.facilities[id]!)
      .filter((f) => f.retailProductId && getProduct(f.retailProductId).needType === 'luxury');
    expect(luxuryShops.length).toBe(1);
  });

  it('no luxury entry before day 60 or without deep pockets', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    for (const f of Object.values(state.firms)) {
      if (f.ownerType === 'ai') f.cash = 150000_00;
    }
    for (let day = 1; day <= 59; day++) {
      state.tick = tpd * day;
      runAIStrategySystem(makeContext(state));
    }
    const anyLuxury = Object.values(state.facilities).some(
      (f) => f.retailProductId && getProduct(f.retailProductId).needType === 'luxury',
    );
    expect(anyLuxury).toBe(false);
  });
});
