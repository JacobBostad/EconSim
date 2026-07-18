import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';

/**
 * Scripted 250-day playthrough — regression FLOOR for the progression loop.
 * Bot v3 plays a consolidated general-store strategy: bread chain via the
 * wizard, clothes + pastries toggled onto the SAME store (basket economics),
 * a warehouse with standing export orders, capped R&D, lean staffing. A human
 * plays far better (tools market untouched, no acquisitions, no festivals).
 * Measured on seed 12: peak ≈ $35k, final ≈ $24k. Floors leave drift headroom;
 * if they break, a change hurt the player's ability to build a business.
 */
describe('Scripted 250-day playtest (bot v3)', () => {
  it('the general-store bot builds real wealth', () => {
    const sim = newSim(12);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    const pid = player.id;
    let stage = 0;
    let luxTry = false;
    const supply0 = totalMoneySupply(state);
    let maxVal = 0;

    const facs = () => player.facilities.map((i) => state.facilities[i]!);
    const store = () => facs().find((f) => f.type === 'retail');

    for (let day = 0; day < 250; day++) {
      const cash = player.cash;
      if (stage === 0 && cash >= 10000_00) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: pid, productId: 'bread' });
        sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'bread', enabled: true });
        sim.dispatch({ type: 'SET_WAGE', firmId: pid, wage: 16_50 });
        sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'bread', dailyBudget: 14_00 });
        stage = 1;
      }
      if (stage === 1 && day >= 18 && cash >= 7000_00) {
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'farm', location: { x: 30, y: 22 } });
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'factory', location: { x: 36, y: 36 } });
        const cottonFarm = facs().filter((f) => f.type === 'farm').find((f) => !f.activeRecipeId);
        const clothesFac = facs().filter((f) => f.type === 'factory').find((f) => !f.activeRecipeId);
        const st = store();
        if (cottonFarm && clothesFac && st) {
          sim.dispatch({ type: 'SELECT_RECIPE', facilityId: cottonFarm.id, recipeId: 'grow_cotton' });
          sim.dispatch({ type: 'SELECT_RECIPE', facilityId: clothesFac.id, recipeId: 'sew_clothes' });
          sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: st.id, productId: 'clothes' });
          sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'clothes', enabled: true });
          sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'clothes', dailyBudget: 10_00 });
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: cottonFarm.id, destinationFacilityId: clothesFac.id, productId: 'cotton', targetQuantity: 24, reorderPoint: 10, maxInventory: 50 });
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: clothesFac.id, destinationFacilityId: st.id, productId: 'clothes', targetQuantity: 24, reorderPoint: 10, maxInventory: 60 });
          stage = 2;
        }
      }
      if (stage === 2 && day >= 30 && cash >= 3000_00) {
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'warehouse', location: { x: 24, y: 33 } });
        const wh = facs().find((f) => f.type === 'warehouse');
        const grainFarm = facs().find((f) => f.activeRecipeId === 'grow_grain');
        const bakery = facs().find((f) => f.activeRecipeId === 'bake_bread');
        if (wh && grainFarm && bakery) {
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: grainFarm.id, destinationFacilityId: wh.id, productId: 'grain', targetQuantity: 40, reorderPoint: 30, maxInventory: 120 });
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: bakery.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 30, reorderPoint: 20, maxInventory: 90 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'grain', minMult: 1.15, keep: 10 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.15, keep: 15 });
          stage = 3;
        }
      }
      if (stage === 3 && day >= 80 && cash >= 8000_00 && !luxTry) {
        sim.dispatch({ type: 'INVEST_RND', firmId: pid, productId: 'pastries', amount: 2500_00 });
        if ((player.qualityByProduct['pastries'] ?? 0) >= 75) {
          sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'factory', location: { x: 56, y: 24 } });
          const pastryFac = facs().filter((f) => f.type === 'factory').find((f) => !f.activeRecipeId);
          const grainFarm = facs().find((f) => f.activeRecipeId === 'grow_grain');
          const st = store();
          if (pastryFac && grainFarm && st) {
            sim.dispatch({ type: 'SELECT_RECIPE', facilityId: pastryFac.id, recipeId: 'bake_pastries' });
            sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: st.id, productId: 'pastries' });
            sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'pastries', enabled: true });
            sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: grainFarm.id, destinationFacilityId: pastryFac.id, productId: 'grain', targetQuantity: 16, reorderPoint: 8, maxInventory: 40 });
            sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: pastryFac.id, destinationFacilityId: st.id, productId: 'pastries', targetQuantity: 16, reorderPoint: 6, maxInventory: 40 });
            luxTry = true;
            stage = 4;
          }
        }
      }
      if (stage >= 1 && cash >= 6000_00 && day % 8 === 3 && day > 30 &&
          (player.qualityByProduct['bread'] ?? 0) < 80) {
        sim.dispatch({ type: 'INVEST_RND', firmId: pid, productId: 'bread', amount: 1200_00 });
      }
      for (const fac of facs()) {
        const scale = stage >= 3 && player.cash > 12000_00 ? 3 : 2;
        const target = fac.type === 'retail' ? 2 : fac.type === 'warehouse' ? 0 : scale;
        if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
      }
      sim.run(tpd);
      maxVal = Math.max(maxVal, companyValuation(state, pid).valuation);
    }

    const finalVal = companyValuation(state, pid).valuation;
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(stage).toBeGreaterThanOrEqual(3);
    expect(maxVal).toBeGreaterThanOrEqual(28000_00);
    expect(finalVal).toBeGreaterThanOrEqual(18000_00);
    // Exports are Port-Rosa-window sensitive (mean-reverting, event-driven
    // prices), so the magnitude swings with any rng-stream shift. A few $k
    // proves the warehouse -> standing-order -> export loop end-to-end; the
    // maxVal/finalVal floors above are the real wealth regression guard.
    expect(player.exportRevenue).toBeGreaterThan(2000_00);
    expect(player.marketShareByProduct['bread'] ?? 0).toBeGreaterThan(0.25);
  }, 30000);
});
