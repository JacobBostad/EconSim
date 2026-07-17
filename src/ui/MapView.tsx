import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { TownRenderer } from '../render/TownRenderer';

/**
 * MapView mounts the self-contained TownRenderer once. The renderer runs its own
 * animation loop and reads live store state every frame, so it stays smooth and
 * correctly sized independent of React re-renders.
 */
export function MapView(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TownRenderer | null>(null);
  const buildDefId = useGameStore((s) => s.buildDefId);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new TownRenderer(
      canvasRef.current,
      () => useGameStore.getState().sim.getState(),
      {
        onPick: (id) => useGameStore.getState().select(id),
        getSelectedId: () => useGameStore.getState().sim.getState().selectedEntityId,
        getBuildMode: () => useGameStore.getState().buildDefId != null,
        onBuildAt: (world) => {
          const store = useGameStore.getState();
          const defId = store.buildDefId;
          if (!defId) return;
          store.dispatch({
            type: 'BUILD_FACILITY',
            firmId: store.sim.getState().playerFirmId,
            defId,
            location: world,
          });
          store.setBuildDef(null);
        },
      },
    );
    rendererRef.current = renderer;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useGameStore.getState().setBuildDef(null);
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
        style={{ width: '100%', height: '100%', cursor: buildDefId ? 'copy' : 'grab' }}
      />
      <div className="map-hint">
        {buildDefId ? '🏗 Click to place · Esc/Cancel to stop' : '🖱 Drag · Scroll zoom · Space pause · 1-4 speed · G gazette'}
        <button onClick={() => rendererRef.current?.resetView()}>Reset view</button>
      </div>
    </div>
  );
}
