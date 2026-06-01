import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { BUILDABLE_DEFS } from '../sim/data/facilityDefinitions';
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
      <div className="small muted" style={{ marginTop: 6 }}>
        Tip: build a Farm → Factory (bake bread) → Retail Store, then wire them with supply
        contracts and hire workers.
      </div>
    </div>
  );
}
