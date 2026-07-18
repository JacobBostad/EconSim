import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { facilityPnL } from '../selectors/companySelectors';
import { morningBriefing } from '../selectors/advisorSelectors';

describe('Facility P&L', () => {
  it('snapshots yesterdayStats at the daily reset and stamps transfer values', () => {
    const sim = newSim(5);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 2 + 2);

    // Some AI store sold goods yesterday...
    const soldSomewhere = Object.values(state.facilities).some(
      (f) => f.type === 'retail' && f.yesterdayStats.unitsSold > 0,
    );
    expect(soldSomewhere).toBe(true);
    // ...and contract shipments were valued on both ends.
    const shippedValue = Object.values(state.facilities).some(
      (f) => f.yesterdayStats.transferOutValue > 0,
    );
    const receivedValue = Object.values(state.facilities).some(
      (f) => f.yesterdayStats.transferInValue > 0,
    );
    expect(shippedValue).toBe(true);
    expect(receivedValue).toBe(true);
  });

  it('attributes revenue, transfers, wages, and upkeep per facility', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    const store = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;

    store.yesterdayStats.revenue = 500_00;
    store.yesterdayStats.transferInValue = 120_00;
    store.yesterdayStats.unitsSold = 40;

    const rows = facilityPnL(state, player.id);
    const row = rows.find((r) => r.facilityId === store.id)!;
    const wages = store.employees.length * player.wagePolicy.baseWage;
    expect(row.revenue).toBe(500_00);
    expect(row.cost).toBe(wages + store.operatingCostPerDay + 120_00);
    expect(row.net).toBe(row.revenue - row.cost);
    // Sorted best-first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.net).toBeGreaterThanOrEqual(rows[i]!.net);
    }
  });

  it('the advisor names the money pit after day 2', () => {
    const sim = newSim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 40, y: 40 } });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: player.facilities[player.facilities.length - 1]!, citizenId: null });
    state.tick = ticksPerDay(state.config) * 3; // day 3, yesterdayStats still zero

    const advice = morningBriefing(state);
    const pit = advice.find((a) => a.icon === '💸');
    expect(pit).toBeTruthy();
    expect(pit!.text).toContain('money pit');
  });
});
