import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { companyValuation, marketCap } from '../selectors/companySelectors';
import { sharePricePerPct } from '../core/Shares';
import { netProfit } from '../entities/Accounting';
import { serialize, deserialize } from '../persistence/saveLoad';

function firstAiId(state: ReturnType<ReturnType<typeof newSim>['getState']>): string {
  return Object.keys(state.firms)
    .sort()
    .find((id) => state.firms[id]!.ownerType === 'ai')!;
}

describe('Investing: stakes on the balance sheet', () => {
  it('buying a stake at market leaves the buyer valuation unchanged', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);

    const before = companyValuation(state, player.id);
    expect(before.holdingsValue).toBe(0);
    const price = sharePricePerPct(state, target);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });

    const after = companyValuation(state, player.id);
    expect(player.sharesHeld[target]).toBe(10);
    expect(player.shareCostBasis[target]).toBe(10 * price);
    // Cash out, an equal mark in: the scoreboard no longer punishes investing.
    expect(after.holdingsValue).toBe(Math.round((10 * marketCap(state, target)) / 100));
    expect(after.holdingsValue).toBeGreaterThan(0);
    expect(Math.abs(after.valuation - before.valuation)).toBeLessThanOrEqual(100); // rounding cents only
  });

  it('a holding company tracks its portfolio: target grows, holder grows', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 20 });

    const v0 = companyValuation(state, player.id);
    state.firms[target]!.cash += 50000_00; // the target strikes gold
    const v1 = companyValuation(state, player.id);
    expect(v1.holdingsValue - v0.holdingsValue).toBe(Math.round((20 * 50000_00) / 100));
    expect(v1.valuation).toBeGreaterThan(v0.valuation);
  });

  it('selling reports realized gain against cost basis and releases it pro-rata', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    const basis0 = player.shareCostBasis[target]!;

    state.firms[target]!.cash += 100000_00; // stake appreciates
    sim.dispatch({ type: 'SELL_SHARES', firmId: player.id, targetFirmId: target, percent: 5 });
    expect(player.sharesHeld[target]).toBe(5);
    expect(player.shareCostBasis[target]).toBe(basis0 - Math.round(basis0 / 2));
    expect(state.events.some((e) => e.message.includes('gain on cost'))).toBe(true);

    sim.dispatch({ type: 'SELL_SHARES', firmId: player.id, targetFirmId: target, percent: 5 });
    expect(player.sharesHeld[target]).toBeUndefined();
    expect(player.shareCostBasis[target]).toBeUndefined();
  });

  it('share trades conserve money and land in the books, not the P&L', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const supply0 = totalMoneySupply(state);
    const target = firstAiId(state);
    const profit0 = netProfit(player.accounting.today);

    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    sim.dispatch({ type: 'SELL_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.accounting.today.shareBuy).toBeGreaterThan(0);
    expect(player.accounting.today.shareSell).toBeGreaterThan(0);
    expect(netProfit(player.accounting.today)).toBe(profit0); // balance-sheet only
  });

  it('dividends are investment income: they enter the holder net profit', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 20 });

    // Hand the target a steady profitable week so the smoothed pool is fat.
    const payer = state.firms[target]!;
    payer.cash = 50000_00;
    for (const d of payer.accounting.dailyHistory) d.netProfit = Math.max(d.netProfit, 2000_00);
    if (payer.accounting.dailyHistory.length === 0) {
      payer.accounting.today.revenue += 2000_00;
    }
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config));

    expect(player.accounting.lifetime.dividendIn).toBeGreaterThan(0);
    expect(payer.accounting.lifetime.dividendOut).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
    // The payer's distribution never reduces its own net profit — dividendOut
    // is absent from the formula, dividendIn is income.
    const p = payer.accounting.lifetime;
    expect(netProfit(p)).toBe(
      p.revenue - p.costOfGoodsSold - p.wages - p.maintenance - p.logisticsCost -
      p.variableProductionCost - p.marketing - p.rnd - p.interest + p.dividendIn,
    );
  });

  it('share price equals marketCap per percent — a holding company sells for its portfolio', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    // The player's own share price now includes the stake it holds.
    expect(sharePricePerPct(state, player.id)).toBe(
      Math.max(1, Math.round(marketCap(state, player.id) / 100)),
    );
    expect(marketCap(state, player.id)).toBeGreaterThan(0);
  });

  it('cost basis and ledger fields migrate: old saves get marks at current price', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });

    const raw = JSON.parse(serialize(state)) as {
      firms: Record<string, Record<string, unknown>>;
    };
    for (const fid in raw.firms) {
      const f = raw.firms[fid]!;
      delete f.shareCostBasis;
      const acc = f.accounting as { lifetime: Record<string, unknown>; today: Record<string, unknown> };
      delete acc.lifetime.dividendIn;
      delete acc.today.shareBuy;
    }
    const loaded = deserialize(JSON.stringify(raw));
    const p2 = loaded.firms[loaded.playerFirmId]!;
    expect(p2.accounting.lifetime.dividendIn).toBe(0);
    expect(p2.accounting.today.shareBuy).toBe(0);
    // Pre-tracking stakes are marked at today's price, not zero.
    expect(p2.shareCostBasis[target]).toBe(
      Math.round((10 * marketCap(loaded, target)) / 100),
    );
  });
});
