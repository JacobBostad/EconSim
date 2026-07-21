/**
 * buildings.ts — the procedural 2.5D building kit.
 *
 * Every structure is drawn in code as a small oblique-projection construction:
 * a front wall, a darker side wall extruded up-right, and a per-type roof and
 * details. Design rules (the whole point of the kit):
 *  - silhouettes identify the type before any label is read (barn+silo = farm,
 *    sawtooth roof + chimney = factory, headframe = mine, awning = shop...)
 *  - state is visible: closed = boarded and grey, working factories smoke
 *    (smoke handled by the renderer), night lights windows,
 *  - upgrades grow the building (L2/L3 add width and a floor) instead of
 *    only adding badges,
 *  - the player's buildings carry a gold accent (awning/trim/flag).
 *
 * All shapes anchor at (x, y) = the building's ground center in screen px,
 * with `w` its half-width — matching the old flat-icon footprint so picking
 * and labels stay put.
 */

import type { FacilityType } from '../sim/entities/Facility';

export interface BuildingPaint {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  /** Half-width of the footprint in px (the old icon "size"). */
  w: number;
  /** Identity color for the type (legend color). */
  fill: string;
  closed: boolean;
  player: boolean;
  level: number;
  /** 0 (day) .. 1 (deep night) — lights windows. */
  night: number;
}

export const PLAYER_ACCENT = '#f0c64c';
const WINDOW_DAY = 'rgba(40,60,80,0.55)';

// --- tiny color utils -----------------------------------------------------
function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

function windowFill(night: number): string {
  return night > 0.25 ? `rgba(255,214,120,${Math.min(0.95, night * 1.25)})` : WINDOW_DAY;
}

// Oblique depth offsets (up-right extrusion).
function depth(w: number): { dx: number; dy: number } {
  return { dx: w * 0.38, dy: -w * 0.26 };
}

/** Front wall + extruded right side + flat roof plane. */
function block(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, halfW: number, h: number,
  wall: string, opts: { roof?: string } = {},
): void {
  const { dx, dy } = depth(halfW);
  const l = x - halfW, r = x + halfW, t = y - h;
  // side (right)
  ctx.fillStyle = shade(wall, -0.16);
  ctx.beginPath();
  ctx.moveTo(r, y); ctx.lineTo(r + dx, y + dy); ctx.lineTo(r + dx, t + dy); ctx.lineTo(r, t);
  ctx.closePath(); ctx.fill();
  // roof plane
  ctx.fillStyle = opts.roof ?? shade(wall, 0.14);
  ctx.beginPath();
  ctx.moveTo(l, t); ctx.lineTo(r, t); ctx.lineTo(r + dx, t + dy); ctx.lineTo(l + dx, t + dy);
  ctx.closePath(); ctx.fill();
  // front
  const g = ctx.createLinearGradient(0, t, 0, y);
  g.addColorStop(0, shade(wall, 0.06));
  g.addColorStop(1, shade(wall, -0.06));
  ctx.fillStyle = g;
  ctx.fillRect(l, t, halfW * 2, h);
  // crisp edges
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(l + 0.5, t + 0.5, halfW * 2 - 1, h - 1);
}

/** Pitched (gabled) roof over a front wall span. */
function gable(
  ctx: CanvasRenderingContext2D,
  x: number, yTop: number, halfW: number, rise: number, roof: string,
): void {
  const { dx, dy } = depth(halfW);
  // roof slope plane (right of ridge)
  ctx.fillStyle = shade(roof, -0.1);
  ctx.beginPath();
  ctx.moveTo(x, yTop - rise); ctx.lineTo(x + halfW, yTop);
  ctx.lineTo(x + halfW + dx, yTop + dy); ctx.lineTo(x + dx, yTop - rise + dy);
  ctx.closePath(); ctx.fill();
  // front gable triangle
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - halfW, yTop); ctx.lineTo(x, yTop - rise); ctx.lineTo(x + halfW, yTop);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  ctx.stroke();
}

function windows(
  ctx: CanvasRenderingContext2D,
  xs: number[], ys: number[], ww: number, wh: number, night: number,
): void {
  ctx.fillStyle = windowFill(night);
  for (const wy of ys) for (const wx of xs) ctx.fillRect(wx, wy, ww, wh);
}

function door(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, closed: boolean): void {
  ctx.fillStyle = closed ? '#5a4a3a' : '#4a3627';
  ctx.fillRect(x - w / 2, y - h, w, h);
  if (closed) {
    // boarded X
    ctx.strokeStyle = '#8a7a62'; ctx.lineWidth = Math.max(1, w * 0.16);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h); ctx.lineTo(x + w / 2, y);
    ctx.moveTo(x + w / 2, y - h); ctx.lineTo(x - w / 2, y);
    ctx.stroke();
  }
}

function playerFlag(ctx: CanvasRenderingContext2D, x: number, yTop: number, s: number): void {
  ctx.strokeStyle = '#7d8590'; ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yTop - s); ctx.stroke();
  ctx.fillStyle = PLAYER_ACCENT;
  ctx.beginPath();
  ctx.moveTo(x, yTop - s); ctx.lineTo(x + s * 0.8, yTop - s * 0.72); ctx.lineTo(x, yTop - s * 0.45);
  ctx.closePath(); ctx.fill();
}

// --- per-type constructions ----------------------------------------------

function drawHouse(p: BuildingPaint): void {
  const { ctx, x, y, w, night } = p;
  const h = w * 1.0;
  block(ctx, x, y, w * 0.92, h, '#d8c8a8');
  gable(ctx, x, y - h, w * 0.92, w * 0.75, '#b06a45');
  windows(ctx, [x - w * 0.62, x + w * 0.26], [y - h * 0.72], w * 0.36, w * 0.36, night);
  door(ctx, x - w * 0.05, y, w * 0.34, h * 0.62, false);
}

function drawApartment(p: BuildingPaint): void {
  const { ctx, x, y, w, night, level } = p;
  const floors = 3 + Math.max(0, level - 1);
  const h = w * (1.15 + floors * 0.42);
  block(ctx, x, y, w, h, '#9a8fd0', { roof: '#7a6fb0' });
  // floor bands + windows
  const xs = [x - w * 0.66, x - w * 0.12, x + w * 0.4];
  const ys: number[] = [];
  for (let i = 0; i < floors; i++) ys.push(y - h + w * 0.5 + i * ((h - w * 0.8) / floors));
  windows(ctx, xs, ys, w * 0.3, w * 0.32, night);
  // gold parapet = premium housing
  ctx.fillStyle = '#e8d28a';
  ctx.fillRect(x - w, y - h - w * 0.1, w * 2, w * 0.12);
  door(ctx, x, y, w * 0.4, w * 0.6, false);
}

function drawFarm(p: BuildingPaint): void {
  const { ctx, x, y, w, night } = p;
  // barn
  const bw = w * 0.78, bh = w * 0.85;
  const bx = x - w * 0.25;
  block(ctx, bx, y, bw, bh, '#b4513c');
  gable(ctx, bx, y - bh, bw, w * 0.6, '#8c3b2c');
  // big barn door
  ctx.fillStyle = '#7a3428';
  ctx.fillRect(bx - bw * 0.4, y - bh * 0.75, bw * 0.8, bh * 0.75);
  ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.beginPath();
  ctx.moveTo(bx - bw * 0.4, y - bh * 0.75); ctx.lineTo(bx + bw * 0.4, y);
  ctx.moveTo(bx + bw * 0.4, y - bh * 0.75); ctx.lineTo(bx - bw * 0.4, y);
  ctx.stroke();
  void night;
  // silo
  const sx = x + w * 0.72, sr = w * 0.3, sh = w * 1.5;
  ctx.fillStyle = '#c9cdd4';
  ctx.fillRect(sx - sr, y - sh, sr * 2, sh);
  ctx.fillStyle = '#aeb4bd';
  ctx.fillRect(sx + sr * 0.2, y - sh, sr * 0.8, sh);
  ctx.fillStyle = '#8f9aa8';
  ctx.beginPath(); ctx.arc(sx, y - sh, sr, Math.PI, 0); ctx.fill();
}

function drawMine(p: BuildingPaint): void {
  const { ctx, x, y, w } = p;
  // tailings mound
  ctx.fillStyle = '#8a7462';
  ctx.beginPath();
  ctx.moveTo(x - w * 1.05, y); ctx.quadraticCurveTo(x - w * 0.5, y - w * 0.55, x + w * 0.05, y);
  ctx.closePath(); ctx.fill();
  // shaft house
  const bw = w * 0.6, bh = w * 0.6, bx = x + w * 0.35;
  block(ctx, bx, y, bw, bh, '#8d6e63');
  // headframe (A-frame + wheel)
  const hx = x - w * 0.35, top = y - w * 1.35;
  ctx.strokeStyle = '#5d4a41'; ctx.lineWidth = Math.max(1.5, w * 0.12);
  ctx.beginPath();
  ctx.moveTo(hx - w * 0.45, y); ctx.lineTo(hx, top);
  ctx.moveTo(hx + w * 0.45, y); ctx.lineTo(hx, top);
  ctx.moveTo(hx - w * 0.28, y - w * 0.55); ctx.lineTo(hx + w * 0.28, y - w * 0.55);
  ctx.stroke();
  ctx.strokeStyle = '#3f332c'; ctx.lineWidth = Math.max(1, w * 0.08);
  ctx.beginPath(); ctx.arc(hx, top, w * 0.2, 0, Math.PI * 2); ctx.stroke();
  // tunnel mouth
  ctx.fillStyle = '#241d18';
  ctx.beginPath(); ctx.arc(hx, y, w * 0.26, Math.PI, 0); ctx.fill();
}

function drawFactory(p: BuildingPaint): void {
  const { ctx, x, y, w, night, level } = p;
  const halfW = w * (0.95 + (level - 1) * 0.12);
  const h = w * (0.95 + (level - 1) * 0.22);
  block(ctx, x, y, halfW, h, '#c98a4b', { roof: '#a06a38' });
  // sawtooth roofline on the front
  const teeth = 3;
  const tw = (halfW * 2) / teeth;
  ctx.fillStyle = '#7d5429';
  for (let i = 0; i < teeth; i++) {
    const tx = x - halfW + i * tw;
    ctx.beginPath();
    ctx.moveTo(tx, y - h); ctx.lineTo(tx, y - h - w * 0.34); ctx.lineTo(tx + tw, y - h);
    ctx.closePath(); ctx.fill();
  }
  // glazing under each tooth
  ctx.fillStyle = windowFill(night);
  for (let i = 0; i < teeth; i++) {
    const tx = x - halfW + i * tw;
    ctx.fillRect(tx + tw * 0.1, y - h - w * 0.02 - w * 0.16, tw * 0.42, w * 0.16);
  }
  // chimney (smoke drawn live by the renderer)
  ctx.fillStyle = '#6e5140';
  ctx.fillRect(x + halfW * 0.55, y - h - w * 0.72, w * 0.24, w * 0.72 + w * 0.2);
  ctx.fillStyle = '#54402f';
  ctx.fillRect(x + halfW * 0.55, y - h - w * 0.78, w * 0.24, w * 0.1);
  // wide entry
  door(ctx, x - halfW * 0.35, y, w * 0.5, h * 0.5, false);
  windows(ctx, [x + w * 0.1, x + w * 0.45], [y - h * 0.55], w * 0.26, w * 0.3, night);
}

function drawWarehouse(p: BuildingPaint): void {
  const { ctx, x, y, w, level } = p;
  const halfW = w * (1.0 + (level - 1) * 0.12);
  const h = w * 0.85;
  block(ctx, x, y, halfW, h, '#8fa3b8', { roof: '#6f8296' });
  // curved roof hint
  ctx.fillStyle = '#a5b6c8';
  ctx.beginPath();
  ctx.moveTo(x - halfW, y - h);
  ctx.quadraticCurveTo(x, y - h - w * 0.3, x + halfW, y - h);
  ctx.closePath(); ctx.fill();
  // two sliding doors + dock stripe
  ctx.fillStyle = '#5c6c7c';
  ctx.fillRect(x - halfW * 0.72, y - h * 0.68, halfW * 0.55, h * 0.68);
  ctx.fillRect(x + halfW * 0.16, y - h * 0.68, halfW * 0.55, h * 0.68);
  ctx.fillStyle = '#e6c46a';
  ctx.fillRect(x - halfW, y - h * 0.08, halfW * 2, h * 0.08);
  // door slats
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  for (const dx0 of [-halfW * 0.72, halfW * 0.16]) {
    for (let i = 1; i < 4; i++) {
      const yy = y - (h * 0.68 * i) / 4;
      ctx.beginPath(); ctx.moveTo(x + dx0, yy); ctx.lineTo(x + dx0 + halfW * 0.55, yy); ctx.stroke();
    }
  }
}

function drawRetail(p: BuildingPaint): void {
  const { ctx, x, y, w, night, player, level } = p;
  const halfW = w * (0.95 + (level - 1) * 0.1);
  const h = w * 1.0;
  block(ctx, x, y, halfW, h, '#74a8d8', { roof: '#5a8ab6' });
  // big shopfront glass
  ctx.fillStyle = night > 0.25 ? windowFill(Math.max(night, 0.5)) : 'rgba(210,230,245,0.85)';
  ctx.fillRect(x - halfW * 0.8, y - h * 0.52, halfW * 1.6, h * 0.44);
  ctx.strokeStyle = 'rgba(30,50,70,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(x - halfW * 0.8, y - h * 0.52, halfW * 1.6, h * 0.44);
  // striped awning — gold for the player, red otherwise
  const stripe = player ? PLAYER_ACCENT : '#d05a4a';
  const aw = halfW * 1.85, ah = w * 0.3, ay = y - h * 0.56;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? stripe : '#f2ede2';
    ctx.beginPath();
    ctx.moveTo(x - aw / 2 + (aw * i) / 6, ay);
    ctx.lineTo(x - aw / 2 + (aw * (i + 1)) / 6, ay);
    ctx.lineTo(x - aw / 2 + (aw * (i + 1)) / 6, ay + ah);
    ctx.lineTo(x - aw / 2 + (aw * i) / 6 + ah * 0.25, ay + ah);
    ctx.closePath(); ctx.fill();
  }
  // signboard
  ctx.fillStyle = '#2d3b4c';
  ctx.fillRect(x - halfW * 0.62, y - h - w * 0.06, halfW * 1.24, w * 0.3);
  ctx.fillStyle = night > 0.25 ? '#ffd678' : '#cfe3f5';
  ctx.fillRect(x - halfW * 0.52, y - h - w * 0.01, halfW * 1.04, w * 0.18);
}

function drawImporter(p: BuildingPaint): void {
  const { ctx, x, y, w, night } = p;
  // terminal hall
  const halfW = w * 1.0, h = w * 0.7;
  block(ctx, x - w * 0.2, y, halfW * 0.8, h, '#b08cc8', { roof: '#8f6cab' });
  windows(ctx, [x - w * 0.75, x - w * 0.35, x + w * 0.05], [y - h * 0.6], w * 0.24, w * 0.26, night);
  // stacked containers
  const cw = w * 0.5, ch = w * 0.26;
  const cols = ['#c96a4a', '#4a8ac9', '#5aa96a'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = cols[i]!;
    const cx = x + w * 0.55 + (i % 2) * cw * 0.16;
    ctx.fillRect(cx - cw / 2, y - ch * (i + 1), cw, ch - 1);
  }
  // gantry crane
  ctx.strokeStyle = '#54607a'; ctx.lineWidth = Math.max(1.5, w * 0.1);
  ctx.beginPath();
  ctx.moveTo(x - w * 1.0, y); ctx.lineTo(x - w * 1.0, y - w * 1.5);
  ctx.lineTo(x + w * 1.15, y - w * 1.5); ctx.lineTo(x + w * 1.15, y);
  ctx.stroke();
  ctx.strokeStyle = '#8b96ad'; ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.beginPath(); ctx.moveTo(x + w * 0.55, y - w * 1.5); ctx.lineTo(x + w * 0.55, y - w * 0.85); ctx.stroke();
}

function drawDatacenter(p: BuildingPaint): void {
  const { ctx, x, y, w, level, night } = p;
  const halfW = w * (1.0 + (level - 1) * 0.12);
  const h = w * 0.95;
  block(ctx, x, y, halfW, h, '#5fb3a1', { roof: '#3f8676' });
  // Rows of server-rack LEDs on the front wall (green/amber "activity").
  const cols = 4, rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = x - halfW * 0.7 + (halfW * 1.4 * (c + 0.5)) / cols;
      const ly = y - h * 0.85 + (h * 0.7 * (r + 0.5)) / rows;
      ctx.fillStyle = (r + c) % 3 === 0
        ? (night > 0.25 ? '#ffd678' : '#e0a94a')
        : (night > 0.25 ? '#7dffce' : '#2f8f70');
      ctx.fillRect(lx - w * 0.06, ly - w * 0.06, w * 0.12, w * 0.12);
    }
  }
  // Rooftop cooling unit.
  ctx.fillStyle = '#cfe0db';
  ctx.fillRect(x - halfW * 0.3, y - h - w * 0.22, halfW * 0.6, w * 0.22);
}

function drawOffice(p: BuildingPaint): void {
  const { ctx, x, y, w, level, night } = p;
  const halfW = w * (0.85 + (level - 1) * 0.1);
  const h = w * (1.15 + (level - 1) * 0.1); // a taller, slimmer block than a datacenter
  block(ctx, x, y, halfW, h, '#6f9bc4', { roof: '#4c749b' });
  // A grid of office windows, lit warm at night.
  const cols = 3, rows = 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = x - halfW * 0.7 + (halfW * 1.4 * (c + 0.5)) / cols;
      const ly = y - h * 0.9 + (h * 0.78 * (r + 0.5)) / rows;
      ctx.fillStyle = night > 0.25
        ? ((r + c) % 2 === 0 ? '#ffe6a8' : '#3b4a5e')
        : '#c8dced';
      ctx.fillRect(lx - w * 0.07, ly - w * 0.09, w * 0.14, w * 0.18);
    }
  }
}

const DRAWERS: Record<FacilityType, (p: BuildingPaint) => void> = {
  home: drawHouse,
  farm: drawFarm,
  mine: drawMine,
  factory: drawFactory,
  warehouse: drawWarehouse,
  retail: drawRetail,
  importer: drawImporter,
  datacenter: drawDatacenter,
  office: drawOffice,
};

/** Draw one building. `defId` picks apartment over plain home. */
export function drawBuilding(type: FacilityType, defId: string, p: BuildingPaint): void {
  const { ctx } = p;
  ctx.save();
  if (p.closed) ctx.globalAlpha = 0.55;
  if (defId === 'apartment') drawApartment(p);
  else DRAWERS[type](p);
  if (p.closed) {
    ctx.globalAlpha = 1;
    // boarded door marker front and center
    door(ctx, p.x, p.y, p.w * 0.4, p.w * 0.55, true);
  }
  if (p.player) playerFlag(ctx, p.x - p.w * 0.98, p.y - p.w * 1.45, p.w * 0.62);
  ctx.restore();
}
