import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { serialize, deserialize } from '../persistence/saveLoad';
import { NEED_BUCKETS } from '../entities/Cohort';
import { getQuantity, addStock, removeStock } from '../entities/Inventory';
import {
  runCohortDemandSystem,
  crowdPurchasableStock,
} from '../systems/CohortDemandSystem';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Cohort demand (world-scale A3 slice 2)', () => {
  it('village towns stay dark: the crowd never spends because there is no crowd', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 5);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    // No money ever moved out of a cohort account.
    const cohortSpend = state.transactions.filter((t) => t.from.kind === 'cohort');
    expect(cohortSpend).toHaveLength(0);
  });

  it('the crowd shops the shelves: cohort-account revenue reaches firms and stats', () => {
    const sim = citySim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 8);

    // Direct settlements: cohort account -> firm account, booked as revenue.
    const crowdBuys = state.transactions.filter(
      (t) => t.from.kind === 'cohort' && t.category === 'revenue' && t.note.startsWith('Crowd bought'),
    );
    expect(crowdBuys.length).toBeGreaterThan(0);
    for (const t of crowdBuys) {
      expect(t.to.kind).toBe('firm');
      expect(t.quantity).toBeGreaterThan(0);
      expect(Number.isInteger(t.quantity)).toBe(true);
      expect(Number.isInteger(t.amount)).toBe(true);
    }

    // The purchases show up in the firms' books and the product market stats.
    let dailyStoreUnits = 0;
    for (const fid in state.facilities) {
      dailyStoreUnits += state.facilities[fid]!.dailyStats.unitsSold;
    }
    let historicUnits = 0;
    for (const pid in state.marketStats) {
      for (const h of state.marketStats[pid]!.history) historicUnits += h.unitsSold;
    }
    expect(dailyStoreUnits + historicUnits).toBeGreaterThan(0);
  });

  it('money is conserved to the cent and cohort pools never go negative over 15 days', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 15; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      for (const cid in state.cohorts) {
        expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('urgency buckets always stay in [0, 3]', () => {
    const sim = citySim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20);
    for (const cid in state.cohorts) {
      const buckets = state.cohorts[cid]!.needBuckets;
      for (const pid in buckets) {
        const b = buckets[pid]!;
        expect(b).toHaveLength(NEED_BUCKETS);
        for (const u of b) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('a city with an active crowd economy round-trips through save/load', () => {
    const sim = citySim(11);
    sim.run(ticksPerDay(sim.getState().config) * 6);
    const state = sim.getState();
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    // Buckets survive the trip intact.
    for (const cid in state.cohorts) {
      expect(again.cohorts[cid]!.needBuckets).toEqual(state.cohorts[cid]!.needBuckets);
    }
  });
});

/** Set every bread-selling store's bread shelf to exactly `qty` and return the
 * list of those stores — the contended shelves a test wants to control. */
function stockAllBreadStores(state: ReturnType<Simulation['getState']>, qty: number) {
  const stores = Object.values(state.facilities).filter((f) =>
    f.retailProductIds.includes('bread'),
  );
  for (const st of stores) {
    const have = getQuantity(st.inputInventory, 'bread');
    if (have > 0) removeStock(st.inputInventory, 'bread', have);
    addStock(st.inputInventory, 'bread', qty, 100);
  }
  return stores;
}

/** castShare exactly as CohortDemandSystem computes it for a slice. */
function castShareOf(state: ReturnType<Simulation['getState']>): number {
  const castPop = Object.keys(state.citizens).length;
  let crowdPop = 0;
  for (const cid in state.cohorts) crowdPop += state.cohorts[cid]!.population;
  return castPop + crowdPop > 0 ? castPop / (castPop + crowdPop) : 0;
}

describe('Cast stock reservation (soak finding (b): the crowd starves the cast)', () => {
  it('crowdPurchasableStock leaves the cast its rounded-up proportional share', () => {
    // No cast in town -> the crowd sees the whole shelf.
    expect(crowdPurchasableStock(100, 0)).toBe(100);
    // All demand is cast -> the crowd is fully reserved out.
    expect(crowdPurchasableStock(100, 1)).toBe(0);
    // Empty shelf reserves nothing to divide.
    expect(crowdPurchasableStock(0, 0.5)).toBe(0);
    // Rounds the reservation UP: 100 x 0.12 = 12 reserved -> crowd may buy 88.
    expect(crowdPurchasableStock(100, 0.12)).toBe(88);
    // A thin shelf still leaves the cast something: ceil(1 x 0.05) = 1 reserved,
    // so the crowd's purchasable stock is 0 and the last unit survives for the
    // cast's RetailDemandSystem.
    expect(crowdPurchasableStock(1, 0.05)).toBe(0);
  });

  it('the crowd cannot zero out a contended bread shelf within a slice', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const cfg = state.config;
    const tpd = ticksPerDay(cfg);
    // Warm the crowd's appetite so it tries to clear the shelf.
    sim.run(tpd * 6);
    // Jump to a shop-window slice boundary (hour 16 — a non-day-boundary hour,
    // so only the slice settles; no bucket growth). Stores are open 08-22.
    state.tick = 7 * tpd + 16 * cfg.ticksPerHour;

    const STOCK = 40;
    const breadStores = stockAllBreadStores(state, STOCK);
    expect(breadStores.length).toBeGreaterThan(0);
    const castShare = castShareOf(state);
    expect(castShare).toBeGreaterThan(0);

    // Run ONLY the crowd (not a full tick — the cast's RetailDemandSystem does
    // not run here), so what remains is exactly what the reservation protected.
    runCohortDemandSystem(makeContext(state));

    let taken = 0;
    for (const st of breadStores) {
      const left = getQuantity(st.inputInventory, 'bread');
      // The cast's share is never fully eaten: at least one unit always survives
      // for RetailDemandSystem, however hungry the crowd.
      expect(left).toBeGreaterThanOrEqual(1);
      taken += STOCK - left;
    }
    // Contention is live: the crowd DID draw the contended shelves down.
    expect(taken).toBeGreaterThan(0);
  });

  it('a single crowd cohort leaves at least the full reserved cast share', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const cfg = state.config;
    const tpd = ticksPerDay(cfg);
    sim.run(tpd * 6);
    state.tick = 7 * tpd + 16 * cfg.ticksPerHour;

    // Isolate ONE crowd cohort so the reservation is a single clean contention
    // step (with many cohorts each re-reserves against the already-drained
    // shelf, eroding the floor — that erosion is honest, just harder to assert).
    const cids = Object.keys(state.cohorts).sort();
    const active = cids
      .map((c) => state.cohorts[c]!)
      .sort((a, b) => b.population - a.population)[0]!;
    for (const c of cids) {
      if (state.cohorts[c] !== active) state.cohorts[c]!.population = 0;
    }
    expect(active.population).toBeGreaterThan(0);

    const STOCK = 80;
    const breadStores = stockAllBreadStores(state, STOCK);
    const castShare = castShareOf(state);
    const reserved = Math.ceil(STOCK * castShare);
    // A real proportional cut, not merely the one-unit floor.
    expect(reserved).toBeGreaterThan(1);

    runCohortDemandSystem(makeContext(state));

    for (const st of breadStores) {
      expect(getQuantity(st.inputInventory, 'bread')).toBeGreaterThanOrEqual(reserved);
    }
  });

  it('the cast still buys bread from the same shelves the crowd shops', () => {
    // In a warm city both demand streams settle onto the same bread stores each
    // day. Reservation constrains only the crowd's view, so cast purchases keep
    // landing — the fairness floor is a floor, not a wall.
    const sim = citySim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 8);

    const castBread = state.transactions.filter(
      (t) =>
        t.from.kind === 'citizen' &&
        t.category === 'revenue' &&
        t.productId === 'bread',
    );
    const crowdBread = state.transactions.filter(
      (t) =>
        t.from.kind === 'cohort' &&
        t.category === 'revenue' &&
        t.productId === 'bread',
    );
    expect(crowdBread.length).toBeGreaterThan(0); // the crowd shopped bread
    expect(castBread.length).toBeGreaterThan(0); // and the cast still could
  });

  it('village stays dark: the reservation path never runs without a crowd', () => {
    const sim = newSim(11);
    sim.run(ticksPerDay(sim.getState().config) * 3);
    const state = sim.getState();
    expect(Object.keys(state.cohorts)).toHaveLength(0);

    // Position at a slice boundary and snapshot every shelf, then invoke the
    // crowd system directly: with no crowd it must return before touching any
    // stock or booking any transaction (reservation code is unreachable).
    const cfg = state.config;
    state.tick = 4 * ticksPerDay(cfg) + 16 * cfg.ticksPerHour;
    const before = Object.values(state.facilities).map((f) => ({
      id: f.id,
      units: getQuantity(f.inputInventory, 'bread'),
    }));
    const txCount = state.transactions.length;
    runCohortDemandSystem(makeContext(state));
    for (const snap of before) {
      expect(getQuantity(state.facilities[snap.id]!.inputInventory, 'bread')).toBe(snap.units);
    }
    expect(state.transactions).toHaveLength(txCount);
  });

  it('money stays conserved to the cent with reservation active', () => {
    const sim = citySim(7);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 12; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
    }
  });
});
