import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';

/**
 * Scripted playthrough: a competent (not perfect) player runs bread + clothes
 * chains with auto-pricing, ads, R&D, poaching wages, and upgrades. Guards the
 * whole progression loop end-to-end: if a change makes Tycoon unreachable for
 * this bot, this test fails before a human player ever feels it.
 */
describe('Scripted 250-day playtest', () => {
  // Regression FLOOR for a deliberately simple bot (a human plays far better:
  // tools/luxury markets untouched, no acquisitions, crude R&D timing). If
  // this bot can no longer build wealth, a change broke the progression loop.
  it('a competent bot builds a $15k+ valuation business within 250 days', () => {
    const sim = newSim(12);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    const pid = player.id;
    const supply0 = totalMoneySupply(state);

    const cash = () => player.cash;
    let builtBread = false;
    let builtClothes = false;
    let adsSet = false;
    let wageSet = false;
    let exportHub = false;
    const upgraded = new Set<string>();

    for (let day = 0; day < 250; day++) {
      // --- daily decisions (before running the day) ---
      if (!builtBread && cash() >= 10000_00) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: pid, productId: 'bread' });
        sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'bread', enabled: true });
        builtBread = player.facilities.length >= 3;
      }
      if (!wageSet && builtBread) {
        sim.dispatch({ type: 'SET_WAGE', firmId: pid, wage: 16_50 }); // match market early
        wageSet = true;
      }
      if (wageSet && day === 80) {
        sim.dispatch({ type: 'SET_WAGE', firmId: pid, wage: 19_00 }); // poach veterans once profitable
      }
      if (!adsSet && builtBread && cash() >= 3000_00) {
        sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'bread', dailyBudget: 14_00 });
        adsSet = true;
      }
      if (builtBread && !builtClothes && cash() >= 9500_00 && day >= 20) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: pid, productId: 'clothes' });
        sim.dispatch({ type: 'SET_AUTO_PRICE', firmId: pid, productId: 'clothes', enabled: true });
        sim.dispatch({ type: 'SET_AD_BUDGET', firmId: pid, productId: 'clothes', dailyBudget: 12_00 });
        builtClothes = player.facilities.length >= 6;
      }
      // Export hub: stage farm/bakery surplus and sell to Port Rosa on spikes.
      if (builtBread && !exportHub && day >= 25 && cash() >= 3000_00) {
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: pid, defId: 'warehouse', location: { x: 24, y: 33 } });
        const wh = player.facilities
          .map((id) => state.facilities[id]!)
          .find((f) => f.type === 'warehouse');
        const farm = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'farm');
        const factory = player.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'factory');
        if (wh && farm && factory) {
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: farm.id, destinationFacilityId: wh.id, productId: 'grain', targetQuantity: 40, reorderPoint: 30, maxInventory: 120 });
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: pid, sourceFacilityId: factory.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 30, reorderPoint: 20, maxInventory: 90 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'grain', minMult: 1.15, keep: 10 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 1.15, keep: 15 });
          exportHub = true;
        }
      }
      // R&D pulses on bread quality once established.
      if (builtBread && cash() >= 8000_00 && day % 8 === 5 && day > 40) {
        sim.dispatch({ type: 'INVEST_RND', firmId: pid, productId: 'bread', amount: 1500_00 });
      }
      // Upgrade factories when flush.
      if (cash() >= 16000_00) {
        for (const facId of player.facilities) {
          const fac = state.facilities[facId];
          if (fac && fac.type === 'factory' && fac.level === 1 && !upgraded.has(facId)) {
            sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: pid, facilityId: facId });
            upgraded.add(facId);
            break;
          }
        }
      }
      // Staff exactly to need: 2 per producer/factory (laborRequired), 2 clerks.
      for (const facId of player.facilities) {
        const fac = state.facilities[facId];
        if (!fac) continue;
        const target = fac.type === 'retail' ? 2 : 2;
        if (fac.employees.length < target) {
          sim.dispatch({ type: 'HIRE_WORKER', facilityId: facId, citizenId: null });
        }
      }
      sim.run(tpd);
    }

    const val = companyValuation(state, pid).valuation;
    const breadShare = player.marketShareByProduct['bread'] ?? 0;
    const clothesShare = player.marketShareByProduct['clothes'] ?? 0;
    const last30 = player.accounting.dailyHistory.slice(-30);
    const profit30 = last30.reduce((a, d) => a + d.netProfit, 0);
    console.log(`playtest: valuation=$${(val / 100).toFixed(0)} breadShare=${(breadShare * 100).toFixed(0)}% clothesShare=${(clothesShare * 100).toFixed(0)}% profit30d=$${(profit30 / 100).toFixed(0)} employees=${player.employees.length} quality=${JSON.stringify(player.qualityByProduct)}`);

    expect(totalMoneySupply(state)).toBe(supply0);
    expect(builtBread && builtClothes).toBe(true);
    expect(val).toBeGreaterThanOrEqual(15000_00); // grew beyond starting capital
    expect(breadShare).toBeGreaterThan(0.3);
    expect(profit30).toBeGreaterThan(0);
    expect(player.exportRevenue).toBeGreaterThan(0); // trade route in use
  }, 30000);
});
