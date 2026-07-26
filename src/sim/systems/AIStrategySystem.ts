/**
 * AIStrategySystem — the firm-archetype DISPATCHER (Arc D1, design HD5).
 *
 * Runs once per day. For each AI firm it reads `firm.strategy.archetype` and
 * routes the firm to that archetype's behavior module. Today every firm is an
 * 'operator' (the full shopkeeper loop — price/staff/source/expand/invest,
 * lives in ai/OperatorBehavior.ts, a verbatim move of the old monolith loop),
 * so a Village run dispatches exactly the operator path in exactly the old
 * order and stays bit-identical. The landlord / investor / service rows are
 * scaffolded inert here; D2–D4 swap each for a real behavior module.
 *
 * The AI reads the just-completed day's facility stats and the firm's `today`
 * accounting (both still intact at this point in the tick order).
 *
 * Re-exports keep the module's old public surface (adjustPrices / maybeWiden
 * Shelves / manageSourcing for ManagerSystem; the digest helpers for tests)
 * pointing at their new homes, so callers didn't have to move.
 */

import type { SimContext } from '../core/GameState';
import { townOf } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import type { FirmArchetype } from '../entities/Firm';
import {
  newDigestBuffer,
  flushRoutineDigest,
  type DigestBuffer,
} from './ai/digest';
import {
  runOperatorBehavior,
  adjustPrices,
  maybeWidenShelves,
  trimManagedAds,
} from './ai/OperatorBehavior';
import { runLandlordBehavior } from './ai/LandlordBehavior';
import { runInvestorBehavior } from './ai/investor';
import { runServiceBehavior } from './ai/ServiceBehavior';

// Public surface preserved for existing importers (ManagerSystem, log tests).
export { adjustPrices, maybeWidenShelves, manageSourcing } from './ai/OperatorBehavior';
export {
  newDigestBuffer,
  routeRoutine,
  flushRoutineDigest,
  type RoutineDigestChannel,
  type DigestBuffer,
} from './ai/digest';

/**
 * One archetype's daily behavior: given a firm id (and the day's digest buffer,
 * undefined in a Village so lines emit individually), advance that firm one day.
 */
export type FirmBehavior = (
  ctx: SimContext,
  firmId: string,
  digest: DigestBuffer | undefined,
) => void;

/**
 * The archetype → behavior dispatch table (Arc D1). All four rows are live:
 * operator (the shopkeeper loop), landlord (D2 — real-estate development,
 * ai/LandlordBehavior), investor (D3 — a holdco working its equity book,
 * ai/investor), and service (D4 — a B2B provider selling compute/advisory
 * seats and growing capacity under tight utilization, ai/ServiceBehavior).
 * Adding/swapping a row is purely additive: the operator path is never
 * re-touched, and specialist rows are only ever REACHED by firms their
 * city-gated, flag-gated founders spin up — every pinned baseline (which
 * founds none) stays inert.
 */
const BEHAVIOR_BY_ARCHETYPE: Record<FirmArchetype, FirmBehavior> = {
  operator: runOperatorBehavior,
  landlord: runLandlordBehavior, // D2
  investor: runInvestorBehavior, // D3
  service: runServiceBehavior, // D4
};

/** Route one firm to its archetype's behavior. Exported so a dispatcher test
 * can prove routing without a full-system run. Falls back to 'operator' if a
 * save somehow carries no archetype (defensive — the migration fills it). */
export function dispatchFirmBehavior(
  ctx: SimContext,
  firmId: string,
  digest: DigestBuffer | undefined,
): void {
  const archetype = townOf(ctx.state, ctx.townId).firms[firmId]!.strategy.archetype ?? 'operator';
  BEHAVIOR_BY_ARCHETYPE[archetype](ctx, firmId, digest);
}

export function runAIStrategySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);

  // Crowd towns collapse routine per-firm chatter into daily digests; Village
  // keeps every line (undefined buffer => individual emits, bit-identity).
  const digest = ctx.config.sizePreset === 'village' ? undefined : newDigestBuffer();

  for (const fid in town.firms) {
    const firm = town.firms[fid]!;
    if (firm.ownerType !== 'ai') continue;
    dispatchFirmBehavior(ctx, firm.id, digest);
  }

  // Player QoL: auto-priced products are "managed" — the same mean-reverting
  // price controller sets their prices, the same shelf-widening keeps their
  // supply contracts sized to demand, and ad spend drifts down toward the
  // floor while the store loses money (downward only — raising the player's
  // spend is the player's call). Deterministic; no rng-stream impact.
  const player = town.firms[state.playerFirmId];
  if (player && Object.values(player.autoPriceByProduct).some(Boolean)) {
    adjustPrices(ctx, player.id, true);
    maybeWidenShelves(ctx, player.id, true);
    trimManagedAds(ctx, player.id);
  }

  // One gazette line per channel instead of a line per firm (crowd towns only).
  if (digest) flushRoutineDigest(state, digest);
}
