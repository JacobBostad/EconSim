import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';

/**
 * Bot v6 — the offers-era integration regression. On top of the familiar
 * bread-chain-plus-exports play it exercises the three systems added this
 * era working together: rush orders filled hands-free by a standing export
 * order, fire-sale purchases whenever a struggling rival's building is
 * affordable, and crew training whenever a facility's average skill dips
 * below 1.1. Floors assert every system actually fired (probed at seed 9:
 * 5 rush orders completed, 8 fire sales bought, 4 training sessions —
 * floors sit well under the measured values so seed-adjacent drift doesn't
 * flake). A human still plays far better.
 */
describe('Scripted 250-day playtest (bot v6, offers era)', () => {
  it('rush orders, fire sales, and training all fire together, conserved', () => {
    const sim = newSim(9);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    player.cash = 40000_00;
    const supply0 = totalMoneySupply(state);
    let stage = 0;
    let trainings = 0;

    const facs = () => player.facilities.map((i) => state.facilities[i]!);
    for (let day = 0; day < 250; day++) {
      const cash = player.cash;
      if (stage === 0 && cash >= 10000_00) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
        const wh = facs().find((f) => f.type === 'warehouse');
        const factory = facs().find((f) => f.type === 'factory');
        if (wh && factory) {
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id, sourceFacilityId: factory.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 8, reorderPoint: 500, maxInventory: 999 });
          sim.dispatch({ type: 'SET_EXPORT_ORDER', facilityId: wh.id, productId: 'bread', minMult: 0.8, keep: 0 });
        }
        stage = 1;
      }
      if (stage >= 1 && day % 10 === 0 && cash > 8000_00) {
        for (const fac of facs()) {
          if (fac.employees.length === 0) continue;
          const avg = fac.employees.reduce((s2, cid) => s2 + (state.citizens[cid]?.skill ?? 0), 0) / fac.employees.length;
          if (avg < 1.1) {
            sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: fac.id });
            trainings += 1;
            break;
          }
        }
      }
      const offer = state.facilityOffer;
      if (offer && cash > offer.askCents + 5000_00) {
        sim.dispatch({ type: 'ACCEPT_FACILITY_OFFER' });
      }
      for (const fac of facs()) {
        const target = fac.type === 'retail' ? 2 : fac.type === 'home' || fac.defId === 'apartment' ? 0 : 2;
        if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
      }
      sim.run(tpd);
    }

    expect(totalMoneySupply(state)).toBe(supply0);
    // Every offers-era system actually fired (measured 5 / 8 / 4 at this seed).
    expect(state.rushOrdersCompleted).toBeGreaterThanOrEqual(2);
    expect(state.fireSalesBought).toBeGreaterThanOrEqual(3);
    expect(trainings).toBeGreaterThanOrEqual(2);
    // The fire-sale spree grows the empire without breaking the firm.
    expect(player.facilities.length).toBeGreaterThanOrEqual(6);
    expect(player.bankruptcyStatus).not.toBe('insolvent');
  }, 30000);
});
