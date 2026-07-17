import { describe, it, expect } from 'vitest';
import { configForDifficulty, DEFAULT_CONFIG } from '../core/SimulationConfig';
import { createInitialState } from '../data/startingScenario';
import { deserialize, serialize } from '../persistence/saveLoad';
import { newSim } from './helpers';

describe('Difficulty presets', () => {
  it('presets scale starting cash, event frequency, and AI expansion', () => {
    const relaxed = configForDifficulty('relaxed');
    const standard = configForDifficulty('standard');
    const brutal = configForDifficulty('brutal');

    expect(relaxed.playerStartCash).toBeGreaterThan(standard.playerStartCash);
    expect(brutal.playerStartCash).toBeLessThan(standard.playerStartCash);
    expect(relaxed.worldEventDailyChance).toBeLessThan(brutal.worldEventDailyChance);
    expect(relaxed.aiExpandChance).toBeLessThan(brutal.aiExpandChance);
    expect(standard).toEqual({ ...DEFAULT_CONFIG, difficulty: 'standard' });
  });

  it('the player firm starts with the preset cash', () => {
    const brutal = createInitialState(9, configForDifficulty('brutal'));
    expect(brutal.firms[brutal.playerFirmId]!.cash).toBe(9000 * 100);
    const relaxed = createInitialState(9, configForDifficulty('relaxed'));
    expect(relaxed.firms[relaxed.playerFirmId]!.cash).toBe(25000 * 100);
  });

  it('old saves normalize to standard difficulty knobs', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    delete raw.config.difficulty;
    delete raw.config.playerStartCash;
    delete raw.config.worldEventDailyChance;
    delete raw.config.aiExpandChance;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.config.difficulty).toBe('standard');
    expect(loaded.config.worldEventDailyChance).toBeCloseTo(0.2);
    expect(loaded.config.aiExpandChance).toBeCloseTo(0.5);
    expect(loaded.config.playerStartCash).toBe(15000 * 100);
  });
});
