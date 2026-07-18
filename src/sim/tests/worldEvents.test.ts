import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import {
  worldProductionMult,
  worldDemandMult,
  worldSpendingMult,
  worldTransportMult,
  worldImportMult,
  worldTradePriceMult,
  activeWorldEvents,
} from '../data/worldEvents';
import { deserialize, serialize } from '../persistence/saveLoad';
import type { GameState } from '../core/GameState';

describe('World events', () => {
  it('events start and expire over time, and stay within the active cap', () => {
    const sim = newSim(7);
    const tpd = ticksPerDay(sim.getState().config);
    let sawActive = false;
    let sawEnd = false;
    for (let day = 0; day < 80; day++) {
      sim.run(tpd);
      const n = sim.getState().worldEvents.length;
      expect(n).toBeLessThanOrEqual(2);
      if (n > 0) sawActive = true;
      if (sawActive && n === 0) sawEnd = true;
    }
    expect(sawActive).toBe(true);
    expect(sawEnd).toBe(true);
    // Announcements land in the event log under 'economy'.
    const economyEvents = sim.getState().events.filter((e) => e.category === 'economy');
    expect(economyEvents.length).toBeGreaterThan(0);
  });

  it('modifier helpers combine active event effects', () => {
    const sim = newSim(1);
    const state = sim.getState();
    expect(worldProductionMult(state, 'farm')).toBe(1);
    expect(worldSpendingMult(state)).toBe(1);

    state.worldEvents.push({ defId: 'drought', startDay: 0, endDay: 5 });
    state.worldEvents.push({ defId: 'boom', startDay: 0, endDay: 5 });
    expect(worldProductionMult(state, 'farm')).toBeCloseTo(0.5);
    expect(worldProductionMult(state, 'mine')).toBe(1);
    expect(worldSpendingMult(state)).toBeCloseTo(1.25);
    expect(worldDemandMult(state, 'bread')).toBe(1);

    state.worldEvents.push({ defId: 'bread_craze', startDay: 0, endDay: 5 });
    state.worldEvents.push({ defId: 'fuel_spike', startDay: 0, endDay: 5 });
    state.worldEvents.push({ defId: 'tariffs', startDay: 0, endDay: 5 });
    expect(worldDemandMult(state, 'bread')).toBeCloseTo(1.6);
    expect(worldTransportMult(state)).toBeCloseTo(2.2);
    expect(worldImportMult(state)).toBeCloseTo(1.5);

    const views = activeWorldEvents(state);
    expect(views.map((v) => v.def.id).sort()).toEqual(
      ['boom', 'bread_craze', 'drought', 'fuel_spike', 'tariffs'],
    );
  });

  it('the coffee craze lifts coffee demand and the trade fair lifts all port prices', () => {
    const sim = newSim(1);
    const state = sim.getState();
    expect(worldDemandMult(state, 'coffee')).toBe(1);
    state.worldEvents.push({ defId: 'coffee_craze', startDay: 0, endDay: 5 });
    expect(worldDemandMult(state, 'coffee')).toBeCloseTo(1.7);
    expect(worldDemandMult(state, 'bread')).toBe(1);

    const before = worldTradePriceMult(state, 'tools');
    state.worldEvents.push({ defId: 'trade_fair', startDay: 0, endDay: 5 });
    expect(worldTradePriceMult(state, 'tools')).toBeCloseTo(before * 1.25);
    expect(worldTradePriceMult(state, 'grain')).toBeCloseTo(1.25);
  });

  it('a drought halves farm production progress', () => {
    const normal = newSim(3);
    const drought = newSim(3);
    drought.getState().worldEvents.push({ defId: 'drought', startDay: 0, endDay: 30 });

    // Run within day 0 (no day boundary => no random event rolls that could
    // consume rng and diverge the two sims).
    normal.run(40);
    drought.run(40);

    const farmNormal = findFacilityByName(normal.getState(), 'Sunrise Farm');
    const farmDrought = findFacilityByName(drought.getState(), 'Sunrise Farm');
    const output = (s: typeof farmNormal) =>
      s.dailyStats.unitsProduced + s.productionProgress;
    expect(output(farmDrought)).toBeLessThan(output(farmNormal));
  });

  it('active world events survive save/load, and old saves get a default', () => {
    const sim = newSim(5);
    const state = sim.getState();
    state.worldEvents.push({ defId: 'recession', startDay: 1, endDay: 9 });
    const loaded = deserialize(serialize(state));
    expect(loaded.worldEvents).toEqual([{ defId: 'recession', startDay: 1, endDay: 9 }]);

    // Simulate a pre-worldEvents save.
    const raw = JSON.parse(serialize(state)) as Partial<GameState>;
    delete raw.worldEvents;
    const migrated = deserialize(JSON.stringify(raw));
    expect(migrated.worldEvents).toEqual([]);
  });
});
