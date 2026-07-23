import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG, type SimulationConfig } from '../core/SimulationConfig';
import { SCENARIOS, scenariosForWorld } from '../data/scenarios';
import { serialize, deserialize } from '../persistence/saveLoad';
import { normalizedSerialize } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';
import {
  computeCapacity,
  listedComputePrice,
  computeSeatDemand,
} from '../systems/ServiceBillingSystem';
import { marketCap, operatingValuationOf } from '../selectors/companySelectors';
import { smoothedProfitBase } from '../systems/DividendSystem';

/**
 * Grand Junction — the first City-scale scenario. These tests pin the three
 * things the scenario promises: it composes with the world-scale era flags (the
 * whole worldScaleConfig 'city' stack) into a solvent, conserved, in-band town;
 * it round-trips through save/load; the picker gates it to the City flow only;
 * and it is genuinely PLAYABLE — the era systems (compute, landlord leasing,
 * dividend stakes) all work from this start. Balance evidence (300d × 3 seeds,
 * bands measured against the City baseline) lives in
 * docs/design/probes/grand-junction.ts; here we assert the load shape and a
 * bounded scripted run.
 */

// The full City channel stack, exactly what worldScaleConfig('...','city') wires.
const CITY_CONFIG: SimulationConfig = {
  ...DEFAULT_CONFIG,
  sizePreset: 'city',
  servicesEnabled: true,
  realEstateEnabled: true,
  investorsEnabled: true,
  tradeDemandPoolsEnabled: true,
};

describe('Grand Junction scenario — load shape', () => {
  it('starts the two entrenched incumbents plus the thin clothes boutique', () => {
    const state = createInitialState(11, CITY_CONFIG, 'grand_junction');
    const names = Object.values(state.firms)
      .filter((f) => f.ownerType === 'ai')
      .map((f) => f.name)
      .sort();
    // The three authored chains + the auto-seeded compute provider (Cirrus,
    // stood up whenever services are on at a non-Village preset).
    expect(names).toContain('Junction Baking Co');
    expect(names).toContain('Ironline Supply Co');
    expect(names).toContain('Thimble & Co');
    expect(names).toContain('Cirrus Compute');
  });

  it('opens with the datacenter already operating (seats flow from day 0)', () => {
    const state = createInitialState(11, CITY_CONFIG, 'grand_junction');
    const datacenters = Object.values(state.facilities).filter((f) => f.type === 'datacenter');
    expect(datacenters.length).toBeGreaterThanOrEqual(1);
  });

  it('houses the cast tight (16 homes) so the landlord has a market', () => {
    const state = createInitialState(11, CITY_CONFIG, 'grand_junction');
    const homes = Object.values(state.facilities).filter((f) => f.type === 'home');
    expect(homes.length).toBe(16);
    // Cast fully housed at the start: occupancy pegs above the landlord bar.
    const residents = homes.reduce((n, h) => n + h.residentIds.length, 0);
    expect(residents).toBe(16 * 2);
  });

  it('the clothes boutique is deliberately weak — the player opening', () => {
    const state = createInitialState(11, CITY_CONFIG, 'grand_junction');
    const thimble = Object.values(state.firms).find((f) => f.name === 'Thimble & Co')!;
    const junction = Object.values(state.firms).find((f) => f.name === 'Junction Baking Co')!;
    // A far lighter brand and far less capital than the entrenched giants.
    expect(thimble.brandByProduct['clothes']!).toBeLessThan(junction.brandByProduct['bread']!);
    expect(thimble.cash).toBeLessThan(junction.cash);
    // But clothes IS on a shelf somewhere (supplied, not a starvation gap).
    const clothesSellers = Object.values(state.facilities).filter((f) =>
      f.retailProductIds.includes('clothes'),
    );
    expect(clothesSellers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Grand Junction scenario — runs and round-trips', () => {
  it('runs 120 days conserved, solvent, and does not collapse', () => {
    const sim = new Simulation(createInitialState(11, CITY_CONFIG, 'grand_junction'));
    sim.dispatch({ type: 'RESUME' });
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * 120);

    // Conserved to the cent.
    expect(totalMoneySupply(state)).toBe(supply0);

    // The founder filled the field and it stayed solvent — no collapse.
    const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(ai.length).toBeGreaterThanOrEqual(3);
    const insolvent = ai.filter((f) => f.bankruptcyStatus === 'insolvent').length;
    expect(insolvent).toBe(0);

    // The era archetypes actually engaged from this start: a landlord founded
    // under the housing squeeze (rent flows) and a holdco under the yields
    // (stakes flow) — both measured to arrive by ~day 62 across seeds 11/4/7.
    expect(Object.values(state.firms).some((f) => f.strategy.archetype === 'landlord')).toBe(true);
    expect(Object.values(state.firms).some((f) => f.strategy.archetype === 'investor')).toBe(true);
  });

  it('round-trips through save/load byte-identically at City scale', () => {
    const sim = new Simulation(createInitialState(11, CITY_CONFIG, 'grand_junction'));
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(sim.getState().config) * 40);

    const reloaded = new Simulation(deserialize(serialize(sim.getState())));
    // The scenario id survives the trip, and the whole state is identical.
    expect(reloaded.getState().scenarioId).toBe('grand_junction');
    expect(normalizedSerialize(reloaded.getState())).toBe(normalizedSerialize(sim.getState()));

    // Save == keep-running: another 60 days lands in the same place either way.
    reloaded.run(ticksPerDay(reloaded.getState().config) * 60);
    sim.run(ticksPerDay(sim.getState().config) * 60);
    expect(normalizedSerialize(reloaded.getState())).toBe(normalizedSerialize(sim.getState()));
  });
});

describe('Grand Junction scenario — picker gating', () => {
  it('is tagged for the City world scale only', () => {
    expect(SCENARIOS['grand_junction']!.worldScale).toBe('city');
  });

  it('never appears in the Village flow, and shows in the City flow', () => {
    const village = scenariosForWorld('village').map((s) => s.id);
    const city = scenariosForWorld('city').map((s) => s.id);
    const metro = scenariosForWorld('metropolis').map((s) => s.id);

    expect(village).not.toContain('grand_junction');
    expect(city).toContain('grand_junction');
    // City-tagged, so it is not offered at Metropolis either (its holdco channel
    // is city-scale only).
    expect(metro).not.toContain('grand_junction');

    // The classic towns stay available at every scale (Meadowbrook + City IS the
    // pinned City baseline), so the Village flow is never emptied.
    expect(village).toContain('meadowbrook');
    expect(city).toContain('meadowbrook');
  });
});

describe('Grand Junction scenario — playable from this start (200-day viability)', () => {
  it('a competent operator enters the underserved staple and uses the era systems', () => {
    const sim = new Simulation(createInitialState(11, CITY_CONFIG, 'grand_junction'));
    sim.dispatch({ type: 'RESUME' });
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    player.cash = 60000_00; // an operator with a foothold, the v8 playtest idiom
    const supply0 = totalMoneySupply(state);
    const netWorth0 = companyValuation(state, player.id).valuation;

    const facs = () => player.facilities.map((i) => state.facilities[i]!).filter(Boolean);

    const tickMsSamples: number[] = [];
    let built = false;
    let computeContractId: string | null = null;
    let stakeTarget: string | null = null;
    let leasedFacilityId: string | null = null;
    let leaseLandlordId: string | null = null;

    for (let d = 0; d < 200; d++) {
      const day = computeTime(state.tick, state.config).day;

      // Day 0: enter the underserved market — build a bread chain against the
      // entrenched giant (measured the stronger entry than the well-fed clothes
      // trade), and hire a manager so the shop prices itself (the v7/v8 idiom).
      if (!built) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
        const shop = facs().find((f) => f.type === 'retail');
        if (shop) sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 1 });
        built = true;
      }

      // C2 — subscribe to a compute provider once one prices reasonably (seats
      // flow from day 0; this proves the services channel is usable from here).
      if (!computeContractId && day >= 8 && computeSeatDemand(player) > 0) {
        for (const fid of Object.keys(state.firms).sort()) {
          if (fid === player.id) continue;
          const prov = state.firms[fid]!;
          const cap = computeCapacity(state, prov);
          if (cap <= 0) continue;
          let sold = 0;
          for (const cid in state.serviceContracts) {
            if (state.serviceContracts[cid]!.providerFirmId === fid) sold += state.serviceContracts[cid]!.seats;
          }
          if (cap - sold <= 0) continue;
          if (listedComputePrice(prov) > 300) continue;
          sim.dispatch({ type: 'SUBSCRIBE_SERVICE', firmId: player.id, providerFirmId: fid });
          const mine = Object.keys(state.serviceContracts).find(
            (cid) => state.serviceContracts[cid]!.subscriberFirmId === player.id,
          );
          if (mine) computeContractId = mine;
          break;
        }
      }

      // D2 — lease a second storefront from the landlord once one has founded
      // (rent flows: the tenant operates a premises the landlord owns on book).
      if (!leasedFacilityId && day >= 56) {
        const landlord = Object.values(state.firms).find(
          (f) => f.strategy.archetype === 'landlord' && f.bankruptcyStatus === 'healthy',
        );
        if (landlord) {
          const before = new Set(player.facilities);
          sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 132, y: 120 }, leaseFrom: landlord.id });
          const leased = facs().find((f) => !before.has(f.id) && f.landlordFirmId === landlord.id);
          if (leased) { leasedFacilityId = leased.id; leaseLandlordId = landlord.id; }
        }
      }

      // B2 — take a dividend stake in the fattest-yield healthy rival (stakes
      // flow: player parity with the holdco path). Target is computed, not
      // hardcoded — the scenario's firm ids differ from the default town.
      if (!stakeTarget && day >= 45) {
        let best = 0;
        let target: string | null = null;
        for (const fid of Object.keys(state.firms).sort()) {
          if (fid === player.id) continue;
          const o = state.firms[fid]!;
          if (o.ownerType !== 'ai' && o.ownerType !== 'player') continue;
          if (o.bankruptcyStatus !== 'healthy') continue;
          const base = smoothedProfitBase(o);
          if (base <= 0) continue;
          if (operatingValuationOf(state, fid) <= 0) continue;
          const mc = marketCap(state, fid);
          if (mc <= 0) continue;
          const y = base / mc;
          if (y > best) { best = y; target = fid; }
        }
        if (target) {
          sim.dispatch({ type: 'BUY_SHARES', firmId: player.id, targetFirmId: target, percent: 5 });
          if ((player.sharesHeld[target] ?? 0) > 0) stakeTarget = target;
        }
      }

      // Keep the player's PRODUCTIVE facilities staffed (the v7/v8 target-2 idiom).
      // A leased storefront left as a bare shell (no product on its shelves) is
      // not staffed — staffing an empty shop only bleeds wages.
      for (const fac of facs()) {
        const productive = fac.type !== 'home' && fac.defId !== 'apartment' &&
          (fac.activeRecipeId != null || fac.retailProductIds.length > 0);
        const target = productive ? 2 : 0;
        if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
      }

      // Run the day tick-by-tick so we can sample per-tick wall time for the
      // contention-robust perf guard below (sim.run() would hide lastTickMs).
      for (let t = 0; t < tpd; t++) {
        sim.tick();
        tickMsSamples.push(state.perf.lastTickMs);
      }
    }

    // Solvent, grew, conserved: the scenario is playable to a materially larger
    // book from its own start, not just survivable. Measured at seeds 11/4/7 the
    // book grows +$9.5k / +$11.4k / +$27.4k; the floor sits well under the
    // smallest (the v7/v8 convention) so seed-adjacent drift never flakes.
    const netWorth = companyValuation(state, player.id).valuation;
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.bankruptcyStatus).toBe('healthy');
    expect(netWorth).toBeGreaterThan(netWorth0 + 4000_00);
    // Perf guard — contention-robust (measured re-design, not a widening). The
    // old assertion read state.perf.avgTickMs, an EWMA *mean*, and flaked under
    // a full parallel vitest run: a loaded machine adds a long right tail to
    // individual ticks and the mean absorbs it, even though the sim itself is
    // never slower. The *median* per-tick wall time is contention-invariant —
    // contention lands in p90+/max, not the middle of the distribution.
    // Measured here (seed 11, 200 days, ~9600 ticks), median vs the old EWMA:
    //   isolated (2-file):        median 0.246 ms   ewma 1.90
    //   full suite + 6 busy procs pinned to 4 cores (3 back-to-back runs):
    //     run 1  median 0.241 ms   ewma 3.32   (old <2 bound → RED)
    //     run 2  median 0.253 ms   ewma 6.14   (old <2 bound → RED)
    //     run 3  median 0.238 ms   ewma 4.78   (old <2 bound → RED)
    // The median wobbles <5% across a >12x swing in the mean. Bound 1.5 ms is
    // ~6x over the worst observed median: it tolerates a ~6x-slower CI runner
    // at true typical cost yet still trips on the per-tick regression class this
    // guards (an O(n²) hot loop, an unbounded log scanned every tick, a daily
    // system firing every tick) — each pushes the *median* far past 1.5 ms
    // (verified fails-on-revert: injecting a ~2ms busy-loop into a per-tick
    // system drives the median to ~2.2 ms → RED). perfGuard.test.ts is the
    // catastrophic-blowup companion.
    const tickMsMedian = [...tickMsSamples].sort((a, b) => a - b)[
      Math.floor(tickMsSamples.length / 2)
    ]!;
    expect(tickMsMedian).toBeLessThan(1.5);

    // The player entered the underserved staple and now sells bread.
    expect(facs().some((f) => f.retailProductIds.includes('bread'))).toBe(true);

    // Each era leg is asserted only if it played; on seed 11 all three engage
    // from this start, so the log must be empty (a non-empty entry names the
    // regressed leg — the citysmoke idiom).
    const skipped: string[] = [];
    if (computeContractId !== null) {
      expect(player.accounting.lifetime.serviceExpense).toBeGreaterThan(0);
    } else skipped.push('C2 compute: no provider quoted at/under the bar with free seats');
    if (leasedFacilityId !== null) {
      const leased = state.facilities[leasedFacilityId]!;
      expect(leased.landlordFirmId).toBe(leaseLandlordId);
      expect(leased.ownerFirmId).toBe(player.id);
      expect(player.accounting.lifetime.rentExpense).toBeGreaterThan(0);
    } else skipped.push('D2 lease: no solvent landlord founded able to finance a premises');
    if (stakeTarget !== null) {
      expect(player.sharesHeld[stakeTarget] ?? 0).toBeGreaterThanOrEqual(5);
    } else skipped.push('B2 stake: no healthy rival carried a positive trailing yield');
    expect(skipped).toEqual([]);
  }, 60000);
});
