import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { morningBriefing } from '../selectors/advisorSelectors';
import { addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';

describe('morningBriefing', () => {
  it('flags a losing day with its dominant cost', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.accounting.dailyHistory.push({
      day: 3, revenue: 1000, costOfGoodsSold: 0, wages: 8000, maintenance: 900,
      logisticsCost: 0, variableProductionCost: 0, marketing: 0, rnd: 0, interest: 0,
      grossProfit: 1000, operatingProfit: -7900, netProfit: -7900,
      cash: 100000, debt: 0, inventoryValue: 0, valuation: 100000, buildSpend: 0,
    });
    const advice = morningBriefing(state);
    const money = advice.find((a) => a.icon === '📉');
    expect(money).toBeTruthy();
    expect(money!.severity).toBe('danger');
    expect(money!.text).toContain('wages');
  });

  it('flags heavy debt service', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.debt = 50000_00;
    player.accounting.dailyHistory.push({
      day: 3, revenue: 20000, costOfGoodsSold: 0, wages: 0, maintenance: 0,
      logisticsCost: 0, variableProductionCost: 0, marketing: 0, rnd: 0, interest: 4500,
      grossProfit: 20000, operatingProfit: 15500, netProfit: 15500,
      cash: 100000, debt: 50000_00, inventoryValue: 0, valuation: 100000, buildSpend: 0,
    });
    const advice = morningBriefing(state);
    const debtLine = advice.find((a) => a.icon === '🏦');
    expect(debtLine).toBeTruthy();
    expect(debtLine!.severity).toBe('warning');
    expect(debtLine!.text).toContain('Debt service');
  });

  it('flags a facility blocked all day and a poach-risk wage gap', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    const farm = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'farm')!;
    // The advisor reads the closed-day snapshot, not mid-day partials.
    farm.yesterdayStats.ticksActive = 0;
    farm.yesterdayStats.bottleneck = 'No workers present (need 2)';
    const rival = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    rival.wagePolicy.baseWage = Math.round(player.wagePolicy.baseWage * 1.3);

    const advice = morningBriefing(state);
    expect(advice.some((a) => a.icon === '🏭' && a.text.includes(farm.name))).toBe(true);
    expect(advice.some((a) => a.icon === '🤝')).toBe(true);
  });

  it('spots a Port Rosa premium for goods the player holds, and caps at 5 items', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    const factory = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'factory')!;
    addStock(factory.outputInventory, 'bread', 40, 60);
    state.tradeCities['port_rosa']!.pricesByProduct['bread'] = Math.round(getProduct('bread').basePrice * 1.5);

    const advice = morningBriefing(state);
    expect(advice.some((a) => a.icon === '🚢' && a.text.includes('Bread'))).toBe(true);
    expect(advice.length).toBeLessThanOrEqual(5);
    // Severity ordering: dangers before infos.
    const sevRank = advice.map((a) => ({ danger: 0, warning: 1, info: 2 })[a.severity]);
    for (let i = 1; i < sevRank.length; i++) expect(sevRank[i - 1]!).toBeLessThanOrEqual(sevRank[i]!);
  });
});
