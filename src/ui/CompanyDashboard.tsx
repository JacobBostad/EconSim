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
  companyValuation,
  rankings,
} from '../sim/selectors/companySelectors';
import { formatMoney } from '../utils/formatMoney';
import { OBJECTIVE_VALUATION } from '../sim/data/constants';
import { clamp } from '../utils/clamp';
import { TrendCard } from './Sparkline';

export function CompanyDashboard(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const select = useGameStore((s) => s.select);
  const dispatch = useGameStore((s) => s.dispatch);
  const state = sim.getState();
  const firm = getPlayerFirm(state);
  if (!firm) return <div>No player firm.</div>;
  const today = firmPnLToday(state, firm.id);
  const life = firmPnLLifetime(state, firm.id);
  const facilities = firmFacilities(state, firm.id);
  const history = firm.accounting.dailyHistory.slice(-14);
  const trend = firm.accounting.dailyHistory.slice(-60);
  const val = companyValuation(state, firm.id);
  const standings = rankings(state);
  const objPct = clamp((val.valuation / OBJECTIVE_VALUATION) * 100, 0, 100);

  return (
    <div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row between">
          <strong>Objective — grow company value to {formatMoney(OBJECTIVE_VALUATION)}</strong>
          <span className="mono">{formatMoney(val.valuation)} ({objPct.toFixed(0)}%)</span>
        </div>
        <div className="bar" style={{ margin: '6px 0' }}>
          <span style={{ width: `${objPct}%`, background: objPct >= 100 ? 'var(--green)' : 'var(--accent)' }} />
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <span className="small">Net worth <span className="mono">{formatMoney(val.netWorth)}</span></span>
          <span className="small muted">cash {formatMoney(val.cash)} · inventory {formatMoney(val.inventoryValue)} · assets {formatMoney(val.assetValue)} · debt {formatMoney(val.debt)}</span>
        </div>
      </div>

      {trend.length >= 2 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <TrendCard
            label="Company value"
            latest={formatMoney(val.valuation)}
            points={trend.map((d) => d.valuation)}
            color="var(--accent)"
          />
          <TrendCard
            label="Net profit / day"
            latest={formatMoney(trend[trend.length - 1]!.netProfit)}
            points={trend.map((d) => d.netProfit)}
            color={trend[trend.length - 1]!.netProfit < 0 ? 'var(--red)' : 'var(--green)'}
            showZeroLine
          />
          <TrendCard
            label="Cash"
            latest={formatMoney(firm.cash)}
            points={trend.map((d) => d.cash)}
            color={firm.cash < 0 ? 'var(--red)' : 'var(--green)'}
            showZeroLine
          />
          <TrendCard
            label="Revenue / day"
            latest={formatMoney(trend[trend.length - 1]!.revenue)}
            points={trend.map((d) => d.revenue)}
            color="var(--amber)"
          />
        </div>
      )}

      <h3 style={{ marginTop: 0 }}>Standings &amp; Stock Market</h3>
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Valuation</th><th>Price / 1%</th><th>You own</th><th>Trade</th></tr></thead>
        <tbody>
          {standings.map((e, i) => {
            const pricePerPct = Math.max(1, Math.round(e.valuation / 100));
            const owned = firm.sharesHeld[e.firmId] ?? 0;
            return (
              <tr key={e.firmId} style={{ fontWeight: e.isPlayer ? 700 : 400, color: e.isPlayer ? 'var(--accent)' : undefined }}>
                <td>{i + 1}{i === 0 ? ' 🏆' : ''}</td>
                <td>{e.name}{e.isPlayer ? ' (you)' : ''}</td>
                <td className="mono">{formatMoney(e.valuation)}</td>
                <td className="mono">{e.isPlayer ? '—' : formatMoney(pricePerPct)}</td>
                <td className="mono">{e.isPlayer ? '—' : `${owned}%`}</td>
                <td>
                  {!e.isPlayer && (
                    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => dispatch({ type: 'BUY_SHARES', firmId: firm.id, targetFirmId: e.firmId, percent: 5 })}>
                        Buy 5%
                      </button>
                      <button disabled={owned <= 0} onClick={() => dispatch({ type: 'SELL_SHARES', firmId: firm.id, targetFirmId: e.firmId, percent: 5 })}>
                        Sell 5%
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 4 }}>
        Owning a rival's shares pays you their percentage of a 30% daily profit
        distribution. Stakes are capped at 49% (no takeovers — yet).
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Card label="Cash" value={formatMoney(firm.cash)} color={firm.cash < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Debt" value={formatMoney(firm.debt)} color={firm.debt > 0 ? 'var(--amber)' : undefined} />
        <Card label="Inventory value" value={formatMoney(firmInventoryValue(state, firm.id))} />
        <Card label="Net profit (today)" value={formatMoney(today.netProfit)} color={today.netProfit < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Operating profit (life)" value={formatMoney(life.operatingProfit)} color={life.operatingProfit < 0 ? 'var(--red)' : 'var(--green)'} />
        <Card label="Facilities" value={String(facilities.length)} />
        <Card label="Employees" value={String(firmEmployees(state, firm.id).length)} />
      </div>

      {Object.keys(firm.brandByProduct).length + Object.keys(firm.qualityByProduct).length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {Array.from(new Set([...Object.keys(firm.brandByProduct), ...Object.keys(firm.qualityByProduct)])).map((pid) => (
            <div className="card" key={pid} style={{ minWidth: 150, marginBottom: 0 }}>
              <div className="muted small">{pid}</div>
              <div className="small">Brand <span className="mono">{(firm.brandByProduct[pid] ?? 0).toFixed(0)}</span> · Quality <span className="mono">{(firm.qualityByProduct[pid] ?? 0).toFixed(0)}</span></div>
              <div className="small muted">Ad/day {formatMoney(firm.adBudgetByProduct[pid] ?? 0)}</div>
            </div>
          ))}
        </div>
      )}

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
      <div className="scroll">
      <table>
        <thead><tr><th>Day</th><th>Revenue</th><th>COGS</th><th>Wages</th><th>Maint</th><th>Log</th><th>Var</th><th>Mktg</th><th>R&amp;D</th><th>Int</th><th>Operating</th><th>Net</th><th>Cash</th><th>Debt</th></tr></thead>
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
              <td className="mono">{formatMoney(d.marketing)}</td>
              <td className="mono">{formatMoney(d.rnd)}</td>
              <td className="mono">{formatMoney(d.interest)}</td>
              <td className="mono" style={{ color: d.operatingProfit < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(d.operatingProfit)}</td>
              <td className="mono" style={{ color: d.netProfit < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(d.netProfit)}</td>
              <td className="mono">{formatMoney(d.cash)}</td>
              <td className="mono">{formatMoney(d.debt)}</td>
            </tr>
          ))}
          {history.length === 0 && <tr><td colSpan={14} className="muted">History appears after the first full day.</td></tr>}
        </tbody>
      </table>
      </div>
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
