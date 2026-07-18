import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { createInitialState } from '../data/startingScenario';
import { configForDifficulty } from '../core/SimulationConfig';
import { challengeScore } from '../selectors/reportSelectors';
import { serialize, deserialize } from '../persistence/saveLoad';
import { dollars } from '../data/constants';

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
    expect(s.satisfactionPts).toBe(120);
    expect(s.sharePts).toBe(90);
    expect(s.exportPts).toBe(50);
    expect(s.total).toBe(s.valuationPts + s.satisfactionPts + s.sharePts + s.exportPts);
    expect(s.total).toBeLessThanOrEqual(1000);

    // Deterministic: same state, same score.
    expect(challengeScore(state).total).toBe(s.total);
  });
});
