/**
 * TradeCitySystem — "Port Rosa", the distant trade city.
 *
 * Port Rosa is an off-map market with its own price for every product,
 * updated once per day as a bounded, seeded random walk around base price
 * (0.6×–1.8×). Goods staged in a warehouse can be EXPORTed there at the
 * current price minus a freight fee — classic arbitrage gameplay: stockpile
 * when local goods are cheap, ship when Port Rosa pays.
 *
 * Threshold crossings (boom above 1.45×, glut below 0.7×) are announced in
 * the event log so the Gazette carries trade news.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { ALL_PRODUCT_IDS, getProduct } from '../data/products';
import {
  TRADE_PRICE_MIN_MULT,
  TRADE_PRICE_MAX_MULT,
  TRADE_WALK_STEP,
  TRADE_BOOM_MULT,
  TRADE_GLUT_MULT,
} from '../data/constants';
import { clamp } from '../../utils/clamp';

export function runTradeCitySystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;

  for (const pid of ALL_PRODUCT_IDS) {
    const base = getProduct(pid).basePrice;
    const prev = state.tradeCity.pricesByProduct[pid] ?? base;
    const next = Math.round(
      clamp(
        prev * (1 + ctx.rng.jitter(TRADE_WALK_STEP)),
        base * TRADE_PRICE_MIN_MULT,
        base * TRADE_PRICE_MAX_MULT,
      ),
    );
    state.tradeCity.pricesByProduct[pid] = next;

    const prevMult = prev / base;
    const nextMult = next / base;
    if (prevMult < TRADE_BOOM_MULT && nextMult >= TRADE_BOOM_MULT) {
      emitEvent(state, 'success', 'economy',
        `🚢 Port Rosa is paying a premium for ${getProduct(pid).name} (${nextMult.toFixed(2)}× base) — exports are lucrative.`);
    } else if (prevMult > TRADE_GLUT_MULT && nextMult <= TRADE_GLUT_MULT) {
      emitEvent(state, 'info', 'economy',
        `🚢 ${getProduct(pid).name} glut in Port Rosa — export prices have collapsed (${nextMult.toFixed(2)}× base).`);
    }
  }
}
