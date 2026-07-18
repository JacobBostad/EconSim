import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { SCENARIOS } from '../data/scenarios';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { ACHIEVEMENT_DEFS } from '../data/achievements';

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
    const toolSellers = Object.values(state.facilities).filter((f) => f.retailProductIds.includes('tools'));
    const clothesSellers = Object.values(state.facilities).filter((f) => f.retailProductIds.includes('clothes'));
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
      if (SCENARIOS[id]!.aiChains.length >= 2) {
        expect(aiAlive.length).toBeGreaterThanOrEqual(2); // rescue M&A may merge one
      }
      for (const f of aiAlive) expect(f.cash).toBeGreaterThan(-100000);
    }
  });

  it('port haven: two exporter firms, thin home shelves, no clothes market', () => {
    const state = createInitialState(1, undefined, 'port_haven');
    const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(ai.length).toBe(2);
    for (const f of ai) expect(f.personalityId).toBe('exporter');
    const clothesSellers = Object.values(state.facilities).filter((f) =>
      f.retailProductIds.includes('clothes'),
    );
    expect(clothesSellers.length).toBe(0);
  });

  it('an unknown scenario id falls back to the default town', () => {
    const state = createInitialState(1, undefined, 'nope');
    expect(Object.values(state.firms).some((f) => f.name === 'Sunrise Foods')).toBe(true);
  });

  it('every scenario sells its social character up front', () => {
    for (const sc of Object.values(SCENARIOS)) {
      expect(sc.society.length).toBeGreaterThan(20);
      expect(sc.society).not.toBe(sc.description);
    }
  });

  it('Dust Hollow opens in crisis: satisfaction collapses and families leave', () => {
    const sim = new Simulation(createInitialState(11, undefined, 'dust_hollow'));
    sim.dispatch({ type: 'RESUME' });
    const state = sim.getState();
    expect(Object.values(state.firms).filter((f) => f.ownerType === 'ai')).toHaveLength(0);
    const pop0 = Object.keys(state.citizens).length;
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 30);
    // Probed: the bar breaks ~day 13, the first wagon rolls ~day 24.
    expect(state.events.some((e) => e.message.includes('packed up and left town'))).toBe(true);
    expect(Object.keys(state.citizens).length).toBeLessThan(pop0);
    expect(state.emigrationDepartures).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('Stopped the Bleed needs departures, zero pressure, and a recovered town', () => {
    const def = ACHIEVEMENT_DEFS.find((a) => a.id === 'stopped_the_bleed')!;
    const state = createInitialState(3, undefined, 'meadowbrook');
    expect(def.check(state)).toBe(false); // nobody has left
    state.emigrationDepartures = 2;
    state.emigrationPressure = 4;
    expect(def.check(state)).toBe(false); // still under pressure
    state.emigrationPressure = 0;
    for (const c of Object.values(state.citizens)) c.satisfaction = 60;
    expect(def.check(state)).toBe(true);
    for (const c of Object.values(state.citizens)) c.satisfaction = 45;
    expect(def.check(state)).toBe(false); // town not truly recovered
  });

  it('Lifted the Town only fires in Mill Country', () => {
    const def = ACHIEVEMENT_DEFS.find((a) => a.id === 'town_lifted')!;
    const lift = (state: ReturnType<typeof createInitialState>) => {
      for (const c of Object.values(state.citizens)) c.tier = 'comfortable';
    };

    const mill = createInitialState(7, undefined, 'mill_country');
    expect(def.check(mill)).toBe(false); // everyone starts a worker
    lift(mill);
    expect(def.check(mill)).toBe(true);

    // The identical tier picture in the default town earns nothing here —
    // Meadowbrook was never the town that needed lifting.
    const meadow = createInitialState(7, undefined, 'meadowbrook');
    lift(meadow);
    expect(def.check(meadow)).toBe(false);
  });
});

describe('Mill Country (importer-fed chains)', () => {
  it('builds no AI producers; every factory imports its inputs', () => {
    const state = createInitialState(1, undefined, 'mill_country');
    const aiFirms = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(aiFirms).toHaveLength(3);
    for (const firm of aiFirms) {
      const types = firm.facilities.map((i) => state.facilities[i]!.type);
      expect(types).not.toContain('farm');
      expect(types).not.toContain('mine');
    }
    const importerContracts = Object.values(state.contracts).filter(
      (c) => state.facilities[c.sourceFacilityId]?.type === 'importer',
    );
    expect(importerContracts.length).toBe(3);
  });

  it('a player farm quickly becomes the local bakery supplier', () => {
    const state = createInitialState(4, undefined, 'mill_country');
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 30, y: 20 } });
    const farm = state.facilities[player.facilities[0]!]!;
    sim.dispatch({ type: 'SELECT_RECIPE', facilityId: farm.id, recipeId: 'grow_grain' });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: farm.id, citizenId: null });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: farm.id, citizenId: null });

    let customerDay = 0;
    const tpd = ticksPerDay(state.config);
    for (let d = 1; d <= 40 && !customerDay; d++) {
      sim.run(tpd);
      const hasCustomer = Object.values(state.contracts).some(
        (c) => c.active && c.sourceFacilityId === farm.id
          && state.firms[c.ownerFirmId]?.ownerType === 'ai',
      );
      if (hasCustomer) customerDay = d;
    }
    expect(customerDay).toBeGreaterThan(0);
    expect(customerDay).toBeLessThanOrEqual(40);
    expect(player.wholesaleEarned).toBeGreaterThanOrEqual(0);
  });
});
