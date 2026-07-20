import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { runDividendSystem } from '../systems/DividendSystem';
import { marketCap } from '../selectors/companySelectors';
import { MAX_STAKE_PCT } from '../data/constants';

const TPD = 48;

describe('Stock market', () => {
  it('buying shares costs market-priced cash plus friction, and records the stake', () => {
    const sim = newSim(201);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    const fair = Math.max(1, Math.round(marketCap(state, target.id) / 100));
    const cashBefore = player.cash;
    const moneyBefore = totalMoneySupply(state);

    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target.id, percent: 10 });

    expect(player.sharesHeld[target.id]).toBe(10);
    const paid = cashBefore - player.cash;
    // Fair notional plus the 3% fee and half the order's own impact.
    expect(paid).toBeGreaterThan(fair * 10);
    expect(paid).toBeLessThanOrEqual(Math.round(fair * 10 * 1.06));
    expect(totalMoneySupply(state)).toBe(moneyBefore); // conserved
  });

  it('stake is capped and selling restores cash', () => {
    const sim = newSim(202);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Granite Industries');
    player.cash = 100_000_000; // plenty

    sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target.id, percent: 100 });
    expect(player.sharesHeld[target.id]).toBe(MAX_STAKE_PCT);

    const cashBefore = player.cash;
    sim.dispatch({ type: 'SELL_SHARES', firmId: player.id, targetFirmId: target.id, percent: 9 });
    expect(player.sharesHeld[target.id]).toBe(MAX_STAKE_PCT - 9);
    expect(player.cash).toBeGreaterThan(cashBefore);
  });

  it('shareholders receive their slice of daily profit as dividends', () => {
    const sim = newSim(203);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    player.sharesHeld[target.id] = 20; // direct stake for the test

    // Give the target a profitable completed day.
    target.accounting.today.revenue = 100_000;
    target.cash = 1_000_000;
    const playerCashBefore = player.cash;
    const moneyBefore = totalMoneySupply(state);

    state.tick = TPD; // day boundary
    runDividendSystem(makeContext(state));

    // 30% payout of 100,000 = 30,000 pool; 20% of pool = 6,000 to the player.
    expect(player.cash - playerCashBefore).toBe(6000);
    expect(totalMoneySupply(state)).toBe(moneyBefore);
  });

  it('no dividends when the firm made no profit', () => {
    const sim = newSim(204);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    player.sharesHeld[target.id] = 20;
    target.accounting.today.wages = 50_000; // pure loss day
    const before = player.cash;
    state.tick = TPD;
    runDividendSystem(makeContext(state));
    expect(player.cash).toBe(before);
  });
});
