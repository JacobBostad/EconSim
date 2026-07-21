import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import type { GameState } from '../core/GameState';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { runAIFounderSystem } from '../systems/AIFounderSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { runInvestorBehavior } from '../systems/ai/investor';
import { companyValuation, operatingValuationOf, marketCap } from '../selectors/companySelectors';
import { emptyStrategy } from '../entities/Firm';
import { emptyAccounting } from '../entities/Accounting';
import { MAX_STAKE_PCT, INVESTOR_SIGNAL_DAYS } from '../data/constants';
import { nextId } from '../core/Id';

/**
 * Arc D3 — the investor (holdco) archetype. Four pins:
 *  1. holdco valuation: a zero-facility firm is valued at portfolio mark + cash,
 *     sanely (no crash, no negative-facility nonsense);
 *  2. the founder gate: opt-in (investorsEnabled) AND city-scale — off in every
 *     pinned baseline;
 *  3. cap compliance: a holdco's buying respects MAX_STAKE_PCT, the float ledger,
 *     and conservation (it routes through tradeShares like everyone else);
 *  4. a distressed investor liquidates its book before going insolvent.
 */

const investorCount = (s: GameState) =>
  Object.values(s.firms).filter((f) => f.strategy.archetype === 'investor').length;

/** A city sim with the D3 holdco archetype opted in. */
function cityInvestorSim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', investorsEnabled: true }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** Give every real firm a fat trailing yield so the median-yield founder signal
 * clears its bar — a healthy `today` revenue with no costs makes
 * smoothedProfitBase (which falls back to today before any history) large
 * relative to marketCap, so base/marketCap sits well above INVESTOR_YIELD_BAR. */
function pinFatYields(state: GameState, dailyNet = 40000): void {
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
    f.bankruptcyStatus = 'healthy';
    f.accounting.dailyHistory = [];
    f.accounting.today = { ...emptyAccounting().today, revenue: dailyNet };
  }
}

/** Drive only the founder system across day boundaries with the town pinned
 * prosperous, so the shared gates are open and the investor row is isolated. */
function runFounderDays(state: GameState, days: number): void {
  const tpd = ticksPerDay(state.config);
  for (let i = 0; i < days; i++) {
    state.tick += tpd - (state.tick % tpd || tpd) + tpd;
    for (const c of Object.values(state.citizens)) c.satisfaction = 70;
    for (const cid in state.cohorts) state.cohorts[cid]!.avgSatisfaction = 70;
    runAIFounderSystem(makeContext(state));
  }
}

describe('D3 investor — holdco valuation', () => {
  it('values a zero-facility firm at cash + portfolio mark, no crash', () => {
    const sim = cityInvestorSim(11);
    const state = sim.getState();
    const target = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;

    // A pure holdco: no facilities, some cash, a stake in a rival.
    const id = nextId(state.idCounters, 'firm');
    state.firms[id] = {
      ...target, id, name: 'Test Holdco', facilities: [], employees: [],
      cash: 50000_00, debt: 0, sharesHeld: { [target.id]: 20 },
      shareCostBasis: { [target.id]: 8000_00 }, accounting: emptyAccounting(),
      strategy: emptyStrategy('none', 'investor'),
    };

    const opVal = operatingValuationOf(state, id);
    const val = companyValuation(state, id);
    // Operating tier: no facilities/inventory ⇒ just cash (no debt, flat history).
    expect(opVal).toBe(50000_00);
    // Scoreboard: cash + the stake marked at the target's marketCap/100 × 20.
    const expectedHoldings = Math.round((20 * marketCap(state, target.id)) / 100);
    expect(val.holdingsValue).toBe(expectedHoldings);
    expect(val.assetValue).toBe(0);
    expect(val.valuation).toBe(50000_00 + expectedHoldings);
    expect(val.valuation).toBeGreaterThan(0);
  });
});

describe('D3 investor — founder gate', () => {
  it('an opted-in city founds a holdco under a sustained fat-yield signal — conserved', () => {
    const sim = cityInvestorSim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const before = investorCount(state);
    pinFatYields(state);
    runFounderDays(state, INVESTOR_SIGNAL_DAYS + 40);

    expect(investorCount(state)).toBeGreaterThan(before);
    const holdco = Object.values(state.firms).find((f) => f.strategy.archetype === 'investor')!;
    expect(holdco.facilities.length).toBe(0); // a pure holdco owns nothing to run
    expect(holdco.ownerType).toBe('ai');
    expect(totalMoneySupply(state)).toBe(supply0); // founding capital is conserved
    expect(state.events.some((e) => e.message.includes('investment firm'))).toBe(true);
  });

  it('never founds a holdco with the flag off (the pinned-baseline default)', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' }); // investorsEnabled defaults false
    new Simulation(state).dispatch({ type: 'RESUME' });
    pinFatYields(state);
    runFounderDays(state, INVESTOR_SIGNAL_DAYS + 40);
    expect(investorCount(state)).toBe(0);
    expect(state.investorSignalDays).toBe(0); // the streak counter is never even touched
  });

  it('never founds a holdco at Village or Metropolis, even opted in', () => {
    for (const preset of ['village', 'metropolis'] as const) {
      const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: preset, investorsEnabled: true });
      new Simulation(state).dispatch({ type: 'RESUME' });
      pinFatYields(state);
      runFounderDays(state, INVESTOR_SIGNAL_DAYS + 40);
      expect(investorCount(state)).toBe(0);
      expect(state.investorSignalDays).toBe(0);
    }
  });
});

describe('D3 investor — behavior & caps', () => {
  it('a holdco ladders yield stakes within MAX_STAKE_PCT and the 100% float, conserved', () => {
    const sim = cityInvestorSim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20); // let the world populate + earn

    // Turn a healthy AI firm into a well-funded holdco and run its loop a while.
    const holdco = Object.values(state.firms).find(
      (f) => f.ownerType === 'ai' && f.bankruptcyStatus === 'healthy',
    )!;
    holdco.strategy.archetype = 'investor';
    holdco.cash = 200000_00;
    const supply0 = totalMoneySupply(state);

    for (let d = 0; d < 40; d++) {
      state.tick = ticksPerDay(state.config) * (d + 1);
      runInvestorBehavior(makeContext(state), holdco.id, undefined);
    }

    let bought = false;
    const floatByTarget: Record<string, number> = {};
    for (const fid in state.firms) {
      const f = state.firms[fid]!;
      for (const tid of Object.keys(f.sharesHeld)) {
        const pct = f.sharesHeld[tid] ?? 0;
        if (pct > 0 && fid === holdco.id) bought = true;
        expect(pct).toBeLessThanOrEqual(MAX_STAKE_PCT);
        floatByTarget[tid] = (floatByTarget[tid] ?? 0) + pct;
      }
    }
    expect(bought).toBe(true); // the holdco actually deployed into the book
    for (const tid of Object.keys(floatByTarget)) {
      expect(floatByTarget[tid]!).toBeLessThanOrEqual(100);
    }
    expect(totalMoneySupply(state)).toBe(supply0); // every trade conserved
  });
});

describe('D3 investor — distress liquidation', () => {
  it('a distressed holdco sells its whole portfolio before going insolvent', () => {
    const sim = cityInvestorSim(4);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20);

    const holdco = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    const target = Object.values(state.firms).find(
      (f) => (f.ownerType === 'ai' || f.ownerType === 'player') && f.id !== holdco.id,
    )!;
    holdco.strategy.archetype = 'investor';
    holdco.sharesHeld[target.id] = 15;
    holdco.shareCostBasis[target.id] = 600_00;
    holdco.cash = -50_00; // underwater
    holdco.daysInsolvent = state.config.insolvencyCloseDays - 1; // +1 this tick trips the close
    holdco.bankruptcyStatus = 'distressed';
    const supply0 = totalMoneySupply(state);

    state.tick = ticksPerDay(state.config);
    runBankruptcySystem(makeContext(state));

    // The book was liquidated at market and cash recovered — the holdco's exit is
    // selling equity, not shuttering anything (it owns no facilities to shutter).
    expect(holdco.sharesHeld[target.id] ?? 0).toBe(0);
    expect(holdco.cash).toBeGreaterThanOrEqual(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
