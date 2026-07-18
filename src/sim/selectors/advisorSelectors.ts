/**
 * advisorSelectors — the morning briefing.
 *
 * Rolls the game's insight streams (P&L, production bottlenecks, labor
 * market, hungry markets, Port Rosa) into a handful of prioritized,
 * actionable one-liners for the player. Pure over GameState; every rule
 * reads signals other systems already maintain.
 */

import type { GameState } from '../core/GameState';
import { dailyInsight, rivalTopWage } from './companySelectors';
import { spendingPower } from './citizenSelectors';
import { getProduct } from '../data/products';
import { getQuantity } from '../entities/Inventory';
import { formatMoney } from '../../utils/formatMoney';

export interface Advice {
  icon: string;
  severity: 'danger' | 'warning' | 'info';
  text: string;
}

const MAX_ITEMS = 5;

export function morningBriefing(state: GameState): Advice[] {
  const player = state.firms[state.playerFirmId];
  if (!player) return [];
  const items: Advice[] = [];

  // 1. Money: yesterday's loss and its dominant cost.
  const insight = dailyInsight(state, player.id);
  if (insight && insight.net < 0 && insight.topCostAmount > 0) {
    items.push({
      icon: '📉',
      severity: 'danger',
      text: `Yesterday lost ${formatMoney(-insight.net)} — biggest cost was ${insight.topCostLabel} (${formatMoney(insight.topCostAmount)}).`,
    });
  }

  // 2. Production blocked all day (stamped during work hours only).
  for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac || fac.status === 'closed') continue;
    if (fac.activeRecipeId && fac.dailyStats.ticksActive === 0 && fac.dailyStats.bottleneck) {
      items.push({
        icon: '🏭',
        severity: 'warning',
        text: `${fac.name} produced nothing yesterday — ${fac.dailyStats.bottleneck}.`,
      });
      break; // one production alert is enough for a briefing
    }
  }

  // 3. Labor: a rival out-pays your crew past the poaching bar.
  const rivalWage = rivalTopWage(state, player.id);
  if (player.employees.length > 0 && rivalWage >= player.wagePolicy.baseWage * 1.15) {
    items.push({
      icon: '🤝',
      severity: 'warning',
      text: `A rival pays ${formatMoney(rivalWage)}/day (≥1.15× your wage) — your workers may defect. See the Wages card.`,
    });
  }

  // 4. Demand: hungry markets worth entering.
  const spend = spendingPower(state);
  if (spend.hungryMarkets.length > 0) {
    items.push({
      icon: '💡',
      severity: 'info',
      text: `Hungry market${spend.hungryMarkets.length > 1 ? 's' : ''}: ${spend.hungryMarkets.join(', ')} — demand outruns supply. First mover wins.`,
    });
  }

  // 5. Trade: Port Rosa pays a premium for something you actually hold.
  for (const facId of player.facilities) {
    const fac = state.facilities[facId];
    if (!fac) continue;
    let found = false;
    for (const pid in state.tradeCity.pricesByProduct) {
      const price = state.tradeCity.pricesByProduct[pid]!;
      const base = getProduct(pid).basePrice;
      if (price < base * 1.3) continue;
      const held = getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
      if (held >= 10) {
        items.push({
          icon: '🚢',
          severity: 'info',
          text: `Port Rosa pays ${(price / base).toFixed(2)}× base for ${getProduct(pid).name} and you hold ${held} — stage them in a warehouse and export.`,
        });
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const order = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return items.slice(0, MAX_ITEMS);
}
