import { describe, it, expect } from 'vitest';
import { newSim, findFacilityByName } from './helpers';
import { makeContext } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { scoreStore } from '../systems/RetailDemandSystem';
import {
  positioningAffinity,
  positioningPriceImage,
  PREMIUM_QUALITY_THRESHOLD,
} from '../systems/TierSystem';
import { addStock } from '../entities/Inventory';
import { getProduct } from '../data/products';
import { deserialize, serialize } from '../persistence/saveLoad';

describe('Store positioning', () => {
  it('discount courts workers, premium courts the affluent', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'bread', 40, 80); // quality earns the premium sign
    const firm = state.firms[shop.ownerFirmId]!;
    firm.pricesByProduct.bread = Math.round(getProduct('bread').basePrice * 0.85); // honest discount
    const cit = Object.values(state.citizens)[0]!;
    const ctx = makeContext(state);

    cit.tier = 'worker';
    shop.positioning = 'discount';
    const workerAtDiscount = scoreStore(ctx, cit, shop, 'bread')!.score;
    shop.positioning = 'premium';
    const workerAtPremium = scoreStore(ctx, cit, shop, 'bread')!.score;
    expect(workerAtDiscount).toBeGreaterThan(workerAtPremium);

    cit.tier = 'affluent';
    const affluentAtPremium = scoreStore(ctx, cit, shop, 'bread')!.score;
    shop.positioning = 'discount';
    const affluentAtDiscount = scoreStore(ctx, cit, shop, 'bread')!.score;
    expect(affluentAtPremium).toBeGreaterThan(affluentAtDiscount);
  });

  it('unearned signs behave as standard — positioning is a promise', () => {
    const cheap = { avgQuality: 80, price: 300, marketAvgPrice: 400 };
    const pricey = { avgQuality: 80, price: 400, marketAvgPrice: 400 };
    // A premium sign over shoddy stock is just a standard store...
    expect(positioningAffinity('premium', 'affluent', { ...pricey, avgQuality: PREMIUM_QUALITY_THRESHOLD - 1 })).toBe(0);
    expect(positioningAffinity('premium', 'affluent', pricey)).toBeGreaterThan(0);
    // ...and a discount sign without real undercutting earns nothing.
    expect(positioningAffinity('discount', 'worker', pricey)).toBe(0);
    expect(positioningAffinity('discount', 'worker', cheap)).toBeGreaterThan(0);
    // Only an earned premium sign moves the walkaway cap.
    expect(positioningPriceImage('premium', 30)).toBe(1);
    expect(positioningPriceImage('premium', 80)).toBeGreaterThan(1);
    expect(positioningPriceImage('discount', 30)).toBe(1);
  });

  it('SET_POSITIONING flips retail stores and ignores factories', () => {
    const sim = newSim(6);
    const state = sim.getState();
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    sim.dispatch({ type: 'SET_POSITIONING', facilityId: shop.id, positioning: 'discount' });
    expect(shop.positioning).toBe('discount');

    const nonRetail = Object.values(state.facilities).find((f) => f.type === 'factory')!;
    sim.dispatch({ type: 'SET_POSITIONING', facilityId: nonRetail.id, positioning: 'premium' });
    expect(nonRetail.positioning).toBe('standard');
  });

  it('AI personalities adopt a matching format', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    const firm = state.firms[shop.ownerFirmId]!;
    expect(firm.ownerType).toBe('ai');

    firm.personalityId = 'price_fighter';
    sim.run(ticksPerDay(state.config));
    expect(shop.positioning).toBe('discount');
    expect(state.events.some((e) => e.message.includes('discount format'))).toBe(true);
  });

  it('brand builders wait for quality before going premium', () => {
    const sim = newSim(8);
    const state = sim.getState();
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    const firm = state.firms[shop.ownerFirmId]!;
    firm.personalityId = 'brand_builder';
    firm.qualityByProduct['bread'] = 40; // not premium-worthy yet
    sim.run(ticksPerDay(state.config));
    expect(shop.positioning).toBe('standard'); // quality not there yet

    firm.qualityByProduct['bread'] = 75;
    sim.run(ticksPerDay(state.config));
    expect(shop.positioning).toBe('premium');
  });

  it('old saves default to standard positioning', () => {
    const sim = newSim(9);
    const raw = JSON.parse(serialize(sim.getState())) as {
      facilities: Record<string, Record<string, unknown>>;
    };
    for (const fid in raw.facilities) delete raw.facilities[fid]!.positioning;
    const migrated = deserialize(JSON.stringify(raw));
    for (const fid in migrated.facilities) {
      expect(migrated.facilities[fid]!.positioning).toBe('standard');
    }
  });
});
