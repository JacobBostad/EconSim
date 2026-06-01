import React from 'react';
import { useGameStore } from '../store/useGameStore';
import {
  getPlayerFirm,
  firmFacilities,
  firmEmployees,
  firmInventoryValue,
  firmPnLToday,
  firmPnLLifetime,
  firmWarnings,
} from '../sim/selectors/companySelectors';
import { formatMoney } from '../utils/formatMoney';

export function CompanyDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const state = sim.getState();
  const firm = getPlayerFirm(state);
  if (!firm) return <div>No player firm.</div>;
  const today = firmPnLToday(state, firm.id);
  const life = firmPnLLifetime(state, firm.id);
  const facilities = firmFacilities(state, firm.id);
  const history = firm.accounting.dailyHistory.slice(-14);

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Card label="Cash" value={formatMoney(firm.cash)} color={firm.cash < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Inventory value" value={formatMoney(firmInventoryValue(state, firm.id))} />
        <Card label="Operating profit (today)" value={formatMoney(today.operatingProfit)} color={today.operatingProfit < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Operating profit (life)" value={formatMoney(life.operatingProfit)} color={life.operatingProfit < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Facilities" value={String(facilities.length)} />
        <Card label="Employees" value={String(firmEmployees(state, firm.id).length)} />
      </div>

      {firmWarnings(state, firm.id).length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)' }}>
          {firmWarnings(state, firm.id).map((w, i) => (
            <div key={i} style={{ color: 'var(--amber)' }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <h3>Facilities</h3>
      <table>
        <thead><tr><th>Facility</th><th>Type</th><th>Status</th><th>Sold today</th><th>Produced</th><th>Lost</th></tr></thead>
        <tbody>
          {facilities.map((f) => (
            <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => select(f.id)}>
              <td>{f.name}</td><td>{f.type}</td><td>{f.status}</td>
              <td className="mono">{f.dailyStats.unitsSold}</td>
              <td className="mono">{f.dailyStats.unitsProduced}</td>
              <td className="mono">{f.dailyStats.lostSales}</td>
            </tr>
          ))}
          {facilities.length === 0 && <tr><td colSpan={6} className="muted">No facilities — build some from the left panel.</td></tr>}
        </tbody>
      </table>

      <h3>Daily History (last {history.length} days)</h3>
      <table>
        <thead><tr><th>Day</th><th>Revenue</th><th>COGS</th><th>Wages</th><th>Maint</th><th>Logistics</th><th>Var</th><th>Gross</th><th>Operating</th><th>Cash</th></tr></thead>
        <tbody>
          {history.map((d) => (
            <tr key={d.day}>
              <td>{d.day + 1}</td>
              <td className="mono">{formatMoney(d.revenue)}</td>
              <td className="mono">{formatMoney(d.costOfGoodsSold)}</td>
              <td className="mono">{formatMoney(d.wages)}</td>
              <td className="mono">{formatMoney(d.maintenance)}</td>
              <td className="mono">{formatMoney(d.logisticsCost)}</td>
              <td className="mono">{formatMoney(d.variableProductionCost)}</td>
              <td className="mono">{formatMoney(d.grossProfit)}</td>
              <td className="mono" style={{ color: d.operatingProfit < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(d.operatingProfit)}</td>
              <td className="mono">{formatMoney(d.cash)}</td>
            </tr>
          ))}
          {history.length === 0 && <tr><td colSpan={10} className="muted">History appears after the first full day.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }): React.ReactElement {
  return (
    <div className="card" style={{ minWidth: 150, marginBottom: 0 }}>
      <div className="muted small">{label}</div>
      <div className="mono" style={{ fontSize: 18, color }}>{value}</div>
    </div>
  );
}
