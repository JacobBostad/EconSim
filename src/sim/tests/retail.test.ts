import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName, setHour } from './helpers';
import { makeContext } from '../core/GameState';
import {
  runRetailDemandSystem,
  scoreStore,
} from '../systems/RetailDemandSystem';
import { getQuantity, addStock } from '../entities/Inventory';
import { emptyCohort } from '../entities/Cohort';
import type { Citizen } from '../entities/Citizen';

function shopper(state: ReturnType<ReturnType<typeof newSim>['getState']>, shopId: string): Citizen {
  const cit = Object.values(state.citizens)[0]!;
  cit.cash = 100000;
  cit.activity = 'shopping';
  cit.movementState = 'idle';
  cit.targetFacilityId = shopId;
  const breadNeed = cit.needs.find((n) => n.productId === 'bread')!;
  breadNeed.urgency = 1.0;
  return cit;
}

describe('RetailDemandSystem', () => {
  it('transfers cash from citizen to firm and reduces store inventory', () => {
    const sim = newSim(11);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'bread', 40, 60);
    const firm = state.firms[shop.ownerFirmId]!;
    firm.pricesByProduct.bread = 350;

    const cit = shopper(state, shop.id);
    const citCashBefore = cit.cash;
    const firmCashBefore = firm.cash;
    const stockBefore = getQuantity(shop.inputInventory, 'bread');

    runRetailDemandSystem(makeContext(state));

    expect(cit.cash).toBeLessThan(citCashBefore);
    expect(firm.cash).toBeGreaterThan(firmCashBefore);
    expect(getQuantity(shop.inputInventory, 'bread')).toBeLessThan(stockBefore);
    // Conservation: cash leaving the citizen equals cash entering the firm.
    expect(citCashBefore - cit.cash).toBe(firm.cash - firmCashBefore);
  });

  it('reduces need urgency after a successful purchase', () => {
    const sim = newSim(12);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    addStock(shop.inputInventory, 'bread', 40, 60);
    const cit = shopper(state, shop.id);
    const need = cit.needs.find((n) => n.productId === 'bread')!;
    const urgencyBefore = need.urgency;

    runRetailDemandSystem(makeContext(state));

    expect(need.urgency).toBeLessThan(urgencyBefore);
  });

  it('creates unmet demand on a stockout', () => {
    const sim = newSim(13);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    shop.inputInventory = {}; // no bread
    shopper(state, shop.id);
    const unmetBefore = state.marketStats.bread!.unmetDemand;

    runRetailDemandSystem(makeContext(state));

    expect(state.marketStats.bread!.unmetDemand).toBeGreaterThan(unmetBefore);
    expect(shop.dailyStats.lostSales).toBeGreaterThan(0);
  });

  // A single urgent worker purchase in a CROWD town buys two extra baskets on
  // top of the base one — the crowd-scale backlog catch-up. A fully-jobbed city
  // cast worker shops too narrow an after-work window to make enough separate
  // staple trips, so it folds the throughput of the trips it can't make into the
  // visit it does. The gate is worker-tier + live crowd, so this is the exact
  // mechanism that keeps Village bit-identical; all branches are asserted below.
  function catchupSetup(seed: number) {
    const sim = newSim(seed);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'bread', 200, 60); // ample: qty is want-limited
    const firm = state.firms[shop.ownerFirmId]!;
    firm.pricesByProduct.bread = 200; // cheap: never priced out or unaffordable
    const cit = shopper(state, shop.id);
    cit.tier = 'worker'; // the catch-up is worker-tier only
    cit.cash = 1_000_000;
    const need = cit.needs.find((n) => n.productId === 'bread')!;
    need.urgency = 2.5; // > needUrgentThreshold (1.1) → catch-up fires
    need.preferredQuantity = 2;
    const stockBefore = getQuantity(shop.inputInventory, 'bread');
    return { state, shop, stockBefore };
  }

  it('crowd-town backlog catch-up: an urgent staple buys +2 extra baskets', () => {
    const { state, shop, stockBefore } = catchupSetup(21);
    // Live crowd present → catch-up active.
    state.cohorts['residential:worker'] = { ...emptyCohort('residential', 'worker', 'city'), population: 100 };

    runRetailDemandSystem(makeContext(state));

    const bought = stockBefore - getQuantity(shop.inputInventory, 'bread');
    // base preferredQuantity(2) + WORKER_CATCHUP_BASKETS(2) × 2 = 6, not the base 2.
    expect(bought).toBe(6);
  });

  it('Village (no crowd) buys only the base basket — catch-up stays dark', () => {
    const { state, shop, stockBefore } = catchupSetup(21); // identical setup, no cohort
    runRetailDemandSystem(makeContext(state));

    const bought = stockBefore - getQuantity(shop.inputInventory, 'bread');
    // No crowd → the ceil(urgency) branch never fires: the base preferredQuantity.
    expect(bought).toBe(2);
    expect(bought).toBeLessThan(6);
  });

  it('catch-up is worker-tier only: a comfortable shopper buys the base basket', () => {
    const { state, shop, stockBefore } = catchupSetup(21);
    state.cohorts['residential:worker'] = { ...emptyCohort('residential', 'worker', 'city'), population: 100 };
    // Same urgent need, but a comfortable citizen — the tier the crowd cohorts
    // already track, so no catch-up (extending it there flips their parity).
    Object.values(state.citizens)[0]!.tier = 'comfortable';

    runRetailDemandSystem(makeContext(state));

    const bought = stockBefore - getQuantity(shop.inputInventory, 'bread');
    expect(bought).toBe(2);
  });

  it('prices affect store attractiveness (lower price scores higher)', () => {
    const sim = newSim(14);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    addStock(shop.inputInventory, 'bread', 40, 60);
    const firm = state.firms[shop.ownerFirmId]!;
    const cit = Object.values(state.citizens)[0]!;
    const ctx = makeContext(state);

    firm.pricesByProduct.bread = 300;
    const cheap = scoreStore(ctx, cit, shop, 'bread')!.score;
    firm.pricesByProduct.bread = 600;
    const pricey = scoreStore(ctx, cit, shop, 'bread')!.score;

    expect(cheap).toBeGreaterThan(pricey);
  });
});
