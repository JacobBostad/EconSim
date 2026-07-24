import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { TownRenderer } from '../render/TownRenderer';
import { placementBlocker } from '../sim/core/Placement';
import { isHomeView } from './townView';

/**
 * MapView mounts the self-contained TownRenderer once. The renderer runs its own
 * animation loop and reads live store state every frame, so it stays smooth and
 * correctly sized independent of React re-renders.
 */
export function MapView(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TownRenderer | null>(null);
  const buildDefId = useGameStore((s) => s.buildDefId);
  const selectedTownId = useGameStore((s) => s.selectedTownId);
  const homeView = isHomeView(selectedTownId);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new TownRenderer(
      canvasRef.current,
      () => useGameStore.getState().sim.getState(),
      {
        // The map is LOOKING at whichever town the switcher points to; every
        // renderer read routes through this (region.md step 5). Every mutating
        // callback below is gated on `isHomeView`: the player OPERATES only in
        // home this slice, so a partner view is strictly read-only — no build,
        // no entity-select command crosses towns (region.md §3b).
        getTownId: () => useGameStore.getState().selectedTownId,
        onPick: (id) => {
          const store = useGameStore.getState();
          if (!isHomeView(store.selectedTownId)) return; // view-only: no select command on a partner
          store.select(id);
        },
        getSelectedId: () => useGameStore.getState().sim.getState().selectedEntityId,
        getBuildMode: () =>
          isHomeView(useGameStore.getState().selectedTownId) &&
          useGameStore.getState().buildDefId != null,
        getBuildDefId: () => useGameStore.getState().buildDefId,
        getFlowOverlay: () => useGameStore.getState().flowOverlay,
        getFollowId: () => useGameStore.getState().followedCitizenId,
        onFollowBroken: () => {
          if (useGameStore.getState().followedCitizenId) useGameStore.getState().setFollow(null);
        },
        onBuildAt: (world) => {
          const store = useGameStore.getState();
          if (!isHomeView(store.selectedTownId)) return; // guard: never place onto a partner map
          const defId = store.buildDefId;
          if (!defId) return;
          // Blocked ground: stay in build mode so the player can just move
          // the cursor — the ghost is already explaining why.
          if (placementBlocker(store.sim.getState(), world)) return;
          store.dispatch({
            type: 'BUILD_FACILITY',
            firmId: store.sim.getState().playerFirmId,
            defId,
            location: world,
            ...(store.leaseFromFirmId ? { leaseFrom: store.leaseFromFirmId } : {}),
          });
          store.setBuildDef(null);
        },
      },
    );
    rendererRef.current = renderer;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useGameStore.getState().setBuildDef(null);
        useGameStore.getState().setFollow(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      renderer.destroy();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: buildDefId && homeView ? 'copy' : 'grab' }}
      />
      <div className="map-hint">
        {!homeView
          ? '👀 Viewing a partner city — you don’t operate here yet · 🖱 Drag · Scroll/± zoom'
          : buildDefId
            ? '🏗 Click to place · Esc/Cancel to stop'
            : '🖱 Drag · Scroll/± zoom · Arrows pan · Space pause · 1-4 speed · G gazette · F flows'}
        <button onClick={() => rendererRef.current?.resetView()}>Reset view</button>
      </div>
    </div>
  );
}
