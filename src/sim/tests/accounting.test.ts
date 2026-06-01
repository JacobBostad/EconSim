import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import type { LedgerCategory } from '../core/Transactions';

describe('AccountingSystem consistency', () => {
  it('firm lifetime accounting matches the transaction history', () => {
    const sim = newSim(61);
    sim.run(state_days(sim, 3));
    const state = sim.getState();
    expect(state.transactions.length).toBeLessThan(state.config.maxTransactions);

    const firm = findFirmByName(state, 'Sunrise Foods');
    const totals = {
      revenue: 0,
      cogs: 0,
      wages: 0,
      maintenance: 0,
      logistics: 0,
      variableCost: 0,
      buildSpend: 0,
    };
    for (const txn of state.transactions) {
      if (txn.firmId !== firm.id) continue;
      addToBucket(totals, txn.category, txn.amount);
    }

    const acc = firm.accounting.lifetime;
    expect(acc.revenue).toBe(totals.revenue);
    expect(acc.costOfGoodsSold).toBe(totals.cogs);
    expect(acc.wages).toBe(totals.wages);
    expect(acc.maintenance).toBe(totals.maintenance);
    expect(acc.logisticsCost).toBe(totals.logistics);
    expect(acc.variableProductionCost).toBe(totals.variableCost);
  });

  it('conserves total money supply across the whole economy', () => {
    const sim = newSim(62);
    const before = totalMoneySupply(sim.getState());
    sim.run(state_days(sim, 5));
    const after = totalMoneySupply(sim.getState());
    expect(after).toBe(before);
  });
});

function state_days(sim: ReturnType<typeof newSim>, days: number): number {
  return sim.getState().config.ticksPerHour * 24 * days;
}

function addToBucket(
  totals: Record<string, number>,
  category: LedgerCategory,
  amount: number,
): void {
  switch (category) {
    case 'revenue': totals.revenue! += amount; break;
    case 'cogs': case 'importPurchase': totals.cogs! += amount; break;
    case 'wages': totals.wages! += amount; break;
    case 'maintenance': totals.maintenance! += amount; break;
    case 'logistics': totals.logistics! += amount; break;
    case 'variableCost': totals.variableCost! += amount; break;
    case 'buildSpend': totals.buildSpend! += amount; break;
    case 'none': break;
  }
}
