/**
 * ai/digest.ts — routine per-firm event batching, shared by the AI dispatcher
 * and every behavior module.
 *
 * Routine-event channels for the daily digest (Arc A5 / HD7). One price/wage/
 * sourcing line per firm reads fine in a Village (6 AI firms); at City and
 * Metropolis scale (18/30 firms) those lines flush the 400-cap log within
 * hours, burying the openings, failures, and takeovers that carry the story.
 * The digest collapses each channel to one gazette line per day. Village keeps
 * every individual line for bit-identity — the routing is preset-gated: an
 * `undefined` buffer means "emit the line exactly as today".
 */

import type { GameState } from '../../core/GameState';
import { emitEvent } from '../../core/GameState';

export type RoutineDigestChannel = 'price' | 'wages' | 'sourcing';
export type DigestBuffer = Record<RoutineDigestChannel, Set<string>>;

export function newDigestBuffer(): DigestBuffer {
  return { price: new Set(), wages: new Set(), sourcing: new Set() };
}

/**
 * Route a routine per-firm event. With a buffer (crowd towns) it collapses into
 * the day's digest, deduped by `firmId` — a firm that reprices three products
 * still counts once. With no buffer (Village, or the player's own managed
 * firm) it emits the individual line the log has always carried. Every routine
 * event routed here is severity `info`, category `ai`.
 */
export function routeRoutine(
  state: GameState,
  digest: DigestBuffer | undefined,
  channel: RoutineDigestChannel,
  firmId: string,
  message: string,
  entityId: string | null,
): void {
  if (digest) {
    digest[channel].add(firmId);
    return;
  }
  emitEvent(state, 'info', 'ai', message, entityId);
}

/**
 * Flush the day's routine digest into one gazette line per active channel.
 * Counts are over distinct firms; the ids are sorted first so the aggregation
 * is deterministic and testable (the count itself is order-independent, but the
 * sort pins it against any future named-firm variants). Only reached in crowd
 * towns — a Village never builds a buffer.
 */
export function flushRoutineDigest(state: GameState, digest: DigestBuffer): void {
  const price = [...digest.price].sort();
  if (price.length > 0) {
    const n = price.length;
    emitEvent(state, 'info', 'ai',
      n === 1
        ? 'A shopkeeper marked up prices after repeated sellouts.'
        : `${n} firms marked up prices after repeated sellouts.`);
  }
  const wages = [...digest.wages].sort();
  if (wages.length > 0) {
    const n = wages.length;
    emitEvent(state, 'info', 'ai',
      n === 1
        ? 'An employer raised wages to chase scarce workers.'
        : `${n} firms raised wages to chase scarce workers.`);
  }
  const sourcing = [...digest.sourcing].sort();
  if (sourcing.length > 0) {
    const n = sourcing.length;
    emitEvent(state, 'info', 'ai',
      n === 1
        ? 'A firm reshuffled its suppliers chasing a sharper wholesale price.'
        : `${n} firms reshuffled suppliers chasing sharper wholesale prices.`);
  }
}
