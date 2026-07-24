import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

import { LOAN_MIN_CREDIT } from '../data/constants';
import {
  BASE_RATE,
  SPREAD_SLOPE,
  LEVERAGE_CAP,
  MIN_NET_WORTH,
  firmLeverage,
  effectiveRateForLeverage,
  effectiveRateForDebt,
  effectiveInterestRatePerDay,
  chargedInterestRatePerDay,
  annualRatePercent,
  loanNetWorth,
} from '../systems/interestRates';

/**
 * Risk-tiered loan pricing (docs/design/interest-rates.md, phases 1+2).
 *
 * The formula: a cheap first (unlevered) dollar rising to the old flat rate
 * exactly at the credit-limit leverage. Behind config flag
 * `riskTieredInterestEnabled`. Flag OFF is byte-identical to the pre-formula
 * flat rate; the four pins are bit-identical flag-ON (no firm on the pinned
 * paths ever borrows, so the interest transaction is never reached).
 */

function villageCfg(tiered: boolean) {
  return { ...DEFAULT_CONFIG, riskTieredInterestEnabled: tiered };
}
function cityCfg(tiered: boolean) {
  return { ...DEFAULT_CONFIG, sizePreset: 'city' as const, riskTieredInterestEnabled: tiered };
}

describe('interest-rate formula (unit)', () => {
  it('constants match the design grid', () => {
    expect(BASE_RATE).toBe(0.0003);
    expect(SPREAD_SLOPE).toBe(0.0004);
    expect(LEVERAGE_CAP).toBe(1.5);
    expect(MIN_NET_WORTH).toBe(LOAN_MIN_CREDIT); // dollars(5000)
  });

  it('leverage 0 (unlevered) → BASE_RATE = 0.0003 (≈11%/yr)', () => {
    expect(effectiveRateForLeverage(0)).toBe(0.0003);
    // No debt → leverage is exactly 0 regardless of net worth.
    expect(firmLeverage(0, 12000_00)).toBe(0);
    expect(firmLeverage(0, -50_00)).toBe(0);
    expect(effectiveRateForDebt(0, 12000_00)).toBe(0.0003);
    expect(Math.round(annualRatePercent(0.0003))).toBe(11);
  });

  it('at the credit-limit leverage (1.5) → exactly 0.0009 (the old flat rate, ≈33%/yr)', () => {
    // Precisely the old flat literal — floating-point exact by construction.
    expect(effectiveRateForLeverage(1.5)).toBe(0.0009);
    expect(Math.round(annualRatePercent(0.0009))).toBe(33);
  });

  it('the curve is monotone and hits the design grid points', () => {
    expect(effectiveRateForLeverage(0)).toBeCloseTo(0.0003, 10);
    // owner's $40k on ~$120k net worth → leverage 0.333 → ~0.00043 (≈16%/yr)
    expect(effectiveRateForLeverage(1 / 3)).toBeCloseTo(0.00043, 5);
    expect(Math.round(annualRatePercent(effectiveRateForLeverage(1 / 3)))).toBe(16);
    expect(effectiveRateForLeverage(1.0)).toBeCloseTo(0.0007, 10);
    expect(effectiveRateForLeverage(1.5)).toBeCloseTo(0.0009, 10);
    // strictly increasing between 0 and the cap
    let prev = -1;
    for (const lev of [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]) {
      const r = effectiveRateForLeverage(lev);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it('clamps leverage above the cap — never exceeds the old flat rate', () => {
    expect(effectiveRateForLeverage(2.0)).toBe(0.0009);
    expect(effectiveRateForLeverage(100)).toBe(0.0009);
    // debt well past 1.5× net worth still prices at the ceiling, not above.
    expect(effectiveRateForDebt(1_000_000_00, 10000_00)).toBe(0.0009);
  });

  it('MIN_NET_WORTH floor: a near-zero / negative net-worth firm is priced against the floor, not a divide-by-zero', () => {
    // onw = 0 → denominator floors to MIN_NET_WORTH (dollars(5000) = 500000c).
    // debt 250000c / 500000c = 0.5 leverage.
    expect(firmLeverage(2500_00, 0)).toBeCloseTo(0.5, 10);
    expect(effectiveRateForDebt(2500_00, 0)).toBeCloseTo(BASE_RATE + SPREAD_SLOPE * 0.5, 10);
    // negative net worth (receivership) also floors — high leverage, capped at ceiling.
    expect(firmLeverage(9000_00, -3000_00)).toBe(LEVERAGE_CAP);
    expect(effectiveRateForDebt(9000_00, -3000_00)).toBe(0.0009);
    // a tiny debt against the floor is finite and near BASE, not Infinity.
    expect(Number.isFinite(effectiveRateForDebt(1_00, 0))).toBe(true);
  });
});

describe('chargedInterestRatePerDay respects the flag', () => {
  it('flag OFF returns the stored flat per-firm rate; flag ON returns the tiered rate', () => {
    const off = createInitialState(11, villageCfg(false));
    const player = off.firms[off.playerFirmId]!;
    player.debt = 4000_00;
    expect(chargedInterestRatePerDay(player, off)).toBe(player.interestRatePerDay);

    const on = createInitialState(11, villageCfg(true));
    const p2 = on.firms[on.playerFirmId]!;
    p2.debt = 4000_00;
    const basis = loanNetWorth(on, p2.id);
    expect(chargedInterestRatePerDay(p2, on)).toBe(effectiveInterestRatePerDay(p2, on));
    expect(chargedInterestRatePerDay(p2, on)).toBe(effectiveRateForDebt(4000_00, basis));
  });
});

describe('coupling to the real credit limit (shared loanNetWorth basis)', () => {
  it('a firm that spent its maxed credit line pays exactly the old 0.0009 ceiling', () => {
    // The credit limit prices 1.5 x loanNetWorth (Simulation.takeLoan delegates
    // to the SAME function the formula divides by). A firm that borrowed to the
    // limit and spent the cash into fixed assets has debt = 1.5 x its remaining
    // liquid worth, i.e. leverage exactly at LEVERAGE_CAP -> the old flat rate.
    const state = createInitialState(11, villageCfg(true));
    const firm = state.firms[state.playerFirmId]!;
    const basis = loanNetWorth(state, firm.id);
    expect(basis).toBeGreaterThan(MIN_NET_WORTH); // a real denominator, not the floor
    firm.debt = Math.round(basis * LEVERAGE_CAP); // maxed line, cash fully spent
    expect(effectiveInterestRatePerDay(firm, state)).toBe(0.0009);
    // And one leverage unit below the cap sits strictly cheaper.
    firm.debt = Math.round(basis * 0.5);
    expect(effectiveInterestRatePerDay(firm, state)).toBeLessThan(0.0009);
  });
});

describe('flag-OFF byte-identity guard', () => {
  it('FinanceSystem charges exactly round(debt × flat rate) with the flag off (pre-change behavior)', () => {
    const s = createInitialState(11, villageCfg(false));
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    const player = s.firms[s.playerFirmId]!;
    // Give it debt funded from the world account so money stays conserved.
    player.debt = 7000_00;
    player.cash += 7000_00;
    s.worldCash -= 7000_00;
    const supply0 = totalMoneySupply(s);
    const expectedFlat = Math.round(player.debt * player.interestRatePerDay);

    sim.run(ticksPerDay(s.config)); // one day → one accrual

    const charged = s.transactions
      .filter((t) => t.category === 'interest' && t.firmId === player.id)
      .reduce((n, t) => n + t.amount, 0);
    expect(charged).toBe(expectedFlat);
    expect(totalMoneySupply(s)).toBe(supply0);
  });
});

describe('player-loan scenario (flag ON) — tiered rate charged day by day, money conserved', () => {
  it('charges the effective rate each day and conserves money to the cent', () => {
    const s = createInitialState(11, villageCfg(true));
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    const player = s.firms[s.playerFirmId]!;
    // Borrow through the real command so debt and cash move via recordTransaction.
    sim.dispatch({ type: 'TAKE_LOAN', firmId: player.id, amount: 4000_00 });
    expect(player.debt).toBeGreaterThan(0);
    const supply0 = totalMoneySupply(s);

    for (let d = 0; d < 20; d++) {
      // The rate the sim WILL charge today, computed from pre-tick state.
      const rate = effectiveInterestRatePerDay(player, s);
      const debtBefore = player.debt;
      const before = s.transactions.length;
      sim.run(ticksPerDay(s.config));
      const todaysInterest = s.transactions
        .slice(before)
        .filter((t) => t.category === 'interest' && t.firmId === player.id)
        .reduce((n, t) => n + t.amount, 0);
      // Interest was charged at the tiered rate (the leverage is low, so the
      // rate reads well under the old flat 0.0009).
      expect(todaysInterest).toBe(Math.round(debtBefore * rate));
      expect(rate).toBeGreaterThanOrEqual(BASE_RATE);
      expect(rate).toBeLessThan(0.0009);
      // Every day conserves to the cent (interest routes through WORLD_ACCOUNT).
      expect(totalMoneySupply(s)).toBe(supply0);
    }
  });
});

describe('the four pins are bit-identical flag ON (Phase 2 opt-in verification)', () => {
  const run = (seed: number, cfg: ReturnType<typeof villageCfg>) => {
    const s = createInitialState(seed, cfg);
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 300);
    return { rng: s.rngState, money: totalMoneySupply(s) };
  };

  it('village 11 → rngState 3274842624 with the flag ON', () => {
    expect(run(11, villageCfg(true)).rng).toBe(3274842624);
  });
  it('village 4 → rngState 2896139677 with the flag ON', () => {
    expect(run(4, villageCfg(true)).rng).toBe(2896139677);
  });
  it('village 7 → rngState 4253583594 with the flag ON', () => {
    expect(run(7, villageCfg(true)).rng).toBe(4253583594);
  });
  it('city 11 → rngState 2546912297 and money 316900000 with the flag ON', () => {
    const r = run(11, cityCfg(true));
    expect(r.rng).toBe(2546912297);
    expect(r.money).toBe(316900000);
  });
});
