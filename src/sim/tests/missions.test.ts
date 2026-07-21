import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { MISSION_DEFS, activeMission, eligibleMissions, getMissionDef } from '../data/missions';
import { deserialize, serialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { Simulation } from '../core/Simulation';
import { ticksPerDay } from '../core/Tick';
import { addStock } from '../entities/Inventory';
import { computeSeatDemand } from '../systems/ServiceBillingSystem';
import { runServiceBillingSystem } from '../systems/ServiceBillingSystem';
import { SERVICE_BOOST_MULT } from '../data/services';

/** A City-preset state with every world-scale channel switched on — the world a
 * real City New Game builds, and the only one the era missions are offered in. */
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

describe('Missions', () => {
  it('defs are unique and the chain starts at Break Ground', () => {
    const ids = MISSION_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sim = newSim(1);
    expect(activeMission(sim.getState())?.id).toBe('build_first');
  });

  it('completing missions pays rewards, conserves money, and advances the chain', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const supplyBefore = totalMoneySupply(state);

    sim.dispatch({
      type: 'BUILD_FACILITY',
      firmId: player.id,
      defId: 'retail',
      location: { x: 50, y: 55 },
    });
    const cashAfterBuild = player.cash;

    sim.run(state.config.ticksPerHour); // one hourly check
    expect(state.missions.map((m) => m.id)).toEqual(['build_first']);
    expect(player.cash).toBe(cashAfterBuild + dollars(500));
    expect(totalMoneySupply(state)).toBe(supplyBefore);
    expect(activeMission(state)?.id).toBe('hire_two');

    // Only one mission may complete per hourly check, even if several qualify.
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: player.facilities[0]!, citizenId: null });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: player.facilities[0]!, citizenId: null });
    sim.run(state.config.ticksPerHour);
    expect(state.missions.length).toBe(2);
  });

  it('missions persist through save/load and default for old saves', () => {
    const sim = newSim(1);
    const state = sim.getState();
    state.missions.push({ id: 'build_first', day: 0 });
    const loaded = deserialize(serialize(state));
    expect(loaded.missions).toEqual([{ id: 'build_first', day: 0 }]);
    expect(activeMission(loaded)?.id).toBe('hire_two');

    const raw = JSON.parse(serialize(state));
    delete raw.missions;
    expect(deserialize(JSON.stringify(raw)).missions).toEqual([]);
  });
});

describe('New-system missions', () => {
  it('wage leader: strictly out-pay every rival while employing someone', () => {
    const sim = newSim(4);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const def = getMissionDef('wage_leader')!;
    expect(def.check(state)).toBe(false); // no employees yet
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    expect(def.check(state)).toBe(false); // same wage as rivals
    sim.dispatch({ type: 'SET_WAGE', firmId: player.id, wage: 2500 });
    expect(def.check(state)).toBe(true);
  });

  it('morning rush: carry coffee and sell some', () => {
    const sim = newSim(4);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const def = getMissionDef('morning_rush')!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 50, y: 52 } });
    const store = state.facilities[player.facilities[0]!]!;
    sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: store.id, productId: 'coffee' });
    expect(def.check(state)).toBe(false); // carried but nothing sold
    state.marketStats['coffee']!.unitsSoldByFirm[player.id] = 3;
    expect(def.check(state)).toBe(true);
  });

  it('landlord: own an apartment with a resident', () => {
    const sim = newSim(4);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const def = getMissionDef('landlord')!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 44, y: 62 } });
    const apt = state.facilities[player.facilities[0]!]!;
    expect(def.check(state)).toBe(false); // vacant
    apt.residentIds.push(Object.keys(state.citizens)[0]!);
    expect(def.check(state)).toBe(true);
  });
});

describe('World-scale era missions', () => {
  const ERA_IDS = ['lease_premises', 'subscribe_compute', 'buy_stake', 'read_ports', 'four_streams'];

  it('era missions are offered only where their channel exists — Village drops them, City keeps them', () => {
    const village = newSim(1).getState();
    const vElig = new Set(eligibleMissions(village).map((d) => d.id));
    for (const id of ERA_IDS) expect(vElig.has(id)).toBe(false);
    // With every CLASSIC mission marked done, the Village chain TERMINATES — an
    // era mission never becomes active, so state.missions can never gain an era
    // id and the serialized Village mission list stays byte-identical.
    for (const d of MISSION_DEFS) if (!d.eligible) village.missions.push({ id: d.id, day: 0 });
    expect(activeMission(village)).toBeNull();
    // A City game offers every era mission (in chain order, after the classics).
    const cElig = new Set(eligibleMissions(cityState(11)).map((d) => d.id));
    for (const id of ERA_IDS) expect(cElig.has(id)).toBe(true);
  });

  it('lease_premises: the MissionSystem pays out when (and only when) a premises is leased', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    player.cash = 200000_00;
    // Fast-forward the chain so lease_premises is the active mission.
    for (const d of MISSION_DEFS) { if (d.id === 'lease_premises') break; state.missions.push({ id: d.id, day: 0 }); }
    expect(activeMission(state)?.id).toBe('lease_premises');

    // An hourly check with nothing leased yet: no completion.
    sim.run(state.config.ticksPerHour);
    expect(state.missions.some((m) => m.id === 'lease_premises')).toBe(false);

    // Lease a store premises from an AI landlord (player pays $0 upfront).
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 120, y: 120 }, leaseFrom: landlord.id });
    expect(player.facilities.some((fid) => state.facilities[fid]?.landlordFirmId === landlord.id)).toBe(true);

    const cashBefore = player.cash;
    const supplyBefore = totalMoneySupply(state);
    sim.run(state.config.ticksPerHour);
    expect(state.missions.some((m) => m.id === 'lease_premises')).toBe(true);
    expect(player.cash - cashBefore).toBe(dollars(3000)); // reward paid
    expect(totalMoneySupply(state)).toBe(supplyBefore); // reward from world, conserved
  });

  it('subscribe_compute: flips only after the firm holds a compute subscription', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    player.cash = 200000_00;
    const def = getMissionDef('subscribe_compute')!;
    expect(def.check(state)).toBe(false);

    // A firm with facilities/employees has real seat demand; a datacenter
    // provider is seeded in a city+services world from day 0.
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    expect(computeSeatDemand(player)).toBeGreaterThan(0);
    const provider = Object.values(state.firms).find(
      (f) => f.facilities.some((id) => state.facilities[id]?.type === 'datacenter'),
    )!;
    sim.dispatch({ type: 'SUBSCRIBE_SERVICE', firmId: player.id, providerFirmId: provider.id });
    expect(def.check(state)).toBe(true);
  });

  it('buy_stake: flips only after a rival stake is held', () => {
    const state = cityState(11);
    const player = state.firms[state.playerFirmId]!;
    const def = getMissionDef('buy_stake')!;
    expect(def.check(state)).toBe(false);
    const rival = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    player.sharesHeld[rival.id] = 5;
    expect(def.check(state)).toBe(true);
  });

  it('read_ports: flips when the player ships a staple into a thin port', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    player.cash = 200000_00;
    const def = getMissionDef('read_ports')!;
    expect(def.check(state)).toBe(false);

    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 104, y: 20 } });
    const wh = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse')!;
    addStock(wh.inputInventory, 'bread', 50, 60);

    // Run Port Rosa's bread larder down below the 🔥 thin bar (cover < 4 days;
    // consumption is 234/day, so ~200 units is under a day of cover).
    state.tradeCities['port_rosa']!.pool!.inventory['bread'] = 200;
    sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: 'bread', quantity: 50, cityId: 'port_rosa' });

    expect(state.poolFeedsWhileThin).toBe(1);
    expect(def.check(state)).toBe(true);
    // A thin feed that never reaches the 6-day target does NOT count as a restore.
    expect(state.poolCoversRestored).toBe(0);
  });

  it('four_streams: the capstone flips only when all four streams are held at once', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    player.cash = 300000_00;
    const def = getMissionDef('four_streams')!;

    // (1) Retail: a selling bread chain.
    sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
    expect(def.check(state)).toBe(false); // retail only

    // (2) Rent stream: lease a premises from a landlord.
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 120, y: 120 }, leaseFrom: landlord.id });
    expect(def.check(state)).toBe(false); // + rent, still no stake/boost

    // (3) Dividend stake in a rival.
    const rival = Object.values(state.firms).find((f) => f.ownerType === 'ai' && f.id !== landlord.id)!;
    player.sharesHeld[rival.id] = 5;
    expect(def.check(state)).toBe(false); // + stake, still no compute boost

    // (4) A live compute boost — subscribe and let the billing system stamp it.
    const provider = Object.values(state.firms).find(
      (f) => f.facilities.some((id) => state.facilities[id]?.type === 'datacenter'),
    )!;
    sim.dispatch({ type: 'SUBSCRIBE_SERVICE', firmId: player.id, providerFirmId: provider.id });
    state.tick = ticksPerDay(state.config); // a day boundary
    runServiceBillingSystem(makeContext(state));
    expect(player.serviceBoost).toBeCloseTo(SERVICE_BOOST_MULT, 10);
    expect(def.check(state)).toBe(true); // all four streams held
  });
});
