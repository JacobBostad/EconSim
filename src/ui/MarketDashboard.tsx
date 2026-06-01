import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { marketRows } from '../sim/selectors/marketSelectors';
import { formatMoney } from '../utils/formatMoney';
import { FormulaTooltip } from './FormulaTooltip';

export function MarketDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const rows = marketRows(sim.getState(), false);

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
            <th>Avg quality</th><th>Total inventory</th><th>Leader</th>
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
              <td>{r.topFirmName ? `${r.topFirmName} ${(r.topFirmShare * 100).toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
