import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { runDividendSystem } from '../systems/DividendSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { tradeShares } from '../core/Shares';
import { MAX_STAKE_PCT } from '../data/constants';
import { findFirmByName } from './helpers';
import type { GameState } from '../core/GameState';

/** A running City-preset sim (Arc B2 market behaviors ON), resumed. */
function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** Total percent of `targetId` held across every firm (the public-float ledger). */
function aggregateFloat(state: GameState, targetId: string): number {
  let agg = 0;
  for (const fid in state.firms) agg += state.firms[fid]!.sharesHeld[targetId] ?? 0;
  return agg;
}

describe('Arc B2 — AI portfolio behavior (city scale)', () => {
  it('AI firms accumulate dividend stakes within the cap and the 100% float, money conserved', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 150);

    let anyStake = false;
    const floatByTarget: Record<string, number> = {};
    for (const fid in state.firms) {
      const f = state.firms[fid]!;
      for (const tid of Object.keys(f.sharesHeld)) {
        const pct = f.sharesHeld[tid] ?? 0;
        if (pct > 0) anyStake = true;
        // MAX_STAKE_PCT cap is respected by every single holding.
        expect(pct).toBeLessThanOrEqual(MAX_STAKE_PCT);
        floatByTarget[tid] = (floatByTarget[tid] ?? 0) + pct;
        // A holder never buys a stake in a firm that no longer exists.
        expect(state.firms[tid]).toBeTruthy();
      }
    }
    // The yield-buying path actually fires in a live city.
    expect(anyStake).toBe(true);
    // Float ledger: aggregate outside holdings of one target never exceed 100%.
    for (const tid of Object.keys(floatByTarget)) {
      expect(floatByTarget[tid]!).toBeLessThanOrEqual(100);
    }
    // No portfolio churn minted or burned a cent across 150 days.
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('a distressed AI sells its whole portfolio at market before any facility is closed', () => {
    const sim = citySim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20); // let the world populate

    const firm = Object.values(state.firms).find(
      (f) => f.ownerType === 'ai' && f.facilities.some((id) => state.facilities[id]?.status !== 'closed'),
    )!;
    const target = Object.values(state.firms).find(
      (f) => (f.ownerType === 'ai' || f.ownerType === 'player') && f.id !== firm.id,
    )!;

    // Give it a real portfolio and drive it straight to the insolvency-close step.
    firm.sharesHeld[target.id] = 12;
    firm.shareCostBasis[target.id] = 500_00;
    firm.cash = -50_00;
    firm.daysInsolvent = state.config.insolvencyCloseDays - 1; // +1 this tick trips the close
    firm.bankruptcyStatus = 'distressed';
    const openBefore = firm.facilities.filter((id) => state.facilities[id]?.status !== 'closed').length;
    const supply0 = totalMoneySupply(state);

    state.tick = ticksPerDay(state.config); // day boundary
    runBankruptcySystem(makeContext(state));

    // Liquid assets went first: the stake is gone.
    expect(firm.sharesHeld[target.id] ?? 0).toBe(0);
    // The sale lifted cash back to solvency, so no facility was shuttered — the
    // reprieve a real operator buys by selling shares instead of closing shops.
    const openAfter = firm.facilities.filter((id) => state.facilities[id]?.status !== 'closed').length;
    expect(firm.cash).toBeGreaterThanOrEqual(0);
    expect(openAfter).toBe(openBefore);
    // Conserved through the liquidation.
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('dividend payout stance differs by persona — an income persona pays holders more than a growth persona', () => {
    const sim = citySim(3);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);

    const ais = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    const income = ais[0]!; // exporter stance (dividendMult 1.15)
    const growth = ais[1]!; // expansionist stance (dividendMult 0.85)
    income.personalityId = 'exporter';
    growth.personalityId = 'expansionist';

    // Identical earnings and ample cash for both payers.
    for (const p of [income, growth]) {
      p.accounting.dailyHistory = [];
      p.accounting.today.revenue = 100_000;
      p.accounting.today.costOfGoodsSold = 0;
      p.cash = 1_000_000;
    }
    // The player holds the same 20% of each payer.
    const holder = state.firms[state.playerFirmId]!;
    holder.sharesHeld[income.id] = 20;
    holder.sharesHeld[growth.id] = 20;

    const supply0 = totalMoneySupply(state);
    const txBefore = state.transactions.length;
    state.tick = tpd; // day boundary
    runDividendSystem(makeContext(state));

    const receiptFrom = (payerId: string): number =>
      state.transactions
        .slice(txBefore)
        .filter((t) =>
          t.category === 'dividendOut' &&
          t.firmId === payerId &&
          t.to.kind === 'firm' &&
          t.to.id === holder.id,
        )
        .reduce((s, t) => s + t.amount, 0);

    const incomePaid = receiptFrom(income.id);
    const growthPaid = receiptFrom(growth.id);
    expect(incomePaid).toBeGreaterThan(0);
    expect(growthPaid).toBeGreaterThan(0);
    // Same profit, same stake — the income persona distributes more to holders.
    expect(incomePaid).toBeGreaterThan(growthPaid);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('the city float ledger caps aggregate outside holdings at 100% with first-come priority', () => {
    const sim = citySim(5);
    const state = sim.getState();
    const target = findFirmByName(state, 'Sunrise Foods');
    const holders = Object.values(state.firms)
      .filter((f) => (f.ownerType === 'ai' || f.ownerType === 'player') && f.id !== target.id)
      .slice(0, 3);
    for (const h of holders) h.cash = 1_000_000_00;

    const supply0 = totalMoneySupply(state);
    // Three holders each try for the 49% partial cap — 147% of a company that
    // only has 100% to give. The float ledger clamps the latecomer.
    for (const h of holders) tradeShares(state, h.id, target.id, MAX_STAKE_PCT);

    // First two get their full 49%; the third is clamped to the 2% remaining.
    expect(holders[0]!.sharesHeld[target.id]).toBe(MAX_STAKE_PCT);
    expect(holders[1]!.sharesHeld[target.id]).toBe(MAX_STAKE_PCT);
    expect(aggregateFloat(state, target.id)).toBeLessThanOrEqual(100);
    // Every holding still respects the per-holder partial cap.
    for (const h of holders) expect(h.sharesHeld[target.id] ?? 0).toBeLessThanOrEqual(MAX_STAKE_PCT);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
