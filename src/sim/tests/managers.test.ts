import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { managerCandidates, managerDuties, MARKETING_DUTY_SKILL } from '../systems/ManagerSystem';
import { addStock } from '../entities/Inventory';
import { deserialize, serialize } from '../persistence/saveLoad';
import { getProduct } from '../data/products';
import type { Simulation } from '../core/Simulation';

/** Player builds and staffs a bread store; returns the facility. */
function playerStore(sim: Simulation) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 100000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 60, y: 30 } });
  const shop = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  sim.dispatch({ type: 'TOGGLE_RETAIL_PRODUCT', facilityId: shop.id, productId: 'bread' });
  for (let i = 0; i < 2; i++) sim.dispatch({ type: 'HIRE_WORKER', facilityId: shop.id, citizenId: null });
  return shop;
}

describe('Managers', () => {
  it('weekly candidates are deterministic and banded', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const a = managerCandidates(state, 10);
    const b = managerCandidates(state, 12); // same week
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    expect(a[0]!.salaryPerDay).toBeLessThan(a[2]!.salaryPerDay);
    expect(managerDuties(a[0]!.skill)).toContain('pricing');
    expect(a[2]!.skill).toBeGreaterThanOrEqual(MARKETING_DUTY_SKILL);
    expect(managerDuties(a[2]!.skill)).toContain('marketing');
    const nextWeek = managerCandidates(state, 17);
    expect(nextWeek).not.toEqual(a); // the market rotates
  });

  it('hire and fire, one manager per store', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const shop = playerStore(sim);
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 1 });
    expect(player.managers.length).toBe(1);
    const day = computeTime(state.tick, state.config).day;
    const cand = managerCandidates(state, day)[1]!;
    expect(player.managers[0]!.name).toBe(cand.name);
    expect(player.managers[0]!.salaryPerDay).toBe(cand.salaryPerDay);

    // Second hire for the same store is refused.
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 0 });
    expect(player.managers.length).toBe(1);

    sim.dispatch({ type: 'FIRE_MANAGER', firmId: player.id, managerId: player.managers[0]!.id });
    expect(player.managers.length).toBe(0);
  });

  it('salary is paid daily, conserves money, and books as wages', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const shop = playerStore(sim);
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 0 });
    const salary = player.managers[0]!.salaryPerDay;
    const supply0 = totalMoneySupply(state);
    const wages0 = player.accounting.lifetime.wages;
    sim.run(ticksPerDay(state.config));
    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.accounting.lifetime.wages).toBeGreaterThanOrEqual(wages0 + salary);
  });

  it('the manager reprices an overpriced store toward selling', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const shop = playerStore(sim);
    addStock(shop.inputInventory, 'bread', 200, 60);
    player.pricesByProduct['bread'] = getProduct('bread').basePrice * 3; // nobody buys
    expect(player.autoPriceByProduct['bread']).toBeFalsy();

    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 0 });
    const before = player.pricesByProduct['bread']!;
    sim.run(ticksPerDay(state.config) * 3);
    expect(player.pricesByProduct['bread']!).toBeLessThan(before);
  });

  it('an unpayable manager resigns on the spot', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const shop = playerStore(sim);
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 2 });
    sim.run(ticksPerDay(state.config)); // let one-time early mission payouts land
    player.cash = 100; // less than any salary
    sim.run(ticksPerDay(state.config));
    expect(player.managers.length).toBe(0);
    expect(state.events.some((e) => e.message.includes('resigned as'))).toBe(true);
  });

  it('inserting the system re-deals nothing without a hire', () => {
    const a = newSim(6);
    const b = newSim(6);
    const tpd = ticksPerDay(a.getState().config);
    a.run(tpd * 20);
    b.run(tpd * 20);
    expect(normalizedSerialize(a.getState())).toBe(normalizedSerialize(b.getState()));
  });

  it('firm-wide roles have their own candidate pools and a one-per-role cap', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const store = managerCandidates(state, 10, 'store');
    const logistics = managerCandidates(state, 10, 'logistics');
    const sales = managerCandidates(state, 10, 'sales');
    expect(logistics.map((c) => c.name)).not.toEqual(store.map((c) => c.name));
    expect(sales.map((c) => c.name)).not.toEqual(logistics.map((c) => c.name));
    expect(logistics[0]!.salaryPerDay).toBeGreaterThan(store[0]!.salaryPerDay);

    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'logistics', candidateIndex: 0 });
    expect(player.managers.filter((m) => m.role === 'logistics').length).toBe(1);
    expect(player.managers[0]!.facilityId).toBeNull();
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'logistics', candidateIndex: 1 });
    expect(player.managers.filter((m) => m.role === 'logistics').length).toBe(1); // capped
  });

  it('the sales manager ships staged goods and completes a rush order unattended', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 70, y: 30 } });
    const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
    addStock(wh.inputInventory, 'bread', 100, 60);
    const day = computeTime(state.tick, state.config).day;
    state.rushOrder = {
      cityId: 'port_rosa', productId: 'bread', quantity: 50, filled: 0,
      startDay: day, deadlineDay: day + 5, bonusCents: 100_00,
    };
    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'sales', candidateIndex: 1 });
    const completed0 = state.rushOrdersCompleted;
    sim.run(ticksPerDay(state.config));
    expect(state.rushOrdersCompleted).toBe(completed0 + 1);
    expect(state.rushOrder).toBeNull();
    // Seasoned hands also left a standing export order on the stocked warehouse.
    expect(wh.exportOrders['bread']).toBeTruthy();
  });

  it('the logistics manager swaps an importer contract to cheaper local wholesale', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 90, y: 30 } });
    const factory = state.facilities[player.facilities[player.facilities.length - 1]!]!;
    const importer = Object.values(state.facilities).find((f) => f.type === 'importer')!;
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id,
      sourceFacilityId: importer.id, destinationFacilityId: factory.id,
      productId: 'grain', targetQuantity: 20, reorderPoint: 10, maxInventory: 40,
    });
    // A local AI farm sits on a fat grain surplus, priced at wholesale.
    const aiFarm = Object.values(state.facilities).find(
      (f) => f.type === 'farm' && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    addStock(aiFarm.outputInventory, 'grain', 300, 60);

    sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'logistics', candidateIndex: 1 });
    sim.run(ticksPerDay(state.config) * 3);
    const contract = Object.values(state.contracts).find(
      (c) => c.ownerFirmId === player.id && c.productId === 'grain',
    )!;
    expect(state.facilities[contract.sourceFacilityId]?.type).not.toBe('importer');
  });

  it('old saves migrate with an empty manager roster', () => {
    const sim = newSim(3);
    const raw = JSON.parse(serialize(sim.getState())) as {
      firms: Record<string, Record<string, unknown>>;
    };
    for (const fid in raw.firms) delete raw.firms[fid]!.managers;
    const migrated = deserialize(JSON.stringify(raw));
    for (const fid in migrated.firms) {
      expect(migrated.firms[fid]!.managers).toEqual([]);
    }
  });
});
