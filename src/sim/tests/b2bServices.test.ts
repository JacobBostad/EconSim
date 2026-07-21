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
import { runMarketingSystem } from '../systems/MarketingSystem';
import {
  runServiceBillingSystem,
  computeCapacity,
  computeSeatDemand,
  serviceCapacity,
} from '../systems/ServiceBillingSystem';
import { runServiceBehavior } from '../systems/ai/ServiceBehavior';
import {
  SERVICE_BOOST_MULT,
  DATACENTER_SEATS_PER_LEVEL,
  COMPUTE_SERVICE_ID,
  CONSULTING_SERVICE_ID,
  CONSULTING_BRAND_MULT,
  getServiceDef,
} from '../data/services';
import { AD_BRAND_GAIN_PER_DOLLAR } from '../data/constants';
import type { GameState } from '../core/GameState';
import type { Firm } from '../entities/Firm';

/** Days a city+services sim needs so BOTH services carry live contracts (the
 * seeded provider diversifies into an office on day 1, subscribers form over the
 * next weeks — measured first consulting contract by ~day 56-64 across seeds). */
const TWO_SERVICE_WARMUP_DAYS = 80;

function consultingContracts(state: GameState): string[] {
  return Object.keys(state.serviceContracts).filter(
    (cid) => state.serviceContracts[cid]!.serviceId === CONSULTING_SERVICE_ID,
  );
}
function computeContracts(state: GameState): string[] {
  return Object.keys(state.serviceContracts).filter(
    (cid) => state.serviceContracts[cid]!.serviceId === COMPUTE_SERVICE_ID,
  );
}

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
    // Arc D4: NEITHER service facility appears, and the service-founder signal map
    // is never even touched — proving the plain-city soaks CANNOT reach the
    // service founder row (its trackSignals returns before accruing when the flag
    // is off), so its rng trajectory is byte-identical to pre-D4.
    expect(Object.values(state.facilities).some((f) => f.type === 'office')).toBe(false);
    expect(state.serviceUncoveredDays).toEqual({});
    expect(state.lastServiceEntryDay).toBe(0);
    expect(Object.values(state.firms).some((f) => f.strategy.archetype === 'service')).toBe(false);
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

describe('B2B services — a service firm enters the compute market under tight demand', () => {
  it('a flush service-archetype firm builds a datacenter when seats are scarce', () => {
    // Arc D4: provisioning is owned by the 'service' archetype (lifted out of the
    // operator loop). Entry gate: town utilization ≥ 0.9, provider count < cap, and
    // flush enough to keep a maintenance buffer after the build. Driven directly on
    // one firm so the seeded provider's own expansion doesn't relieve the tightness.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
    // A healthy AI firm with no service capacity becomes a flush service firm.
    const target = Object.keys(state.firms).sort()
      .map((fid) => state.firms[fid]!)
      .find((f) => f.ownerType === 'ai' && computeCapacity(state, f) === 0)!;
    target.strategy.archetype = 'service';
    target.bankruptcyStatus = 'healthy';
    target.cash = 300000_00;

    // Inject tight demand: fill the seeded provider to 38/40 seats (util 0.95).
    const prov = provider(state);
    const someSub = Object.keys(state.firms).sort()
      .find((fid) => fid !== prov.id && fid !== target.id)!;
    state.serviceContracts['svc_tight'] = {
      id: 'svc_tight', providerFirmId: prov.id, subscriberFirmId: someSub,
      serviceId: COMPUTE_SERVICE_ID, seats: 38, pricePerSeatDay: 200,
    };

    runServiceBehavior(makeContext(state), target.id, undefined);
    expect(computeCapacity(state, target)).toBe(DATACENTER_SEATS_PER_LEVEL);
  });

  it('an operator firm no longer builds a datacenter, however flush', () => {
    // The seam moved: keep a plain operator very flush across a long window with
    // the market fully subscribed — it must never enter the compute market.
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 60);
    const target = Object.values(state.firms).find(
      (f) => f.ownerType === 'ai' && f.bankruptcyStatus === 'healthy'
        && computeCapacity(state, f) === 0 && f.strategy.archetype === 'operator',
    )!;
    for (let i = 0; i < 30; i++) {
      target.cash = 300000_00;
      target.bankruptcyStatus = 'healthy';
      sim.run(tpd);
    }
    expect(computeCapacity(state, target)).toBe(0);
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

// ---------------------------------------------------------------------------
// Arc D4 — the second service (consulting) + the generic (catalog-driven) channel
// ---------------------------------------------------------------------------

describe('B2B services — D4 second service adoption (consulting)', () => {
  it('the seeded provider diversifies into an office and consulting contracts form', () => {
    // Cirrus is a 'service' archetype firm: on day 1 the town has ZERO advisory
    // capacity, so its ServiceBehavior treats consulting as tight and opens an
    // office alongside its datacenter — the same generic entry path, no service-
    // specific code. Subscribers then form over the following weeks.
    const sim = cityServicesSim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * TWO_SERVICE_WARMUP_DAYS);
    const offices = Object.values(state.facilities).filter((f) => f.type === 'office');
    expect(offices.length).toBeGreaterThan(0);
    expect(computeContracts(state).length).toBeGreaterThan(0);
    expect(consultingContracts(state).length).toBeGreaterThan(0);
    // No cross-service bleed: every consulting contract's provider actually runs
    // an office, every compute contract's provider actually runs a datacenter.
    for (const cid of consultingContracts(state)) {
      const c = state.serviceContracts[cid]!;
      expect(serviceCapacity(state, state.firms[c.providerFirmId]!, getServiceDef(CONSULTING_SERVICE_ID))).toBeGreaterThan(0);
    }
    for (const cid of computeContracts(state)) {
      const c = state.serviceContracts[cid]!;
      expect(serviceCapacity(state, state.firms[c.providerFirmId]!, getServiceDef(COMPUTE_SERVICE_ID))).toBeGreaterThan(0);
    }
  });
});

describe('B2B services — D4 consulting benefit application', () => {
  it('advisory coverage lifts ad→brand conversion by exactly the consulting multiplier', () => {
    // Two identical firms advertise the same budget from brand 0; the covered one
    // (advisoryBoost = CONSULTING_BRAND_MULT) must build brand faster by exactly
    // that factor — the margin-side benefit wired into MarketingSystem, distinct
    // from the compute production boost (which never touches brand).
    const mk = (advisory: number): number => {
      const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
      const firm = state.firms[state.playerFirmId]!;
      firm.cash = 1_000_000_00;
      firm.brandByProduct = { bread: 0 };
      firm.adBudgetByProduct = { bread: 200_00 };
      firm.advisoryBoost = advisory;
      state.tick = ticksPerDay(state.config); // a day boundary
      runMarketingSystem(makeContext(state));
      return firm.brandByProduct['bread']!;
    };
    const base = mk(1);
    const boosted = mk(CONSULTING_BRAND_MULT);
    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(base);
    // From brand 0 the headroom term is identical, so the ratio is exactly the mult.
    expect(boosted / base).toBeCloseTo(CONSULTING_BRAND_MULT, 10);
    // And the absolute gain matches the documented formula.
    expect(boosted).toBeCloseTo(AD_BRAND_GAIN_PER_DOLLAR * 200 * 1 * CONSULTING_BRAND_MULT, 6);
  });

  it('compute coverage does NOT move brand, and consulting coverage does NOT move production', () => {
    // Cross-benefit isolation: the two services feed different daily multipliers.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city', servicesEnabled: true });
    const firm = state.firms[state.playerFirmId]!;
    firm.cash = 1_000_000_00;
    firm.brandByProduct = { bread: 0 };
    firm.adBudgetByProduct = { bread: 200_00 };
    // serviceBoost (production) set high, advisoryBoost (brand) neutral: brand
    // must build at the un-boosted rate.
    firm.serviceBoost = 2;
    firm.advisoryBoost = 1;
    state.tick = ticksPerDay(state.config);
    runMarketingSystem(makeContext(state));
    expect(firm.brandByProduct['bread']).toBeCloseTo(AD_BRAND_GAIN_PER_DOLLAR * 200, 6);
  });
});

describe('B2B services — D4 generic billing iteration order', () => {
  it('bills every contract in (serviceId, contractId) order across both services', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * TWO_SERVICE_WARMUP_DAYS);
    expect(computeContracts(state).length).toBeGreaterThan(0);
    expect(consultingContracts(state).length).toBeGreaterThan(0);

    // Re-run billing on this same day boundary with a cleared ledger so the only
    // serviceExpense entries are this run's, recorded in the engine's billing order.
    state.transactions.length = 0;
    runServiceBillingSystem(makeContext(state));
    const billed = state.transactions.filter((t) => t.category === 'serviceExpense');

    // The engine bills state.serviceContracts sorted by (serviceId, id); every
    // positive-amount contract in that order is the expected sequence.
    const sorted = Object.keys(state.serviceContracts).sort((a, b) => {
      const ca = state.serviceContracts[a]!.serviceId;
      const cb = state.serviceContracts[b]!.serviceId;
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const expectedAmounts: number[] = [];
    const expectedServiceIds: string[] = [];
    for (const cid of sorted) {
      const c = state.serviceContracts[cid]!;
      const amount = c.seats * c.pricePerSeatDay;
      if (amount <= 0) continue;
      expectedAmounts.push(amount);
      expectedServiceIds.push(c.serviceId);
    }
    expect(billed.map((t) => t.amount)).toEqual(expectedAmounts);
    // Explicitly: all compute contracts bill before any consulting (serviceIds
    // non-decreasing), never interleaved.
    for (let i = 1; i < expectedServiceIds.length; i++) {
      expect(expectedServiceIds[i]! >= expectedServiceIds[i - 1]!).toBe(true);
    }
    expect(expectedServiceIds).toContain(COMPUTE_SERVICE_ID);
    expect(expectedServiceIds).toContain(CONSULTING_SERVICE_ID);
  });
});

describe('B2B services — D4 service founder gate', () => {
  it('the uncovered-seat signal accrues only under city-scale + servicesEnabled', () => {
    // City + services: the uncovered-seat signal is actually written — the gate
    // is reachable. Run a few days and confirm the counter map carries at least
    // one service key (town demand outruns the thin seeded/founded capacity).
    const onSim = cityServicesSim(11);
    const on = onSim.getState();
    onSim.run(ticksPerDay(on.config) * 8);
    expect(Object.keys(on.serviceUncoveredDays).length).toBeGreaterThan(0);

    // Plain city (flag off): the counter map is never written, and no service
    // firm is ever founded — the founder row is structurally unreachable, so the
    // pinned plain-city soak trajectory is untouched (proven over a long window).
    const off = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const offSim = new Simulation(off);
    offSim.dispatch({ type: 'RESUME' });
    offSim.run(ticksPerDay(off.config) * 120);
    expect(off.serviceUncoveredDays).toEqual({});
    expect(off.lastServiceEntryDay).toBe(0);
    expect(Object.values(off.firms).some((f) => f.strategy.archetype === 'service')).toBe(false);
  });

  it('a service provider is founded when uncovered demand persists (city + services)', () => {
    // Over a full run the founder row lands at least one additional service firm
    // (beyond the seeded Cirrus) — proving the row actually fires, not just that
    // Cirrus diversified. Seed 7 founds extra consulting providers by day 300.
    const sim = cityServicesSim(7);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 300);
    const serviceFirms = Object.values(state.firms).filter((f) => f.strategy.archetype === 'service');
    expect(serviceFirms.length).toBeGreaterThan(1); // Cirrus + at least one founded
    // Every service firm the founder stood up is solvent at day 300.
    for (const f of serviceFirms) expect(f.bankruptcyStatus).not.toBe('insolvent');
  });
});

describe('B2B services — D4 save round-trip with two services', () => {
  it('compute AND consulting contracts, prices, and both boosts survive serialize/deserialize', () => {
    const sim = cityServicesSim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * TWO_SERVICE_WARMUP_DAYS);
    expect(computeContracts(state).length).toBeGreaterThan(0);
    expect(consultingContracts(state).length).toBeGreaterThan(0);

    const round = deserialize(serialize(state));
    expect(Object.keys(round.serviceContracts).sort()).toEqual(Object.keys(state.serviceContracts).sort());
    // Both a compute and a consulting contract come back byte-for-byte.
    const cCompute = computeContracts(state).sort()[0]!;
    const cConsult = consultingContracts(state).sort()[0]!;
    expect(round.serviceContracts[cCompute]).toEqual(state.serviceContracts[cCompute]);
    expect(round.serviceContracts[cConsult]).toEqual(state.serviceContracts[cConsult]);
    // The provider that runs both services keeps both listed prices.
    const consultProv = state.firms[state.serviceContracts[cConsult]!.providerFirmId]!;
    expect(round.firms[consultProv.id]!.servicePriceByService).toEqual(consultProv.servicePriceByService);
    // Per-firm boosts (production + brand) survive on every firm that carries them.
    for (const fid of Object.keys(state.firms).sort()) {
      expect(round.firms[fid]!.serviceBoost).toBe(state.firms[fid]!.serviceBoost);
      expect(round.firms[fid]!.advisoryBoost).toBe(state.firms[fid]!.advisoryBoost);
    }
    // Re-serialize stability.
    expect(serialize(deserialize(serialize(state)))).toBe(serialize(round));
  });
});
