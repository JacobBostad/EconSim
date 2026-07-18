import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

/**
 * AI firms take expansion loans; without deleveraging they carried the debt
 * forever, paying ~30%/yr interest as a permanent late-game drag. A cash-rich
 * firm must pay its loans down (keeping an operating cushion).
 */
describe('AI deleveraging', () => {
  it('a cash-rich healthy AI firm repays its debt', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const ai = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;

    // Simulate a past drawdown: debt on the books, cash from the bank.
    ai.debt = 3000_00;
    ai.cash += 3000_00;
    state.worldCash -= 3000_00;
    // Make sure cash comfortably exceeds cushion + debt.
    if (ai.cash < 12000_00) {
      const topUp = 12000_00 - ai.cash;
      ai.cash += topUp;
      state.worldCash -= topUp;
    }
    const supply0 = totalMoneySupply(state);
    const cashBefore = ai.cash;

    sim.run(ticksPerDay(state.config));

    expect(ai.debt).toBe(0);
    // The repayment actually moved money (cash fell by at least the principal
    // net of the day's trading).
    expect(ai.cash).toBeLessThan(cashBefore);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('keeps the operating cushion: a merely-comfortable firm repays only partially', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const ai = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;

    ai.debt = 20000_00;
    ai.cash += 20000_00;
    state.worldCash -= 20000_00;
    // Pin cash to cushion + $2k so only ~$2k of the $20k debt is repayable.
    const target = 8000_00;
    state.worldCash += ai.cash - target;
    ai.cash = target;
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config));

    expect(ai.debt).toBeGreaterThan(0);
    expect(ai.debt).toBeLessThan(20000_00);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
