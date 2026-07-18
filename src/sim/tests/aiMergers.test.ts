import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { objectiveProgress } from '../selectors/companySelectors';
import { dollars } from '../data/constants';

describe('AI rescue M&A and objective ladder', () => {
  it('a flush AI absorbs a distressed AI rival within days', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const rich = findFirmByName(state, 'Granite Industries');
    const weak = findFirmByName(state, 'Loom & Thread');
    rich.cash = 200000_00;
    weak.cash = -5000_00; // genuinely under water — stays distressed/insolvent
    weak.bankruptcyStatus = 'distressed';
    const weakFacilities = [...weak.facilities];
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) * 20 + 1);

    const stillExists = Object.values(state.firms).some((f) => f.name === 'Loom & Thread');
    expect(stillExists).toBe(false);
    const buyer = Object.values(state.firms).find((f) => f.acquiredNames.includes('Loom & Thread'))!;
    expect(buyer.ownerType).toBe('ai');
    for (const facId of weakFacilities) {
      expect(state.facilities[facId]!.ownerFirmId).toBe(buyer.id);
    }
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('AI never rescue-acquires the player', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = -100;
    player.bankruptcyStatus = 'distressed';
    for (const f of Object.values(state.firms)) {
      if (f.ownerType === 'ai') f.cash = 200000_00;
    }
    sim.run(ticksPerDay(state.config) * 15 + 1);
    expect(state.firms[state.playerFirmId]).toBeTruthy();
  });

  it('the objective ladder escalates and completes', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;

    let prog = objectiveProgress(state);
    expect(prog.reachedTiers).toBe(0);
    expect(prog.next?.title).toBe('Tycoon');

    player.cash = dollars(160000);
    prog = objectiveProgress(state);
    expect(prog.reachedTiers).toBe(2);
    expect(prog.reachedTitle).toBe('Magnate');
    expect(prog.next?.title).toBe('Business Empire');

    player.cash = dollars(500000);
    prog = objectiveProgress(state);
    expect(prog.reachedTiers).toBe(3);
    expect(prog.next).toBeNull();
  });
});
