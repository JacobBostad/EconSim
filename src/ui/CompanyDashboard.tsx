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
  objectiveProgress,
  facilityPnL,
} from '../sim/selectors/companySelectors';
import { formatMoney } from '../utils/formatMoney';
import { getProduct } from '../sim/data/products';
import {
  OBJECTIVE_VALUATION,
  ACQUISITION_PREMIUM_HEALTHY,
  ACQUISITION_PREMIUM_DISTRESSED,
  DIVIDEND_PAYOUT_RATIO,
} from '../sim/data/constants';
import { clamp } from '../utils/clamp';
import { TrendCard } from './Sparkline';
import { SHOW_CHRONICLE_EVENT } from './ChronicleModal';
import { getPersonality } from '../sim/data/personalities';

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
  const objective = objectiveProgress(state);
  const objTarget = objective.next?.valuation ?? OBJECTIVE_VALUATION;
  const objPct = clamp((val.valuation / objTarget) * 100, 0, 100);

  return (
    <div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row between">
          <strong>
            {objective.next
              ? `Objective — grow company value to ${formatMoney(objective.next.valuation)} (${objective.next.title})`
              : '🏆 All objectives complete — endless mode'}
            {objective.reachedTitle && objective.next ? ` · rank earned: ${objective.reachedTitle}` : ''}
          </strong>
          <span className="row" style={{ gap: 8 }}>
            <span className="mono">{formatMoney(val.valuation)} ({objPct.toFixed(0)}%)</span>
            {!objective.next && (
              <button onClick={() => window.dispatchEvent(new Event(SHOW_CHRONICLE_EVENT))}>
                📜 Chronicle
              </button>
            )}
          </span>
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
            const targetFirm = state.firms[e.firmId];
            const premium =
              targetFirm?.bankruptcyStatus === 'healthy'
                ? ACQUISITION_PREMIUM_HEALTHY
                : ACQUISITION_PREMIUM_DISTRESSED;
            const buyoutCost = Math.max(
              1,
              Math.round((e.valuation * premium * (100 - owned)) / 100),
            );
            return (
              <tr key={e.firmId} style={{ fontWeight: e.isPlayer ? 700 : 400, color: e.isPlayer ? 'var(--accent)' : undefined }}>
                <td>{i + 1}{i === 0 ? ' 🏆' : ''}</td>
                <td>
                  {e.name}{e.isPlayer ? ' (you)' : ''}
                  {targetFirm?.ceoName && (
                    <div className="small muted" title={getPersonality(targetFirm.personalityId).blurb}>
                      CEO {targetFirm.ceoName} · {getPersonality(targetFirm.personalityId).icon}{' '}
                      {getPersonality(targetFirm.personalityId).name}
                    </div>
                  )}
                </td>
                <td className="mono">{formatMoney(e.valuation)}</td>
                <td className="mono">{e.isPlayer ? '—' : formatMoney(pricePerPct)}</td>
                <td className="mono">
                  {e.isPlayer ? '—' : `${owned}%`}
                  {!e.isPlayer && (() => {
                    // What a stake pays: 30% of the rival's positive daily
                    // profit is distributed pro-rata (7-day average). Makes
                    // the ~35%/yr dividend economics visible before buying.
                    const hist = targetFirm?.accounting.dailyHistory ?? [];
                    const recent = hist.slice(-7);
                    if (recent.length === 0) return null;
                    const avgPool =
                      (recent.reduce((s, d) => s + Math.max(0, d.netProfit), 0) / recent.length) *
                      DIVIDEND_PAYOUT_RATIO;
                    const per5 = (avgPool * 5) / 100;
                    if (per5 < 1) return null;
                    return (
                      <div className="small muted" title="Estimated from the rival's 7-day average profit at the 30% payout ratio. Paid daily, pro-rata to your stake.">
                        ~{formatMoney(owned > 0 ? (avgPool * owned) / 100 : per5)}/day{owned > 0 ? '' : ' per 5%'}
                      </div>
                    );
                  })()}
                </td>
                <td>
                  {!e.isPlayer && (
                    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => dispatch({ type: 'BUY_SHARES', firmId: firm.id, targetFirmId: e.firmId, percent: 5 })}>
                        Buy 5%
                      </button>
                      <button disabled={owned <= 0} onClick={() => dispatch({ type: 'SELL_SHARES', firmId: firm.id, targetFirmId: e.firmId, percent: 5 })}>
                        Sell 5%
                      </button>
                      <button
                        disabled={firm.cash < buyoutCost}
                        title={`Full takeover: absorb all facilities, staff, and brands${targetFirm?.bankruptcyStatus !== 'healthy' ? ' (distressed discount)' : ''}`}
                        onClick={() => {
                          if (confirm(`Acquire ${e.name} outright for ${formatMoney(buyoutCost)}? You absorb their facilities, staff, debt, and brands.`)) {
                            dispatch({ type: 'ACQUIRE_FIRM', firmId: firm.id, targetFirmId: e.firmId });
                          }
                        }}
                      >
                        🤝 Buy out {formatMoney(buyoutCost)}
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
        distribution (partial stakes cap at 49%). A full buyout costs 1.3× valuation
        (0.9× if they're distressed), minus credit for shares you already hold — you
        absorb everything, including their debt.
      </p>
      {firm.acquiredNames.length > 0 && (
        <p className="small" style={{ marginTop: 2 }}>
          🤝 Acquired: {firm.acquiredNames.join(', ')}
        </p>
      )}

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
              <div className="muted small">{getProduct(pid).name}</div>
              <div className="small">Brand <span className="mono">{(firm.brandByProduct[pid] ?? 0).toFixed(0)}</span> · Quality <span className="mono">{(firm.qualityByProduct[pid] ?? getProduct(pid).defaultQuality).toFixed(0)}</span></div>
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

      <h3>Facilities — yesterday's P&L</h3>
      <table>
        <thead><tr><th>Facility</th><th>Type</th><th>Staff</th><th>Sold</th><th>Made</th><th>Earned</th><th>Cost</th><th>Net</th><th>7d Ø</th></tr></thead>
        <tbody>
          {facilityPnL(state, firm.id).map((r) => (
            <tr key={r.facilityId} style={{ cursor: 'pointer' }} onClick={() => select(r.facilityId)}>
              <td>{r.name}{r.status === 'closed' ? ' 🚫' : ''}</td><td>{r.type}</td>
              <td className="mono">{r.staff}</td>
              <td className="mono">{r.unitsSold}</td>
              <td className="mono">{r.unitsProduced}</td>
              <td className="mono">{formatMoney(r.revenue)}</td>
              <td className="mono">{formatMoney(r.cost)}</td>
              <td className="mono" style={{ color: r.net < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(r.net)}</td>
              <td className="mono" style={{ color: r.emaNet < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(r.emaNet)}</td>
            </tr>
          ))}
          {facilities.length === 0 && <tr><td colSpan={9} className="muted">No facilities — build some from the left panel.</td></tr>}
        </tbody>
      </table>
      <p className="muted small" style={{ marginTop: 4 }}>
        Internal shipments are credited to the shipper and debited to the
        receiver at market price, so factories and farms show the value they
        create. Wages and upkeep are per-facility; firm-wide spend (ads, R&D,
        interest, freight) isn't attributed. Rows rank by the 7-day average
        (single days swing with ship/idle rhythms) — a red bottom row is your
        money pit: click it to restaff, reprice, or sell.
      </p>

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
