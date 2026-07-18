import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { rivalTopWage } from '../selectors/companySelectors';

describe('Wage market', () => {
  it('SET_WAGE re-prices every current employee immediately', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const foods = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    sim.dispatch({ type: 'SET_WAGE', firmId: foods.id, wage: 2000 });
    expect(foods.wagePolicy.baseWage).toBe(2000);
    for (const cid of foods.employees) {
      expect(state.citizens[cid]!.wage).toBe(2000);
    }
  });

  it('AI raises wages when it has open slots and nobody is left to hire', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const foods = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    const before = foods.wagePolicy.baseWage;
    // Tight labor: everyone employed, and Sunrise is short a worker.
    for (const cid in state.citizens) {
      const c = state.citizens[cid]!;
      if (c.employmentStatus === 'unemployed') c.employmentStatus = 'employed';
    }
    const farm = foods.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'farm')!;
    const firedId = farm.employees[0]!;
    farm.employees = farm.employees.slice(1);
    foods.employees = foods.employees.filter((id) => id !== firedId);

    state.tick = ticksPerDay(state.config);
    runAIStrategySystem(makeContext(state));
    expect(foods.wagePolicy.baseWage).toBeGreaterThan(before);
    // Existing staff ride the raise (retention parity).
    for (const cid of foods.employees) {
      expect(state.citizens[cid]!.wage).toBe(foods.wagePolicy.baseWage);
    }
  });

  it('AI wages drift back to the floor when labor is slack', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const foods = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    foods.strategy.startingWage = foods.wagePolicy.baseWage;
    const floor = foods.wagePolicy.baseWage;
    foods.wagePolicy.baseWage = Math.round(floor * 1.4); // was bid up earlier

    state.tick = ticksPerDay(state.config);
    runAIStrategySystem(makeContext(state));
    expect(foods.wagePolicy.baseWage).toBeLessThan(Math.round(floor * 1.4));
    expect(foods.wagePolicy.baseWage).toBeGreaterThanOrEqual(floor);
  });

  it('rivalTopWage reports the highest other firm wage', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const foods = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    foods.wagePolicy.baseWage = 2500;
    expect(rivalTopWage(state, state.playerFirmId)).toBe(2500);
    expect(rivalTopWage(state, foods.id)).toBeLessThan(2500);
  });
});
