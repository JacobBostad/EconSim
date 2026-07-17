import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { SCENARIOS } from '../data/scenarios';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

describe('Scenario variants', () => {
  it('the default town matches the classic three chains', () => {
    const state = createInitialState(1);
    const names = Object.values(state.firms).filter((f) => f.ownerType === 'ai').map((f) => f.name).sort();
    expect(names).toEqual(['Granite Industries', 'Loom & Thread', 'Sunrise Foods']);
  });

  it('gold rush has two tool firms and no clothes seller', () => {
    const state = createInitialState(1, undefined, 'gold_rush');
    const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(ai.map((f) => f.name).sort()).toEqual(
      ['Deepvein Mining Co', 'Granite Industries', 'Sunrise Foods'],
    );
    const toolSellers = Object.values(state.facilities).filter((f) => f.retailProductId === 'tools');
    const clothesSellers = Object.values(state.facilities).filter((f) => f.retailProductId === 'clothes');
    expect(toolSellers.length).toBe(2);
    expect(clothesSellers.length).toBe(0);
  });

  it('every scenario runs 60 days with money conserved and AI alive', () => {
    for (const id of Object.keys(SCENARIOS)) {
      const sim = new Simulation(createInitialState(5, undefined, id));
      sim.dispatch({ type: 'RESUME' });
      const s0 = totalMoneySupply(sim.getState());
      sim.run(ticksPerDay(sim.getState().config) * 60 + 1);
      const state = sim.getState();
      expect(totalMoneySupply(state)).toBe(s0);
      const aiAlive = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
      expect(aiAlive.length).toBeGreaterThanOrEqual(2); // rescue M&A may merge one
      for (const f of aiAlive) expect(f.cash).toBeGreaterThan(-100000);
    }
  });

  it('an unknown scenario id falls back to the default town', () => {
    const state = createInitialState(1, undefined, 'nope');
    expect(Object.values(state.firms).some((f) => f.name === 'Sunrise Foods')).toBe(true);
  });
});
