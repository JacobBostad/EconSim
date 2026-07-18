import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { getAchievementDef } from '../data/achievements';

/**
 * Bot v5 — the pure supplier. No stores, no brands: two staffed grain farms
 * whose surplus sits in output storage waiting for AI customers. Guards the
 * whole B2B loop end-to-end: AI roasteries open importer-fed grain lines
 * mid-game, manageSourcing switches them to the player's cheaper local
 * surplus, and wholesale money flows in.
 *
 * Measured finding (kept as design): a pure GRAIN supplier is
 * cashflow-marginal — grain is cheap, wages aren't. Customers come, revenue
 * flows, but it's a sideline or a stepping stone, not an empire. The bot
 * asserts the loop, not riches.
 */
describe('Scripted 250-day playtest (bot v5, pure supplier)', () => {
  it('AI customers appear and wholesale revenue flows', () => {
    const sim = newSim(7);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    const supply0 = totalMoneySupply(state);

    for (const loc of [{ x: 20, y: 20 }, { x: 30, y: 20 }]) {
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: loc });
    }
    for (const fid of player.facilities) {
      sim.dispatch({ type: 'SELECT_RECIPE', facilityId: fid, recipeId: 'grow_grain' });
      sim.dispatch({ type: 'HIRE_WORKER', facilityId: fid, citizenId: null });
      sim.dispatch({ type: 'HIRE_WORKER', facilityId: fid, citizenId: null });
    }

    let customerSeen = false;
    for (let d = 1; d <= 250; d++) {
      sim.run(tpd);
      if (!customerSeen) {
        customerSeen = Object.values(state.contracts).some((c) => {
          const src = state.facilities[c.sourceFacilityId];
          return c.active && src && player.facilities.includes(src.id)
            && state.firms[c.ownerFirmId]?.ownerType === 'ai';
        });
      }
    }

    expect(customerSeen).toBe(true); // an AI firm switched its imports to us
    expect(player.wholesaleEarned).toBeGreaterThan(600_00);
    expect(totalMoneySupply(state)).toBe(supply0);

    // The cumulative counter drives the achievement.
    const ach = getAchievementDef('towns_supplier')!;
    player.wholesaleEarned = 1000_00;
    expect(ach.check(state)).toBe(true);
  }, 30000);
});
