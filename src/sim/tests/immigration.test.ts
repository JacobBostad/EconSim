import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { runImmigrationSystem } from '../systems/ImmigrationSystem';
import { MAX_CITIZENS } from '../data/constants';

const TPD = 48;

function makeProsperous(state: ReturnType<ReturnType<typeof newSim>['getState']>): void {
  // High satisfaction + near-full employment triggers immigration.
  const ids = Object.keys(state.citizens);
  for (const id of ids) {
    const c = state.citizens[id]!;
    c.satisfaction = 90;
    c.employmentStatus = 'employed';
  }
}

describe('Immigration', () => {
  it('a prosperous town attracts new citizens (and builds homes when full)', () => {
    const sim = newSim(301);
    const state = sim.getState();
    makeProsperous(state);
    const popBefore = Object.keys(state.citizens).length;
    const homesBefore = Object.values(state.facilities).filter((f) => f.type === 'home').length;
    const moneyBefore = totalMoneySupply(state);

    // Run several day boundaries; the 40% daily chance makes one arrival
    // near-certain within 20 attempts (deterministic given the seed).
    for (let d = 1; d <= 20; d++) {
      state.tick = TPD * d;
      runImmigrationSystem(makeContext(state));
      makeProsperous(state); // keep newcomers employed for the next check
    }

    const popAfter = Object.keys(state.citizens).length;
    const homesAfter = Object.values(state.facilities).filter((f) => f.type === 'home').length;
    expect(popAfter).toBeGreaterThan(popBefore);
    expect(homesAfter).toBeGreaterThan(homesBefore); // town started at capacity
    expect(totalMoneySupply(state)).toBe(moneyBefore); // arrival cash from world
    // Newcomers arrive with savings, a home, and needs.
    const newcomer = Object.values(state.citizens).find((c) => !c.dailyStats || c.cash === 40000)!;
    expect(newcomer).toBeTruthy();
  });

  it('a merely-glum town neither grows nor shrinks', () => {
    // Satisfaction 50: below the immigration gate (55) but above the
    // emigration bar (42) — the town just sits still.
    const sim = newSim(302);
    const state = sim.getState();
    const popBefore = Object.keys(state.citizens).length;
    for (let d = 1; d <= 20; d++) {
      state.tick = TPD * d;
      for (const id in state.citizens) state.citizens[id]!.satisfaction = 50;
      runImmigrationSystem(makeContext(state));
    }
    expect(Object.keys(state.citizens).length).toBe(popBefore);
  });

  it('a deeply miserable worker town eventually shrinks', () => {
    const sim = newSim(302);
    const state = sim.getState();
    const popBefore = Object.keys(state.citizens).length;
    for (let d = 1; d <= 30; d++) {
      state.tick = TPD * d;
      for (const id in state.citizens) state.citizens[id]!.satisfaction = 20;
      runImmigrationSystem(makeContext(state));
    }
    expect(Object.keys(state.citizens).length).toBeLessThan(popBefore);
  });

  it('growth respects the population cap', () => {
    const sim = newSim(303);
    const state = sim.getState();
    makeProsperous(state);
    for (let d = 1; d <= 400; d++) {
      state.tick = TPD * d;
      runImmigrationSystem(makeContext(state));
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        c.satisfaction = 90;
        c.employmentStatus = 'employed';
      }
    }
    expect(Object.keys(state.citizens).length).toBeLessThanOrEqual(MAX_CITIZENS);
  });
});
