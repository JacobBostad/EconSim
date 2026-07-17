import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { BUILDABLE_DEFS } from '../sim/data/facilityDefinitions';
import { CHAIN_BLUEPRINTS, chainCost } from '../sim/data/chains';
import { getProduct } from '../sim/data/products';
import { formatMoney } from '../utils/formatMoney';
import { getPlayerFirm } from '../sim/selectors/companySelectors';

export function BuildPanel(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const buildDefId = useGameStore((s) => s.buildDefId);
  const setBuildDef = useGameStore((s) => s.setBuildDef);
  const state = sim.getState();
  const player = getPlayerFirm(state);
  const cash = player?.cash ?? 0;

  return (
    <div>
      <div className="section-title">Build (click a building, then click the map)</div>
      <div className="small muted" style={{ marginBottom: 4 }}>
        Land near homes costs up to 1.6× to build and rent (0.8× on the outskirts) —
        but that's where the customers are.
      </div>
      {buildDefId && (
        <div className="card small">
          Placing <strong>{BUILDABLE_DEFS.find((d) => d.id === buildDefId)?.name}</strong>. Click an
          empty spot on the map.
          <div style={{ marginTop: 6 }}>
            <button onClick={() => setBuildDef(null)}>Cancel</button>
          </div>
        </div>
      )}
      {BUILDABLE_DEFS.map((def) => {
        const affordable = cash >= def.buildCost;
        return (
          <button
            key={def.id}
            className={`buildbtn ${buildDefId === def.id ? 'active' : ''}`}
            disabled={!affordable}
            onClick={() => setBuildDef(buildDefId === def.id ? null : def.id)}
            title={def.description}
          >
            {def.name} — {formatMoney(def.buildCost)}
            <small>{def.description}</small>
          </button>
        );
      })}
      <div className="section-title">Chain wizard (one click, fully wired)</div>
      {Object.values(CHAIN_BLUEPRINTS).map((bp) => {
        const cost = chainCost(bp);
        return (
          <button
            key={bp.productId}
            className="buildbtn"
            disabled={cash < cost}
            title={`Builds ${bp.producerDefId} → factory → store, selects recipes, staffs every stage, and wires both supply contracts.`}
            onClick={() => {
              const dispatch = useGameStore.getState().dispatch;
              dispatch({ type: 'BUILD_CHAIN', firmId: state.playerFirmId, productId: bp.productId });
            }}
          >
            🪄 {getProduct(bp.productId).name} chain — {formatMoney(cost)}
            <small>producer + factory + store, staffed &amp; wired</small>
          </button>
        );
      })}
      <div className="small muted" style={{ marginTop: 6 }}>
        Tip: the wizard is a starting point — tune prices, wages, ads, and R&amp;D
        in each facility's inspector to actually win the market.
      </div>
    </div>
  );
}
