import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { debugSnapshot, recentTransactions } from '../sim/selectors/debugSelectors';
import { getProduct } from '../sim/data/products';
import { formatMoney } from '../utils/formatMoney';
import { townOf } from '../sim/core/Town';

export function DebugPanel(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const tickOnce = useGameStore((s) => s.tickOnce);
  const state = sim.getState();
  // The panel renders the home town (one-town region → identical reference);
  // it gains a town selector at the endgame move.
  const town = townOf(state);
  const d = debugSnapshot(state);
  const txns = recentTransactions(state, 40);

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Kv k="Tick" v={String(d.tick)} />
        <Kv k="Seed" v={String(d.seed)} />
        <Kv k="Day / Hour" v={`${d.day + 1} / ${d.hour}:00`} />
        <Kv k="RNG state" v={String(d.rngState)} />
        <Kv k="Money supply" v={formatMoney(d.totalMoneySupply)} />
        <Kv k="World cash" v={formatMoney(d.worldCash)} />
        <Kv k="Citizens" v={String(d.citizenCount)} />
        <Kv k="Firms" v={String(d.firmCount)} />
        <Kv k="Facilities" v={String(d.facilityCount)} />
        <Kv k="Shipments" v={String(d.activeShipments)} />
        <Kv k="Contracts" v={String(d.contractCount)} />
        <Kv k="Avg tick" v={`${d.avgTickMs.toFixed(3)} ms`} />
        <Kv k="Last tick" v={`${d.lastTickMs.toFixed(3)} ms`} />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={tickOnce}>Step 1 tick</button>
      </div>

      <h3>Total Product Quantities</h3>
      <div className="row" style={{ gap: 12 }}>
        {Object.entries(d.productQuantities).map(([pid, q]) => (
          <span key={pid} className="mono">{getProduct(pid).name}: {q}</span>
        ))}
      </div>

      <h3>Recent Transactions</h3>
      <table>
        <thead><tr><th>Tick</th><th>Category</th><th>Amount</th><th>Firm</th><th>Note</th></tr></thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.tick}</td>
              <td>{t.category}</td>
              <td className="mono">{formatMoney(t.amount)}</td>
              <td>{t.firmId ? town.firms[t.firmId]?.name ?? t.firmId : '—'}</td>
              <td style={{ textAlign: 'left' }}>{t.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="card" style={{ minWidth: 120, marginBottom: 0 }}>
      <div className="muted small">{k}</div>
      <div className="mono">{v}</div>
    </div>
  );
}
