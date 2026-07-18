import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { pricingInsight } from '../selectors/marketSelectors';
import { getProduct } from '../data/products';

describe('Pricing insight', () => {
  it('reflects brand/quality premium and competition', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const foods = findFirmByName(state, 'Sunrise Foods');
    const base = getProduct('bread').basePrice;

    const ins = pricingInsight(state, foods.id, 'bread');
    expect(ins.basePrice).toBe(base);
    expect(ins.wtpLow).toBeGreaterThan(base); // multiplier ≥1.4 for bread
    expect(ins.wtpHigh).toBeGreaterThan(ins.wtpLow);
    expect(ins.competitors).toBe(0); // only Sunrise sells bread at start

    // Raising brand/quality raises willingness-to-pay.
    const before = ins.wtpHigh;
    foods.brandByProduct['bread'] = 90;
    foods.qualityByProduct['bread'] = 95;
    const after = pricingInsight(state, foods.id, 'bread');
    expect(after.wtpHigh).toBeGreaterThan(before);

    // A player bread store counts as competition for Sunrise.
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 50, y: 55 } });
    const store = state.facilities[player.facilities[0]!]!;
    sim.dispatch({ type: 'SET_RETAIL_PRODUCT', facilityId: store.id, productId: 'bread' });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: store.id, citizenId: null });
    expect(pricingInsight(state, foods.id, 'bread').competitors).toBe(1);
  });
});
