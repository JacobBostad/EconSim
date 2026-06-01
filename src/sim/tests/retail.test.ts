import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName, setHour } from './helpers';
import { makeContext } from '../core/GameState';
import {
  runRetailDemandSystem,
  scoreStore,
} from '../systems/RetailDemandSystem';
import { getQuantity, addStock } from '../entities/Inventory';
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
