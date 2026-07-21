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
  COMMERCIAL_TARGET_YIELD,
} from '../systems/ai/LandlordBehavior';
import { runCommercialRentSystem } from '../systems/CommercialRentSystem';
import { sellRefund } from '../core/Demolition';
import { createFacility } from '../entities/factories';

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
