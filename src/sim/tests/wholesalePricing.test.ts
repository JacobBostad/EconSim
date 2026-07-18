import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock } from '../entities/Inventory';
import { wholesaleUnitPrice, WHOLESALE_MULT_MIN, WHOLESALE_MULT_MAX } from '../core/Wholesale';
import { WHOLESALE_DISCOUNT } from '../data/constants';
import { getProduct } from '../data/products';
import { ACHIEVEMENT_DEFS } from '../data/achievements';

/**
 * Sellers set their own wholesale price (fraction of market average).
 * Undercutting wins AI customers — buyers pick the cheapest qualifying
 * supplier — and pricing above import parity makes them walk.
 */
describe('Wholesale pricing lever', () => {
  function setupFarm(sim: ReturnType<typeof newSim>, x: number) {
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x, y: 20 } });
    const farm = state.facilities[player.facilities[player.facilities.length - 1]!]!;
    addStock(farm.outputInventory, 'grain', 200, 60);
    return farm;
  }

  function giveAiImportContract(sim: ReturnType<typeof newSim>) {
    const state = sim.getState();
    const importer = Object.values(state.facilities).find((f) => f.type === 'importer')!;
    const aiFactory = Object.values(state.facilities).find(
      (f) => f.type === 'factory' && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: aiFactory.ownerFirmId,
      sourceFacilityId: importer.id, destinationFacilityId: aiFactory.id,
      productId: 'grain', targetQuantity: 20, reorderPoint: 10, maxInventory: 40,
    });
    return Object.values(state.contracts).find(
      (c) => c.ownerFirmId === aiFactory.ownerFirmId && c.productId === 'grain'
        && state.facilities[c.sourceFacilityId]?.type === 'importer',
    )!;
  }

  it('wholesaleUnitPrice: market average when present, base as fallback, seller mult applied', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const farm = setupFarm(sim, 100);
    const base = getProduct('grain').basePrice;

    // No sales of grain -> average 0 -> base price fallback at the default 70%.
    expect(wholesaleUnitPrice(state, farm, 'grain')).toBe(Math.round(base * WHOLESALE_DISCOUNT));

    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 0.9 });
    expect(wholesaleUnitPrice(state, farm, 'grain')).toBe(Math.round(base * 0.9));

    state.marketStats['grain']!.averagePrice = 2_00;
    expect(wholesaleUnitPrice(state, farm, 'grain')).toBe(Math.round(2_00 * 0.9));
  });

  it('SET_WHOLESALE_PRICE clamps to the legal band', () => {
    const sim = newSim(3);
    const farm = setupFarm(sim, 100);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 0.2 });
    expect(farm.wholesalePriceMult).toBe(WHOLESALE_MULT_MIN);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 1.4 });
    expect(farm.wholesalePriceMult).toBe(WHOLESALE_MULT_MAX);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 0.85 });
    expect(farm.wholesalePriceMult).toBe(0.85);
  });

  it('the AI picks the cheapest qualifying supplier', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const farmA = setupFarm(sim, 100);
    const farmB = setupFarm(sim, 108);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farmA.id, mult: 0.7 });
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farmB.id, mult: 0.55 });
    const contract = giveAiImportContract(sim);
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) * 3);

    expect(contract.sourceFacilityId).toBe(farmB.id);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('undercutting earns less per unit than the default price on the same flow', () => {
    // Two identical seeded runs; only the seller price differs. Determinism
    // makes the shipped volumes match, so lifetime earnings scale with price.
    const run = (mult?: number) => {
      const sim = newSim(3);
      const state = sim.getState();
      const player = state.firms[state.playerFirmId]!;
      const farm = setupFarm(sim, 100);
      if (mult !== undefined) sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult });
      giveAiImportContract(sim);
      sim.run(ticksPerDay(state.config) * 5);
      return player.wholesaleEarned;
    };
    const cheap = run(0.55);
    const standard = run(); // default 0.7
    expect(cheap).toBeGreaterThan(0);
    expect(standard).toBeGreaterThan(cheap);
  });

  it('an AI seller sitting on unsold surplus cuts its price toward the personality floor', () => {
    const sim = newSim(3);
    const state = sim.getState();
    // Give an AI producer a fat surplus and nobody buying it wholesale.
    const aiProducer = Object.values(state.facilities).find(
      (f) => (f.type === 'farm' || f.type === 'mine') && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    addStock(aiProducer.outputInventory, 'grain', 200, 60);
    const before = aiProducer.wholesalePriceMult ?? WHOLESALE_DISCOUNT;

    sim.run(ticksPerDay(state.config) * 6);

    const after = aiProducer.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
    expect(after).toBeLessThan(before);
  });

  it('an AI seller with a paying customer creeps its price up (never past the milk cap)', () => {
    const sim = newSim(3);
    const state = sim.getState();
    // AI producer sells to ANOTHER AI firm's factory: seller has a customer.
    const aiProducer = Object.values(state.facilities).find(
      (f) => (f.type === 'farm' || f.type === 'mine') && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    addStock(aiProducer.outputInventory, 'grain', 400, 60);
    const buyerFactory = Object.values(state.facilities).find(
      (f) => f.type === 'factory' && state.firms[f.ownerFirmId]?.ownerType === 'ai'
        && f.ownerFirmId !== aiProducer.ownerFirmId,
    )!;
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: buyerFactory.ownerFirmId,
      sourceFacilityId: aiProducer.id, destinationFacilityId: buyerFactory.id,
      productId: 'grain', targetQuantity: 10, reorderPoint: 5, maxInventory: 20,
    });

    sim.run(ticksPerDay(state.config) * 6);

    const after = aiProducer.wholesalePriceMult ?? WHOLESALE_DISCOUNT;
    expect(after).toBeGreaterThan(WHOLESALE_DISCOUNT);
    expect(after).toBeLessThanOrEqual(0.85);
  });

  it('a locked-in buyer defects to a rival supplier 10%+ cheaper', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const farmA = setupFarm(sim, 100);
    const contract = giveAiImportContract(sim);
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 3);
    expect(contract.sourceFacilityId).toBe(farmA.id); // locked in at 70%

    // A second farm undercuts hard. Keep A's stock topped up so the buyer
    // never leaves for starvation reasons — only price can move it.
    const farmB = setupFarm(sim, 108);
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farmB.id, mult: 0.5 });
    addStock(farmA.outputInventory, 'grain', 300, 60);

    sim.run(tpd * 3);

    expect(contract.sourceFacilityId).toBe(farmB.id);
  });

  it('the Undercutter achievement needs a deep cut AND a live AI customer', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const farm = setupFarm(sim, 100);
    const badge = ACHIEVEMENT_DEFS.find((a) => a.id === 'undercutter')!;

    expect(badge.check(state)).toBe(false);
    // Deep cut alone isn't enough — someone has to actually buy at it.
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 0.6 });
    expect(badge.check(state)).toBe(false);
    const contract = giveAiImportContract(sim);
    contract.sourceFacilityId = farm.id;
    expect(badge.check(state)).toBe(true);
    // A shallow cut with a customer doesn't count either.
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 0.7 });
    expect(badge.check(state)).toBe(false);
  });

  it('buyers walk when the supplier prices above import parity', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const farm = setupFarm(sim, 100);
    const contract = giveAiImportContract(sim);
    const tpd = ticksPerDay(state.config);

    sim.run(tpd * 3);
    expect(contract.sourceFacilityId).toBe(farm.id); // locked in

    // Spike the grain market so max price (100% of market) exceeds the
    // importer's unit cost, and set the farm to full gouge. The accumulators
    // finalize into averagePrice at the next day boundary, right before the
    // AI's sourcing pass reads it.
    sim.dispatch({ type: 'SET_WHOLESALE_PRICE', facilityId: farm.id, mult: 1.0 });
    const toBoundary = tpd - (state.tick % tpd);
    sim.run(toBoundary - 1);
    state.marketStats['grain']!.revenueAccum = 4_00 * 100;
    state.marketStats['grain']!.unitsSold = 100;
    sim.run(2);

    const source = state.facilities[contract.sourceFacilityId]!;
    expect(source.type).toBe('importer');
  });
});
