import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { fitCamera, screenToWorld, type Camera } from '../render/camera';
import { drawMap } from '../render/drawMap';
import { drawFacilities } from '../render/drawFacilities';
import { drawCitizens } from '../render/drawCitizens';
import { drawVehicles } from '../render/drawVehicles';
import { distance } from '../sim/entities/Location';
import type { EntityId } from '../sim/core/Id';

export function MapView(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<Camera | null>(null);
  const version = useGameStore((s) => s.version);
  const sim = useGameStore((s) => s.sim);
  const buildDefId = useGameStore((s) => s.buildDefId);
  const setBuildDef = useGameStore((s) => s.setBuildDef);
  const dispatch = useGameStore((s) => s.dispatch);
  const select = useGameStore((s) => s.select);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const state = sim.getState();
    const cam = fitCamera(state.config.mapWidth, state.config.mapHeight, w, h);
    camRef.current = cam;

    drawMap(ctx, cam, state, w, h);
    drawVehicles(ctx, cam, state, state.selectedEntityId);
    drawFacilities(ctx, cam, state, state.playerFirmId, state.selectedEntityId);
    drawCitizens(ctx, cam, state, state.selectedEntityId);
  }, [version, sim]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current;
    const cam = camRef.current;
    if (!canvas || !cam) return;
    const rect = canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(cam, screen);
    const state = sim.getState();

    if (buildDefId) {
      dispatch({
        type: 'BUILD_FACILITY',
        firmId: state.playerFirmId,
        defId: buildDefId,
        location: world,
      });
      setBuildDef(null);
      return;
    }

    // Hit-test facilities (priority), then citizens, then vehicles.
    let best: { id: EntityId; d: number } | null = null;
    for (const id in state.facilities) {
      const d = distance(world, state.facilities[id]!.location);
      if (d < 4 && (!best || d < best.d)) best = { id, d };
    }
    if (!best) {
      for (const id in state.citizens) {
        const d = distance(world, state.citizens[id]!.currentLocation);
        if (d < 3 && (!best || d < best.d)) best = { id, d };
      }
    }
    if (!best) {
      for (const id in state.vehicles) {
        const v = state.vehicles[id]!;
        if (v.status !== 'enroute') continue;
        const d = distance(world, v.currentLocation);
        if (d < 3 && (!best || d < best.d)) best = { id, d };
      }
    }
    select(best ? best.id : null);
  }

  return (
    <canvas ref={canvasRef} onClick={handleClick} />
  );
}
