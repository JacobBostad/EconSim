import { describe, it, expect } from 'vitest';
import fixtureJson from './fixtures/golden-save-v1.json';
import fixture2Json from './fixtures/golden-save-v2.json';
import fixture3Json from './fixtures/golden-save-v3.json';
import fixture4Json from './fixtures/golden-save-v4.json';
import fixture5Json from './fixtures/golden-save-v5.json';
import fixture6Json from './fixtures/golden-save-v6.json';
import fixture7Json from './fixtures/golden-save-v7.json';
import fixture8Json from './fixtures/golden-save-v8.json';
import fixture9Json from './fixtures/golden-save-v9.json';
import fixture10Json from './fixtures/golden-save-v10.json';
import { Simulation } from '../core/Simulation';
import { PARTNER_TOWN_ID } from '../data/seedTown';
import { HOME_TOWN_ID } from '../core/Town';
import { deserialize, serialize } from '../persistence/saveLoad';
import { totalMoneySupply } from '../core/GameState';
import { ticksPerDay, computeTime } from '../core/Tick';

/**
 * Golden-save compatibility guard: a REAL save produced by an earlier build
 * (day 40, seed 777 — chains, multi-product store, export orders, shares,
 * festival, upgrade, achievements, missions, trade prices, world events all
 * populated). Every future change must keep this artifact loadable and
 * runnable. If a migration is needed, add it to migrations.ts — do NOT
 * regenerate this fixture to paper over a break.
 */
describe('Golden save fixture', () => {
  const raw = JSON.stringify(fixtureJson);

  it('loads through the migration chain intact', () => {
    const state = deserialize(raw);
    expect(state.playerFirmId).toBeTruthy();
    const player = state.firms[state.playerFirmId]!;
    expect(player.facilities.length).toBeGreaterThanOrEqual(4);
    const store = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;
    expect(store.retailProductIds.length).toBeGreaterThanOrEqual(2);
    const wh = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse')!;
    expect(wh.exportOrders['grain']).toBeTruthy();
    expect(Object.keys(player.sharesHeld).length).toBe(1);
    expect(state.achievements.length).toBeGreaterThan(0);
    expect(state.missions.length).toBeGreaterThan(0);
    expect(Object.keys(state.tradeCities['port_rosa']!.pricesByProduct).length).toBeGreaterThanOrEqual(8);
    // Round-trip stability: loading a re-serialized load changes nothing.
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the loaded world keeps running with money conserved', () => {
    const state = deserialize(raw);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.run(ticksPerDay(state.config) * 5 + 1);
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});

/**
 * Golden save v2 — a modern-feature artifact (day 80, seed 777): coffee
 * chain, apartment with tenants, AI personalities/CEOs, town history,
 * wage-market state, doubled production lines possibly in flight. Same
 * contract as v1: never regenerate to paper over a break.
 */
describe('Golden save fixture v2 (modern features)', () => {
  const raw2 = JSON.stringify(fixture2Json);

  it('loads intact with every modern field populated', () => {
    const state = deserialize(raw2);
    const player = state.firms[state.playerFirmId]!;
    expect(player.facilities.some((i) => state.facilities[i]?.defId === 'apartment')).toBe(true);
    expect(
      player.facilities.some((i) => state.facilities[i]?.retailProductIds.includes('coffee')),
    ).toBe(true);
    expect(state.townHistory.length).toBeGreaterThan(50);
    expect(state.scenarioId).toBe('meadowbrook');
    for (const f of Object.values(state.firms)) {
      if (f.ownerType === 'ai') {
        expect(f.personalityId).toBeTruthy();
        expect(f.ceoName).toBeTruthy();
      }
    }
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running deterministically with money conserved', () => {
    const state = deserialize(raw2);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});

/**
 * Golden save v3 — the wholesale era (day 100, seed 888): player farms with
 * AI wholesale customers, a store buying bread wholesale from an AI factory,
 * Ironvale exports, both trade-city books walked, facility P&L EMAs
 * populated. Same contract as v1/v2: never regenerate to paper over a break.
 */
describe('Golden save fixture v3 (wholesale era)', () => {
  const raw3 = JSON.stringify(fixture3Json);

  it('loads intact with every wholesale-era field populated', () => {
    const state = deserialize(raw3);
    const player = state.firms[state.playerFirmId]!;
    expect(player.wholesaleEarned).toBeGreaterThan(0);
    expect(player.wholesaleSpend).toBeGreaterThan(0);
    expect(player.exportRevenueByCity['ironvale'] ?? 0).toBeGreaterThan(0);
    expect(Object.keys(state.tradeCities)).toContain('ironvale');
    expect(Object.keys(state.tradeCities)).toContain('port_rosa');
    // Live AI customer contracts sourcing from the player's facilities.
    const aiCustomers = Object.values(state.contracts).filter((c) => {
      const src = state.facilities[c.sourceFacilityId];
      return c.active && src && player.facilities.includes(src.id)
        && state.firms[c.ownerFirmId]?.ownerType === 'ai';
    });
    expect(aiCustomers.length).toBeGreaterThanOrEqual(1);
    // Facility P&L EMAs carry real numbers.
    expect(Object.values(state.facilities).some((f) => f.pnlEma.net !== 0)).toBe(true);
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved', () => {
    const state = deserialize(raw3);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});

describe('Golden save fixture v4 (rush-order / fire-sale era)', () => {
  const raw4 = JSON.stringify(fixture4Json);

  it('loads intact with every rush/fire-sale field populated', () => {
    const state = deserialize(raw4);
    // Earned counters came through the real engine paths.
    expect(state.rushOrdersCompleted).toBe(1);
    expect(state.fireSalesBought).toBe(1);
    // Live offers mid-flight.
    expect(state.rushOrder).not.toBeNull();
    expect(state.rushOrder!.filled).toBeGreaterThan(0);
    expect(state.rushOrder!.bonusCents).toBeGreaterThan(0);
    expect(state.facilityOffer).not.toBeNull();
    expect(state.facilities[state.facilityOffer!.facilityId]).toBeDefined();
    expect(state.lastLapsedFireSale).not.toBeNull();
    // The fire-sale purchase actually moved a building to the player.
    const player = state.firms[state.playerFirmId]!;
    const boughtFactory = player.facilities
      .map((id) => state.facilities[id]!)
      .filter((f) => f.type === 'factory');
    expect(boughtFactory.length).toBeGreaterThanOrEqual(2); // chain's own + fire-sale buy
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved, offers expiring naturally', () => {
    const state = deserialize(raw4);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    // Both live offers resolve one way or another within ten days.
    const end = sim.getState();
    expect(end.rushOrder === null || end.rushOrder.startDay > 33).toBe(true);
  });
});

/**
 * Golden save v5 — the four-pillar era (day 82, seed 999): prosperity tiers
 * derived with real spread, a premium-positioned store run by a hired
 * manager, a logistics manager on the executive team, a commodity-desk
 * position staged, an open forward contract, and tier counts flowing into
 * townHistory. Same contract as ever: never regenerate to paper over a break.
 */
describe('Golden save fixture v5 (four-pillar era)', () => {
  const raw5 = JSON.stringify(fixture5Json);

  it('loads intact with every pillar field populated', () => {
    const state = deserialize(raw5);
    const player = state.firms[state.playerFirmId]!;
    // Managers on payroll, one per kind.
    expect(player.managers.some((m) => m.role === 'store' && m.facilityId)).toBe(true);
    expect(player.managers.some((m) => m.role === 'logistics' && m.facilityId === null)).toBe(true);
    // A positioned store and an open forward.
    expect(
      player.facilities.some((i) => state.facilities[i]?.positioning === 'premium'),
    ).toBe(true);
    expect(player.forwards.length).toBe(1);
    expect(player.forwards[0]!.lockedPrice).toBeGreaterThan(0);
    // Tiers derived with real spread, recorded in town history.
    const tiers = new Set(Object.values(state.citizens).map((c) => c.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(2);
    const last = state.townHistory[state.townHistory.length - 1]!;
    expect(last.workers + last.comfortable + last.affluent).toBe(last.population);
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved, the forward settling naturally', () => {
    const state = deserialize(raw5);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 12)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    // The open forward settled (delivered or defaulted) once its day passed.
    expect(sim.getState().firms[state.playerFirmId]!.forwards.length).toBe(0);
  });
});

/**
 * Golden save v6 — the emigration era (Dust Hollow, day 30, seed 11): a town
 * captured mid-exodus. Zero AI firms, emigration pressure deep past the grace
 * period, four families already gone, 🧳 events in the log. Same contract as
 * ever: never regenerate to paper over a break.
 */
describe('Golden save fixture v6 (emigration era)', () => {
  const raw6 = JSON.stringify(fixture6Json);

  it('loads mid-crisis with the emigration fields intact', () => {
    const state = deserialize(raw6);
    expect(Object.values(state.firms).filter((f) => f.ownerType === 'ai')).toHaveLength(0);
    expect(state.emigrationDepartures).toBeGreaterThan(0);
    expect(state.emigrationPressure).toBeGreaterThan(0);
    expect(state.events.some((e) => e.message.includes('packed up and left town'))).toBe(true);
    // Departed citizens are fully unlinked: no home lists a ghost resident.
    for (const f of Object.values(state.facilities)) {
      for (const id of f.residentIds) expect(state.citizens[id]).toBeTruthy();
      for (const id of f.employees) expect(state.citizens[id]).toBeTruthy();
    }
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the crisis keeps unfolding after load — money conserved', () => {
    const state = deserialize(raw6);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 5)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});

/**
 * Golden save v7 — the cohort era (City preset, seed 11, day 120): the first
 * fixture with a LIVE crowd. Every A3 system has written state: a worker/
 * comfortable/affluent cohort grid holding the crowd (CohortLaborSystem's
 * headcount employed, CohortDemandSystem's drained pools), cohort satisfaction
 * and tier-gate streaks off their seed (CohortSocialSystem), under-supply AI
 * founders that answered the crowd's demand, and a curator that has swapped
 * cast members with the crowd to hold the sample representative. Same contract
 * as v1-v6: never regenerate to paper over a break — add a migration instead.
 */
describe('Golden save fixture v7 (cohort era, City preset)', () => {
  const raw7 = JSON.stringify(fixture7Json);

  it('loads intact with the live crowd and every A3 system populated', () => {
    const state = deserialize(raw7);
    // City preset: crowd cohorts are ON.
    expect(state.config.sizePreset).toBe('city');
    // The crowd is real population across the district × tier grid, with jobs.
    const cohorts = Object.values(state.cohorts);
    const crowdPop = cohorts.reduce((n, c) => n + c.population, 0);
    const crowdEmployed = cohorts.reduce((n, c) => n + c.employed, 0);
    expect(crowdPop).toBeGreaterThan(200);
    expect(crowdEmployed).toBeGreaterThan(0);
    // Tier gates moved mass off the all-worker bootstrap: a comfortable cohort
    // now holds people (CohortSocialSystem's promotion route ran).
    expect(cohorts.some((c) => c.tier === 'comfortable' && c.population > 0)).toBe(true);
    // Gate hysteresis is streaked and satisfaction has moved off its seed 70.
    expect(cohorts.some((c) => c.gateStreaks.promote > 0 || c.gateStreaks.demote > 0)).toBe(true);
    expect(cohorts.some((c) => c.avgSatisfaction !== 70)).toBe(true);
    // Cohorts carry real cash in a 'cohort' account (drained/refilled by trade).
    expect(cohorts.reduce((n, c) => n + c.cashPool, 0)).toBeGreaterThan(0);
    // Under-supply founders answered the crowd — more AI sellers than the
    // scenario's opening three.
    const aiFirms = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(aiFirms.length).toBeGreaterThanOrEqual(4);
    // The curator has swapped named citizens with the crowd to stay a faithful
    // sample; its retirements/promotions leave a trail in the event log.
    expect(
      state.events.some((e) => /settled into the crowd|stepped out of/.test(e.message)),
    ).toBe(true);
    // No ghost links survive the cohort churn: every home/job id resolves.
    for (const f of Object.values(state.facilities)) {
      for (const id of f.residentIds) expect(state.citizens[id]).toBeTruthy();
      for (const id of f.employees) expect(state.citizens[id]).toBeTruthy();
    }
    // Round-trip stability: loading a re-serialized load changes nothing.
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the cohort city keeps running with money conserved to the cent', () => {
    const state = deserialize(raw7);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 5)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});

/**
 * Golden save v8 — the archetype era (City preset, seed 11, day 120): the first
 * fixture with the full world-scale specialist economy LIVE — the three flags a
 * real City game sets (servicesEnabled + realEstateEnabled + investorsEnabled)
 * all on. Every Arc D archetype has founded and gone to work: landlord firms
 * (D2) holding rental housing, a service provider (D4) running a datacenter +
 * office against live compute contracts (D4/HD3 billing), investor holdcos (D3)
 * carrying equity stakes worked against the public float, all riding on the A3
 * crowd cohorts × A4 districts. Same contract as v1-v7: never regenerate to
 * paper over a break — add a migration instead.
 */
describe('Golden save fixture v8 (archetype era, City preset)', () => {
  const raw8 = JSON.stringify(fixture8Json);

  it('loads intact with every Arc D archetype live on the crowd economy', () => {
    const state = deserialize(raw8);
    // City preset with the full specialist channel opted in.
    expect(state.config.sizePreset).toBe('city');
    expect(state.config.servicesEnabled).toBe(true);
    expect(state.config.realEstateEnabled).toBe(true);
    expect(state.config.investorsEnabled).toBe(true);

    const businesses = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' || f.ownerType === 'player',
    );
    const archetypes = new Set(businesses.map((f) => f.strategy.archetype));
    // All four archetypes founded: operators plus the three D specialists.
    expect(archetypes.has('operator')).toBe(true);
    expect(archetypes.has('landlord')).toBe(true);
    expect(archetypes.has('investor')).toBe(true);
    expect(archetypes.has('service')).toBe(true);

    // D2: a landlord archetype holds rental housing it built.
    const landlords = businesses.filter((f) => f.strategy.archetype === 'landlord');
    expect(landlords.length).toBeGreaterThanOrEqual(1);
    expect(
      landlords.some((f) => f.facilities.some((id) => state.facilities[id]?.type === 'home')),
    ).toBe(true);

    // D4: a service provider runs a datacenter and carries live compute
    // contracts; every contract links a real provider to a real subscriber,
    // and no subscriber is itself a provider (the billing rule).
    const providers = businesses.filter((f) => f.strategy.archetype === 'service');
    expect(providers.some((f) => f.facilities.some((id) => state.facilities[id]?.defId === 'datacenter'))).toBe(true);
    const contracts = Object.values(state.serviceContracts);
    expect(contracts.length).toBeGreaterThan(0);
    for (const c of contracts) {
      expect(state.firms[c.providerFirmId]).toBeTruthy();
      const sub = state.firms[c.subscriberFirmId];
      expect(sub).toBeTruthy();
      expect(sub!.strategy.archetype).not.toBe('service');
      expect(c.seats).toBeGreaterThan(0);
    }

    // D3: an investor holdco carries an equity book against the public float —
    // every stake targets a real firm and respects the 0..49% cap.
    const investors = businesses.filter((f) => f.strategy.archetype === 'investor');
    const totalStakes = investors.reduce((n, f) => n + Object.keys(f.sharesHeld).length, 0);
    expect(totalStakes).toBeGreaterThanOrEqual(1);
    for (const f of investors) {
      for (const [targetId, pct] of Object.entries(f.sharesHeld)) {
        expect(state.firms[targetId]).toBeTruthy();
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(49);
      }
    }

    // A4 districts partition the map; A3 cohorts hold the crowd across tiers.
    expect(Object.keys(state.districts).length).toBeGreaterThanOrEqual(2);
    const cohorts = Object.values(state.cohorts);
    expect(cohorts.reduce((n, c) => n + c.population, 0)).toBeGreaterThan(200);
    expect(cohorts.some((c) => c.tier === 'comfortable' && c.population > 0)).toBe(true);

    // No ghost links survive the archetype churn: every home/job id resolves.
    for (const f of Object.values(state.facilities)) {
      for (const id of f.residentIds) expect(state.citizens[id]).toBeTruthy();
      for (const id of f.employees) expect(state.citizens[id]).toBeTruthy();
    }
    // Round-trip stability: loading a re-serialized load changes nothing.
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the archetype city keeps running with money conserved to the cent', () => {
    const state = deserialize(raw8);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 5)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});

/**
 * Golden save v9 — the towns era (City preset, seed 11, day 120): the FIRST
 * fixture minted in the SAVE_VERSION 3 shape (region.md step-3 endgame). The six
 * town-scoped record families (districts, cohorts, citizens, marketStats, firms,
 * facilities) now LIVE under `state.towns.home`; the flat `state.firms`/
 * `state.districts`/... paths are non-enumerable accessor aliases (see Town.ts),
 * so a save serializes ONLY the `towns` key — no flat family key appears in the
 * JSON. v1-v8 predate the move and stay in the old flat format; the guard below
 * pins exactly that split, so every future migration must prove it can load both
 * the flat corpus AND this towns-shaped one.
 *
 * Content mirrors v8's archetype era at the current engine (same recipe: a City
 * game left to grow itself, no player actions) so the towns-era shape is frozen
 * over a real world-scale economy — all four archetypes live, service contracts,
 * a 300-strong crowd across cohorts. Reproducible byte-for-byte via
 * docs/design/probes/mint-golden-v9.ts (perf telemetry zeroed there — it is the
 * only wall-clock-noisy field). Same contract as v1-v8: never regenerate to
 * paper over a break — add a migration instead.
 */
describe('Golden save fixture v9 (towns era, City preset — first SAVE_VERSION 3 fixture)', () => {
  const raw9 = JSON.stringify(fixture9Json);

  it('is the first towns-shape fixture (one town, home); v1-v8 stay flat', () => {
    // v9 is the first corpus fixture serialized in the SAVE_VERSION 3 (towns)
    // shape, and a ONE-town region (home only) — v10 is the first with a second
    // town. v1-v8 predate the move and stay flat (the corpus-split guard, in full,
    // lives in the v10 block below).
    const oldFormat = [
      fixtureJson, fixture2Json, fixture3Json, fixture4Json,
      fixture5Json, fixture6Json, fixture7Json, fixture8Json,
    ];
    for (const j of oldFormat) {
      const r = j as Record<string, unknown>;
      // Old-format corpus: records sit FLAT at the top level, no `towns` key.
      expect(r.towns).toBeUndefined();
      expect(r.firms).toBeTruthy();
    }
    // v9: records live under `towns.home`; the flat family keys are ABSENT from
    // the stored JSON (the aliases are non-enumerable, so stringify skips them).
    const r9 = fixture9Json as Record<string, unknown>;
    expect(r9.saveVersion).toBe(3);
    expect(r9.firms).toBeUndefined();
    expect(r9.districts).toBeUndefined();
    const towns = r9.towns as Record<string, Record<string, unknown>>;
    expect(Object.keys(towns)).toEqual([HOME_TOWN_ID]);
    expect(Object.keys(towns[HOME_TOWN_ID]!).sort()).toEqual(
      ['citizens', 'cohorts', 'districts', 'facilities', 'firms', 'marketStats'],
    );
  });

  it('loads intact with records under towns.home and the flat aliases resolving', () => {
    const state = deserialize(raw9);
    // The records genuinely live under towns.home, and the flat back-compat
    // aliases resolve to the SAME objects (installTownAliases ran on load).
    expect(state.towns[HOME_TOWN_ID]).toBeTruthy();
    expect(state.firms).toBe(state.towns[HOME_TOWN_ID]!.firms);
    expect(state.facilities).toBe(state.towns[HOME_TOWN_ID]!.facilities);
    expect(state.districts).toBe(state.towns[HOME_TOWN_ID]!.districts);
    expect(state.cohorts).toBe(state.towns[HOME_TOWN_ID]!.cohorts);
    expect(state.citizens).toBe(state.towns[HOME_TOWN_ID]!.citizens);
    expect(state.marketStats).toBe(state.towns[HOME_TOWN_ID]!.marketStats);

    // The world-scale economy is live under the new shape: City preset with the
    // full specialist channel opted in.
    expect(state.config.sizePreset).toBe('city');
    expect(state.config.servicesEnabled).toBe(true);
    expect(state.config.realEstateEnabled).toBe(true);
    expect(state.config.investorsEnabled).toBe(true);

    // All four Arc D archetypes founded and went to work off the crowd (read
    // through the alias, which is the home town's firms record).
    const businesses = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' || f.ownerType === 'player',
    );
    const archetypes = new Set(businesses.map((f) => f.strategy.archetype));
    expect(archetypes.has('operator')).toBe(true);
    expect(archetypes.has('landlord')).toBe(true);
    expect(archetypes.has('investor')).toBe(true);
    expect(archetypes.has('service')).toBe(true);

    // The archetype-internal invariants v8 pins hold in the towns shape too
    // (same referee depth, read through the aliases).
    // D2: a landlord archetype holds rental housing it built.
    const landlords = businesses.filter((f) => f.strategy.archetype === 'landlord');
    expect(landlords.length).toBeGreaterThanOrEqual(1);
    expect(
      landlords.some((f) => f.facilities.some((id) => state.facilities[id]?.type === 'home')),
    ).toBe(true);
    // D4: a service provider runs a datacenter; every contract links a real
    // provider to a real subscriber, no subscriber is itself a provider, and
    // seats are live (the billing rule).
    const providers = businesses.filter((f) => f.strategy.archetype === 'service');
    expect(providers.some((f) => f.facilities.some((id) => state.facilities[id]?.defId === 'datacenter'))).toBe(true);
    for (const c of Object.values(state.serviceContracts)) {
      expect(state.firms[c.providerFirmId]).toBeTruthy();
      const sub = state.firms[c.subscriberFirmId];
      expect(sub).toBeTruthy();
      expect(sub!.strategy.archetype).not.toBe('service');
      expect(c.seats).toBeGreaterThan(0);
    }
    // D3: every investor stake targets a real firm within the 0..49% cap.
    const investors = businesses.filter((f) => f.strategy.archetype === 'investor');
    expect(investors.reduce((n, f) => n + Object.keys(f.sharesHeld).length, 0)).toBeGreaterThanOrEqual(1);
    for (const f of investors) {
      for (const [targetId, pct] of Object.entries(f.sharesHeld)) {
        expect(state.firms[targetId]).toBeTruthy();
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(49);
      }
    }

    // Live service contracts, a partitioned map, and a real crowd across tiers.
    expect(Object.keys(state.serviceContracts).length).toBeGreaterThan(0);
    expect(Object.keys(state.districts).length).toBeGreaterThanOrEqual(2);
    const cohorts = Object.values(state.cohorts);
    expect(cohorts.reduce((n, c) => n + c.population, 0)).toBeGreaterThan(200);
    expect(cohorts.some((c) => c.tier === 'comfortable' && c.population > 0)).toBe(true);

    // No ghost links survive: every home/job id resolves through the alias.
    for (const f of Object.values(state.facilities)) {
      for (const id of f.residentIds) expect(state.citizens[id]).toBeTruthy();
      for (const id of f.employees) expect(state.citizens[id]).toBeTruthy();
    }
    // Round-trip stability: loading a re-serialized load changes nothing (and the
    // re-serialized form is still the towns shape — no flat key leaks back in).
    const reserialized = serialize(state);
    expect(JSON.parse(reserialized).firms).toBeUndefined();
    expect(JSON.parse(reserialized).towns).toBeTruthy();
    const again = deserialize(reserialized);
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the towns-era city keeps running with money conserved to the cent', () => {
    const state = deserialize(raw9);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 5)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});

/**
 * Golden save v10 — the region + interest era (City preset, seed 11, day 120): the
 * SECOND SAVE_VERSION 3 fixture and the FIRST with a second town. A current City
 * new game now opts into the whole region.md step-4 endgame (regionEnabled) and the
 * risk-tiered loan pricing (riskTieredInterestEnabled) that shipped with it — both
 * `worldScaleConfig` City defaults. So this fixture carries what v9 could not:
 *
 *  - a LIVE PARTNER TOWN at `towns.port_rosa` — its own cohorts, firms, facilities,
 *    and a marketStats book with real sales history (its crowd has been shopping);
 *  - a FREIGHT SHIPMENT IN FLIGHT at the cut — the player freighted 300 bread to
 *    Port Rosa on day 118 (arrival day 121), so `state.freight` carries a dated
 *    inter-town shipment that must round-trip: land + pay on day 121 after a load,
 *    region money conserved to the cent across the settlement.
 *
 * Reproducible byte-for-byte via docs/design/probes/mint-golden-v10.ts (perf
 * telemetry zeroed there — the v9 improvement carried forward). Same contract as
 * v1-v9: never regenerate to paper over a break — add a migration instead.
 */
describe('Golden save fixture v10 (region + interest era — first two-town fixture)', () => {
  const raw10 = JSON.stringify(fixture10Json);

  it('is towns-shaped with TWO towns; the corpus split holds (v1-v8 flat, v9-v10 towns)', () => {
    // v1-v8: FLAT, no `towns` key.
    const oldFormat = [
      fixtureJson, fixture2Json, fixture3Json, fixture4Json,
      fixture5Json, fixture6Json, fixture7Json, fixture8Json,
    ];
    for (const j of oldFormat) {
      const r = j as Record<string, unknown>;
      expect(r.towns).toBeUndefined();
      expect(r.firms).toBeTruthy();
    }
    // v9: towns shape, ONE town (home).
    const t9 = (fixture9Json as Record<string, unknown>).towns as Record<string, unknown>;
    expect(Object.keys(t9)).toEqual([HOME_TOWN_ID]);
    // v10: towns shape, TWO towns (home + the live partner) — the first fixture
    // with a second town. The flat family keys are ABSENT (non-enumerable aliases).
    const r10 = fixture10Json as Record<string, unknown>;
    expect(r10.saveVersion).toBe(3);
    expect(r10.firms).toBeUndefined();
    expect(r10.districts).toBeUndefined();
    const t10 = r10.towns as Record<string, Record<string, unknown>>;
    expect(Object.keys(t10).sort()).toEqual([HOME_TOWN_ID, PARTNER_TOWN_ID].sort());
    // Each town carries the full six-family record set PLUS its own map dims
    // (mapWidth/mapHeight became per-town fields at step 4 — v9 predates them, so
    // its home record has only the six families; a step-4 town has all eight keys).
    for (const townId of [HOME_TOWN_ID, PARTNER_TOWN_ID]) {
      expect(Object.keys(t10[townId]!).sort()).toEqual(
        ['citizens', 'cohorts', 'districts', 'facilities', 'firms', 'mapHeight', 'mapWidth', 'marketStats'],
      );
    }
    // The in-flight freight is a WORLD-scoped save-shape addition (an array).
    expect(Array.isArray(r10.freight)).toBe(true);
    expect((r10.freight as unknown[]).length).toBe(1);
  });

  it('loads intact: the region on, a live partner book, and freight in flight', () => {
    const state = deserialize(raw10);
    // Both era flags are on (the City new-game defaults).
    expect(state.config.sizePreset).toBe('city');
    expect(state.config.regionEnabled).toBe(true);
    expect(state.config.riskTieredInterestEnabled).toBe(true);
    // Both towns live; the flat aliases resolve to the HOME town's records.
    expect(state.towns[HOME_TOWN_ID]).toBeTruthy();
    expect(state.towns[PARTNER_TOWN_ID]).toBeTruthy();
    expect(state.firms).toBe(state.towns[HOME_TOWN_ID]!.firms);
    expect(state.marketStats).toBe(state.towns[HOME_TOWN_ID]!.marketStats);

    // The PARTNER is a real (small) economy: cohorts holding population, its own
    // firms, and a marketStats book with LIVE sales history (its crowd has shopped).
    const partner = state.towns[PARTNER_TOWN_ID]!;
    expect(Object.keys(partner.firms).length).toBeGreaterThanOrEqual(1);
    expect(Object.values(partner.cohorts).reduce((n, c) => n + c.population, 0)).toBeGreaterThan(0);
    const partnerHistory = Object.values(partner.marketStats).reduce((n, m) => n + m.history.length, 0);
    expect(partnerHistory).toBeGreaterThan(0);

    // A freight shipment is IN FLIGHT home → the live partner (goods dispatched,
    // not yet landed): the arc's new inter-town edge, frozen mid-transit.
    expect(state.freight.length).toBe(1);
    const ship = state.freight[0]!;
    expect(ship.originTownId).toBe(HOME_TOWN_ID);
    expect(ship.destTownId).toBe(PARTNER_TOWN_ID);
    expect(ship.qty).toBeGreaterThan(0);
    expect(ship.priceLocked).toBeGreaterThan(0);
    expect(ship.arrivalDay).toBeGreaterThan(ship.dispatchDay);

    // v9's referee strength holds in the two-town shape: all four archetypes live
    // on the home crowd, with the archetype-internal invariants intact.
    const businesses = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' || f.ownerType === 'player',
    );
    const archetypes = new Set(businesses.map((f) => f.strategy.archetype));
    expect(archetypes.has('operator')).toBe(true);
    expect(archetypes.has('landlord')).toBe(true);
    expect(archetypes.has('investor')).toBe(true);
    expect(archetypes.has('service')).toBe(true);
    const landlords = businesses.filter((f) => f.strategy.archetype === 'landlord');
    expect(
      landlords.some((f) => f.facilities.some((id) => state.facilities[id]?.type === 'home')),
    ).toBe(true);
    const providers = businesses.filter((f) => f.strategy.archetype === 'service');
    expect(providers.some((f) => f.facilities.some((id) => state.facilities[id]?.defId === 'datacenter'))).toBe(true);
    for (const c of Object.values(state.serviceContracts)) {
      expect(state.firms[c.providerFirmId]).toBeTruthy();
      const sub = state.firms[c.subscriberFirmId];
      expect(sub).toBeTruthy();
      expect(sub!.strategy.archetype).not.toBe('service');
      expect(c.seats).toBeGreaterThan(0);
    }
    const investors = businesses.filter((f) => f.strategy.archetype === 'investor');
    expect(investors.reduce((n, f) => n + Object.keys(f.sharesHeld).length, 0)).toBeGreaterThanOrEqual(1);
    for (const f of investors) {
      for (const [targetId, pct] of Object.entries(f.sharesHeld)) {
        expect(state.firms[targetId]).toBeTruthy();
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(49);
      }
    }
    // A real home crowd across tiers; no ghost home/job links survive.
    const cohorts = Object.values(state.cohorts);
    expect(cohorts.reduce((n, c) => n + c.population, 0)).toBeGreaterThan(200);
    expect(cohorts.some((c) => c.tier === 'comfortable' && c.population > 0)).toBe(true);
    for (const f of Object.values(state.facilities)) {
      for (const id of f.residentIds) expect(state.citizens[id]).toBeTruthy();
      for (const id of f.employees) expect(state.citizens[id]).toBeTruthy();
    }
    // Round-trip stability: re-serializing a load changes nothing, and the form is
    // still the two-town shape carrying the in-flight freight (no flat key leaks).
    const reserialized = serialize(state);
    expect(JSON.parse(reserialized).firms).toBeUndefined();
    expect(Object.keys(JSON.parse(reserialized).towns).sort()).toEqual(
      [HOME_TOWN_ID, PARTNER_TOWN_ID].sort(),
    );
    const again = deserialize(reserialized);
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running, the in-flight freight round-trips, money conserved to the cent', () => {
    const state = deserialize(raw10);
    const supply0 = totalMoneySupply(state);
    const ship = { ...state.freight[0]! };
    const sim = new Simulation(state);
    // Run past the shipment's arrival day: it must LAND and PAY (the round-trip),
    // clearing the in-flight queue, with region money conserved every step.
    const daysToArrival = ship.arrivalDay - computeTime(state.tick, state.config).day;
    expect(() => sim.run(ticksPerDay(state.config) * (daysToArrival + 2))).not.toThrow();
    const end = sim.getState();
    // The shipment settled: no longer in flight, and a freight-delivery payment
    // was booked to the live partner.
    expect(end.freight.some((s) => s.id === ship.id)).toBe(false);
    expect(end.transactions.some((t) => /Freight delivered to Port Rosa/.test(t.note))).toBe(true);
    // Region money is conserved across the inter-town settlement (a TRANSFER, not
    // minting) — summed over BOTH towns by the region-wide primitive.
    expect(totalMoneySupply(end)).toBe(supply0);
    expect(Object.keys(end.citizens).length).toBeGreaterThan(0);
  });
});
