/**
 * camera.ts — world<->screen transform. The whole town fits the canvas with a
 * margin; coordinates are in world units (config.mapWidth/Height).
 */

import type { Vec2 } from '../sim/entities/Location';

export interface Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function fitCamera(
  mapWidth: number,
  mapHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  margin = 20,
): Camera {
  const sx = (canvasWidth - margin * 2) / mapWidth;
  const sy = (canvasHeight - margin * 2) / mapHeight;
  const scale = Math.min(sx, sy);
  return {
    scale,
    offsetX: margin + (canvasWidth - margin * 2 - mapWidth * scale) / 2,
    offsetY: margin + (canvasHeight - margin * 2 - mapHeight * scale) / 2,
  };
}

export function worldToScreen(cam: Camera, p: Vec2): Vec2 {
  return { x: cam.offsetX + p.x * cam.scale, y: cam.offsetY + p.y * cam.scale };
}

export function screenToWorld(cam: Camera, p: Vec2): Vec2 {
  return { x: (p.x - cam.offsetX) / cam.scale, y: (p.y - cam.offsetY) / cam.scale };
}
