import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName, findFacilityByName, setHour } from './helpers';
import { makeContext } from '../core/GameState';
import { runMarketingSystem } from '../systems/MarketingSystem';
import { runFinanceSystem } from '../systems/FinanceSystem';
import { runProductionSystem } from '../systems/ProductionSystem';
import { runRetailDemandSystem } from '../systems/RetailDemandSystem';
import { getQuality, addStock } from '../entities/Inventory';
import { dollars } from '../data/constants';

const TPD = 48;

describe('Marketing & brand', () => {
  it('advertising raises brand; brand decays without spend', () => {
    const sim = newSim(101);
    const state = sim.getState();
    const firm = findFirmByName(state, 'Sunrise Foods');
    firm.brandByProduct.bread = 0;
    firm.adBudgetByProduct.bread = dollars(100);
    state.tick = TPD; // day boundary
    runMarketingSystem(makeContext(state));
    const afterAd = firm.brandByProduct.bread!;
    expect(afterAd).toBeGreaterThan(0);

    firm.adBudgetByProduct.bread = 0;
    state.tick = TPD * 2;
    runMarketingSystem(makeContext(state));
    expect(firm.brandByProduct.bread!).toBeLessThan(afterAd); // decayed
  });
});

describe('R&D & quality', () => {
  it('R&D investment raises produced quality', () => {
    const sim = newSim(102);
    const state = sim.getState();
    const firm = findFirmByName(state, 'Sunrise Foods');
    const before = firm.qualityByProduct.bread ?? 0;
    sim.dispatch({ type: 'INVEST_RND', firmId: firm.id, productId: 'bread', amount: dollars(5000) });
    expect(firm.qualityByProduct.bread!).toBeGreaterThan(before);

    // Produced bread carries the firm's improved quality.
    const bakery = findFacilityByName(state, 'Sunrise Bakery');
    bakery.activeRecipeId = 'bake_bread';
    bakery.presentWorkers = 3;
    bakery.inputInventory = {}; bakery.outputInventory = {};
    addStock(bakery.inputInventory, 'grain', 30, 50);
    for (let i = 0; i < 3; i++) runProductionSystem(makeContext(state));
    expect(getQuality(bakery.outputInventory, 'bread')).toBeCloseTo(firm.qualityByProduct.bread!, 0);
  });
});

describe('Brand/quality raise willingness-to-pay', () => {
  it('a high-brand store sells at a price an unbranded one cannot', () => {
    const sim = newSim(103);
    const state = sim.getState();
    setHour(state, 17);
    const shop = findFacilityByName(state, 'Sunrise Bread Shop');
    const firm = state.firms[shop.ownerFirmId]!;
    shop.inputInventory = {};
    addStock(shop.inputInventory, 'bread', 40, 60);
    // Price above the citizen's base willingness (1.4–1.8x). 1.85x base.
    firm.pricesByProduct.bread = Math.round(getProduct('bread').basePrice * 1.85);

    const setup = () => {
      const cit = Object.values(state.citizens)[0]!;
      cit.cash = 100000;
      cit.activity = 'shopping'; cit.movementState = 'idle'; cit.targetFacilityId = shop.id;
      const n = cit.needs.find((x) => x.productId === 'bread')!;
      n.urgency = 1; n.maxAffordablePriceMultiplier = 1.5; // would refuse at 1.85x with no brand
      return cit;
    };

    // No brand: should refuse (no fulfilled sale).
    firm.brandByProduct.bread = 0;
    const c1 = setup();
    const cash1 = c1.cash;
    addStock(shop.inputInventory, 'bread', 40, 60);
    runRetailDemandSystem(makeContext(state));
    const boughtNoBrand = c1.cash < cash1;

    // Strong brand: premium lifts willingness -> buys.
    firm.brandByProduct.bread = 100;
    const c2 = setup();
    const cash2 = c2.cash;
    addStock(shop.inputInventory, 'bread', 40, 60);
    runRetailDemandSystem(makeContext(state));
    const boughtWithBrand = c2.cash < cash2;

    expect(boughtNoBrand).toBe(false);
    expect(boughtWithBrand).toBe(true);
  });
});

describe('Loans & interest', () => {
  it('borrowing adds cash + debt; interest accrues; repayment reduces debt', () => {
    const sim = newSim(104);
    const state = sim.getState();
    const firm = state.firms[state.playerFirmId]!;
    const cash0 = firm.cash;
    sim.dispatch({ type: 'TAKE_LOAN', firmId: firm.id, amount: dollars(5000) });
    expect(firm.debt).toBeGreaterThan(0);
    expect(firm.cash).toBe(cash0 + firm.debt);

    const debtBefore = firm.debt;
    const cashBeforeInterest = firm.cash;
    state.tick = TPD;
    runFinanceSystem(makeContext(state));
    expect(firm.cash).toBeLessThan(cashBeforeInterest); // interest paid
    expect(firm.debt).toBe(debtBefore); // principal unchanged by interest

    sim.dispatch({ type: 'REPAY_LOAN', firmId: firm.id, amount: dollars(1000) });
    expect(firm.debt).toBeLessThan(debtBefore);
  });
});

// local import to avoid top clutter
import { getProduct } from '../data/products';
