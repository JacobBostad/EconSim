/**
 * drawFacilities.ts — draws each facility as a labeled colored marker, with a
 * status ring (green=active, amber=bottleneck, grey=idle/closed) and selection
 * highlight.
 */

import type { Camera } from './camera';
import { worldToScreen } from './camera';
import type { GameState } from '../sim/core/GameState';
import type { FacilityType, FacilityStatus } from '../sim/entities/Facility';

const TYPE_COLOR: Record<FacilityType, string> = {
  home: '#3b4252',
  farm: '#7bc96f',
  mine: '#b58863',
  factory: '#e0a458',
  warehouse: '#8aa0c0',
  retail: '#6cb6ff',
  importer: '#c678dd',
};

const TYPE_GLYPH: Record<FacilityType, string> = {
  home: '⌂',
  farm: '🌾',
  mine: '⛏',
  factory: '🏭',
  warehouse: '📦',
  retail: '🏬',
  importer: '🚢',
};

function statusColor(status: FacilityStatus): string {
  switch (status) {
    case 'active': return '#3fb950';
    case 'input-starved':
    case 'labor-starved':
    case 'inventory-full': return '#d29922';
    case 'closed': return '#f85149';
    default: return '#6e7681';
  }
}

export function drawFacilities(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  state: GameState,
  playerFirmId: string,
  selectedId: string | null,
): void {
  for (const id in state.facilities) {
    const f = state.facilities[id]!;
    const p = worldToScreen(cam, f.location);
    const isHome = f.type === 'home';
    const r = isHome ? 5 : 11;

    // Selection highlight.
    if (id === selectedId) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(88,166,255,0.25)';
      ctx.fill();
    }

    // Body.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLOR[f.type];
    ctx.globalAlpha = f.status === 'closed' ? 0.4 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Player ownership ring.
    if (f.ownerFirmId === playerFirmId) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Status ring for operating facilities.
    if (!isHome) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = statusColor(f.status);
      ctx.stroke();

      // Glyph + label.
      ctx.fillStyle = '#0d1117';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TYPE_GLYPH[f.type], p.x, p.y);

      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.font = '9px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(f.name, p.x, p.y + r + 3);
    }
  }
}

export { TYPE_COLOR };
