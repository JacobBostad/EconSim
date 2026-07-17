import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { MISSION_DEFS, activeMission } from '../data/missions';
import { deserialize, serialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';

describe('Missions', () => {
  it('defs are unique and the chain starts at Break Ground', () => {
    const ids = MISSION_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sim = newSim(1);
    expect(activeMission(sim.getState())?.id).toBe('build_first');
  });

  it('completing missions pays rewards, conserves money, and advances the chain', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const supplyBefore = totalMoneySupply(state);

    sim.dispatch({
      type: 'BUILD_FACILITY',
      firmId: player.id,
      defId: 'retail',
      location: { x: 50, y: 55 },
    });
    const cashAfterBuild = player.cash;

    sim.run(state.config.ticksPerHour); // one hourly check
    expect(state.missions.map((m) => m.id)).toEqual(['build_first']);
    expect(player.cash).toBe(cashAfterBuild + dollars(500));
    expect(totalMoneySupply(state)).toBe(supplyBefore);
    expect(activeMission(state)?.id).toBe('hire_two');

    // Only one mission may complete per hourly check, even if several qualify.
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: player.facilities[0]!, citizenId: null });
    sim.dispatch({ type: 'HIRE_WORKER', facilityId: player.facilities[0]!, citizenId: null });
    sim.run(state.config.ticksPerHour);
    expect(state.missions.length).toBe(2);
  });

  it('missions persist through save/load and default for old saves', () => {
    const sim = newSim(1);
    const state = sim.getState();
    state.missions.push({ id: 'build_first', day: 0 });
    const loaded = deserialize(serialize(state));
    expect(loaded.missions).toEqual([{ id: 'build_first', day: 0 }]);
    expect(activeMission(loaded)?.id).toBe('hire_two');

    const raw = JSON.parse(serialize(state));
    delete raw.missions;
    expect(deserialize(JSON.stringify(raw)).missions).toEqual([]);
  });
});
