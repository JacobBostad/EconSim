import { describe, it, expect } from 'vitest';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { emitEvent } from '../core/GameState';
import {
  newDigestBuffer,
  routeRoutine,
  flushRoutineDigest,
} from '../systems/AIStrategySystem';
import type { GameState } from '../core/GameState';

/** A fresh Village state, wound to a clean point with no queued events. */
function fresh(): GameState {
  const state = createInitialState(1, { ...DEFAULT_CONFIG });
  state.events.length = 0;
  return state;
}

describe('Routine event digest (A5 log channels)', () => {
  it('collapses a channel to one line counting distinct firms (deduped, sorted)', () => {
    const state = fresh();
    const digest = newDigestBuffer();
    // Three firms reprice; firm_a reprices twice (two products) — counts once.
    routeRoutine(state, digest, 'price', 'firm_c', 'C raised bread', 'firm_c');
    routeRoutine(state, digest, 'price', 'firm_a', 'A raised milk', 'firm_a');
    routeRoutine(state, digest, 'price', 'firm_a', 'A raised eggs', 'firm_a');
    routeRoutine(state, digest, 'price', 'firm_b', 'B raised tools', 'firm_b');
    // Buffered — nothing hits the log until the flush.
    expect(state.events.length).toBe(0);

    flushRoutineDigest(state, digest);
    expect(state.events.length).toBe(1);
    expect(state.events[0]!.message).toBe(
      '3 firms marked up prices after repeated sellouts.',
    );
    expect(state.events[0]!.category).toBe('ai');
    expect(state.events[0]!.severity).toBe('info');
  });

  it('emits one summary per active channel and skips empty channels', () => {
    const state = fresh();
    const digest = newDigestBuffer();
    routeRoutine(state, digest, 'price', 'firm_a', 'x', null);
    routeRoutine(state, digest, 'price', 'firm_b', 'y', null);
    routeRoutine(state, digest, 'sourcing', 'firm_a', 'z', null);
    // wages channel left empty.
    flushRoutineDigest(state, digest);
    const msgs = state.events.map((e) => e.message);
    expect(msgs).toContain('2 firms marked up prices after repeated sellouts.');
    expect(msgs.some((m) => m.includes('reshuffled'))).toBe(true);
    expect(msgs.some((m) => m.includes('wages'))).toBe(false);
    expect(state.events.length).toBe(2);
  });

  it('uses singular gazette phrasing for a lone firm', () => {
    const state = fresh();
    const digest = newDigestBuffer();
    routeRoutine(state, digest, 'wages', 'firm_a', 'ignored', null);
    flushRoutineDigest(state, digest);
    expect(state.events.length).toBe(1);
    expect(state.events[0]!.message).toBe(
      'An employer raised wages to chase scarce workers.',
    );
  });

  it('Village passthrough: with no buffer the individual line is emitted verbatim', () => {
    const state = fresh();
    routeRoutine(
      state,
      undefined,
      'wages',
      'firm_a',
      'Acme Bakery raised wages to $30.00/day to attract scarce workers.',
      'firm_a',
    );
    expect(state.events.length).toBe(1);
    expect(state.events[0]!.message).toBe(
      'Acme Bakery raised wages to $30.00/day to attract scarce workers.',
    );
  });

  it('notable events are never swallowed by the digest', () => {
    const state = fresh();
    const digest = newDigestBuffer();
    // Routine chatter buffers silently...
    routeRoutine(state, digest, 'price', 'firm_a', 'routine', 'firm_a');
    // ...but a notable event on the same day emits immediately, on the same
    // path the digest never touches.
    emitEvent(state, 'success', 'ai', 'Northgate Foods opened a new outlet.', 'fac_9');
    emitEvent(state, 'danger', 'finance', 'Riverside Mills has gone bankrupt.', 'firm_x');
    expect(state.events.map((e) => e.message)).toEqual([
      'Northgate Foods opened a new outlet.',
      'Riverside Mills has gone bankrupt.',
    ]);
    flushRoutineDigest(state, digest);
    // The digest appends its summary after the notable lines, keeping them.
    expect(state.events.length).toBe(3);
    expect(state.events[2]!.message).toContain('marked up prices');
  });
});
