import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { ACHIEVEMENT_DEFS, getAchievementDef } from '../data/achievements';
import { deserialize, serialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';

describe('Achievements', () => {
  it('defs are unique and well-formed', () => {
    const ids = ACHIEVEMENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of ACHIEVEMENT_DEFS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(0);
    }
  });

  it('a fresh player unlocks nothing on day 1', () => {
    const sim = newSim(1);
    sim.run(ticksPerDay(sim.getState().config));
    expect(sim.getState().achievements).toEqual([]);
  });

  it('building and selling unlocks founder-type achievements', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;

    sim.dispatch({
      type: 'BUILD_FACILITY',
      firmId: player.id,
      defId: 'retail',
      location: { x: 50, y: 55 },
    });
    expect(player.facilities.length).toBe(1);
    // Simulate revenue + a stake in a rival.
    player.accounting.lifetime.revenue = 1000;
    const rival = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    player.sharesHeld[rival.id] = 5;

    sim.run(state.config.ticksPerHour); // reach an hour boundary
    const unlocked = sim.getState().achievements.map((a) => a.id);
    expect(unlocked).toContain('founder');
    expect(unlocked).toContain('first_sale');
    expect(unlocked).toContain('shareholder');
  });

  it('unlocks are permanent and never duplicated', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.accounting.lifetime.revenue = 1000;
    sim.run(ticksPerDay(state.config) * 2);
    // Revenue accumulator resets etc., but the unlock persists exactly once.
    const firstSales = sim.getState().achievements.filter((a) => a.id === 'first_sale');
    expect(firstSales.length).toBe(1);
  });

  it('valuation tiers unlock as the company grows', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = dollars(120000);
    sim.run(state.config.ticksPerHour);
    const unlocked = sim.getState().achievements.map((a) => a.id);
    expect(unlocked).toContain('rising_star');
    expect(unlocked).toContain('tycoon');
    expect(unlocked).toContain('empire');
  });

  it('achievements survive save/load and default for old saves', () => {
    const sim = newSim(1);
    const state = sim.getState();
    state.achievements.push({ id: 'founder', day: 3 });
    const loaded = deserialize(serialize(state));
    expect(loaded.achievements).toEqual([{ id: 'founder', day: 3 }]);

    const raw = JSON.parse(serialize(state));
    delete raw.achievements;
    expect(deserialize(JSON.stringify(raw)).achievements).toEqual([]);
    expect(getAchievementDef('founder')?.name).toBeTruthy();
  });
});

describe('New-system achievements', () => {
  it('landlord baron: three occupied apartments', () => {
    const sim = newSim(6);
    const state = sim.getState();
    const p = state.firms[state.playerFirmId]!;
    p.cash = 60000_00;
    const def = getAchievementDef('landlord_baron')!;
    for (let i = 0; i < 3; i++) {
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'apartment', location: { x: 30 + i * 8, y: 62 } });
    }
    expect(def.check(state)).toBe(false); // vacant
    const cids = Object.keys(state.citizens);
    p.facilities.forEach((fid, i) => state.facilities[fid]!.residentIds.push(cids[i]!));
    expect(def.check(state)).toBe(true);
  });

  it('talent magnet: 1.15× every rival wage with 5+ staff', () => {
    const sim = newSim(6);
    const state = sim.getState();
    const p = state.firms[state.playerFirmId]!;
    const def = getAchievementDef('talent_magnet')!;
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: p.id, productId: 'bread' });
    expect(p.employees.length).toBeGreaterThanOrEqual(5);
    expect(def.check(state)).toBe(false);
    sim.dispatch({ type: 'SET_WAGE', firmId: p.id, wage: 3000 });
    expect(def.check(state)).toBe(true);
  });

  it('weathered the storm: red day in history, positive cash now', () => {
    const sim = newSim(6);
    const state = sim.getState();
    const p = state.firms[state.playerFirmId]!;
    const def = getAchievementDef('weathered_storm')!;
    expect(def.check(state)).toBe(false);
    p.accounting.dailyHistory.push({
      day: 5, revenue: 0, costOfGoodsSold: 0, wages: 0, maintenance: 0,
      logisticsCost: 0, variableProductionCost: 0, marketing: 0, rnd: 0, interest: 0,
      grossProfit: 0, operatingProfit: 0, netProfit: 0,
      cash: -5000, debt: 0, inventoryValue: 0, valuation: 0, buildSpend: 0,
    });
    expect(def.check(state)).toBe(true);
    expect(getAchievementDef('coffee_magnate')!.check(state)).toBe(false);
    p.marketShareByProduct['coffee'] = 0.6;
    expect(getAchievementDef('coffee_magnate')!.check(state)).toBe(true);
  });
});
