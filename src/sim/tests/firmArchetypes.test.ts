import { describe, it, expect } from 'vitest';
import fixtureV1Json from './fixtures/golden-save-v1.json';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { makeContext, SAVE_VERSION } from '../core/GameState';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { emptyStrategy } from '../entities/Firm';
import {
  runAIStrategySystem,
  dispatchFirmBehavior,
} from '../systems/AIStrategySystem';
import { deserialize } from '../persistence/saveLoad';
import { MIGRATIONS } from '../persistence/migrations';

/**
 * Arc D1 — the firm-archetype framework. Two things to pin:
 *  1. The strategy dispatcher routes each AI firm by `strategy.archetype`, so a
 *     non-operator firm does NOT run the operator loop (proven with a stub
 *     landlord archetype — no landlord behavior ships until D2).
 *  2. SAVE_VERSION 2's migration stamps `archetype = 'operator'` on every firm
 *     of an old save, so the golden fixtures load unchanged.
 */

/** A sentinel loss-streak the operator loop always overwrites (it ends every
 * run resetting/incrementing lossStreak) but a non-operator behavior never
 * touches — an observable proof of which code path ran. */
const SENTINEL = 987654;

describe('Firm archetype dispatcher', () => {
  it('defaults every firm to the operator archetype', () => {
    const state = createInitialState(1, { ...DEFAULT_CONFIG });
    for (const f of Object.values(state.firms)) {
      expect(f.strategy.archetype).toBe('operator');
    }
    // The builder default and its explicit form both land on operator.
    expect(emptyStrategy('bread').archetype).toBe('operator');
    expect(emptyStrategy('none', 'operator').archetype).toBe('operator');
  });

  it('routes a stub non-operator archetype away from the operator loop', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
    expect(ai.length).toBeGreaterThanOrEqual(2);

    // One firm is a (not-yet-shipped) landlord; a control stays operator. Both
    // carry the sentinel and enough cash to be healthy but below the rescue
    // floor, so the operator control's loss-streak update is the only mover.
    const landlord = ai[0]!;
    const operator = ai[1]!;
    landlord.strategy.archetype = 'landlord';
    operator.strategy.archetype = 'operator';
    landlord.strategy.lossStreak = SENTINEL;
    operator.strategy.lossStreak = SENTINEL;
    landlord.cash = 5000_00;
    operator.cash = 5000_00;

    state.tick = ticksPerDay(state.config); // a day boundary
    runAIStrategySystem(makeContext(state));

    // The landlord row is inert (D2 ships it) — the operator loop never touched
    // it. The operator control ran its full loop and moved off the sentinel.
    expect(landlord.strategy.lossStreak).toBe(SENTINEL);
    expect(operator.strategy.lossStreak).not.toBe(SENTINEL);
  });

  it('dispatchFirmBehavior selects by archetype directly', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const firm = Object.values(state.firms).find((f) => f.ownerType === 'ai')!;
    firm.cash = 5000_00;

    // As an operator: the behavior runs and overwrites the sentinel.
    firm.strategy.archetype = 'operator';
    firm.strategy.lossStreak = SENTINEL;
    dispatchFirmBehavior(makeContext(state), firm.id, undefined);
    expect(firm.strategy.lossStreak).not.toBe(SENTINEL);

    // As an investor (stub): the behavior is inert, the sentinel survives.
    firm.strategy.archetype = 'investor';
    firm.strategy.lossStreak = SENTINEL;
    dispatchFirmBehavior(makeContext(state), firm.id, undefined);
    expect(firm.strategy.lossStreak).toBe(SENTINEL);
  });
});

describe('SAVE_VERSION 2 archetype migration', () => {
  it('is at version 2', () => {
    expect(SAVE_VERSION).toBe(2);
  });

  it('the v1->v2 step stamps operator on firms lacking an archetype', () => {
    const raw: Record<string, unknown> = {
      saveVersion: 1,
      firms: {
        f1: { strategy: { kind: 'bread' } },
        f2: { strategy: { kind: 'none' } },
        f3: { strategy: { kind: 'tools', archetype: 'landlord' } }, // preserved
      },
    };
    const out = MIGRATIONS[1]!(raw) as {
      saveVersion: number;
      firms: Record<string, { strategy: { kind: string; archetype?: string } }>;
    };
    expect(out.saveVersion).toBe(2);
    expect(out.firms.f1!.strategy.archetype).toBe('operator');
    expect(out.firms.f2!.strategy.archetype).toBe('operator');
    expect(out.firms.f3!.strategy.archetype).toBe('landlord'); // not clobbered
  });

  it('a real v1 golden save gains archetype through the migration chain', () => {
    const rawJson = JSON.stringify(fixtureV1Json);
    // The fixture predates the field entirely — the migration, not the fixture,
    // supplies it.
    expect(rawJson.includes('"archetype"')).toBe(false);

    const state = deserialize(rawJson);
    expect(state.saveVersion).toBe(2);
    const firmIds = Object.keys(state.firms);
    expect(firmIds.length).toBeGreaterThan(0);
    for (const id of firmIds) {
      expect(state.firms[id]!.strategy.archetype).toBe('operator');
    }
  });
});
