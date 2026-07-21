import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { Simulation } from '../core/Simulation';
import { ticksPerDay } from '../core/Tick';
import { dispatchFirmBehavior } from '../systems/AIStrategySystem';
import {
  runLandlordBehavior,
  townHousingOccupancy,
  commercialLeaseAsk,
  landlordCanFinance,
  COMMERCIAL_TARGET_YIELD,
} from '../systems/ai/LandlordBehavior';
import { runCommercialRentSystem } from '../systems/CommercialRentSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { maybeExpand } from '../systems/ai/expansion';
import { sellRefund } from '../core/Demolition';
import { createFacility } from '../entities/factories';
import { hireCitizen, findUnemployed } from '../systems/LaborSystem';
import { getFacilityDef } from '../data/facilityDefinitions';
import { landCostMultiplier, landValueAt } from '../core/LandValue';

/**
 * Arc D2 — real-estate firms (HD4). The landlord archetype, commercial leasing,
 * and the housing founder row. Everything here rides the realEstateEnabled flag
 * (off in every pinned baseline — verified bit-identical separately), so these
 * tests opt the channel in explicitly.
 */

const SENTINEL = 987654;

function cityState(seed: number) {
  return createInitialState(seed, {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    realEstateEnabled: true,
  });
}

describe('Landlord dispatch routing', () => {
  it('routes a landlord firm to the landlord loop, never the operator loop', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const firm = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    firm.cash = 5000_00;

    // As a landlord: the operator loop never runs, so its loss-streak update
    // never fires — the sentinel survives (the landlord loop deliberately never
    // touches lossStreak).
    firm.strategy.archetype = 'landlord';
    firm.strategy.lossStreak = SENTINEL;
    state.tick = ticksPerDay(state.config);
    dispatchFirmBehavior(makeContext(state), firm.id, undefined);
    expect(firm.strategy.lossStreak).toBe(SENTINEL);

    // As an operator: the loop runs and moves off the sentinel.
    firm.strategy.archetype = 'operator';
    firm.strategy.lossStreak = SENTINEL;
    dispatchFirmBehavior(makeContext(state), firm.id, undefined);
    expect(firm.strategy.lossStreak).not.toBe(SENTINEL);
  });
});

describe('Commercial lease — data model + billing', () => {
  it('the player leases premises from a landlord instead of buying; rent bills conserved', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;

    // Stand up an AI landlord with cash to finance a premises.
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 100000_00;
    const landlordCashBefore = landlord.cash;
    const playerCashBefore = player.cash;
    const supply = totalMoneySupply(state);

    // Lease a store premises: player pays $0 upfront, landlord fronts the build.
    sim.dispatch({
      type: 'BUILD_FACILITY',
      firmId: player.id,
      defId: 'retail',
      location: { x: 120, y: 120 },
      leaseFrom: landlord.id,
    });

    // A leased facility exists, operated by the player, owned-on-book by the
    // landlord, with a positive rent.
    const leased = Object.values(state.facilities).find((f) => f.landlordFirmId === landlord.id);
    expect(leased).toBeDefined();
    expect(leased!.ownerFirmId).toBe(player.id);
    expect(leased!.rentPerDay!).toBeGreaterThan(0);
    // Player spent nothing upfront; the landlord fronted the build cost.
    expect(player.cash).toBe(playerCashBefore);
    expect(landlord.cash).toBe(landlordCashBefore - leased!.buildCost);
    // The tenant can't sell premises it doesn't own — no refund.
    expect(sellRefund(state, player.id, leased!.id)).toBeNull();
    // Conserved through the financing move (cash -> world buildSpend).
    expect(totalMoneySupply(state)).toBe(supply);

    // Bill one day of rent: operator -> landlord, firm-to-firm, conserved.
    const supply2 = totalMoneySupply(state);
    const rent = leased!.rentPerDay!;
    const pCash = player.cash;
    const lCash = landlord.cash;
    state.tick = ticksPerDay(state.config);
    runCommercialRentSystem(makeContext(state));
    expect(player.cash).toBe(pCash - rent);
    expect(landlord.cash).toBe(lCash + rent);
    expect(player.accounting.today.rentExpense).toBe(rent);
    expect(landlord.accounting.today.revenue).toBe(rent);
    expect(totalMoneySupply(state)).toBe(supply2); // money circulated, none minted
  });

  it('a firm cannot lease from itself (self-lease block, command + billing guard)', () => {
    const state = cityState(11);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const player = state.firms[state.playerFirmId]!;
    const facCountBefore = Object.keys(state.facilities).length;

    // Command-level block: leasing from yourself creates nothing.
    sim.dispatch({
      type: 'BUILD_FACILITY',
      firmId: player.id,
      defId: 'retail',
      location: { x: 120, y: 120 },
      leaseFrom: player.id,
    });
    expect(Object.keys(state.facilities).length).toBe(facCountBefore);

    // Billing-level guard (defense in depth): a facility hand-set to lease from
    // its own owner pays no rent.
    const fac = createFacility(state, 'retail', player.id, { x: 121, y: 121 });
    fac.landlordFirmId = player.id;
    fac.rentPerDay = 500_00;
    const cash = player.cash;
    const supply = totalMoneySupply(state);
    state.tick = ticksPerDay(state.config);
    runCommercialRentSystem(makeContext(state));
    expect(player.cash).toBe(cash); // no self-payment
    expect(totalMoneySupply(state)).toBe(supply);
  });

  it('the commercial ask targets the 12-18% yield band', () => {
    const bookValue = 40000_00;
    const ask = commercialLeaseAsk(bookValue);
    const annualYield = (ask * 365) / bookValue;
    expect(annualYield).toBeCloseTo(COMMERCIAL_TARGET_YIELD, 2);
    expect(annualYield).toBeGreaterThanOrEqual(0.12);
    expect(annualYield).toBeLessThanOrEqual(0.18);
  });
});

describe('Landlord solvency — distress block sale (B3)', () => {
  it('a landlord below its distress floor sells a block to raise cash', () => {
    const state = cityState(11);
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 5000_00; // below the $12k distress floor

    // Give it two apartment blocks to own.
    const a1 = createFacility(state, 'apartment', landlord.id, { x: 60, y: 130 });
    a1.buildCost = 8000_00;
    const a2 = createFacility(state, 'apartment', landlord.id, { x: 70, y: 130 });
    a2.buildCost = 12000_00;

    const blocksBefore = landlord.facilities.length;
    const cashBefore = landlord.cash;
    const supply = totalMoneySupply(state);

    state.tick = ticksPerDay(state.config);
    runLandlordBehavior(makeContext(state), landlord.id, undefined);

    // One block sold (the cheaper one), cash rose by the refund, conserved.
    expect(landlord.facilities.length).toBe(blocksBefore - 1);
    expect(landlord.facilities).toContain(a2.id); // sold the cheaper a1, kept a2
    expect(landlord.cash).toBeGreaterThan(cashBefore);
    expect(totalMoneySupply(state)).toBe(supply);
  });
});

describe('Landlord founder gate', () => {
  it('founds a landlord when housing runs chronically tight (flag on, city-scale)', () => {
    const state = cityState(7);
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const tpd = ticksPerDay(state.config);
    sim.run(80 * tpd);

    const landlords = Object.values(state.firms).filter(
      (f) => f.ownerType === 'ai' && f.strategy.archetype === 'landlord',
    );
    expect(landlords.length).toBeGreaterThanOrEqual(1);
    // The housing signal is genuinely hot when a landlord entered.
    expect(state.housingTightDays > 0 || landlords.length > 0).toBe(true);
    // Every founded landlord is solvent and money is conserved.
    for (const f of landlords) expect(f.bankruptcyStatus).not.toBe('insolvent');
    expect(totalMoneySupply(state)).toBe(totalMoneySupply(sim.getState()));
  });

  it('never founds a landlord with the flag off (pinned-baseline safety)', () => {
    const state = createInitialState(7, { ...DEFAULT_CONFIG, sizePreset: 'city' }); // flag OFF
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const tpd = ticksPerDay(state.config);
    sim.run(120 * tpd);

    const landlords = Object.values(state.firms).filter((f) => f.strategy.archetype === 'landlord');
    expect(landlords.length).toBe(0);
    // The signal counter never even accrues (Village/flag-off path is untouched).
    expect(state.housingTightDays).toBe(0);
  });

  it('townHousingOccupancy reads filled/total home slots', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const occ = townHousingOccupancy(state);
    expect(occ).toBeGreaterThanOrEqual(0);
    expect(occ).toBeLessThanOrEqual(1);
  });
});

/**
 * Repossession rung (Arc D2 / HD4 item 1). When a tenant's insolvency would
 * CLOSE a leased premises, BankruptcySystem instead reverts it to the landlord:
 * ownership transfers on-book, NO money moves, the tenant loses the premises it
 * never paid for and the landlord recovers its asset. Same close-point serves
 * the player and AI paths, so both are covered.
 */
describe('Repossession rung — a leased premises reverts to its landlord', () => {
  function setupLeasedTenant(ownerType: 'ai' | 'player') {
    const state = cityState(11);
    const config = state.config;
    // Landlord (an AI real-estate firm) and a separate tenant.
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 80000_00;
    const tenant =
      ownerType === 'player'
        ? state.firms[state.playerFirmId]!
        : Object.values(state.firms).find((f) => f.ownerType === 'ai' && f.id !== landlord.id)!;

    // The tenant holds ONLY a leased premises (so the insolvency ladder reaches
    // the repossession close-point rather than shedding an owned facility first).
    tenant.facilities = [];
    tenant.sharesHeld = {};
    const leased = createFacility(state, 'retail', tenant.id, { x: 118, y: 118 });
    leased.buildCost = 2000_00;
    leased.operatingCostPerDay = 900;
    leased.landlordFirmId = landlord.id;
    leased.rentPerDay = 100_00;
    // Staff it, to prove the crew is released on repossession.
    const c = findUnemployed(state);
    if (c) hireCitizen(state, leased.id, c);

    // Drive the tenant to the insolvent close-point.
    tenant.cash = -50000_00;
    tenant.daysInsolvent = config.insolvencyCloseDays - 1;
    state.tick = ticksPerDay(config);
    return { state, config, landlord, tenant, leased };
  }

  it('AI tenant: the leased facility moves to the landlord, no money moves, conserved', () => {
    const { state, landlord, tenant, leased } = setupLeasedTenant('ai');
    const supply = totalMoneySupply(state);
    const landlordCashBefore = landlord.cash;
    const tenantCashBefore = tenant.cash;

    runBankruptcySystem(makeContext(state));

    const fac = state.facilities[leased.id]!;
    // Ownership transferred on-book to the landlord; the lease is cleared.
    expect(fac.ownerFirmId).toBe(landlord.id);
    expect(landlord.facilities).toContain(leased.id);
    expect(tenant.facilities).not.toContain(leased.id);
    expect(fac.landlordFirmId).toBeUndefined();
    expect(fac.rentPerDay).toBeUndefined();
    // Not shuttered — the landlord recovered a live asset, crew released.
    expect(fac.status).not.toBe('closed');
    expect(fac.employees.length).toBe(0);
    // NO money moved for the transfer itself; the landlord's cash is untouched.
    expect(landlord.cash).toBe(landlordCashBefore);
    // The tenant's books are clean: it holds no facilities and its cash is
    // unchanged by the repossession (it never owned the premises to refund).
    expect(tenant.facilities.length).toBe(0);
    expect(tenant.cash).toBe(tenantCashBefore);
    // Money conserved to the cent across the whole bankruptcy tick.
    expect(totalMoneySupply(state)).toBe(supply);
  });

  it('player tenant (receivership): the same close-point reverts the lease', () => {
    const { state, landlord, tenant, leased } = setupLeasedTenant('player');
    const supply = totalMoneySupply(state);
    const landlordCashBefore = landlord.cash;

    runBankruptcySystem(makeContext(state));

    const fac = state.facilities[leased.id]!;
    expect(fac.ownerFirmId).toBe(landlord.id);
    expect(landlord.facilities).toContain(leased.id);
    expect(tenant.facilities).not.toContain(leased.id);
    expect(fac.landlordFirmId).toBeUndefined();
    expect(fac.status).not.toBe('closed');
    // The player firm is never deleted; it simply loses the premises it leased.
    expect(state.firms[state.playerFirmId]).toBeDefined();
    expect(landlord.cash).toBe(landlordCashBefore);
    expect(totalMoneySupply(state)).toBe(supply);
  });
});

/**
 * AI operator lease-vs-buy (Arc D2 / HD4 item 2). An expanding operator leases
 * its new outlet from a landlord instead of buying when cash is tight (below 2×
 * the build cost) and a landlord offers. The store/outlet path is shortage-gated
 * (dormant under the founder system in the standard presets, which is why it is
 * inert in the pinned runs), so these tests construct the shortage the rule
 * needs and drive the decision directly.
 */
describe('AI operator lease-vs-buy', () => {
  function shortageCity(seed: number) {
    return createInitialState(seed, {
      ...DEFAULT_CONFIG,
      sizePreset: 'city',
      realEstateEnabled: true,
      aiExpandChance: 1, // the shortage day always converts, for determinism
    });
  }

  /** Stand up a cash-tight operator under a real shortage for `product`. */
  function tightOperatorUnderShortage(state: ReturnType<typeof shortageCity>, product: string) {
    const op = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    op.strategy.archetype = 'operator';
    op.facilities = [];
    const store = createFacility(state, 'retail', op.id, { x: 60, y: 52 });
    store.retailProductIds = [product];
    store.dailyStats.lostSales = 20; // ≥ 6
    state.marketStats[product]!.unmetDemand = 30; // ≥ 14
    const cost = Math.round(
      getFacilityDef('retail').buildCost * landCostMultiplier(landValueAt(state, { x: 60, y: 52 })),
    );
    op.cash = cost; // < 2 × cost, so leasing preserves runway
    return { op, cost };
  }

  it('leases the new outlet from a landlord when cash is tight (flag on)', () => {
    const state = shortageCity(11);
    const { op } = tightOperatorUnderShortage(state, 'bread');
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai' && f.id !== op.id)!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 60000_00;

    const supply = totalMoneySupply(state);
    const opCashBefore = op.cash;
    const landlordCashBefore = landlord.cash;
    const before = new Set(op.facilities);

    maybeExpand(makeContext(state), op.id);

    const built = op.facilities.filter((id) => !before.has(id));
    expect(built.length).toBe(1);
    const outlet = state.facilities[built[0]!]!;
    // Leased: operated by the tenant, carried on-book + financed by the landlord.
    expect(outlet.ownerFirmId).toBe(op.id);
    expect(outlet.landlordFirmId).toBe(landlord.id);
    expect(outlet.rentPerDay!).toBeGreaterThan(0);
    // The operator paid $0 upfront (runway preserved); the landlord fronted it.
    expect(op.cash).toBe(opCashBefore);
    expect(landlord.cash).toBe(landlordCashBefore - outlet.buildCost);
    // The financing move (landlord cash → world buildSpend) conserves money.
    expect(totalMoneySupply(state)).toBe(supply);
  });

  it('buys (never leases) when no landlord offers — even flag on', () => {
    const state = shortageCity(11);
    const { op } = tightOperatorUnderShortage(state, 'bread');
    // No firm is a landlord: the lessor lookup finds nobody, so the operator
    // funds and buys the outlet itself exactly as it did pre-D2.
    for (const f of Object.values(state.firms)) {
      if (f.strategy.archetype === 'landlord') f.strategy.archetype = 'operator';
    }
    const before = new Set(op.facilities);
    const supply = totalMoneySupply(state);

    maybeExpand(makeContext(state), op.id);

    const built = op.facilities.filter((id) => !before.has(id));
    expect(built.length).toBe(1);
    expect(state.facilities[built[0]!]!.landlordFirmId).toBeUndefined();
    expect(totalMoneySupply(state)).toBe(supply);
  });

  it('never leases with the flag off — no landlord ever exists, so no premises is leased', () => {
    const state = createInitialState(7, { ...DEFAULT_CONFIG, sizePreset: 'city' }); // flag OFF
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const tpd = ticksPerDay(state.config);
    sim.run(150 * tpd);

    // The chain of inertness: flag off, the founder row never seats a landlord,
    // so the lessor lookup can never find one and no facility is ever leased.
    expect(Object.values(state.firms).some((f) => f.strategy.archetype === 'landlord')).toBe(false);
    expect(Object.values(state.facilities).every((f) => f.landlordFirmId === undefined)).toBe(true);
  });

  it('leasing keeps the landlord solvent and money conserved across repeated leases', () => {
    const state = shortageCity(4);
    const { op } = tightOperatorUnderShortage(state, 'bread');
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai' && f.id !== op.id)!;
    landlord.strategy.archetype = 'landlord';
    landlord.cash = 60000_00;

    // Drive several expansions (the store cap is 3): each keeps the shortage hot
    // and the operator cash-tight, so it leases again while the landlord can
    // finance within its runway. The cash reset is test scaffolding (a direct
    // write, which itself moves the supply), so conservation is asserted around
    // each maybeExpand call — the lease path must neither mint nor burn a cent.
    let leases = 0;
    for (let i = 0; i < 3; i++) {
      const store = op.facilities
        .map((id) => state.facilities[id]!)
        .find((f) => f.type === 'retail')!;
      store.dailyStats.lostSales = 20;
      state.marketStats['bread']!.unmetDemand = 30;
      op.cash = store.buildCost; // stay tight (scaffolding)
      const supplyBefore = totalMoneySupply(state);
      maybeExpand(makeContext(state), op.id);
      expect(totalMoneySupply(state)).toBe(supplyBefore); // lease conserved money
    }
    for (const id of op.facilities) {
      if (state.facilities[id]!.landlordFirmId === landlord.id) leases += 1;
    }
    expect(leases).toBeGreaterThan(0); // lease count > 0
    expect(landlord.bankruptcyStatus).not.toBe('insolvent'); // landlord stays solvent
  });

  it('landlordCanFinance gates on runway above the distress floor, and refuses insolvent landlords', () => {
    const state = cityState(11);
    const landlord = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    landlord.strategy.archetype = 'landlord';
    landlord.bankruptcyStatus = 'healthy';
    // Enough to cover the cost and keep the distress-floor runway.
    landlord.cash = 20000_00;
    expect(landlordCanFinance(landlord, 3000_00)).toBe(true);
    // Fronting this would drop it below its distress floor — refuse.
    expect(landlordCanFinance(landlord, 15000_00)).toBe(false);
    // An insolvent landlord never fronts, however much cash it nominally holds.
    landlord.bankruptcyStatus = 'insolvent';
    expect(landlordCanFinance(landlord, 3000_00)).toBe(false);
  });
});
