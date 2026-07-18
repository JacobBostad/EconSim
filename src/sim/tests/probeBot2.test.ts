import { describe, it } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { companyValuation } from '../selectors/companySelectors';

describe('bot2', () => {
  it('market-power pacing', () => {
    const sim = newSim(12);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    const pid = player.id;
    let builtBread = false, builtClothes = false, hub = false;
    for (let day = 0; day < 250; day++) {
      const cash = player.cash;
      if (!builtBread && cash >= 10000_00) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: pid, productId: 'bread' });
        sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'bread', enabled: true });
        sim.dispatch({ type: 'SET_WAGE', firmId: pid, wage: 16_50 });
        sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'bread', dailyBudget: 14_00 });
        builtBread = true;
      }
      if (builtBread && !hub && day >= 25 && cash >= 3000_00) {
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'warehouse', location: { x: 24, y: 33 } });
        const wh = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse');
        const farm = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'farm');
        const factory = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'factory');
        if (wh && farm && factory) {
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: farm.id, destinationFacilityId: wh.id, productId: 'grain', targetQuantity: 40, reorderPoint: 30, maxInventory: 120 });
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: factory.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 30, reorderPoint: 20, maxInventory: 90 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'grain', minMult: 1.15, keep: 10 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.15, keep: 15 });
          hub = true;
        }
      }
      if (builtBread && !builtClothes && cash >= 9500_00 && day >= 30) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: pid, productId: 'clothes' });
        sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'clothes', enabled: true });
        sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'clothes', dailyBudget: 12_00 });
        builtClothes = true;
      }
      if (builtBread && cash >= 6000_00 && day % 8 === 3 && day > 30) {
        sim.dispatch({ type: 'INVEST_RND', firmId: pid, productId: 'bread', amount: 1200_00 });
      }
      for (const facId of player.facilities) {
        const fac = state.facilities[facId];
        if (fac && fac.employees.length < 2) sim.dispatch({ type: 'HIRE_WORKER', facilityId: facId, citizenId: null });
      }
      sim.run(tpd);
      if ((day + 1) % 50 === 0) {
        const v = companyValuation(state, pid).valuation;
        const h = player.accounting.dailyHistory.slice(-10);
        const net10 = h.reduce((a, d) => a + d.netProfit, 0) / 10;
        console.log(`d${day + 1}: val=$${(v / 100).toFixed(0)} cash=$${(player.cash / 100).toFixed(0)} net/day=$${(net10 / 100).toFixed(1)} price=${player.pricesByProduct['bread']} shares=${JSON.stringify(player.marketShareByProduct)}`);
      }
    }
  }, 30000);
});
