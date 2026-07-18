import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { createInitialState } from '../data/startingScenario';
import { configForDifficulty } from '../core/SimulationConfig';
import { challengeScore } from '../selectors/reportSelectors';
import { serialize, deserialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';
import { challengeShareText } from '../../ui/records';

describe('Challenge mode', () => {
  it('challengeMode flag flows through config and survives save/load', () => {
    const state = createInitialState(1, { ...configForDifficulty('brutal'), challengeMode: true });
    expect(state.config.challengeMode).toBe(true);
    expect(state.scenarioId).toBe('meadowbrook');
    const reloaded = deserialize(serialize(state));
    expect(reloaded.config.challengeMode).toBe(true);
    expect(reloaded.scenarioId).toBe('meadowbrook');
  });

  it('old saves without the new fields get defaults', () => {
    const state = createInitialState(1);
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.scenarioId;
    delete (raw.config as Record<string, unknown>).challengeMode;
    const reloaded = deserialize(JSON.stringify(raw));
    expect(reloaded.config.challengeMode).toBe(false);
    expect(reloaded.scenarioId).toBe('meadowbrook');
  });

  it('scores the run from valuation, satisfaction, share, and exports', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;

    // Forge a strong run: player cash IS valuation here (no facilities).
    player.cash = dollars(150000);
    for (const cid in state.citizens) state.citizens[cid]!.satisfaction = 80;
    player.marketShareByProduct['bread'] = 0.6;
    player.exportRevenue = dollars(10000);

    const s = challengeScore(state);
    expect(s.valuationPts).toBeGreaterThan(500); // valuation dominates
    // Sat 80 scores (80−55)/35 of 150 — points start above the unattended
    // ~60-65 equilibrium, not at zero satisfaction.
    expect(s.satisfactionPts).toBe(107);
    expect(s.sharePts).toBe(90);
    expect(s.exportPts).toBe(50);
    expect(s.total).toBe(s.valuationPts + s.satisfactionPts + s.sharePts + s.exportPts);
    expect(s.total).toBeLessThanOrEqual(1000);

    // Deterministic: same state, same score.
    expect(challengeScore(state).total).toBe(s.total);
  });

  it('scales the total by difficulty', () => {
    const forge = (difficulty: 'relaxed' | 'standard' | 'brutal') => {
      const state = createInitialState(1, configForDifficulty(difficulty));
      const player = state.firms[state.playerFirmId]!;
      player.cash = dollars(100000);
      for (const cid in state.citizens) state.citizens[cid]!.satisfaction = 70;
      return challengeScore(state);
    };
    const relaxed = forge('relaxed');
    const standard = forge('standard');
    const brutal = forge('brutal');
    expect(relaxed.difficultyMult).toBe(0.85);
    expect(standard.difficultyMult).toBe(1);
    expect(brutal.difficultyMult).toBe(1.15);
    // Same raw output ranks by difficulty (cash differs slightly by start
    // cash preset, so compare via the multiplier on each raw total).
    expect(relaxed.total).toBe(Math.round(relaxed.rawTotal * 0.85));
    expect(brutal.total).toBe(Math.round(brutal.rawTotal * 1.15));
  });
});

describe('challengeShareText', () => {
  it('formats a compact replayable dare', () => {
    const text = challengeShareText(
      { score: 812, valuation: 12345600, scenarioId: 'port_haven', difficulty: 'brutal', seed: 42, at: '2026-07-18' },
      'Port Haven',
    );
    expect(text).toContain('Port Haven · brutal · seed 42');
    expect(text).toContain('Score 812/1000');
    expect(text).toContain('$123,456');
    expect(text.split('\n').length).toBe(3);
  });
});
