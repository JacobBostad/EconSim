import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { makeContext } from '../core/GameState';
import { runProductionSystem } from '../systems/ProductionSystem';
import { deserialize, serialize } from '../persistence/saveLoad';

describe('Citizen skills & job market', () => {
  it('skill grows on the job and rusts while unemployed', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const employed = Object.values(state.citizens).find((c) => c.employmentStatus === 'employed')!;
    const idle = Object.values(state.citizens).find((c) => c.employmentStatus === 'unemployed')!;
    const e0 = employed.skill;
    const i0 = idle.skill;
    sim.run(ticksPerDay(state.config) * 10 + 1);
    // The employed citizen may have switched jobs but stays employed; skill up.
    expect(employed.skill).toBeGreaterThan(e0);
    if (idle.employmentStatus === 'unemployed') {
      expect(idle.skill).toBeLessThanOrEqual(i0);
    }
    expect(employed.skill).toBeLessThanOrEqual(1.3);
  });

  it('a skilled crew produces faster than a green one', () => {
    const a = newSim(2);
    const b = newSim(2);
    const bakA = findFacilityByName(a.getState(), 'Sunrise Bakery');
    const bakB = findFacilityByName(b.getState(), 'Sunrise Bakery');
    // Drive production directly with identical labor counts, different skill.
    for (const [sim, bak, skill] of [[a, bakA, 2 * 0.8], [b, bakB, 2 * 1.3]] as const) {
      bak.presentWorkers = 2;
      bak.presentSkill = skill;
      runProductionSystem(makeContext(sim.getState()));
    }
    expect(bakB.productionProgress).toBeGreaterThan(bakA.productionProgress);
  });

  it('a big wage premium poaches workers to the player', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 55, y: 55 } });
    sim.dispatch({ type: 'SET_WAGE', firmId: player.id, wage: 30_00 }); // ~2x AI pay
    sim.run(ticksPerDay(state.config) * 10 + 1);
    expect(player.employees.length).toBeGreaterThan(0);
  });

  it('no poaching without a meaningful premium', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 55, y: 55 } });
    sim.dispatch({ type: 'SET_WAGE', firmId: player.id, wage: 17_00 }); // < 15% over $16
    sim.run(ticksPerDay(state.config) * 6 + 1);
    expect(player.employees.length).toBe(0);
  });

  it('old saves get neutral skill and presentSkill defaults', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    for (const cid in raw.citizens) delete raw.citizens[cid].skill;
    for (const fid in raw.facilities) delete raw.facilities[fid].presentSkill;
    const loaded = deserialize(JSON.stringify(raw));
    for (const cid in loaded.citizens) expect(loaded.citizens[cid]!.skill).toBe(1.0);
    for (const fid in loaded.facilities) expect(loaded.facilities[fid]!.presentSkill).toBe(0);
  });
});
