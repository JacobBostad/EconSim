import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { TRAINING_COST_PER_WORKER, TRAINING_SKILL_GAIN, SKILL_MAX } from '../systems/LaborSystem';

function setup() {
  const sim = newSim(1);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 20000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'farm', location: { x: 100, y: 22 } });
  const farm = state.facilities[player.facilities[0]!]!;
  sim.dispatch({ type: 'HIRE_WORKER', facilityId: farm.id, citizenId: null });
  sim.dispatch({ type: 'HIRE_WORKER', facilityId: farm.id, citizenId: null });
  return { sim, state, player, farm };
}

describe('Crew training', () => {
  it('bumps every trainee, bills per head, and conserves money', () => {
    const { sim, state, player, farm } = setup();
    const before = farm.employees.map((cid) => state.citizens[cid]!.skill);
    const supply0 = totalMoneySupply(state);
    const cash0 = player.cash;

    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: farm.id });

    farm.employees.forEach((cid, i) => {
      expect(state.citizens[cid]!.skill).toBeCloseTo(
        Math.min(SKILL_MAX, before[i]! + TRAINING_SKILL_GAIN),
      );
    });
    expect(player.cash).toBe(cash0 - farm.employees.length * TRAINING_COST_PER_WORKER);
    expect(totalMoneySupply(state)).toBe(supply0);
    // Books as R&D for the day.
    expect(player.accounting.today.rnd).toBeGreaterThanOrEqual(
      farm.employees.length * TRAINING_COST_PER_WORKER,
    );
  });

  it('caps at SKILL_MAX, skips capped workers, and no-ops on a full crew', () => {
    const { sim, state, player, farm } = setup();
    const [a, b] = farm.employees;
    state.citizens[a!]!.skill = SKILL_MAX; // veteran: not billed
    state.citizens[b!]!.skill = 1.25; // clamps at cap
    const cash0 = player.cash;
    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: farm.id });
    expect(state.citizens[b!]!.skill).toBeCloseTo(SKILL_MAX);
    expect(player.cash).toBe(cash0 - 1 * TRAINING_COST_PER_WORKER);

    // Whole crew at cap: nothing charged.
    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: farm.id });
    expect(player.cash).toBe(cash0 - 1 * TRAINING_COST_PER_WORKER);
  });

  it('refuses without cash and never trains rivals for you', () => {
    const { sim, state, player, farm } = setup();
    player.cash = 10_00;
    const before = farm.employees.map((cid) => state.citizens[cid]!.skill);
    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: farm.id });
    farm.employees.forEach((cid, i) => {
      expect(state.citizens[cid]!.skill).toBe(before[i]!);
    });

    const aiFac = Object.values(state.facilities).find(
      (f) => state.firms[f.ownerFirmId]?.ownerType === 'ai' && f.employees.length > 0,
    )!;
    player.cash = 20000_00;
    const aiSkills = aiFac.employees.map((cid) => state.citizens[cid]!.skill);
    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: aiFac.id });
    aiFac.employees.forEach((cid, i) => {
      expect(state.citizens[cid]!.skill).toBe(aiSkills[i]!);
    });
  });

  it('a trained-up crew unlocks Master Crew on the next scan', () => {
    const { sim, state, player, farm } = setup();
    for (const cid of farm.employees) state.citizens[cid]!.skill = 1.2;
    sim.dispatch({ type: 'TRAIN_CREW', firmId: player.id, facilityId: farm.id });
    sim.run(ticksPerDay(state.config));
    expect(state.achievements.some((a) => a.id === 'master_crew')).toBe(true);
  });
});
