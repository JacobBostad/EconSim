import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { EntityInspector } from './EntityInspector';

export function InspectorPanel(): React.ReactElement {
  const sim = useGameStore((s) => s.sim);
  const state = sim.getState();
  const selected = state.selectedEntityId;

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>Inspector</div>
      {selected ? (
        <EntityInspector id={selected} />
      ) : (
        // Default to the player's firm so the panel is always useful.
        <EntityInspector id={state.playerFirmId} />
      )}
    </div>
  );
}
