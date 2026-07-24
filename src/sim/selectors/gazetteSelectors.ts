/**
 * gazetteSelectors — turns the raw event log + market history into a daily
 * newspaper: one lead story per day plus briefs and a market ticker line.
 * Pure functions over GameState; the Gazette dashboard renders the result.
 */

import type { GameState } from '../core/GameState';
import type { ProductId } from '../core/Id';
import type { GameEvent } from '../core/Events';
import { CONSUMER_PRODUCT_IDS_BY_PRESET, PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
import { ticksPerDay } from '../core/Tick';
import { cityPrice, exportFreightFee } from '../core/Trade';
import { TRADE_CITY_IDS, getTradeCity } from '../data/tradeCities';
import { poolCoverDays } from '../data/tradePool';
import { isLivePartnerCity, partnerCoverDaysOrUndefined } from '../core/PartnerMarket';
import { townOf } from '../core/Town';

/**
 * Days of cover the desk shows for a trade city+product, routing the two supply
 * models (Arc E slice 5): a LIVE partner reads real shelf/demand cover, a stub
 * city its pool. Undefined ⇒ no chip (bare walk, or a live partner with no larder
 * / no crowd demand for the product).
 */
function deskCoverDays(state: GameState, cityId: string, pid: ProductId): number | undefined {
  if (isLivePartnerCity(state, cityId)) return partnerCoverDaysOrUndefined(state, cityId, pid);
  const stock = state.tradeCities[cityId]?.pool?.inventory[pid];
  return stock === undefined ? undefined : poolCoverDays(cityId, pid, stock);
}

export interface GazetteStory {
  severity: GameEvent['severity'];
  category: GameEvent['category'];
  text: string;
}

export interface GazetteEdition {
  day: number;
  lead: GazetteStory | null;
  briefs: GazetteStory[];
  /** One-line market ticker: price and shortage info per product. */
  ticker: string[];
}

/** How newsworthy a category is when picking the lead story. */
const LEAD_PRIORITY: Record<GameEvent['category'], number> = {
  economy: 6,
  finance: 5,
  ai: 4,
  player: 3,
  retail: 2,
  production: 2,
  logistics: 1,
  payroll: 2,
  system: 0,
};

const SEVERITY_BONUS: Record<GameEvent['severity'], number> = {
  danger: 3,
  warning: 2,
  success: 2,
  info: 0,
};

export function currentGazetteDay(state: GameState): number {
  return Math.floor(state.tick / ticksPerDay(state.config));
}

/** Newspaper editions for the most recent `days` days (today first). */
export function gazetteEditions(state: GameState, days: number): GazetteEdition[] {
  const today = currentGazetteDay(state);
  const byDay = new Map<number, GameEvent[]>();
  for (const ev of state.events) {
    if (ev.day < today - days + 1) continue;
    const list = byDay.get(ev.day);
    if (list) list.push(ev);
    else byDay.set(ev.day, [ev]);
  }

  const editions: GazetteEdition[] = [];
  for (let day = today; day > today - days && day >= 0; day--) {
    const events = byDay.get(day) ?? [];
    if (events.length === 0 && day !== today) continue;

    let lead: GameEvent | null = null;
    let leadScore = -1;
    for (const ev of events) {
      const score = LEAD_PRIORITY[ev.category] + SEVERITY_BONUS[ev.severity];
      if (score > leadScore) {
        leadScore = score;
        lead = ev;
      }
    }

    const briefs = events
      .filter((ev) => ev !== lead)
      .slice(-8)
      .reverse()
      .map((ev) => ({ severity: ev.severity, category: ev.category, text: ev.message }));

    const ticker: string[] = [];
    for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
      const hist = townOf(state).marketStats[pid]?.history ?? [];
      const snap = hist.find((h) => h.day === day) ?? (day === today ? null : undefined);
      if (snap) {
        const price = snap.averagePrice > 0 ? `${(snap.averagePrice / 100).toFixed(2)}` : '—';
        const short = snap.unmetDemand > snap.unitsSold ? ' ⚠ shortage' : '';
        ticker.push(`${getProduct(pid).name} $${price} (${snap.unitsSold} sold${short})`);
      }
    }

    editions.push({
      day,
      lead: lead
        ? { severity: lead.severity, category: lead.category, text: lead.message }
        : null,
      briefs,
      ticker,
    });
  }
  return editions;
}

export interface TradeDeskRow {
  productId: string;
  productName: string;
  /** Net per-unit price (after each city's freight) at the better port. */
  bestCityId: string;
  bestCityName: string;
  bestCityEmoji: string;
  bestNet: number;
  otherNet: number;
  /** Per-unit advantage of shipping to the better port, cents. */
  spread: number;
  /** Days of cover the better port's demand pool holds (Arc E, opt-in) —
   * thin cover means it's paying a premium, an overhang means a glut.
   * Undefined when the pool is off (the classic pure-walk desk). */
  bestCover?: number;
  /** The OTHER port's emoji and cover, so the desk shows the supply read on
   * both cities rather than only the one it routes to (both run pools flag-on;
   * both undefined flag-off). */
  otherCityEmoji: string;
  otherCover?: number;
}

/**
 * The trade desk: today's biggest per-unit spreads between the trade cities,
 * net of each city's freight — the products where picking the right port
 * actually matters. Sorted by spread, largest first.
 */
export function tradeDesk(state: GameState, limit = 4): TradeDeskRow[] {
  const rows: TradeDeskRow[] = [];
  for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
    const nets = TRADE_CITY_IDS.map((cid) => ({
      cid,
      net: Math.round(cityPrice(state, cid, pid) * (1 - exportFreightFee(state, cid))),
    })).sort((a, b) => b.net - a.net);
    const best = nets[0]!;
    const other = nets[nets.length - 1]!;
    const city = getTradeCity(best.cid);
    // Arc E: if a port runs cover on this product, show it (days of stock) so the
    // desk explains WHY the quote is where it is. A LIVE partner (slice 5) reads
    // real shelf/demand cover; a stub city reads its pool. `deskCoverDays` routes.
    const bestCover = deskCoverDays(state, best.cid, pid);
    const otherCover = deskCoverDays(state, other.cid, pid);
    rows.push({
      productId: pid,
      productName: getProduct(pid).name,
      bestCityId: best.cid,
      bestCityName: city.name,
      bestCityEmoji: city.emoji,
      bestNet: best.net,
      otherNet: other.net,
      spread: best.net - other.net,
      otherCityEmoji: getTradeCity(other.cid).emoji,
      ...(bestCover === undefined ? {} : { bestCover }),
      ...(otherCover === undefined ? {} : { otherCover }),
    });
  }
  rows.sort((a, b) => b.spread - a.spread);
  return rows.slice(0, limit);
}
