import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { marketRows } from '../sim/selectors/marketSelectors';
import { formatMoney } from '../utils/formatMoney';
import { FormulaTooltip } from './FormulaTooltip';
import { TrendCard } from './Sparkline';
import { CONSUMER_PRODUCT_IDS, getProduct } from '../sim/data/products';

export function MarketDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const rows = marketRows(state, false);
  const playerId = state.playerFirmId;

  return (
    <div>
      <p className="muted small">
        Daily figures reset at midnight. Demand attempts inflate when goods are scarce (citizens
        retry). “Avg price” is sales-weighted across all stores.
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th><th>Base</th><th>Avg price</th>
            <th><FormulaTooltip title="Demand attempts" explanation="Shopping visits today, fulfilled or not.">Attempts</FormulaTooltip></th>
            <th>Fulfilled</th><th>Unmet</th><th>Units sold</th><th>Stockouts</th>
            <th>Avg quality</th><th>Total inventory</th>
            <th><FormulaTooltip title="Port Rosa price" explanation="The distant trade city's current price. Export from a warehouse; freight takes 8%. Green = lucrative (≥1.3× base).">Port Rosa</FormulaTooltip></th>
            <th>Leader</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
              <td>{r.name}</td>
              <td className="mono">{formatMoney(r.basePrice)}</td>
              <td className="mono">{r.averagePrice ? formatMoney(r.averagePrice) : '—'}</td>
              <td className="mono">{r.demandAttempts}</td>
              <td className="mono">{r.fulfilledDemand}</td>
              <td className="mono" style={{ color: r.unmetDemand > 0 ? 'var(--amber)' : undefined }}>{r.unmetDemand}</td>
              <td className="mono">{r.unitsSold}</td>
              <td className="mono">{r.stockoutCount}</td>
              <td className="mono">{r.averageQuality.toFixed(0)}</td>
              <td className="mono">{r.totalInventory}</td>
              {(() => {
                const tradePrice = state.tradeCity.pricesByProduct[r.productId] ?? r.basePrice;
                const mult = tradePrice / r.basePrice;
                return (
                  <td className="mono" style={{ color: mult >= 1.3 ? 'var(--green)' : mult <= 0.75 ? 'var(--red)' : undefined }}>
                    {formatMoney(tradePrice)}
                  </td>
                );
              })()}
              <td>{r.topFirmName ? `${r.topFirmName} ${(r.topFirmShare * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Trends (last 60 days)</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {CONSUMER_PRODUCT_IDS.map((pid) => {
          const stat = state.marketStats[pid];
          const hist = (stat?.history ?? []).slice(-60);
          if (hist.length < 2) return null;
          const name = getProduct(pid).name;
          const lastPrice = hist[hist.length - 1]!.averagePrice;
          const lastShare = hist[hist.length - 1]!.sharesByFirm[playerId] ?? 0;
          return (
            <React.Fragment key={pid}>
              <TrendCard
                label={`${name} — avg price`}
                latest={lastPrice ? formatMoney(lastPrice) : '—'}
                points={hist.map((h) => h.averagePrice)}
                color="var(--amber)"
              />
              <TrendCard
                label={`${name} — your share`}
                latest={`${(lastShare * 100).toFixed(0)}%`}
                points={hist.map((h) => (h.sharesByFirm[playerId] ?? 0) * 100)}
                color="var(--accent)"
              />
              <TrendCard
                label={`${name} — unmet demand`}
                latest={String(hist[hist.length - 1]!.unmetDemand)}
                points={hist.map((h) => h.unmetDemand)}
                color="var(--red)"
              />
            </React.Fragment>
          );
        })}
      </div>
      {CONSUMER_PRODUCT_IDS.every((pid) => (state.marketStats[pid]?.history ?? []).length < 2) && (
        <p className="muted small">Trend charts appear after a couple of in-game days.</p>
      )}
    </div>
  );
}
