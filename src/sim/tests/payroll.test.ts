import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { makeContext } from '../core/GameState';
import { runPayrollSystem } from '../systems/PayrollSystem';

describe('PayrollSystem', () => {
  it('moves cash from firm to employees on payday', () => {
    const sim = newSim(21);
    const state = sim.getState();
    state.tick = state.config.ticksPerHour * 24; // first day boundary
    const firm = findFirmByName(state, 'Sunrise Foods');
    const totalWages = firm.employees.reduce((s, cid) => s + state.citizens[cid]!.wage, 0);
    const firmCashBefore = firm.cash;
    const citCashBefore = firm.employees.map((cid) => state.citizens[cid]!.cash);

    runPayrollSystem(makeContext(state));

    expect(firm.cash).toBe(firmCashBefore - totalWages);
    firm.employees.forEach((cid, i) => {
      expect(state.citizens[cid]!.cash).toBe(citCashBefore[i]! + state.citizens[cid]!.wage);
    });
  });

  it('records missed payroll when the firm cannot pay', () => {
    const sim = newSim(22);
    const state = sim.getState();
    state.tick = state.config.ticksPerHour * 24;
    const firm = findFirmByName(state, 'Sunrise Foods');
    firm.cash = 0; // cannot pay anyone
    const eventsBefore = state.events.length;

    runPayrollSystem(makeContext(state));

    const missed = firm.employees.filter((cid) => state.citizens[cid]!.missedPaydays > 0);
    expect(missed.length).toBeGreaterThan(0);
    expect(state.events.length).toBeGreaterThan(eventsBefore);
    expect(firm.cash).toBe(0); // no wages paid
  });
});
