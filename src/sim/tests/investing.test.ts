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
  it('buying a stake at market costs only the trading friction, not the stake', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);

    const before = companyValuation(state, player.id);
    expect(before.holdingsValue).toBe(0);
    const cash0 = player.cash;
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });

    const after = companyValuation(state, player.id);
    const paid = cash0 - player.cash;
    expect(player.sharesHeld[target]).toBe(10);
    expect(player.shareCostBasis[target]).toBe(paid); // all-in cost, fees included
    // Cash out, a near-equal mark in: only the fee + half-impact (~5%) is
    // consumed — nothing like the old full-purchase-price crater.
    expect(after.holdingsValue).toBe(Math.round((10 * marketCap(state, target)) / 100));
    const drop = before.valuation - after.valuation;
    expect(drop).toBeGreaterThan(0); // friction is real
    expect(drop).toBeLessThanOrEqual(Math.round(paid * 0.08)); // and bounded
    // The buy pushed the resting quote up (mean-reverts daily).
    expect(state.sharePriceShift[target]).toBeCloseTo(0.04, 5);
  });

  it('the round-trip timing exploit is dead: buy + immediate sell loses the spread', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    const cash0 = player.cash;
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    sim.dispatch({ type: 'SELL_SHARES', firmId: player.id, targetFirmId: target, percent: 10 });
    const loss = cash0 - player.cash;
    // Two 3% fees plus walking the impact curve both ways: ~5%+ of notional.
    const notional = Math.round((10 * marketCap(state, target)) / 100);
    expect(loss).toBeGreaterThanOrEqual(Math.round(notional * 0.04));
    expect(player.sharesHeld[target]).toBeUndefined();
  });

  it('price displacement decays back to fair value day by day', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    const target = firstAiId(state);
    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 20 });
    const shift0 = state.sharePriceShift[target]!;
    expect(shift0).toBeGreaterThan(0);
    sim.run(ticksPerDay(state.config));
    const shift1 = state.sharePriceShift[target] ?? 0;
    expect(shift1).toBeLessThan(shift0);
    // Old saves default the displacement map to empty.
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.sharePriceShift;
    expect(deserialize(JSON.stringify(raw)).sharePriceShift).toEqual({});
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
    // The player's own share price now includes the stake it holds (no one
    // traded PLAYER shares, so its quote sits exactly at fair value).
    expect(state.sharePriceShift[player.id]).toBeUndefined();
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
      towns: { home: { firms: Record<string, Record<string, unknown>> } };
    };
    const home = raw.towns.home; // the six families live under towns.home now
    for (const fid in home.firms) {
      const f = home.firms[fid]!;
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
