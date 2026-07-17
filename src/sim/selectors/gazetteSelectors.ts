/**
 * gazetteSelectors — turns the raw event log + market history into a daily
 * newspaper: one lead story per day plus briefs and a market ticker line.
 * Pure functions over GameState; the Gazette dashboard renders the result.
 */

import type { GameState } from '../core/GameState';
import type { GameEvent } from '../core/Events';
import { CONSUMER_PRODUCT_IDS, getProduct } from '../data/products';
import { ticksPerDay } from '../core/Tick';

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
    for (const pid of CONSUMER_PRODUCT_IDS) {
      const hist = state.marketStats[pid]?.history ?? [];
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
