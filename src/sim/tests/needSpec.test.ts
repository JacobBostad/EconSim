import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { PRODUCTS, ALL_PRODUCT_IDS, CONSUMER_PRODUCT_IDS } from '../data/products';
import { defaultNeedFor } from '../entities/factories';
import { tierNeedGrowthMult, tierPriceCapMult } from '../systems/TierSystem';
import { basketNormalization, needWeight, BASKET_WEIGHT_BASELINE } from '../systems/SatisfactionSystem';

describe('Demand as data (needSpec)', () => {
  it('reproduces the historical need draws exactly (seed 11 fingerprint)', () => {
    // Captured from the hand-authored table before the refactor — the spec
    // loop must draw the same values in the same order, or every seeded
    // baseline in the repo silently shifts.
    const state = newSim(11).getState();
    const c0 = state.citizens[Object.keys(state.citizens).sort()[0]!]!;
    const fp = c0.needs.map((n) =>
      `${n.productId}:${n.urgency.toFixed(4)}:${n.urgencyGrowthPerDay.toFixed(4)}:${n.maxAffordablePriceMultiplier.toFixed(4)}`).join('|');
    expect(fp).toBe(
      'bread:0.7005:0.5665:1.7702|tools:0.1411:0.2445:1.5800|coffee:0.5660:0.4659:1.8212|' +
      'clothes:0.4993:0.2378:1.6059|pastries:0.0000:0.1593:1.4106|jewelry:0.0000:0.0510:1.3716',
    );
  });

  it('every consumer product carries a needSpec; raws and intermediates none', () => {
    for (const pid of ALL_PRODUCT_IDS) {
      const p = PRODUCTS[pid]!;
      if (CONSUMER_PRODUCT_IDS.includes(pid)) expect(p.needSpec, pid).toBeTruthy();
      else expect(p.needSpec, pid).toBeUndefined();
    }
    // Spec orders are unique — a duplicate would make draw order ambiguous.
    const orders = CONSUMER_PRODUCT_IDS.map((pid) => PRODUCTS[pid]!.needSpec!.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('migration defaults are byte-compatible with the historical table', () => {
    expect(defaultNeedFor('clothes')).toMatchObject({ urgency: 0.25, urgencyGrowthPerDay: 0.21, maxAffordablePriceMultiplier: 1.5 });
    expect(defaultNeedFor('coffee')).toMatchObject({ urgency: 0.3, urgencyGrowthPerDay: 0.42, maxAffordablePriceMultiplier: 1.7 });
    expect(defaultNeedFor('pastries')).toMatchObject({ urgency: 0, urgencyGrowthPerDay: 0.14, maxAffordablePriceMultiplier: 1.4 });
    expect(defaultNeedFor('jewelry')).toMatchObject({ urgency: 0, urgencyGrowthPerDay: 0.05, maxAffordablePriceMultiplier: 1.25 });
    expect(defaultNeedFor('grain')).toBeNull();
  });

  it('tier tables absorbed into specs keep their exact values', () => {
    expect(tierNeedGrowthMult('worker', 'pastries')).toBe(0);
    expect(tierNeedGrowthMult('comfortable', 'jewelry')).toBe(0.3);
    expect(tierNeedGrowthMult('affluent', 'coffee')).toBe(1.5);
    expect(tierNeedGrowthMult('affluent', 'clothes')).toBe(1.4);
    expect(tierNeedGrowthMult('worker', 'bread')).toBe(1); // unlisted default
    expect(tierPriceCapMult('affluent', 'bread')).toBe(1.1);
    expect(tierPriceCapMult('affluent', 'coffee')).toBe(1.2);
    expect(tierPriceCapMult('worker', 'coffee')).toBe(1);
  });

  it('basket normalization is provably inert for the shipped catalog', () => {
    const state = newSim(11).getState();
    for (const cit of Object.values(state.citizens)) {
      for (const tier of ['worker', 'comfortable', 'affluent'] as const) {
        expect(basketNormalization({ tier, needs: cit.needs })).toBe(1);
      }
    }
    // ...and kicks in once a basket outweighs the baseline: a synthetic
    // heavy basket normalizes back down to W₀ worth of exposure.
    const heavy = {
      tier: 'worker' as const,
      needs: [
        ...Object.values(state.citizens)[0]!.needs,
        { productId: 'bread' }, { productId: 'bread' }, // duplicate weight, > W₀
      ],
    };
    const factor = basketNormalization(heavy);
    expect(factor).toBeLessThan(1);
    const sum = heavy.needs
      .filter((n) => tierNeedGrowthMult('worker', n.productId) > 0)
      .reduce((a, n) => a + needWeight(n.productId), 0);
    expect(factor).toBeCloseTo(BASKET_WEIGHT_BASELINE / sum, 10);
  });
});
