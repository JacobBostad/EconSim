/**
 * regionFreight.test.ts — the freight edge with a lead time (region.md step 4,
 * slice 4). Pins the slice's binding acceptance:
 *
 *  - a home export to the LIVE partner city (port_rosa) is DISPATCHED, not
 *    settled: the goods leave the warehouse now, no money moves, an in-flight
 *    FreightShipment is recorded with arrivalDay = dispatchDay + FREIGHT_LEAD_DAYS;
 *  - it ARRIVES exactly FREIGHT_LEAD_DAYS later, lands qty in the partner's larder
 *    (the pool interface), and PAYS OUT then at the LOCKED price (freight netted);
 *  - region money is conserved to the cent EVERY day across the whole in-flight
 *    window (in-flight goods are inventory, not money);
 *  - a shipment in flight SERIALIZES / round-trips: save mid-flight, load, and the
 *    arrival still lands on its scheduled day at the same price;
 *  - FLAG-OFF byte-identity: an export to port_rosa with the region off keeps the
 *    instant path and never touches state.freight (which stays []);
 *  - a STUB trade city (ironvale) keeps the instant pool path even with the flag on;
 *  - two flag-on runs with an identical dispatched export agree bit-for-bit.
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import type { SimulationConfig } from '../core/SimulationConfig';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock } from '../entities/Inventory';
import { performExport, exportFreightFee, isFreightDest } from '../core/Trade';
import { getTradeCity } from '../data/tradeCities';
import { FREIGHT_LEAD_DAYS } from '../data/constants';
import { PARTNER_TOWN_ID } from '../data/seedTown';
import { normalizedSerialize } from './helpers';
import { serialize, deserialize } from '../persistence/saveLoad';

function regionConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
    regionEnabled: true,
  };
}

function regionSim(seed = 11): Simulation {
  const sim = new Simulation(createInitialState(seed, regionConfig()));
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** A player warehouse loaded with `units` of `pid`, ready to export. */
function loadedWarehouse(sim: Simulation, pid: string, units: number) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  addStock(wh.inputInventory, pid, units, 60);
  return wh;
}

const QTY = 300;

describe('Region slice 4 — the freight edge dispatches, not settles', () => {
  it('a home export to the live partner is DISPATCHED with a lead time (no money moves)', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    expect(isFreightDest(state, PARTNER_TOWN_ID)).toBe(true);
    const wh = loadedWarehouse(sim, 'bread', QTY);
    const player = state.firms[state.playerFirmId]!;

    const cash0 = player.cash;
    const world0 = state.worldCash;
    const money0 = totalMoneySupply(state);
    const larder0 = state.tradeCities[PARTNER_TOWN_ID]!.pool!.inventory['bread']!;
    const day = computeTime(state.tick, state.config).day;

    performExport(state, player.id, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);

    // Goods LEFT the warehouse; NO money moved; a shipment is in flight.
    expect(wh.inputInventory['bread']?.quantity ?? 0).toBe(0); // all 300 shipped
    expect(player.cash).toBe(cash0);
    expect(state.worldCash).toBe(world0);
    expect(totalMoneySupply(state)).toBe(money0);
    expect(state.freight.length).toBe(1);
    // Larder NOT fed yet — the goods are in flight, not landed.
    expect(state.tradeCities[PARTNER_TOWN_ID]!.pool!.inventory['bread']).toBe(larder0);

    const ship = state.freight[0]!;
    expect(ship.destTownId).toBe(PARTNER_TOWN_ID);
    expect(ship.originTownId).toBe('home');
    expect(ship.productId).toBe('bread');
    expect(ship.qty).toBe(QTY);
    expect(ship.dispatchDay).toBe(day);
    expect(ship.arrivalDay).toBe(day + FREIGHT_LEAD_DAYS);
    expect(ship.priceLocked).toBeGreaterThan(0);
  });

  it('arrives exactly FREIGHT_LEAD_DAYS later and pays the locked price (isolated via the ledger)', () => {
    // The player firm trades in the home economy too, so its raw cash is noisy —
    // isolate the freight payment through its ledger line instead.
    const sim = regionSim(11);
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'bread', QTY);
    performExport(state, state.playerFirmId, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
    const ship = { ...state.freight[0]! };
    const tpd = ticksPerDay(state.config);
    const noteHead = `Freight delivered to ${getTradeCity(PARTNER_TOWN_ID).name}`;
    const delivered = () => state.transactions.filter((t) => t.note.startsWith(noteHead));

    // Run up to (but not through) the arrival day boundary: still in flight, unpaid.
    while (computeTime(state.tick, state.config).day < ship.arrivalDay - 1) {
      sim.run(tpd);
      expect(state.freight.some((s) => s.id === ship.id)).toBe(true);
      expect(delivered().length).toBe(0); // no settlement while in flight
    }
    // Cross the arrival boundary.
    sim.run(tpd);
    expect(computeTime(state.tick, state.config).day).toBe(ship.arrivalDay);
    expect(state.freight.some((s) => s.id === ship.id)).toBe(false);

    // Exactly one settlement, at the LOCKED price with this day's freight netted,
    // booked on the arrival day.
    const txns = delivered();
    expect(txns.length).toBe(1);
    const net = Math.round(ship.priceLocked * (1 - exportFreightFee(state, PARTNER_TOWN_ID)));
    expect(txns[0]!.amount).toBe(net * QTY);
    expect(computeTime(txns[0]!.tick, state.config).day).toBe(ship.arrivalDay);
  });

  it('the qty LANDS in the partner larder on arrival (control vs treatment)', () => {
    // Isolate the +qty landing from the pool's own daily drain/refill by diffing a
    // dispatched run against an identical run that ships nothing.
    function poolBreadAtArrival(dispatchIt: boolean): number {
      const sim = regionSim(11);
      const state = sim.getState();
      const wh = loadedWarehouse(sim, 'bread', QTY); // built identically in both arms
      let arrival = computeTime(state.tick, state.config).day + FREIGHT_LEAD_DAYS;
      if (dispatchIt) {
        performExport(state, state.playerFirmId, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
        arrival = state.freight[0]!.arrivalDay;
      }
      while (computeTime(state.tick, state.config).day < arrival) sim.run(ticksPerDay(state.config));
      return state.tradeCities[PARTNER_TOWN_ID]!.pool!.inventory['bread']!;
    }
    // Everything but the shipment is identical, so the delta is exactly the landing.
    expect(poolBreadAtArrival(true) - poolBreadAtArrival(false)).toBe(QTY);
  });

  it('region money is conserved to the cent EVERY day across the in-flight window', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'bread', QTY);
    performExport(state, state.playerFirmId, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
    const money0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    // Dispatch day + the full lead window + a few days past arrival.
    for (let d = 0; d < FREIGHT_LEAD_DAYS + 4; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(money0);
    }
    expect(state.freight.length).toBe(0); // delivered
  });
});

describe('Region slice 4 — a shipment in flight round-trips through a save', () => {
  it('save mid-flight, load, and the arrival still lands on schedule at the locked price', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    const wh = loadedWarehouse(sim, 'bread', QTY);
    performExport(state, state.playerFirmId, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
    const ship = { ...state.freight[0]! };
    const tpd = ticksPerDay(state.config);

    // Advance ONE day (still in flight), then save mid-flight.
    sim.run(tpd);
    expect(state.freight.some((s) => s.id === ship.id)).toBe(true);
    const saved = serialize(state);

    // The reloaded state carries the in-flight shipment verbatim.
    const loaded = deserialize(saved);
    const reship = loaded.freight.find((s) => s.id === ship.id)!;
    expect(reship).toBeTruthy();
    expect(reship.priceLocked).toBe(ship.priceLocked);
    expect(reship.arrivalDay).toBe(ship.arrivalDay);

    // Drive the LOADED game to the arrival day: the shipment lands + pays on
    // schedule, at the price locked before the save (isolated via the ledger).
    const rsim = new Simulation(loaded);
    rsim.dispatch({ type: 'RESUME' });
    const noteHead = `Freight delivered to ${getTradeCity(PARTNER_TOWN_ID).name}`;
    expect(loaded.transactions.some((t) => t.note.startsWith(noteHead))).toBe(false); // unpaid at save time
    while (computeTime(loaded.tick, loaded.config).day < ship.arrivalDay) rsim.run(tpd);

    expect(loaded.freight.some((s) => s.id === ship.id)).toBe(false);
    const txns = loaded.transactions.filter((t) => t.note.startsWith(noteHead));
    expect(txns.length).toBe(1);
    const net = Math.round(ship.priceLocked * (1 - exportFreightFee(loaded, PARTNER_TOWN_ID)));
    expect(txns[0]!.amount).toBe(net * QTY);
    expect(computeTime(txns[0]!.tick, loaded.config).day).toBe(ship.arrivalDay);
  });
});

describe('Region slice 4 — gating + identity', () => {
  it('flag OFF: an export to port_rosa keeps the instant path, never touches state.freight', () => {
    const off = new Simulation(
      createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', tradeDemandPoolsEnabled: true }),
    );
    off.dispatch({ type: 'RESUME' });
    const state = off.getState();
    expect(isFreightDest(state, PARTNER_TOWN_ID)).toBe(false); // no partner town, flag off
    const wh = loadedWarehouse(off, 'bread', QTY);
    const player = state.firms[state.playerFirmId]!;
    const cash0 = player.cash;
    const rev = performExport(state, player.id, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
    // INSTANT settle: paid now, nothing in flight.
    expect(rev).toBeGreaterThan(0);
    expect(player.cash).toBe(cash0 + rev);
    expect(state.freight.length).toBe(0);
  });

  it('flag ON: an export to the STUB city (ironvale) keeps the instant pool path', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    expect(isFreightDest(state, 'ironvale')).toBe(false); // ironvale is not a live town
    const wh = loadedWarehouse(sim, 'bread', QTY);
    const player = state.firms[state.playerFirmId]!;
    const cash0 = player.cash;
    const rev = performExport(state, player.id, wh.id, 'bread', QTY, 'Exported', 'ironvale');
    expect(rev).toBeGreaterThan(0);
    expect(player.cash).toBe(cash0 + rev); // paid instantly
    expect(state.freight.length).toBe(0); // no freight for a stub city
  });

  it('a plain flag-off City run never populates state.freight', () => {
    const s = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(s);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(s.config) * 60);
    expect(s.freight).toEqual([]);
  });
});

describe('Region slice 4 — determinism', () => {
  it('two flag-on runs with an identical dispatched export agree bit-for-bit', () => {
    function runWithFreight(): string {
      const sim = regionSim(11);
      const state = sim.getState();
      const wh = loadedWarehouse(sim, 'bread', QTY);
      performExport(state, state.playerFirmId, wh.id, 'bread', QTY, 'Exported', PARTNER_TOWN_ID);
      // Through dispatch, the full in-flight window, and past arrival.
      sim.run(ticksPerDay(state.config) * (FREIGHT_LEAD_DAYS + 5));
      return normalizedSerialize(state);
    }
    expect(runWithFreight()).toBe(runWithFreight());
  });
});
