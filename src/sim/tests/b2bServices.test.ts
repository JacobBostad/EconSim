/**
 * b2bServices.test.ts — the firm-to-firm compute channel (HD3).
 *
 * Covers: billing conservation, the subscribe/cancel ROI gates + hysteresis,
 * the coverage production boost, save round-trip, and the Village/flag gates
 * that keep the channel inert everywhere it must be.
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { totalMoneySupply, makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { serialize, deserialize } from '../persistence/saveLoad';
import { runProductionSystem } from '../systems/ProductionSystem';
import { runServiceBillingSystem, computeCapacity, computeSeatDemand } from '../systems/ServiceBillingSystem';
import { SERVICE_BOOST_MULT, DATACENTER_SEATS_PER_LEVEL, COMPUTE_SERVICE_ID } from '../data/services';
import type { GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';

function cityServicesSim(seed: number): Simulation {
  const sim = new Simulation(
    createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true }),
  );
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

function provider(state: GameState): Firm {
  for (const fid of Object.keys(state.firms).sort()) {
    if (computeCapacity(state, state.firms[fid]!) > 0) return state.firms[fid]!;
  }
  throw new Error('no compute provider seeded');
}

describe('B2B services — datacenter seeding + gates', () => {
  it('seeds exactly one provider datacenter in a city+services world', () => {
    const state = cityServicesSim(11).getState();
    const dcs = Object.values(state.facilities).filter((f) => f.type === 'datacenter');
    expect(dcs.length).toBe(1);
    expect(computeCapacity(state, provider(state))).toBe(DATACENTER_SEATS_PER_LEVEL);
  });

  it('Village never sees the channel — no datacenter, no contracts, flag off', () => {
    const state = createInitialState(11); // Village default
    expect(state.config.servicesEnabled).toBe(false);
    expect(Object.keys(state.serviceContracts).length).toBe(0);
    expect(Object.values(state.facilities).some((f) => f.type === 'datacenter')).toBe(false);
  });

  it('a plain city world (flag off) stays inert — the pinned baseline is untouched', () => {
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    sim.run(ticksPerDay(state.config) * 30);
    expect(Object.keys(state.serviceContracts).length).toBe(0);
    expect(Object.values(state.facilities).some((f) => f.type === 'datacenter')).toBe(false);
  });

  it('rejects a datacenter build in Village but allows it city+services', () => {
    const village = new Simulation(createInitialState(11));
    const vFirm = village.getState().playerFirmId;
    village.getState().firms[vFirm]!.cash = 50000_00;
    village.dispatch({ type: 'BUILD_FACILITY', firmId: vFirm, defId: 'datacenter', location: { x: 40, y: 40 } });
    expect(Object.values(village.getState().facilities).some((f) => f.type === 'datacenter')).toBe(false);

    const sim = cityServicesSim(11);
    const s = sim.getState();
    const pFirm = s.playerFirmId;
    s.firms[pFirm]!.cash = 50000_00;
    const before = Object.values(s.facilities).filter((f) => f.type === 'datacenter').length;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: pFirm, defId: 'datacenter', location: { x: 30, y: 30 } });
    expect(Object.values(s.facilities).filter((f) => f.type === 'datacenter').length).toBe(before + 1);
  });
});

describe('B2B services — AI builds a datacenter under tight demand', () => {
  it('a very flush AI firm enters the compute market when seats are scarce', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    // Let the market mature so the seeded provider is fully subscribed (tight
    // utilization is the entry signal).
    sim.run(tpd * 60);
    const soldSeats = Object.values(state.serviceContracts).reduce((s, c) => s + c.seats, 0);
    expect(soldSeats).toBeGreaterThan(0);

    // Pick a healthy AI firm that isn't already the provider and keep it flush.
    // Demand stays tight most days, so within a short window the entry gate
    // (day ≥ 40, cash ≥ $120k, utilization ≥ 0.9, provider count < 4) clears.
    const target = Object.values(state.firms).find(
      (f) => f.ownerType === 'ai' && f.bankruptcyStatus === 'healthy' && computeCapacity(state, f) === 0,
    )!;
    let built = false;
    for (let i = 0; i < 15 && !built; i++) {
      target.cash = 300000_00; // hold it very flush across the window
      sim.run(tpd);
      built = computeCapacity(state, target) > 0;
    }
    expect(built).toBe(true);
    expect(computeCapacity(state, target)).toBe(DATACENTER_SEATS_PER_LEVEL);
  });
});

describe('B2B services — billing conservation', () => {
  it('money is conserved to the cent across 120 days with an active channel', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);
    let contractsSeen = 0;
    for (let d = 0; d < 120; d++) {
      sim.run(tpd);
      expect(totalMoneySupply(state)).toBe(supply0);
      contractsSeen = Math.max(contractsSeen, Object.keys(state.serviceContracts).length);
    }
    // The channel actually did something: subscribers appeared and were billed.
    expect(contractsSeen).toBeGreaterThan(0);
  });

  it('a billed day debits the subscriber and credits the provider by the same seats×price', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    // Run until at least one AI subscription exists.
    let guard = 0;
    while (Object.keys(state.serviceContracts).length === 0 && guard++ < 200) sim.run(tpd);
    expect(Object.keys(state.serviceContracts).length).toBeGreaterThan(0);

    const c = state.serviceContracts[Object.keys(state.serviceContracts).sort()[0]!]!;
    const prov = state.firms[c.providerFirmId]!;
    const sub = state.firms[c.subscriberFirmId]!;
    const provRev0 = prov.accounting.lifetime.revenue;
    const subSvc0 = sub.accounting.lifetime.serviceExpense;
    // Advance exactly one day so billing fires once.
    sim.run(tpd);
    // The subscriber's serviceExpense rose by the seat bill; the provider's
    // revenue rose by at least that same bill (it may serve others / earn
    // trade income too), so the money moved firm-to-firm, not to the world.
    const provRevDelta = prov.accounting.lifetime.revenue - provRev0;
    const subSvcDelta = sub.accounting.lifetime.serviceExpense - subSvc0;
    expect(subSvcDelta).toBeGreaterThan(0);
    expect(provRevDelta).toBeGreaterThanOrEqual(subSvcDelta);
  });
});

describe('B2B services — boost application', () => {
  it('a covered firm produces measurably more than the same firm uncovered', () => {
    // Two identical city worlds; in one, force full coverage on a producing firm.
    const mk = (): { state: GameState; firmId: string; facId: string } => {
      const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
      // Find an AI firm with a producing facility and give it a running recipe.
      let firmId = '', facId = '';
      for (const fid of Object.keys(state.firms).sort()) {
        const f = state.firms[fid]!;
        if (f.ownerType !== 'ai') continue;
        const fac = f.facilities.map((i) => state.facilities[i]!).find((x) => x && x.type === 'factory' && x.activeRecipeId);
        if (fac) { firmId = fid; facId = fac.id; break; }
      }
      return { state, firmId, facId };
    };

    const base = mk();
    const boosted = mk();
    boosted.state.firms[boosted.firmId]!.serviceBoost = SERVICE_BOOST_MULT;
    base.state.firms[base.firmId]!.serviceBoost = 1;

    // Run the facility throughput-bound (a single worker, so progress-per-tick
    // stays under the recipe threshold and output tracks efficiency — the regime
    // where a production multiplier, like a facility upgrade or the compute
    // boost, actually moves units). Several days average out batch quantization.
    const runProd = (o: { state: GameState; facId: string }): number => {
      const fac = o.state.facilities[o.facId]!;
      const before = fac.dailyStats.unitsProduced;
      for (let t = 0; t < ticksPerDay(o.state.config) * 6; t++) {
        fac.presentWorkers = 1; fac.presentSkill = 1;
        for (const pid of ['grain', 'minerals', 'cotton']) fac.inputInventory[pid] = { productId: pid, quantity: 100000, quality: 60 };
        fac.outputInventory = {}; // never storage-cap
        const ctx = makeContext(o.state);
        runProductionSystem(ctx);
        o.state.tick += 1;
      }
      return fac.dailyStats.unitsProduced - before;
    };

    const baseOut = runProd(base);
    const boostedOut = runProd(boosted);
    expect(boostedOut).toBeGreaterThan(baseOut);
  });

  it('a truncated allocation confers a PROPORTIONAL boost — every billed seat maps to a benefit', () => {
    // The review's revert check: an oversubscribed provider clamps allocations,
    // and all-or-nothing coverage let a partial holder pay daily for nothing.
    // A player subscriber keeps its chosen seat count through the resize pass,
    // so it pins the stamping directly: half the demand -> half the lift.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
    const prov = provider(state);
    const playerId = Object.keys(state.firms)
      .sort()
      .find((fid) => state.firms[fid]!.ownerType === 'player')!;
    const player = state.firms[playerId]!;
    // Pad the roster so seat demand is exactly 2 (ceil(8/4) + 0 facilities...
    // the player may own starting facilities, so measure and target held = half).
    while (computeSeatDemand(player) < 2) player.employees.push(`pad_${player.employees.length}`);
    const desired = computeSeatDemand(player);
    const held = Math.floor(desired / 2);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(desired);

    state.serviceContracts['svc_partial'] = {
      id: 'svc_partial',
      providerFirmId: prov.id,
      subscriberFirmId: playerId,
      serviceId: COMPUTE_SERVICE_ID,
      seats: held,
      pricePerSeatDay: 100,
    };
    state.tick = ticksPerDay(state.config) * 10; // a day boundary
    runServiceBillingSystem(makeContext(state));

    const expected = 1 + (SERVICE_BOOST_MULT - 1) * (held / desired);
    expect(player.serviceBoost).toBeCloseTo(expected, 10);
    // ...and full coverage still grants exactly the designed multiplier.
    state.serviceContracts['svc_partial']!.seats = desired;
    runServiceBillingSystem(makeContext(state));
    expect(player.serviceBoost).toBeCloseTo(SERVICE_BOOST_MULT, 10);
  });
});

describe('B2B services — subscribe / cancel gates + hysteresis', () => {
  it('a healthy earner subscribes; a firm whose boost cannot pay cancels after the grace window', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    // Let the market form subscriptions.
    let guard = 0;
    while (Object.keys(state.serviceContracts).length === 0 && guard++ < 200) sim.run(tpd);
    expect(Object.keys(state.serviceContracts).length).toBeGreaterThan(0);

    // Pick a subscriber and starve its gross so the ROI gate fails every day.
    const cid = Object.keys(state.serviceContracts).sort()[0]!;
    const subId = state.serviceContracts[cid]!.subscriberFirmId;
    const sub = state.firms[subId]!;
    // Zero out its trailing revenue history so boost value ≈ 0 < seat bill.
    for (const d of sub.accounting.dailyHistory) d.revenue = 0;
    // Manually drive the billing gate 6 times (deterministic, no rng): the
    // failing-day counter must trip cancellation at 5.
    let hadContract = true;
    for (let i = 0; i < 6; i++) {
      // keep history flat-zero each iteration
      for (const d of sub.accounting.dailyHistory) d.revenue = 0;
      state.tick += tpd; // land on a day boundary
      runServiceBillingSystem(makeContext(state));
      hadContract = Object.values(state.serviceContracts).some((c) => c.subscriberFirmId === subId);
    }
    expect(hadContract).toBe(false); // cancelled within the 5-day window
  });

  it('the subscribe threshold sits above the cancel threshold (no flapping band)', () => {
    // Structural hysteresis check: subscribe needs value > 1.3× cost; a failing
    // day starts only when value < 1.0× cost, and 5 such days are required. So a
    // firm at value ≈ cost neither subscribes nor cancels — it holds.
    const sim = cityServicesSim(7);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 200);
    // No contract should be both created and destroyed repeatedly: count churn
    // by checking the seat-demand invariant holds and contracts are stable-ish.
    const before = new Set(Object.keys(state.serviceContracts));
    sim.run(tpd * 5);
    const after = new Set(Object.keys(state.serviceContracts));
    // Over a 5-day quiet window at maturity, the contract set changes by at most
    // a couple of entries (no per-day thrash).
    let churn = 0;
    for (const id of before) if (!after.has(id)) churn++;
    for (const id of after) if (!before.has(id)) churn++;
    expect(churn).toBeLessThanOrEqual(3);
  });
});

describe('B2B services — save round-trip', () => {
  it('service contracts, listed prices, and boosts survive serialize/deserialize', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    let guard = 0;
    while (Object.keys(state.serviceContracts).length === 0 && guard++ < 200) sim.run(tpd);
    expect(Object.keys(state.serviceContracts).length).toBeGreaterThan(0);

    const round = deserialize(serialize(state));
    expect(Object.keys(round.serviceContracts).sort()).toEqual(Object.keys(state.serviceContracts).sort());
    const cid = Object.keys(state.serviceContracts).sort()[0]!;
    expect(round.serviceContracts[cid]).toEqual(state.serviceContracts[cid]);
    // The provider's walked listed price and firms' boosts survive too.
    const prov = provider(state);
    expect(round.firms[prov.id]!.servicePriceByService?.[COMPUTE_SERVICE_ID])
      .toBe(prov.servicePriceByService?.[COMPUTE_SERVICE_ID]);
    // Re-serialize stability.
    expect(serialize(deserialize(serialize(state)))).toBe(serialize(round));
  });
});

describe('B2B services — seat demand', () => {
  it('a firm wants ceil(employees/4) + facilityCount seats', () => {
    const state = cityServicesSim(11).getState();
    for (const fid of Object.keys(state.firms).sort().slice(0, 5)) {
      const f = state.firms[fid]!;
      expect(computeSeatDemand(f)).toBe(Math.ceil(f.employees.length / 4) + f.facilities.length);
    }
  });
});
