/**
 * FireSaleSystem — rolls and expires rival fire-sale offers.
 *
 * When an AI firm has a facility bleeding money on the 7-day EMA view, it
 * would rather sell it to the player at 75% of build cost than keep feeding
 * it (the same losses that would eventually make the bankruptcy system
 * close it). Offers roll at most one at a time, only once the player could
 * plausibly operate the building (day 20+), and expire after four days.
 *
 * Timing randomness comes from a hash of (seed, day) — the same
 * stream-safe scheme as rush orders — so the shared sim rng and every
 * calibrated probe stay untouched. WHICH facility goes on the block is
 * fully deterministic: the worst EMA loser among eligible AI facilities.
 */

import type { SimContext, GameState, FacilityOffer } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { FIRE_SALE_RATE } from '../core/FireSale';
import { formatMoney } from '../../utils/formatMoney';

export const FIRE_SALE_EARLIEST_DAY = 20;
export const FIRE_SALE_DAILY_CHANCE = 0.08;
export const FIRE_SALE_WINDOW_DAYS = 4;
/** A facility must be losing at least this much (7-day EMA net) to be offered. */
export const FIRE_SALE_LOSS_FLOOR = -10_00;
/** A lapsed offer keeps that facility off the block for this many days. */
export const FIRE_SALE_COOLDOWN_DAYS = 30;

/** Independent deterministic stream per (seed, day) — see header. */
function saleRoll(seed: number, day: number): number {
  let t = (seed ^ Math.imul(day + 1, 0x27d4eb2f) ^ 0x165667b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The worst sustained loser among sellable facilities of STRUGGLING AI
 * firms. Internal cost attribution makes healthy chains' input facilities
 * (mines, farms) look like per-facility losers, but a profitable firm
 * doesn't fire-sale its own supply line — the seller must be losing money
 * at the firm level (7-day view) or already distressed. A facility whose
 * last offer lapsed recently is off the block (cooldown), so the ticker
 * doesn't nag about the same building every week.
 */
function worstAIFacility(state: GameState, day: number) {
  let worst: { id: string; net: number } | null = null;
  const cooled = state.lastLapsedFireSale;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.type === 'home' || f.type === 'importer' || f.status === 'closed') continue;
    const firm = state.firms[f.ownerFirmId];
    if (firm?.ownerType !== 'ai') continue;
    if (cooled && cooled.facilityId === fid && day < cooled.day + FIRE_SALE_COOLDOWN_DAYS) continue;
    const recent = firm.accounting.dailyHistory.slice(-7);
    const firmNet = recent.length
      ? recent.reduce((s, d) => s + d.netProfit, 0) / recent.length
      : 0;
    if (firm.bankruptcyStatus === 'healthy' && firmNet >= 0) continue;
    const net = f.pnlEma.net;
    if (net > FIRE_SALE_LOSS_FLOOR) continue;
    if (!worst || net < worst.net) worst = { id: fid, net };
  }
  return worst;
}

export function runFireSaleSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const day = ctx.time.day;

  const active = state.facilityOffer;
  if (active) {
    const fac = state.facilities[active.facilityId];
    const stillValid = fac && fac.ownerFirmId === active.sellerFirmId;
    if (!stillValid || day > active.deadlineDay) {
      state.facilityOffer = null;
      if (stillValid) {
        state.lastLapsedFireSale = { facilityId: active.facilityId, day };
        emitEvent(state, 'info', 'finance',
          `🏷️ The fire sale on ${fac.name} has ended — ${state.firms[active.sellerFirmId]?.name ?? 'the seller'} took it off the block.`);
      }
    }
    return; // one at a time
  }

  if (day < FIRE_SALE_EARLIEST_DAY) return;
  if (saleRoll(state.seed, day) >= FIRE_SALE_DAILY_CHANCE) return;
  const worst = worstAIFacility(state, day);
  if (!worst) return;
  const fac = state.facilities[worst.id]!;
  const seller = state.firms[fac.ownerFirmId]!;

  const offer: FacilityOffer = {
    facilityId: fac.id,
    sellerFirmId: seller.id,
    askCents: Math.round(fac.buildCost * FIRE_SALE_RATE),
    startDay: day,
    deadlineDay: day + FIRE_SALE_WINDOW_DAYS,
  };
  state.facilityOffer = offer;
  emitEvent(state, 'success', 'finance',
    `🏷️ Fire sale: ${seller.name} offers ${fac.name} for ${formatMoney(offer.askCents)} (75% of build cost, losing ${formatMoney(-worst.net)}/day) — deal stands until day ${offer.deadlineDay + 1}. Accept from the ticker.`);
}
