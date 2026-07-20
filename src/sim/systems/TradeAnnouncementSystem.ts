/**
 * TradeAnnouncementSystem — pre-announced trade shocks: the Gazette breaks
 * the news 3 days before a city's price center actually moves ("Ironvale
 * announces a tool tender — buyers expected to pay up from day N"), so
 * reading the paper becomes a trading skill: position on the desk or lock
 * forwards before the move, and let the Pillar-3 price impact keep the
 * edge honest (loading up moves the quote against you — the informed edge
 * is real but self-limiting).
 *
 * Randomness comes from a hash of (seed, day), the rush-order pattern —
 * never ctx.rng — so inserting this system leaves the shared stream and
 * every calibrated outcome untouched until a shock actually fires.
 * The multiplier applies to the city's price CENTER: the daily walk's
 * center-pull (0.12/day) then drags the quote toward the shocked level
 * over the effect window and back to normal afterwards — moves ramp in
 * and out like real markets, no teleporting prices.
 */

import type { SimContext, GameState } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import type { ProductId } from '../core/Id';
import { PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
import { getTradeCity, TRADE_CITY_IDS } from '../data/tradeCities';

/** No shocks before the town has an economy worth trading against. */
export const ANNOUNCE_EARLIEST_DAY = 20;
/** Daily roll chance while no announcement is pending or active. */
export const ANNOUNCE_DAILY_CHANCE = 0.07;
/** Days of warning between the news and the move. */
export const ANNOUNCE_LEAD_DAYS = 3;

/** Independent deterministic stream per (seed, day, salt) — rush-order style. */
function annRoll(seed: number, day: number, salt: number): number {
  let t = (seed ^ Math.imul(day + 31, 0x9e3779b9) ^ Math.imul(salt + 47, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The center multiplier an active announcement applies to (city, product). */
export function tradeAnnouncementMult(
  state: GameState,
  cityId: string,
  productId: ProductId,
  day: number,
): number {
  const a = state.tradeAnnouncement;
  if (!a || a.cityId !== cityId || a.productId !== productId) return 1;
  if (day < a.effectDay || day >= a.effectDay + a.durationDays) return 1;
  return a.mult;
}

export function runTradeAnnouncementSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const day = ctx.time.day;

  const a = state.tradeAnnouncement;
  if (a) {
    if (day === a.effectDay) {
      const city = getTradeCity(a.cityId);
      emitEvent(state, a.mult > 1 ? 'success' : 'warning', 'economy',
        `${city.emoji} The ${getProduct(a.productId).name.toLowerCase()} ${a.mult > 1 ? 'tender' : 'glut'} in ${city.name} begins — prices ${a.mult > 1 ? 'surging' : 'sliding'} for ${a.durationDays} days.`);
    }
    if (day >= a.effectDay + a.durationDays) {
      state.tradeAnnouncement = null; // the walk reverts to the normal center
    }
    return; // one story at a time
  }

  if (day < ANNOUNCE_EARLIEST_DAY) return;
  if (annRoll(state.seed, day, 0) >= ANNOUNCE_DAILY_CHANCE) return;

  const cityId = TRADE_CITY_IDS[Math.floor(annRoll(state.seed, day, 1) * TRADE_CITY_IDS.length)]!;
  // Preset-gated (C1): announcements only name products that exist here, so the
  // Village hash-pick indexes the classic catalog (same length) unchanged.
  const productIds = PRODUCT_IDS_BY_PRESET[state.config.sizePreset];
  const productId = productIds[Math.floor(annRoll(state.seed, day, 2) * productIds.length)]!;
  const surge = annRoll(state.seed, day, 3) < 0.6;
  const mult = surge
    ? 1.4 + annRoll(state.seed, day, 4) * 0.2 // 1.4–1.6
    : 0.6 + annRoll(state.seed, day, 4) * 0.15; // 0.60–0.75
  const durationDays = 4 + Math.floor(annRoll(state.seed, day, 5) * 3); // 4–6

  state.tradeAnnouncement = {
    cityId,
    productId,
    mult: Math.round(mult * 100) / 100,
    announcedDay: day,
    effectDay: day + ANNOUNCE_LEAD_DAYS,
    durationDays,
  };
  const city = getTradeCity(cityId);
  const name = getProduct(productId).name;
  emitEvent(state, 'info', 'economy',
    surge
      ? `📯 ${city.emoji} ${city.name} announces a ${name.toLowerCase()} tender — buyers expected to pay up from day ${day + ANNOUNCE_LEAD_DAYS} (~${state.tradeAnnouncement.mult}× for ${durationDays} days). Traders, position yourselves.`
      : `📯 ${city.emoji} ${city.name} reports a coming ${name.toLowerCase()} glut — prices expected to slide from day ${day + ANNOUNCE_LEAD_DAYS} (~${state.tradeAnnouncement.mult}× for ${durationDays} days).`);
}
