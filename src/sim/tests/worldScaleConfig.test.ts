import { describe, it, expect } from 'vitest';
import {
  worldScaleConfig,
  configForDifficulty,
  METROPOLIS_PLAYER_START_CASH_BONUS,
  SIZE_PRESETS,
} from '../core/SimulationConfig';
import { createInitialState } from '../data/startingScenario';

/**
 * The New-Game world-scale wiring (the pure helper the store and modal share).
 * Village stays the classic all-agent town; City and Metropolis switch on the
 * crowd economy and the archetype/services/trade channels their founder
 * baselines are gated for. The one deliberate asymmetry is investorsEnabled:
 * its holdco founder row is double-gated on sizePreset === 'city', so Metropolis
 * leaves it off (a live holdco would move the D3-measured crowd-tier bands).
 */
describe('worldScaleConfig — New Game world-scale wiring', () => {
  it('village keeps the classic town: default preset, every crowd flag off', () => {
    const cfg = worldScaleConfig('standard', false, 'cozy', 'village');
    expect(cfg.sizePreset).toBe('village');
    expect(cfg.servicesEnabled).toBe(false);
    expect(cfg.realEstateEnabled).toBe(false);
    expect(cfg.investorsEnabled).toBe(false);
    expect(cfg.tradeDemandPoolsEnabled).toBe(false);
    // bit-identity: a Village New Game is exactly the difficulty config.
    expect(cfg).toEqual({ ...configForDifficulty('standard'), challengeMode: false });
  });

  it('city turns the whole stack on together (all four channels)', () => {
    const cfg = worldScaleConfig('standard', false, 'cozy', 'city');
    expect(cfg.sizePreset).toBe('city');
    expect(cfg.servicesEnabled).toBe(true);
    expect(cfg.realEstateEnabled).toBe(true);
    expect(cfg.investorsEnabled).toBe(true);
    expect(cfg.tradeDemandPoolsEnabled).toBe(true);
    // City keeps the difficulty starting cash (no uplift).
    expect(cfg.playerStartCash).toBe(configForDifficulty('standard').playerStartCash);
  });

  it('metropolis wires the biggest preset + services/realEstate/trade pools, investors OFF', () => {
    const cfg = worldScaleConfig('standard', false, 'cozy', 'metropolis');
    expect(cfg.sizePreset).toBe('metropolis');
    expect(cfg.servicesEnabled).toBe(true);
    expect(cfg.realEstateEnabled).toBe(true);
    expect(cfg.tradeDemandPoolsEnabled).toBe(true);
    // investorsEnabled is a no-op at metropolis (founder row is city-only), so
    // the wiring leaves it off rather than pretending it does something.
    expect(cfg.investorsEnabled).toBe(false);
  });

  it('metropolis adds the player-only cash uplift on top of difficulty cash', () => {
    for (const diff of ['relaxed', 'standard', 'brutal'] as const) {
      const base = configForDifficulty(diff).playerStartCash;
      const cfg = worldScaleConfig(diff, false, 'cozy', 'metropolis');
      expect(cfg.playerStartCash).toBe(base + METROPOLIS_PLAYER_START_CASH_BONUS);
    }
    // Standard opens at $28k — parity with the AI field's founderCash.
    expect(worldScaleConfig('standard', false, 'cozy', 'metropolis').playerStartCash).toBe(
      SIZE_PRESETS.metropolis.founderCash,
    );
  });

  it('the uplift reaches the actual player firm, and only at metropolis', () => {
    const metro = createInitialState(11, worldScaleConfig('standard', false, 'cozy', 'metropolis'));
    expect(metro.firms[metro.playerFirmId]!.cash).toBe(SIZE_PRESETS.metropolis.founderCash);
    const city = createInitialState(11, worldScaleConfig('standard', false, 'cozy', 'city'));
    expect(city.firms[city.playerFirmId]!.cash).toBe(15000 * 100);
  });

  it('challenge and bustling flags still compose with a world scale', () => {
    const cfg = worldScaleConfig('standard', true, 'bustling', 'metropolis');
    expect(cfg.challengeMode).toBe(true);
    expect(cfg.maxHomes).toBe(80);
    // createInitialState maxes the map up to the metropolis preset height, so the
    // bustling override never shrinks the big map.
    const s = createInitialState(1, cfg);
    expect(s.config.mapHeight).toBe(SIZE_PRESETS.metropolis.mapHeight);
  });
});
