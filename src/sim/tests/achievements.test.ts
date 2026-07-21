import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { ACHIEVEMENT_DEFS, getAchievementDef } from '../data/achievements';
import { deserialize, serialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { Simulation } from '../core/Simulation';
import { addStock } from '../entities/Inventory';
import { createFacility } from '../entities/factories';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { runAchievementSystem } from '../systems/AchievementSystem';
import { SERVICE_BOOST_MULT } from '../data/services';

function cityState(seed: number) {
  return createInitialState(seed, {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  });
}

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
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'apartment', location: { x: 30 + i * 8, y: 64 } });
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

describe('World-scale era achievements', () => {
  it('are provably inert in Village — the gate returns false even with the condition forced', () => {
    const state = newSim(1).getState(); // Village preset, every era flag off
    const p = state.firms[state.playerFirmId]!;
    // Force each underlying condition; every era check must still return false.
    p.serviceBoost = SERVICE_BOOST_MULT;
    state.forwardsClosed = 5;
    state.landlordRepossessions = 3;
    state.poolCoversRestored = 2;
    p.sharesHeld = { firm_2: 5, firm_3: 5, firm_4: 5 };
    const rival = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    const fac = createFacility(state, 'retail', p.id, { x: 60, y: 52 });
    fac.landlordFirmId = rival.id; // a (would-be) leased premises
    for (const id of ['first_lease', 'full_compute', 'closed_forward', 'three_stakes', 'landlord_repossession', 'pool_restored']) {
      expect(getAchievementDef(id)!.check(state)).toBe(false);
    }
  });

  it('first_lease: unlocks when the player operates a leased premises', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const p = state.firms[state.playerFirmId]!;
    p.cash = 200000_00;
    const def = getAchievementDef('first_lease')!;
    expect(def.check(state)).toBe(false);
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'retail', location: { x: 120, y: 120 }, leaseFrom: landlord.id });
    expect(def.check(state)).toBe(true);
  });

  it('full_compute: unlocks only at full coverage, not partial', () => {
    const state = cityState(11);
    const p = state.firms[state.playerFirmId]!;
    const def = getAchievementDef('full_compute')!;
    expect(def.check(state)).toBe(false); // no boost
    p.serviceBoost = 1 + (SERVICE_BOOST_MULT - 1) * 0.5; // partial coverage
    expect(def.check(state)).toBe(false);
    p.serviceBoost = SERVICE_BOOST_MULT; // full coverage
    expect(def.check(state)).toBe(true);
  });

  it('closed_forward: unlocks after a forward is closed at the mark (any P&L)', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const p = state.firms[state.playerFirmId]!;
    p.cash = 200000_00;
    const def = getAchievementDef('closed_forward')!;

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'warehouse', location: { x: 104, y: 20 } });
    const day = Math.floor(state.tick / ticksPerDay(state.config));
    sim.dispatch({ type: 'SELL_FORWARD', firmId: p.id, productId: 'bread', quantity: 40, cityId: 'port_rosa', deliveryDay: day + 8 });
    const fwd = p.forwards[0]!;
    expect(def.check(state)).toBe(false); // open, not closed
    sim.dispatch({ type: 'CLOSE_FORWARD', firmId: p.id, forwardId: fwd.id });
    expect(p.forwards.length).toBe(0);
    expect(state.forwardsClosed).toBe(1);
    expect(def.check(state)).toBe(true);
  });

  it('three_stakes: unlocks at three distinct rival stakes, not two', () => {
    const state = cityState(11);
    const p = state.firms[state.playerFirmId]!;
    const def = getAchievementDef('three_stakes')!;
    const rivals = Object.values(state.firms).filter((f) => f.ownerType === 'ai').slice(0, 3);
    p.sharesHeld[rivals[0]!.id] = 5;
    p.sharesHeld[rivals[1]!.id] = 5;
    expect(def.check(state)).toBe(false); // only two
    p.sharesHeld[rivals[2]!.id] = 5;
    expect(def.check(state)).toBe(true);
  });

  it('landlord_repossession: unlocks when the player-as-landlord collects a repossessed premises', () => {
    const state = cityState(11);
    const config = state.config;
    const player = state.firms[state.playerFirmId]!; // the landlord
    const def = getAchievementDef('landlord_repossession')!;
    expect(def.check(state)).toBe(false);

    // An AI tenant holding ONLY a premises it LEASES from the player. Drive it to
    // the insolvency close-point so the repossession rung hands the asset back.
    const tenant = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    tenant.facilities = [];
    tenant.sharesHeld = {};
    const leased = createFacility(state, 'retail', tenant.id, { x: 118, y: 118 });
    leased.buildCost = 2000_00;
    leased.operatingCostPerDay = 900;
    leased.landlordFirmId = player.id;
    leased.rentPerDay = 100_00;
    tenant.cash = -50000_00;
    tenant.daysInsolvent = config.insolvencyCloseDays - 1;
    state.tick = ticksPerDay(config);

    runBankruptcySystem(makeContext(state));
    expect(state.facilities[leased.id]!.ownerFirmId).toBe(player.id); // reverted to landlord
    expect(state.landlordRepossessions).toBe(1);
    expect(def.check(state)).toBe(true);
  });

  it('pool_restored: unlocks when a thin port is shipped back to its target cover, not before', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const p = state.firms[state.playerFirmId]!;
    p.cash = 200000_00;
    const def = getAchievementDef('pool_restored')!;

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: p.id, defId: 'warehouse', location: { x: 104, y: 20 } });
    const wh = p.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse')!;
    addStock(wh.inputInventory, 'bread', 100, 60);

    // Sit the larder just UNDER the 6-day target (target 1404; 1380 ⇒ cover 5.9d).
    state.tradeCities['port_rosa']!.pool!.inventory['bread'] = 1380;
    // A ship that does NOT cross the target does not count as a restore.
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: p.id, facilityId: wh.id, productId: 'bread', quantity: 10, cityId: 'port_rosa' });
    expect(state.poolCoversRestored).toBe(0);
    expect(def.check(state)).toBe(false);
    // A ship that crosses the target restores the larder.
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: p.id, facilityId: wh.id, productId: 'bread', quantity: 40, cityId: 'port_rosa' });
    expect(state.poolCoversRestored).toBe(1);
    expect(def.check(state)).toBe(true);
  });

  it('the AchievementSystem fires an era unlock exactly once', () => {
    const state = cityState(11);
    state.forwardsClosed = 1; // condition already met
    state.tick = state.config.ticksPerHour; // hour boundary
    runAchievementSystem(makeContext(state));
    runAchievementSystem(makeContext(state));
    const fires = state.achievements.filter((a) => a.id === 'closed_forward');
    expect(fires.length).toBe(1);
  });
});
