import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { serialize, deserialize } from '../persistence/saveLoad';
import { runCrowdRentSystem, rentAffordFactor } from '../systems/CrowdRentSystem';
import { APARTMENT_CAPACITY, CROWD_RENT_PER_DAY } from '../data/constants';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

/** Total crowd rent that left the cohort pools (both legs: apartments + world). */
function crowdRentTx(state: ReturnType<Simulation['getState']>) {
  return state.transactions.filter(
    (t) =>
      t.from.kind === 'cohort' &&
      (t.note === 'Crowd housing' || t.note.startsWith('Crowd rent')),
  );
}

describe('Crowd housing costs (A3 / HD4 — the pool-drift sink)', () => {
  it('village stays dark: no crowd, no housing cost, apartment crowdTenants never set', () => {
    const sim = newSim(11);
    const state = sim.getState();
    // A player apartment with cast tenants exists — the crowd path must still
    // never touch it (there is no crowd).
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 43, y: 64 } });

    sim.run(ticksPerDay(state.config) * 5);
    expect(Object.keys(state.cohorts)).toHaveLength(0);
    expect(crowdRentTx(state)).toHaveLength(0);
    for (const fid in state.facilities) {
      expect(state.facilities[fid]!.crowdTenants).toBe(0);
    }

    // Invoking the system directly at a day boundary is a no-op with no crowd.
    state.tick = ticksPerDay(state.config) * 6;
    const txCount = state.transactions.length;
    runCrowdRentSystem(makeContext(state));
    expect(state.transactions).toHaveLength(txCount);
  });

  it('the city pool plateaus instead of climbing (120 days)', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);

    const perCapAt: Record<number, number> = {};
    for (let day = 1; day <= 120; day++) {
      sim.run(tpd);
      if (day % 10 === 0) {
        let pop = 0, pool = 0;
        for (const cid in state.cohorts) {
          pop += state.cohorts[cid]!.population;
          pool += state.cohorts[cid]!.cashPool;
        }
        perCapAt[day] = pop > 0 ? pool / pop : 0;
      }
    }

    // Bounded, not the $900-1,360/cap runaway the baseline soak measured.
    expect(perCapAt[120]!).toBeLessThan(500_00);
    // The sink bites: per-capita drift across days 40->120 is a fraction of the
    // measured $3.7-4.4/cap/day, i.e. the pool has stopped climbing.
    const driftPerDay = (perCapAt[120]! - perCapAt[40]!) / 80;
    expect(driftPerDay).toBeLessThan(200); // < $2.00/cap/day

    // Not monotonically increasing in the last 40 days: the pool dips from its
    // recent peak (immigration dilutes per-capita whenever it fires), so day
    // 120 is not the high-water mark of the window.
    const last40 = [80, 90, 100, 110, 120].map((d) => perCapAt[d]!);
    const peak = Math.max(...last40);
    expect(perCapAt[120]!).toBeLessThan(peak);
  });

  it('an apartment landlord earns crowd rent from its spare capacity', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 20); // warm the pools well above the affordability buffer

    // Build a player apartment in the residential district (The Rows, y >= 56).
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 43, y: 64 } });
    const apt = Object.values(state.facilities).find(
      (f) => f.defId === 'apartment' && f.ownerFirmId === player.id,
    )!;
    expect(apt.residentIds.length).toBeLessThan(APARTMENT_CAPACITY); // has spare capacity

    const cashBefore = player.cash;
    apt.dailyStats.revenue = 0;
    state.tick = tpd * 21; // a clean day boundary
    runCrowdRentSystem(makeContext(state));

    // Crowd filled the block's spare capacity and paid the owner as revenue.
    expect(apt.crowdTenants).toBeGreaterThan(0);
    expect(apt.dailyStats.revenue).toBeGreaterThan(0);
    expect(player.cash).toBe(cashBefore + apt.dailyStats.revenue);

    const landlordTx = state.transactions.filter(
      (t) =>
        t.from.kind === 'cohort' &&
        t.to.kind === 'firm' &&
        t.to.id === player.id &&
        t.category === 'revenue' &&
        t.note.startsWith('Crowd rent'),
    );
    expect(landlordTx.length).toBeGreaterThan(0);
    // Booked as revenue on the firm's P&L, exactly like cast rent.
    expect(player.accounting.today.revenue).toBeGreaterThanOrEqual(apt.dailyStats.revenue);
  });

  it('a well-funded cohort pays the full per-capita rent', () => {
    const sim = citySim(4);
    const state = sim.getState();
    const cid = Object.keys(state.cohorts).sort()[0]!;
    const co = state.cohorts[cid]!;
    // Push the pool far above the 30-day buffer so the affordability factor is 1.
    co.cashPool = co.population * CROWD_RENT_PER_DAY * 100;
    // Isolate this one cohort (no apartments at day 0 -> all rent is informal).
    for (const other of Object.keys(state.cohorts)) {
      if (other !== cid) state.cohorts[other]!.population = 0;
    }
    expect(rentAffordFactor(co)).toBe(1);

    const poolBefore = co.cashPool;
    state.tick = ticksPerDay(state.config);
    runCrowdRentSystem(makeContext(state));
    // Full rent: population x CROWD_RENT_PER_DAY, to the world (informal housing).
    expect(poolBefore - co.cashPool).toBe(co.population * CROWD_RENT_PER_DAY);
    const informal = crowdRentTx(state).filter((t) => t.note === 'Crowd housing');
    expect(informal.length).toBe(1);
    expect(informal[0]!.to.kind).toBe('world');
  });

  it('the affordability guard protects a drained cohort — reduced rent, never negative', () => {
    const sim = citySim(7);
    const state = sim.getState();
    const cid = Object.keys(state.cohorts).sort()[0]!;
    const co = state.cohorts[cid]!;
    for (const other of Object.keys(state.cohorts)) {
      if (other !== cid) state.cohorts[other]!.population = 0;
    }

    // Half the 30-day buffer -> affordability factor 0.5, so rent is halved.
    co.cashPool = Math.floor(co.population * CROWD_RENT_PER_DAY * 15);
    expect(rentAffordFactor(co)).toBeCloseTo(0.5, 5);
    const fullRent = co.population * CROWD_RENT_PER_DAY;
    const poolBefore = co.cashPool;

    state.tick = ticksPerDay(state.config);
    runCrowdRentSystem(makeContext(state));
    const paid = poolBefore - co.cashPool;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(fullRent); // reduced, not full
    expect(co.cashPool).toBeGreaterThanOrEqual(0);

    // A fully drained pool pays a negligible rent and never goes negative: the
    // factor collapses toward 0, so the charge is at most a couple of cents.
    co.cashPool = 50; // 50 cents against a ~$27,000 buffer
    state.tick = ticksPerDay(state.config) * 2;
    runCrowdRentSystem(makeContext(state));
    expect(co.cashPool).toBeGreaterThanOrEqual(0);
    expect(co.cashPool).toBeGreaterThan(45); // barely touched, not collapsed
  });

  it('money is conserved to the cent with crowd rent flowing', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    for (let d = 0; d < 20; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      for (const cid in state.cohorts) {
        expect(state.cohorts[cid]!.cashPool).toBeGreaterThanOrEqual(0);
      }
    }
    // Both rent legs are live: apartment revenue (if any apt was built) and the
    // world informal stream.
    expect(crowdRentTx(state).length).toBeGreaterThan(0);
  });

  it('a city with crowd rent round-trips through save/load, crowdTenants intact', () => {
    const sim = citySim(11);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 43, y: 64 } });
    sim.run(ticksPerDay(state.config) * 8);

    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
    for (const fid in state.facilities) {
      expect(again.facilities[fid]!.crowdTenants).toBe(state.facilities[fid]!.crowdTenants);
    }
  });
});
