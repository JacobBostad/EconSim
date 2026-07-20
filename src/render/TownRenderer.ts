/**
 * TownRenderer — a self-contained, smooth canvas renderer for the town.
 *
 * Owns its own requestAnimationFrame loop and reads live GameState each frame,
 * so the map is always animated and correctly sized regardless of React. It:
 *  - sizes to its container via ResizeObserver at devicePixelRatio (crisp),
 *  - eases entity positions toward their live targets (buttery movement even at
 *    low tick rates),
 *  - draws ground, a road network, buildings (vector icons), shipments, and
 *    citizens, with a day/night tint and a legend,
 *  - spawns floating "+$" and goods popups when sales/deliveries/production
 *    happen, so you literally see money and product change hands,
 *  - supports wheel-zoom, drag-pan, hover tooltips, and click selection.
 */

import type { GameState } from '../sim/core/GameState';
import type { FacilityType } from '../sim/entities/Facility';
import type { CitizenActivity } from '../sim/entities/Citizen';
import { computeTime } from '../sim/core/Tick';
import { landValueAt, landValueFromIndex, buildHomeIndex, landCostMultiplier } from '../sim/core/LandValue';
import { placementBlocker } from '../sim/core/Placement';
import { getFacilityDef } from '../sim/data/facilityDefinitions';
import { seasonOf } from '../sim/data/seasons';
import { getProduct } from '../sim/data/products';
import { formatMoney } from '../utils/formatMoney';
import { drawBuilding } from './buildings';
import { buildRoute, routePose, type Route } from './roadRoute';

interface Vec { x: number; y: number }
interface Floater { x: number; y: number; vy: number; life: number; maxLife: number; text: string; color: string }
interface Trail { x: number; y: number; life: number }

/** Premium housing gets its own hue so landlord holdings read at a glance. */
const APARTMENT_FILL = '#8a7fc9';

/** Identity colors (legend + chips); the buildings themselves are drawn by
 * the procedural kit in buildings.ts with matching hues. */
const BUILDING_FILL: Record<FacilityType, string> = {
  home: '#b06a45',
  farm: '#b4513c',
  mine: '#8d6e63',
  factory: '#c98a4b',
  warehouse: '#8fa3b8',
  retail: '#74a8d8',
  importer: '#b08cc8',
  datacenter: '#5fb3a1',
};

const ACTIVITY_COLOR: Record<CitizenActivity, string> = {
  sleeping: '#3a4256',
  home: '#6e7681',
  'commuting-to-work': '#58a6ff',
  working: '#3fb950',
  'commuting-to-shop': '#d2a8ff',
  shopping: '#f0883e',
  'commuting-home': '#8b949e',
};

export const LEGEND_EXTRAS: { color: string; label: string }[] = [
  { color: APARTMENT_FILL, label: 'Apartment' },
  { color: 'rgba(255,190,90,0.9)', label: 'Wholesale route (F)' },
];

export const LEGEND_BUILDINGS: { type: FacilityType; label: string }[] = [
  { type: 'farm', label: 'Farm' },
  { type: 'mine', label: 'Mine' },
  { type: 'factory', label: 'Factory' },
  { type: 'warehouse', label: 'Warehouse' },
  { type: 'retail', label: 'Store' },
  { type: 'importer', label: 'Importer' },
  { type: 'home', label: 'Home' },
];

/**
 * Render-time LOD / culling thresholds, measured in effScale (screen px per
 * world unit). At or above LOD_GLYPH_SCALE buildings draw the full 2.5-D kit;
 * below it they collapse to flat footprint glyphs. Below LOD_CITIZEN_SKIP_SCALE
 * per-agent sprites (cast citizens and ambient crowd dots) are sub-pixel noise
 * and are skipped wholesale. Culling itself runs at every zoom — offscreen
 * entities are never drawn regardless of these thresholds. At the classic fit
 * view effScale is ~11, so the Village at its default zoom stays fully detailed;
 * LOD only engages when the player zooms out (or on the large City/Metropolis
 * maps whose fit view sits nearer the threshold).
 */
const LOD_GLYPH_SCALE = 5.5;
const LOD_CITIZEN_SKIP_SCALE = 3.5;

/** LOD is a big-map economy measure. The Village map always fit fully
 * detailed before A4 — on a narrow canvas its FIT view can dip under the
 * glyph threshold, which would visibly downgrade the classic game at
 * default zoom (review finding) — so Village never engages LOD. */
function lodEnabled(state: { config: { sizePreset: string } }): boolean {
  return state.config.sizePreset !== 'village';
}
/** World-unit margins added around the visible rect before per-entity culling.
 * Buildings are tall (2.5-D body plus upgrade pips reach ~1.7× their half-width
 * — up to ~5 world units — above the ground anchor), so they need a deeper
 * margin than the ground-hugging agents to avoid popping at the top edge.
 * Ground-hugging agents (citizens, trucks) are culled in screen space with a
 * small pixel margin, since their sprites are screen-constant in size. */
const FACILITY_CULL_MARGIN = 7;
/**
 * Ambient crowd: one background pedestrian dot per this many cohort residents.
 * Pinned by eye — dense enough to read as a living city beside the ~40-150
 * simulated cast, sparse enough to stay cheap once viewport-culled (a 2,000-pop
 * City district scatters ~80 dots, a 10,000-pop Metropolis district ~400, and
 * only the visible tiles of either are ever drawn).
 */
const AMBIENT_PEOPLE_PER_DOT = 25;
const AMBIENT_TILE = 6; // world units per hash tile
const AMBIENT_MAX_DOTS_PER_TILE = 3;

/**
 * Salted integer hash → [0,1). The same stream-safe xxhash-style finalizer the
 * sim uses for its rng-free timing gates (see FireSaleSystem.saleRoll); here it
 * seeds the ambient crowd from (district, day, tile, index) so the dots are a
 * pure function of the game day — stable within a day (no per-frame flicker),
 * fresh each morning — and never touch the shared sim rng or Math.random.
 */
function hashInts(...vals: number[]): number {
  let t = 0x9e3779b1 >>> 0;
  for (let i = 0; i < vals.length; i++) {
    t = (t ^ Math.imul((vals[i]! | 0) + 1, 0x27d4eb2f)) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
  }
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** FNV-1a of a district id → a stable numeric salt for the ambient hash. */
function strSeed(str: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export interface RendererCallbacks {
  onPick: (id: string | null) => void;
  getSelectedId: () => string | null;
  getBuildMode: () => boolean;
  /** Which facility def is being placed (null when not in build mode) —
   * drives the cursor ghost preview. */
  getBuildDefId: () => string | null;
  getFlowOverlay: () => boolean;
  onBuildAt: (world: Vec) => void;
  /** Citizen the camera should track (null = free camera). */
  getFollowId: () => string | null;
  /** Manual pan/zoom broke the follow — clear it upstream. */
  onFollowBroken: () => void;
}

export class TownRenderer {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private raf = 0;
  private cssW = 1;
  private cssH = 1;

  // camera
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private autoFit = true;

  // interaction
  private mouse: Vec | null = null;
  private dragging = false;
  private dragStart: Vec = { x: 0, y: 0 };
  private dragMoved = false;
  private hoverId: string | null = null;

  // minimap (bottom-left, only while the viewport crops the town)
  private miniRect: { x: number; y: number; w: number; h: number } | null = null;
  private miniDragging = false;

  // held camera keys (arrows pan, +/- zoom), applied per-frame for smoothness
  private camKeys = new Set<string>();

  // animation
  private smooth = new Map<string, Vec>();
  private trails: Trail[] = [];
  private floaters: Floater[] = [];
  private prevStats = new Map<string, { revenue: number; received: number; produced: number }>();
  private lastFrame = performance.now();
  private lastSeenTick = 0;
  private lastSeenSeed = NaN;

  constructor(
    private canvas: HTMLCanvasElement,
    private getState: () => GameState,
    private cb: RendererCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bindEvents();
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unbindEvents();
  }

  // --- sizing -----------------------------------------------------------
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
  }
  private dpr = 1;

  // --- camera (auto-fits to the town's bounding box) --------------------
  private view = { scale: 1, cx: 65, cy: 46, minX: 0, minY: 0, maxX: 1, maxY: 1 };

  private updateView(s: GameState): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      if (f.location.x < minX) minX = f.location.x;
      if (f.location.y < minY) minY = f.location.y;
      if (f.location.x > maxX) maxX = f.location.x;
      if (f.location.y > maxY) maxY = f.location.y;
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = s.config.mapWidth; maxY = s.config.mapHeight; }
    const padW = 14, padH = 12;
    minX -= padW; maxX += padW; minY -= padH; maxY += padH;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const margin = 24;
    this.view.scale = Math.min((this.cssW - margin) / w, (this.cssH - margin) / h);
    this.view.cx = (minX + maxX) / 2;
    this.view.cy = (minY + maxY) / 2;
    this.view.minX = minX; this.view.minY = minY; this.view.maxX = maxX; this.view.maxY = maxY;
  }

  private effScale(): number { return this.view.scale * this.zoom; }

  // --- camera glide to off-screen selections ----------------------------
  private lastSel: string | null = null;
  private camGlide: Vec | null = null;

  /** Where a selectable entity stands right now (facilities, citizens,
   * vehicles — firms have no location). */
  private entityLocation(s: GameState, id: string): Vec | null {
    return s.facilities[id]?.location
      ?? s.citizens[id]?.currentLocation
      ?? s.vehicles[id]?.currentLocation
      ?? null;
  }

  /**
   * When something gets selected from a list (event log, tables) while it
   * sits off-screen, glide the camera to it — "click it and the map takes
   * you there". Map-click selections are already on-screen and never move
   * the camera. Any manual drag/wheel cancels the glide.
   */
  private trackSelection(s: GameState, dt: number): void {
    // Follow mode: keep the glide target pinned on the followed citizen
    // every frame — the eased pan below does the cinematography. Any manual
    // drag/wheel/arrow input breaks the follow (see those handlers).
    const followId = this.cb.getFollowId();
    if (followId) {
      const cit = s.citizens[followId];
      if (!cit) {
        this.cb.onFollowBroken();
      } else {
        this.camGlide = { x: cit.currentLocation.x, y: cit.currentLocation.y };
        this.autoFit = false;
      }
    }
    const sel = this.cb.getSelectedId();
    if (sel !== this.lastSel) {
      this.lastSel = sel;
      if (sel) {
        const loc = this.entityLocation(s, sel);
        if (loc) {
          const sp = this.w2s(s, loc);
          const m = 8;
          if (sp.x < m || sp.y < m || sp.x > this.cssW - m || sp.y > this.cssH - m) {
            this.camGlide = { x: loc.x, y: loc.y };
            this.autoFit = false;
          }
        }
      }
    }
    if (this.camGlide) {
      const sc = this.effScale();
      const tx = -(this.camGlide.x - this.view.cx) * sc;
      const ty = -(this.camGlide.y - this.view.cy) * sc;
      const k = Math.min(1, dt * 6);
      this.panX += (tx - this.panX) * k;
      this.panY += (ty - this.panY) * k;
      if (Math.hypot(tx - this.panX, ty - this.panY) < 1) this.camGlide = null;
    }
  }
  private w2s(_s: GameState, p: Vec): Vec {
    const sc = this.effScale();
    return {
      x: this.cssW / 2 + this.panX + (p.x - this.view.cx) * sc,
      y: this.cssH / 2 + this.panY + (p.y - this.view.cy) * sc,
    };
  }
  private s2w(_s: GameState, p: Vec): Vec {
    const sc = this.effScale();
    return {
      x: this.view.cx + (p.x - this.cssW / 2 - this.panX) / sc,
      y: this.view.cy + (p.y - this.cssH / 2 - this.panY) / sc,
    };
  }

  /**
   * The visible world rectangle (screen corners mapped back to world),
   * expanded by `margin` world units for per-entity culling. s2w is a pure
   * axis-aligned affine (no rotation), so the screen box maps to an
   * axis-aligned world box and a point-in-rect test is an exact cull.
   */
  private visibleWorldRect(
    s: GameState,
    margin: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    const a = this.s2w(s, { x: 0, y: 0 });
    const b = this.s2w(s, { x: this.cssW, y: this.cssH });
    return { minX: a.x - margin, minY: a.y - margin, maxX: b.x + margin, maxY: b.y + margin };
  }

  // --- events -----------------------------------------------------------
  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    c.addEventListener('mouseleave', this.onLeave);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }
  private unbindEvents(): void {
    const c = this.canvas;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    c.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private static readonly CAM_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_',
  ]);
  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!TownRenderer.CAM_KEYS.has(e.key)) return;
    e.preventDefault(); // arrows would scroll the page, +/- would zoom it
    this.camKeys.add(e.key);
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.camKeys.delete(e.key); };
  private onBlur = (): void => { this.camKeys.clear(); };

  /** Held-key camera: arrows pan, +/- zooms about the screen center. Runs
   * every frame so movement is dt-smooth instead of key-repeat-choppy. */
  private applyKeyCamera(s: GameState, dt: number): void {
    if (this.camKeys.size === 0) return;
    const k = this.camKeys;
    const pan = 480 * dt;
    let dx = 0, dy = 0;
    if (k.has('ArrowLeft')) dx += pan;
    if (k.has('ArrowRight')) dx -= pan;
    if (k.has('ArrowUp')) dy += pan;
    if (k.has('ArrowDown')) dy -= pan;
    const zin = k.has('+') || k.has('=');
    const zout = k.has('-') || k.has('_');
    if (!dx && !dy && zin === zout) return;
    this.autoFit = false;
    this.camGlide = null;
    this.cb.onFollowBroken();
    this.panX += dx;
    this.panY += dy;
    if (zin !== zout) {
      const m = { x: this.cssW / 2, y: this.cssH / 2 };
      const before = this.s2w(s, m);
      this.zoom = Math.max(0.4, Math.min(6, this.zoom * Math.exp((zin ? 1.6 : -1.6) * dt)));
      const after = this.w2s(s, before);
      this.panX += m.x - after.x;
      this.panY += m.y - after.y;
    }
  }
  private localMouse(e: MouseEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.getState();
    this.updateView(s);
    const m = this.localMouse(e);
    const before = this.s2w(s, m);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoom = Math.max(0.4, Math.min(6, this.zoom * factor));
    this.autoFit = false;
    this.camGlide = null;
    this.cb.onFollowBroken();
    const after = this.w2s(s, before);
    this.panX += m.x - after.x;
    this.panY += m.y - after.y;
  };
  private onDown = (e: MouseEvent): void => {
    const m = this.localMouse(e);
    if (this.miniHit(m)) {
      // Minimap navigation wins over map interaction (including build mode).
      this.miniDragging = true;
      this.miniNavigate(m);
      return;
    }
    this.camGlide = null;
    this.cb.onFollowBroken();
    this.dragging = true;
    this.dragMoved = false;
    this.dragStart = m;
  };
  private onMove = (e: MouseEvent): void => {
    const m = this.localMouse(e);
    this.mouse = m;
    if (this.miniDragging) {
      this.miniNavigate(m);
      return;
    }
    if (this.dragging) {
      const dx = m.x - this.dragStart.x;
      const dy = m.y - this.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.panX += m.x - this.dragStart.x;
      this.panY += m.y - this.dragStart.y;
      this.dragStart = m;
      this.autoFit = false;
    }
  };
  private onUp = (e: MouseEvent): void => {
    if (this.miniDragging) { this.miniDragging = false; return; }
    if (this.dragging && !this.dragMoved) this.handleClick(this.localMouse(e));
    this.dragging = false;
  };
  private onLeave = (): void => { this.mouse = null; };

  private handleClick(m: Vec): void {
    const s = this.getState();
    if (this.cb.getBuildMode()) {
      this.cb.onBuildAt(this.s2w(s, m));
      return;
    }
    this.cb.onPick(this.pick(s, m));
  }

  private pick(s: GameState, m: Vec): string | null {
    this.updateView(s);
    const best = { id: null as string | null, d: Infinity };
    const consider = (id: string, p: Vec, r: number) => {
      const sp = this.w2s(s, p);
      const d = Math.hypot(sp.x - m.x, sp.y - m.y);
      if (d <= r && d < best.d) { best.id = id; best.d = d; }
    };
    const psc = this.effScale();
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      consider(id, this.drawPos(id, f.location), Math.max(11, (f.type === 'home' ? 1.7 : 2.9) * psc));
    }
    for (const id in s.vehicles) {
      const v = s.vehicles[id]!;
      if (v.status === 'enroute') consider(id, this.drawPos(id, v.currentLocation), 10);
    }
    for (const id in s.citizens) consider(id, this.drawPos(id, s.citizens[id]!.currentLocation), 7);
    return best.id;
  }

  // --- smoothing --------------------------------------------------------
  private drawPos(id: string, live: Vec): Vec {
    let cur = this.smooth.get(id);
    if (!cur) { cur = { x: live.x, y: live.y }; this.smooth.set(id, cur); }
    return cur;
  }
  private ease(id: string, live: Vec, k: number): Vec {
    const cur = this.drawPos(id, live);
    cur.x += (live.x - cur.x) * k;
    cur.y += (live.y - cur.y) * k;
    return cur;
  }

  // --- main loop --------------------------------------------------------
  private loggedDrawError = false;

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try {
      this.render(dt);
    } catch (err) {
      // Never let a draw error kill the loop — but never hide it either.
      if (!this.loggedDrawError) {
        this.loggedDrawError = true;
        console.error('TownRenderer draw error (logged once):', err);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private render(dt: number): void {
    const s = this.getState();
    // Detect a New game / Load (tick jumped back or seed changed) and clear the
    // animation caches so entities don't slide in from stale positions.
    if (s.seed !== this.lastSeenSeed || s.tick < this.lastSeenTick) {
      this.smooth.clear();
      this.prevStats.clear();
      this.floaters.length = 0;
      this.trails.length = 0;
    }
    this.lastSeenSeed = s.seed;
    this.lastSeenTick = s.tick;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.autoFit) { this.panX = 0; this.panY = 0; }
    this.updateView(s);
    this.applyKeyCamera(s, dt);
    this.trackSelection(s, dt);

    const time = computeTime(s.tick, s.config);
    this.smokeT += dt * 1000;
    this.drawGround(s, time.hour);
    this.drawRoads(s);
    this.drawAmbientCrowd(s);
    if (this.cb.getFlowOverlay()) this.drawFlowOverlay(s, dt);
    this.drawFacilities(s, time.hour);
    this.drawShipments(s, dt);
    this.drawCitizens(s, dt);
    this.updateFloaters(s, dt);
    this.drawFloaters();
    this.drawNightTint(time.hour);
    this.drawNightLights(s, time.hour);
    this.drawWorldEventAmbiance(s, dt);
    if (this.cb.getBuildMode()) {
      this.drawLandValueOverlay(s);
      this.drawBuildGhost(s, time.hour);
    }
    this.drawHud(time);
    this.drawMinimap(s);
    this.drawHover(s);
  }

  // --- supply-chain flow overlay (F) --------------------------------------
  private flowDash = 0;

  /**
   * Every active contract as a curved arrow, width scaled by shipment volume,
   * player routes in accent blue and AI routes muted; warehouses with export
   * activity get a dashed lane running off the east edge toward Port Rosa.
   */
  private drawFlowOverlay(s: GameState, dt: number): void {
    const ctx = this.ctx;
    this.flowDash = (this.flowDash + dt * 0.012) % 24;

    const route = (
      from: Vec, to: Vec, width: number, color: string, dashed: boolean,
    ): void => {
      const a = this.w2s(s, from);
      const b = this.w2s(s, to);
      // Curve control point: perpendicular offset so parallel routes separate.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const cxp = mx - (dy / len) * Math.min(30, len * 0.18);
      const cyp = my + (dx / len) * Math.min(30, len * 0.18);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.setLineDash(dashed ? [8, 8] : [12, 12]);
      ctx.lineDashOffset = -this.flowDash;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cxp, cyp, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead at the destination.
      const tx = b.x - cxp, ty = b.y - cyp;
      const tlen = Math.max(1, Math.hypot(tx, ty));
      const ux = tx / tlen, uy = ty / tlen;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * 8 - uy * 4, b.y - uy * 8 + ux * 4);
      ctx.lineTo(b.x - ux * 8 + uy * 4, b.y - uy * 8 - ux * 4);
      ctx.closePath();
      ctx.fill();
    };

    for (const cid in s.contracts) {
      const c = s.contracts[cid]!;
      if (!c.active) continue;
      const src = s.facilities[c.sourceFacilityId];
      const dst = s.facilities[c.destinationFacilityId];
      if (!src || !dst) continue;
      const isPlayer = c.ownerFirmId === s.playerFirmId;
      const width = Math.min(4.5, 1.2 + c.targetQuantity / 25);
      // Wholesale (cross-firm, non-importer) routes glow amber — money is
      // changing hands between firms along these lines.
      const wholesale = src.type !== 'importer' && src.ownerFirmId !== dst.ownerFirmId;
      const playerInvolved = isPlayer || src.ownerFirmId === s.playerFirmId;
      const color = wholesale
        ? (playerInvolved ? 'rgba(255,190,90,0.8)' : 'rgba(220,180,120,0.4)')
        : isPlayer ? 'rgba(90,170,255,0.75)' : 'rgba(170,180,200,0.35)';
      route(src.location, dst.location, width, color, wholesale);
    }

    // Export lanes: any warehouse with a standing order or shipped units today.
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type !== 'warehouse') continue;
      const exporting = Object.keys(f.exportOrders).length > 0 || f.dailyStats.unitsShipped > 0;
      if (!exporting) continue;
      const isPlayer = f.ownerFirmId === s.playerFirmId;
      route(
        f.location,
        { x: s.config.mapWidth + 6, y: Math.min(f.location.y, 20) },
        1.8,
        isPlayer ? 'rgba(120,220,180,0.7)' : 'rgba(150,190,170,0.35)',
        true,
      );
    }
  }

  // --- land-value overlay (placement mode) -------------------------------
  private landGrid: { key: string; step: number; cols: number; rows: number; v: Float32Array } | null = null;

  /** Sampled land-value grid, cached until homes/residents change. */
  private landValues(s: GameState): NonNullable<TownRenderer['landGrid']> {
    let homes = 0, residents = 0;
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type === 'home') { homes += 1; residents += f.residentIds.length; }
    }
    const key = `${homes}:${residents}:${s.seed}`;
    if (this.landGrid && this.landGrid.key === key) return this.landGrid;
    const step = 4;
    const cols = Math.ceil(s.config.mapWidth / step) + 1;
    const rows = Math.ceil(s.config.mapHeight / step) + 1;
    const v = new Float32Array(cols * rows);
    // Snapshot the homes once and sample every cell against it (A4): the grid is
    // thousands of queries over one unchanged home set, so building the index once
    // turns an O(cols×rows×facilities) sweep into O(facilities + cols×rows×homes).
    // landValueFromIndex is byte-identical to the per-cell landValueAt it replaces,
    // so the overlay is pixel-for-pixel unchanged.
    const homeIndex = buildHomeIndex(s);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        v[gy * cols + gx] = landValueFromIndex(homeIndex, { x: gx * step, y: gy * step });
      }
    }
    this.landGrid = { key, step, cols, rows, v };
    return this.landGrid;
  }

  /** Green (cheap) → red (premium) wash while the player is placing a building. */
  private drawLandValueOverlay(s: GameState): void {
    const grid = this.landValues(s);
    const ctx = this.ctx;
    const sc = this.effScale();
    ctx.save();
    for (let gy = 0; gy < grid.rows; gy++) {
      for (let gx = 0; gx < grid.cols; gx++) {
        const lv = grid.v[gy * grid.cols + gx]!;
        const p = this.w2s(s, { x: gx * grid.step, y: gy * grid.step });
        const size = grid.step * sc;
        if (p.x < -size || p.y < -size || p.x > this.cssW + size || p.y > this.cssH + size) continue;
        // Hue 120 (green) → 0 (red); stronger alpha where pricier.
        ctx.fillStyle = `hsla(${120 - lv * 120}, 75%, 45%, ${0.08 + lv * 0.16})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }
    ctx.restore();
    // Legend chip.
    ctx.save();
    ctx.fillStyle = 'rgba(13,17,23,0.8)';
    ctx.fillRect(this.cssW / 2 - 130, 8, 260, 22);
    ctx.fillStyle = '#e6edf3';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Land value: green = cheap (0.8×) · red = premium (1.6×)', this.cssW / 2, 23);
    ctx.restore();
  }

  /**
   * Cursor ghost while placing: the actual 2.5D building at ~65% opacity with
   * the land-adjusted price at that spot, so location cost is felt before the
   * click instead of discovered after it.
   */
  private drawBuildGhost(s: GameState, hour: number): void {
    const defId = this.cb.getBuildDefId();
    if (!defId || !this.mouse) return;
    const def = getFacilityDef(defId as Parameters<typeof getFacilityDef>[0]);
    const world = this.s2w(s, this.mouse);
    if (world.x < this.view.minX || world.x > this.view.maxX ||
        world.y < this.view.minY || world.y > this.view.maxY) return;

    const ctx = this.ctx;
    const sc = this.effScale();
    const isApartment = defId === 'apartment';
    const size = (isApartment ? 2.0 : def.type === 'home' ? 1.45 : 2.6) * sc;
    const sp = this.mouse;
    const cost = Math.round(def.buildCost * landCostMultiplier(landValueAt(s, world)));
    const cash = s.firms[s.playerFirmId]?.cash ?? 0;
    const blocker = placementBlocker(s, world);
    const affordable = cash >= cost && !blocker;

    ctx.save();
    ctx.globalAlpha = blocker ? 0.4 : 0.65;
    ctx.fillStyle = 'rgba(28,38,32,0.28)';
    ctx.beginPath();
    ctx.ellipse(sp.x + size * 0.25, sp.y + size * 0.42, size * 1.15, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    drawBuilding(def.type, defId, {
      ctx,
      x: sp.x,
      y: sp.y + size * 0.4,
      w: size,
      fill: isApartment ? APARTMENT_FILL : BUILDING_FILL[def.type],
      closed: false,
      player: true,
      level: 1,
      night: Math.max(0, this.nightAmount(hour) - 0.2),
    });
    ctx.restore();

    // price chip under the ghost — red when blocked or unaffordable
    const label = blocker ? `Too close to ${blocker.name}` : formatMoney(cost);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width;
    const cy = sp.y + size * 0.75;
    ctx.fillStyle = affordable ? 'rgba(8,12,18,0.78)' : 'rgba(60,12,12,0.85)';
    this.roundRectPath(sp.x - tw / 2 - 6, cy, tw + 12, 17, 4); ctx.fill();
    ctx.strokeStyle = affordable ? 'rgba(126,231,135,0.5)' : 'rgba(248,113,113,0.7)';
    ctx.lineWidth = 1;
    this.roundRectPath(sp.x - tw / 2 - 6, cy, tw + 12, 17, 4); ctx.stroke();
    ctx.fillStyle = affordable ? '#7ee787' : '#f87171';
    ctx.fillText(label, sp.x, cy + 3);
  }

  // --- world-event ambiance ---------------------------------------------
  /** Full-canvas color washes per active world event (drought = dry sepia,
   * recession = gray, boom = golden…), plus drifting smog during fuel spikes.
   * Purely cosmetic; reads the same state.worldEvents the ticker shows. */
  private static readonly EVENT_TINTS: Record<string, string> = {
    drought: 'rgba(190,130,40,0.10)',
    bumper_harvest: 'rgba(70,190,90,0.06)',
    recession: 'rgba(110,115,125,0.13)',
    boom: 'rgba(255,205,90,0.07)',
    fuel_spike: 'rgba(80,70,55,0.12)',
    mine_collapse: 'rgba(130,105,80,0.10)',
    rich_vein: 'rgba(90,220,220,0.05)',
    tariffs: 'rgba(70,110,170,0.06)',
    coffee_craze: 'rgba(160,110,60,0.05)',
    trade_fair: 'rgba(120,190,210,0.05)',
  };

  private smogT = 0;

  /** Subtle seasonal ground wash (under the event tints). */
  private static readonly SEASON_TINTS: Record<string, string> = {
    spring: 'rgba(110,200,110,0.05)',
    summer: 'rgba(240,220,110,0.05)',
    autumn: 'rgba(220,150,70,0.07)',
    winter: 'rgba(190,210,240,0.10)',
  };

  private weatherT = 0;

  /** Snow all winter; light drizzle on ~30% of spring days. Pure decoration. */
  private drawWeather(s: GameState, dt: number): void {
    const season = seasonOf(s);
    const day = Math.floor(s.tick / (s.config.ticksPerHour * 24));
    const rainy =
      season === 'spring' && (Math.imul(day ^ s.seed, 2654435761) >>> 28) < 5;
    if (season !== 'winter' && !rainy) return;
    this.weatherT += dt;
    const ctx = this.ctx;
    ctx.save();
    if (season === 'winter') {
      ctx.fillStyle = 'rgba(235,242,255,0.75)';
      for (let i = 0; i < 70; i++) {
        const h = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
        const speed = 18 + h * 26;
        const x = (h * this.cssW + Math.sin(this.weatherT / 1400 + i) * 24 + this.cssW) % this.cssW;
        const y = (h * 7919 + (this.weatherT / 1000) * speed) % (this.cssH + 8);
        ctx.globalAlpha = 0.35 + h * 0.4;
        ctx.beginPath();
        ctx.arc(x, y, 1 + h * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(140,180,230,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 45; i++) {
        const h = (Math.imul(i + 7, 2654435761) >>> 0) / 4294967296;
        const x = (h * this.cssW + this.weatherT / 90) % this.cssW;
        const y = (h * 5417 + (this.weatherT / 1000) * (140 + h * 80)) % (this.cssH + 12);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1.5, y + 7);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawWorldEventAmbiance(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const seasonTint = TownRenderer.SEASON_TINTS[seasonOf(s)];
    if (seasonTint) {
      ctx.fillStyle = seasonTint;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    this.drawWeather(s, dt);
    if (s.worldEvents.length === 0) return;
    let smog = false;
    for (const ev of s.worldEvents) {
      const tint = TownRenderer.EVENT_TINTS[ev.defId];
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
      }
      if (ev.defId === 'fuel_spike') smog = true;
    }
    if (smog) {
      this.smogT += dt;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const px = ((this.smogT * (8 + i * 3)) / 1000 + i * 137) % (this.cssW + 240) - 120;
        const py = this.cssH * (0.12 + 0.17 * i) + Math.sin(this.smogT / 2600 + i * 2) * 12;
        ctx.globalAlpha = 0.05 + 0.02 * Math.sin(this.smogT / 1900 + i);
        ctx.fillStyle = '#8a8070';
        ctx.beginPath();
        ctx.ellipse(px, py, 90 + i * 18, 22 + i * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // --- layers -----------------------------------------------------------
  private decor: { x: number; y: number; r: number }[] = [];
  private decorKey = '';

  private buildDecor(s: GameState): void {
    const key = `${Math.round(this.view.minX)},${Math.round(this.view.maxX)},${Object.keys(s.facilities).length}`;
    if (key === this.decorKey) return;
    this.decorKey = key;
    // deterministic scatter (LCG) of trees/bushes in open ground
    const trees: { x: number; y: number; r: number }[] = [];
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const facs = Object.values(s.facilities);
    for (let i = 0; i < 130; i++) {
      const x = this.view.minX + rnd() * (this.view.maxX - this.view.minX);
      const y = this.view.minY + rnd() * (this.view.maxY - this.view.minY);
      let ok = true;
      for (const f of facs) {
        if (Math.abs(f.location.x - x) < 6 && Math.abs(f.location.y - y) < 6) { ok = false; break; }
      }
      if (ok) trees.push({ x, y, r: 0.9 + rnd() * 1.1 });
    }
    this.decor = trees;
  }

  /** Ground + tree palettes per season — winter is a real snowfield, not a
   * translucent wash that vanishes on bright grass. */
  private static readonly GROUND_BY_SEASON: Record<string, [string, string]> = {
    spring: ['#7fae62', '#6b9a51'],
    summer: ['#8db35e', '#78a04c'],
    autumn: ['#a5a058', '#8c8c48'],
    winter: ['#dde4ec', '#c5cfdb'],
  };
  private static readonly TREE_BY_SEASON: Record<string, [string, string, string]> = {
    spring: ['#3e7d3a', '#57994c', 'rgba(200,235,170,0.5)'],
    summer: ['#3a7434', '#549145', 'rgba(210,230,150,0.5)'],
    autumn: ['#8a5f2a', '#b07c33', 'rgba(240,200,120,0.55)'],
    winter: ['#49624f', '#5d7a62', 'rgba(240,246,255,0.85)'],
  };

  private drawGround(s: GameState, _hour: number): void {
    const ctx = this.ctx;
    const season = seasonOf(s);
    const winter = season === 'winter';
    // Beyond the town plate: muted neutral so the daylight plate pops.
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const tl = this.w2s(s, { x: this.view.minX, y: this.view.minY });
    const br = this.w2s(s, { x: this.view.maxX, y: this.view.maxY });
    const gw = br.x - tl.x, gh = br.y - tl.y;
    const [g0, g1] = TownRenderer.GROUND_BY_SEASON[season]!;
    const grad = ctx.createLinearGradient(0, tl.y, 0, br.y);
    grad.addColorStop(0, g0);
    grad.addColorStop(1, g1);
    ctx.fillStyle = grad;
    this.roundRectPathRaw(ctx, tl.x, tl.y, gw, gh, 14); ctx.fill();

    ctx.save();
    ctx.beginPath(); this.roundRectPathRaw(ctx, tl.x, tl.y, gw, gh, 14); ctx.clip();

    // mowing stripes give the grass texture; on snow they read as drifts
    const sc = this.effScale();
    const stripeH = 6 * sc;
    ctx.fillStyle = winter ? 'rgba(160,180,210,0.05)' : 'rgba(255,255,255,0.035)';
    for (let y = tl.y, i = 0; y < br.y; y += stripeH, i++) {
      if (i % 2 === 0) ctx.fillRect(tl.x, y, gw, stripeH);
    }

    // district washes: warm paving near shops, dusty ground near industry
    const zone = (wx: number, wy: number, rad: number, color: string) => {
      const c = this.w2s(s, { x: wx, y: wy });
      const rr = rad * sc;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rr);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill();
    };
    if (!winter) zone(40, 70, 36, 'rgba(190,215,150,0.20)');  // residential lawns
    zone(55, 22, 40, winter ? 'rgba(140,145,155,0.20)' : 'rgba(180,150,105,0.22)');  // industrial dust
    zone(62, 46, 30, 'rgba(205,200,185,0.25)');  // commercial paving

    // farm plots: tilled field rows + fence around every farm
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type !== 'farm') continue;
      const c = this.w2s(s, f.location);
      const pw = 11 * sc, ph = 7.5 * sc;
      ctx.fillStyle = winter ? '#c2bcae' : '#a58757';
      this.roundRectPathRaw(ctx, c.x - pw, c.y - ph * 0.4, pw * 2, ph * 1.6, 4 * sc * 0.2 + 3);
      ctx.fill();
      // crop rows (snow settles between the furrows in winter)
      ctx.strokeStyle = winter ? 'rgba(235,241,248,0.8)' : 'rgba(122,158,82,0.9)';
      ctx.lineWidth = Math.max(1.2, sc * 0.55);
      const rows = 5;
      for (let i = 1; i <= rows; i++) {
        const yy = c.y - ph * 0.4 + (ph * 1.6 * i) / (rows + 1);
        ctx.beginPath(); ctx.moveTo(c.x - pw * 0.9, yy); ctx.lineTo(c.x + pw * 0.9, yy); ctx.stroke();
      }
      // fence
      ctx.strokeStyle = 'rgba(120,90,55,0.8)';
      ctx.lineWidth = Math.max(1, sc * 0.2);
      this.roundRectPathRaw(ctx, c.x - pw, c.y - ph * 0.4, pw * 2, ph * 1.6, 3);
      ctx.stroke();
    }

    // retail plaza: light paving under the shopping cluster
    let rx = 0, ry = 0, rn = 0;
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type === 'retail') { rx += f.location.x; ry += f.location.y; rn++; }
    }
    if (rn > 0) {
      const c = this.w2s(s, { x: rx / rn, y: ry / rn });
      const rr = 14 * sc;
      ctx.fillStyle = 'rgba(214,209,196,0.55)';
      this.roundRectPathRaw(ctx, c.x - rr, c.y - rr * 0.62, rr * 2, rr * 1.24, 8);
      ctx.fill();
      // paving joints
      ctx.strokeStyle = 'rgba(150,145,132,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const xx = c.x - rr + (rr * 2 * i) / 4;
        ctx.beginPath(); ctx.moveTo(xx, c.y - rr * 0.62); ctx.lineTo(xx, c.y + rr * 0.62); ctx.stroke();
      }
    }

    // trees: trunk + layered canopy, tinted by season (snow-capped in winter)
    this.buildDecor(s);
    const [c0, c1, hi] = TownRenderer.TREE_BY_SEASON[season]!;
    for (const t of this.decor) {
      const p = this.w2s(s, t);
      const rr = Math.max(2, t.r * sc * 0.55);
      ctx.fillStyle = winter ? 'rgba(60,75,95,0.25)' : 'rgba(40,70,35,0.30)';
      ctx.beginPath(); ctx.ellipse(p.x + rr * 0.3, p.y + rr * 0.75, rr * 0.9, rr * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6d4c33';
      ctx.fillRect(p.x - rr * 0.12, p.y - rr * 0.1, rr * 0.24, rr * 0.8);
      ctx.fillStyle = c0;
      ctx.beginPath(); ctx.arc(p.x, p.y - rr * 0.35, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.arc(p.x - rr * 0.25, p.y - rr * 0.55, rr * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath(); ctx.arc(p.x - rr * 0.35, p.y - rr * 0.7, rr * (winter ? 0.42 : 0.3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // gentle vignette (much lighter than the old night-forest look)
    const vg = ctx.createRadialGradient(
      this.cssW / 2, this.cssH / 2, Math.min(this.cssW, this.cssH) * 0.35,
      this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.8,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,15,25,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  /** The street grid in world coordinates — single source of truth for road
   * drawing, streetlamps, and truck routing. */
  private roadGrid(): { x0: number; x1: number; y0: number; y1: number; hYs: number[]; vXs: number[] } {
    const { minX, minY, maxX, maxY } = this.view;
    const insetX = (maxX - minX) * 0.08, insetY = (maxY - minY) * 0.08;
    const x0 = minX + insetX, x1 = maxX - insetX, y0 = minY + insetY, y1 = maxY - insetY;
    return {
      x0, x1, y0, y1,
      hYs: [y0, (y0 + y1) / 2, y1],
      vXs: [x0, x0 + (x1 - x0) / 3, x0 + (2 * (x1 - x0)) / 3, x1],
    };
  }

  private drawRoads(s: GameState): void {
    const ctx = this.ctx;
    const sc = this.effScale();
    const roadW = Math.max(3, sc * 2.2);
    const { x0, x1, y0, y1, hYs, vXs } = this.roadGrid();

    const road = (ax: number, ay: number, bx: number, by: number) => {
      const a = this.w2s(s, { x: ax, y: ay }), b = this.w2s(s, { x: bx, y: by });
      ctx.lineCap = 'round';
      // sidewalks first (wider light band under the asphalt)
      ctx.strokeStyle = 'rgba(206,201,188,0.85)'; ctx.lineWidth = roadW * 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // asphalt
      ctx.strokeStyle = '#565b61'; ctx.lineWidth = roadW;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // center line
      ctx.strokeStyle = 'rgba(235,225,180,0.7)'; ctx.lineWidth = Math.max(1, roadW * 0.09);
      ctx.setLineDash([7, 9]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    };
    // street grid
    for (const y of hYs) road(x0, y, x1, y);
    for (const x of vXs) road(x, y0, x, y1);

    // The highway east: the top avenue keeps going toward the trade cities,
    // fading out at the canvas edge, with a signpost naming where it leads —
    // Port Rosa and Ironvale are real places, not just numbers in a panel.
    {
      const exit = this.w2s(s, { x: x1, y: hYs[1]! }); // middle avenue: clear of top chrome
      const edgeX = this.cssW + 40;
      if (exit.x < this.cssW) {
        const grad = ctx.createLinearGradient(exit.x, 0, Math.min(edgeX, exit.x + 420), 0);
        grad.addColorStop(0, '#565b61');
        grad.addColorStop(1, 'rgba(86,91,97,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = roadW;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(exit.x, exit.y); ctx.lineTo(edgeX, exit.y); ctx.stroke();
        ctx.setLineDash([7, 9]);
        ctx.strokeStyle = 'rgba(235,225,180,0.45)';
        ctx.lineWidth = Math.max(1, roadW * 0.09);
        ctx.beginPath(); ctx.moveTo(exit.x, exit.y); ctx.lineTo(edgeX, exit.y); ctx.stroke();
        ctx.setLineDash([]);

        // signpost just past the last intersection, north side of the road
        const sc = this.effScale();
        const px = exit.x + sc * 2.2;
        const py = exit.y - roadW * 0.85;
        const k = Math.min(1.35, Math.max(0.8, sc / 9)); // gentle zoom scaling
        ctx.strokeStyle = '#6b5a43'; ctx.lineWidth = 2.5 * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 26 * k); ctx.stroke();
        ctx.font = `600 ${Math.round(9 * k)}px system-ui`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const boards: [string, number][] = [['Port Rosa →', -22], ['Ironvale →', -12]];
        for (const [label, dy] of boards) {
          const w = ctx.measureText(label).width + 10;
          ctx.fillStyle = '#7a6a50';
          this.roundRectPath(px - 2, py + dy * k - 6 * k, w, 12 * k, 2);
          ctx.fill();
          ctx.fillStyle = '#f2ead8';
          ctx.fillText(label, px + 3, py + dy * k);
        }
      }
    }

    // driveways for businesses only — homes sit on their residential streets,
    // and a driveway per house turned the neighborhoods into a picket fence.
    ctx.lineCap = 'round';
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      if (f.type === 'home') continue;
      let ny = hYs[0]!; for (const y of hYs) if (Math.abs(y - f.location.y) < Math.abs(ny - f.location.y)) ny = y;
      const a = this.w2s(s, f.location), bpt = this.w2s(s, { x: f.location.x, y: ny });
      ctx.strokeStyle = 'rgba(206,201,188,0.6)'; ctx.lineWidth = Math.max(3, roadW * 0.72);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bpt.x, bpt.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(125,130,136,0.9)'; ctx.lineWidth = Math.max(2, roadW * 0.5);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bpt.x, bpt.y); ctx.stroke();
    }
  }

  private smokeT = 0;

  /**
   * Ambient crowd density — the district-scale background of a city that has
   * cohort population beyond the simulated cast (world-scale roadmap A4). For
   * each district with residents we scatter faint pedestrian dots whose count
   * scales with that district's cohort population; positions come from a pure
   * hash of (district, day, tile, index), so the crowd is stable within a game
   * day (no per-frame flicker) and draws nothing from the sim rng.
   *
   * A Village has no cohort population (every cohort record stays dark), so
   * anyPop is 0 and this method draws nothing — the Village is pixel-identical
   * to before this layer existed. Only the tiles inside the visible rect are
   * ever visited, so a Metropolis costs no more than a Village once zoomed in.
   */
  private drawAmbientCrowd(s: GameState): void {
    const sc = this.effScale();
    if (lodEnabled(s) && sc < LOD_CITIZEN_SKIP_SCALE) return; // dots would be sub-pixel — skip
    const cohortIds = Object.keys(s.cohorts);
    if (cohortIds.length === 0) return;

    // Cohort population per district (summed across tiers).
    const popByDistrict: Record<string, number> = {};
    let anyPop = 0;
    for (const cid of cohortIds) {
      const co = s.cohorts[cid]!;
      if (co.population <= 0) continue;
      popByDistrict[co.districtId] = (popByDistrict[co.districtId] ?? 0) + co.population;
      anyPop += co.population;
    }
    if (anyPop === 0) return; // dark cohorts (Village) → identical to before

    const day = Math.floor(s.tick / (s.config.ticksPerHour * 24));
    const cull = this.visibleWorldRect(s, AMBIENT_TILE);
    const ctx = this.ctx;
    ctx.save();
    for (const did of Object.keys(popByDistrict).sort()) {
      const d = s.districts[did];
      if (!d) continue;
      const pop = popByDistrict[did]!;
      const b = d.bounds;
      // Visible tile span = district bounds ∩ viewport, in tile coordinates.
      const tx0 = Math.floor(Math.max(b.x, cull.minX) / AMBIENT_TILE);
      const ty0 = Math.floor(Math.max(b.y, cull.minY) / AMBIENT_TILE);
      const tx1 = Math.floor(Math.min(b.x + b.w, cull.maxX) / AMBIENT_TILE);
      const ty1 = Math.floor(Math.min(b.y + b.h, cull.maxY) / AMBIENT_TILE);
      if (tx1 < tx0 || ty1 < ty0) continue;
      // Dots-per-tile from the WHOLE district's tile count, so density tracks
      // population regardless of how much of the district is on screen.
      const tilesW = Math.max(1, Math.ceil(b.w / AMBIENT_TILE));
      const tilesH = Math.max(1, Math.ceil(b.h / AMBIENT_TILE));
      const perTile = pop / AMBIENT_PEOPLE_PER_DOT / (tilesW * tilesH);
      const seed = strSeed(did) ^ (s.seed | 0);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          // Whole dots + a hashed fractional carry so sparse density still reads.
          let n = Math.floor(perTile);
          const carry = perTile - n;
          if (carry > 0 && hashInts(seed, day, tx, ty, 7) < carry) n += 1;
          if (n > AMBIENT_MAX_DOTS_PER_TILE) n = AMBIENT_MAX_DOTS_PER_TILE;
          for (let i = 0; i < n; i++) {
            const wx = tx * AMBIENT_TILE + hashInts(seed, day, tx, ty, i * 2 + 1) * AMBIENT_TILE;
            const wy = ty * AMBIENT_TILE + hashInts(seed, day, tx, ty, i * 2 + 2) * AMBIENT_TILE;
            if (wx < b.x || wx >= b.x + b.w || wy < b.y || wy >= b.y + b.h) continue;
            const sp = this.w2s(s, { x: wx, y: wy });
            const r = Math.max(0.8, sc * 0.16);
            ctx.globalAlpha = 0.26 + hashInts(seed, day, tx, ty, i + 40) * 0.22;
            ctx.fillStyle = '#c7cdd6';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawFacilities(s: GameState, hour: number): void {
    const ctx = this.ctx;
    const selected = this.cb.getSelectedId();
    const night = Math.max(0, this.nightAmount(hour) - 0.2);
    // Painter's order: draw north-most first so nearer buildings overlap
    // correctly in the oblique projection.
    const order = Object.keys(s.facilities).sort(
      (a, b) => s.facilities[a]!.location.y - s.facilities[b]!.location.y,
    );
    const cull = this.visibleWorldRect(s, FACILITY_CULL_MARGIN);
    const lod = lodEnabled(s) && this.effScale() < LOD_GLYPH_SCALE;
    for (const id of order) {
      const f = s.facilities[id]!;
      const p = this.drawPos(id, f.location);
      // Viewport cull: skip anything whose ground anchor is outside the visible
      // rect (+ margin for building height). This is the big-map win — on a
      // 260×184 city only the on-screen buildings pay for their 2.5-D draw.
      if (p.x < cull.minX || p.x > cull.maxX || p.y < cull.minY || p.y > cull.maxY) continue;
      const sp = this.w2s(s, p);
      const isHome = f.type === 'home';
      const isApartment = f.defId === 'apartment';
      // World-proportional size: buildings occupy real ground, so zooming in
      // makes them big and detailed instead of leaving miniatures on huge
      // lots. (~2.6 world units half-width ≈ the old 18px at the fit view.)
      const sc = this.effScale();
      const size = (isApartment ? 2.0 : isHome ? 1.45 : 2.6) * sc;
      const player = f.ownerFirmId === s.playerFirmId;
      const sel = id === selected || id === this.hoverId;

      // LOD: zoomed far out, collapse the 2.5-D kit to a flat footprint glyph
      // — no shadow, extruded body, chimney smoke, upgrade pips, status dot or
      // label (all of which are illegible at this scale and dominate frame
      // time when there are hundreds of buildings on a city map).
      if (lod) {
        if (sel) {
          ctx.beginPath();
          ctx.ellipse(sp.x, sp.y, size * 1.15, size * 0.95, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(88,166,255,0.30)'; ctx.fill();
        }
        const gw = size * 1.3;
        const gr = Math.max(1, size * 0.28);
        ctx.fillStyle = isApartment ? APARTMENT_FILL : BUILDING_FILL[f.type];
        this.roundRectPathRaw(ctx, sp.x - gw / 2, sp.y - gw / 2, gw, gw, gr); ctx.fill();
        if (player) {
          ctx.strokeStyle = 'rgba(88,166,255,0.9)'; ctx.lineWidth = 1;
          this.roundRectPathRaw(ctx, sp.x - gw / 2, sp.y - gw / 2, gw, gw, gr); ctx.stroke();
        }
        continue;
      }

      // ground shadow (anchored at the building's base)
      ctx.save();
      ctx.fillStyle = 'rgba(28,38,32,0.28)';
      ctx.beginPath();
      ctx.ellipse(sp.x + size * 0.25, sp.y + size * 0.42, size * 1.15, size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (sel) {
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y + size * 0.3, size * 1.5, size * 0.65, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(88,166,255,0.30)'; ctx.fill();
      }

      // the building itself (anchor = ground line, so base sits at sp.y+size*0.4)
      drawBuilding(f.type, f.defId, {
        ctx,
        x: sp.x,
        y: sp.y + size * 0.4,
        w: size,
        fill: isApartment ? APARTMENT_FILL : BUILDING_FILL[f.type],
        closed: f.status === 'closed',
        player,
        level: f.level,
        night: f.status === 'closed' ? 0 : night,
      });

      // chimney smoke while a factory is actually producing
      if (f.type === 'factory' && f.status === 'active') {
        const chx = sp.x + size * (0.95 + (f.level - 1) * 0.12) * 0.55 + size * 0.12;
        const chy = sp.y + size * 0.4 - size * (0.95 + (f.level - 1) * 0.22) - size * 0.75;
        ctx.save();
        for (let i = 0; i < 3; i++) {
          const t = (this.smokeT / 1000 + i * 0.7) % 2.1;
          const a = Math.max(0, 0.34 - t * 0.16);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = '#d7d7d2';
          ctx.beginPath();
          ctx.arc(chx + Math.sin(t * 2 + i) * size * 0.14 + t * size * 0.2, chy - t * size * 0.75, size * (0.14 + t * 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Upgrade pips stay as a quick-read cue on top of the physical growth.
      if (f.level > 1) {
        ctx.fillStyle = '#f0c040';
        for (let li = 0; li < f.level - 1; li++) {
          ctx.beginPath();
          ctx.arc(sp.x - size * 0.3 + li * size * 0.35, sp.y - size * 1.7, Math.max(1.4, size * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (!isHome) {
        ctx.beginPath(); ctx.arc(sp.x + size + 3, sp.y - size * 1.1, Math.max(3.6, size * 0.18), 0, Math.PI * 2);
        ctx.fillStyle = this.statusColor(f.status); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        // label with readable backdrop (grows a little with zoom)
        const fpx = Math.min(13, Math.round(10 * Math.max(1, sc / 7)));
        ctx.font = `600 ${fpx}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const tw = ctx.measureText(f.name).width;
        ctx.fillStyle = 'rgba(8,12,18,0.6)';
        this.roundRectPath(sp.x - tw / 2 - 4, sp.y + size * 0.65, tw + 8, fpx + 3, 3); ctx.fill();
        ctx.fillStyle = '#f2f6fa';
        ctx.fillText(f.name, sp.x, sp.y + size * 0.65 + 2);
      }
    }

  }

  /**
   * Light pass drawn AFTER the night tint so glows punch through the dark
   * instead of being dimmed by it — streetlamps along the avenues plus warm
   * halos around every lit building. 'screen' composite keeps it luminous.
   */
  private drawNightLights(s: GameState, hour: number): void {
    const night = Math.max(0, this.nightAmount(hour) - 0.2);
    if (night <= 0.12) return;
    const ctx = this.ctx;
    const sc = this.effScale();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // streetlamps along the three avenues
    const g = this.roadGrid();
    const lampR = Math.max(14, sc * 2.4);
    for (const ly of g.hYs) {
      for (let lx = g.x0 + 6; lx < g.x1; lx += 14) {
        const lp = this.w2s(s, { x: lx, y: ly });
        // Cull offscreen lamps (their glow radius is the margin).
        if (lp.x < -lampR || lp.y < -lampR || lp.x > this.cssW + lampR || lp.y > this.cssH + lampR) continue;
        const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lampR);
        g.addColorStop(0, `rgba(255,214,130,${0.34 * night})`);
        g.addColorStop(1, 'rgba(255,214,130,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lp.x, lp.y, lampR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,240,190,${Math.min(1, night * 1.6)})`;
        ctx.beginPath(); ctx.arc(lp.x, lp.y - lampR * 0.35, Math.max(1.4, sc * 0.22), 0, Math.PI * 2); ctx.fill();
      }
    }

    // lit-building halos: homes glow softly, shops brighter, working factories
    // give off a cooler industrial light
    const cull = this.visibleWorldRect(s, FACILITY_CULL_MARGIN);
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      if (f.status === 'closed') continue;
      const loc = f.location;
      if (loc.x < cull.minX || loc.x > cull.maxX || loc.y < cull.minY || loc.y > cull.maxY) continue;
      const isHome = f.type === 'home';
      const isApartment = f.defId === 'apartment';
      const size = (isApartment ? 2.0 : isHome ? 1.45 : 2.6) * sc;
      const sp = this.w2s(s, this.drawPos(id, f.location));
      let r = size * 1.5, warm = '255,206,120', a = 0.10 * night;
      if (f.type === 'retail') { r = size * 1.9; a = 0.17 * night; }
      else if (isApartment) { r = size * 1.7; a = 0.13 * night; }
      else if (f.type === 'factory' && f.status === 'active') { warm = '170,205,255'; a = 0.11 * night; }
      else if (!isHome && f.type !== 'factory') a = 0.08 * night;
      const cy = sp.y - size * 0.3;
      const g = ctx.createRadialGradient(sp.x, cy, 0, sp.x, cy, r);
      g.addColorStop(0, `rgba(${warm},${a})`);
      g.addColorStop(1, `rgba(${warm},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sp.x, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // --- road-following truck routes ----------------------------------------
  /** Cached Manhattan polyline per vehicle (see roadRoute.ts). Purely
   * cosmetic — the engine moves vehicles in a straight line; we map its
   * progress fraction onto this road path so trucks drive the streets. */
  private routeCache = new Map<string, Route & { key: string }>();

  private vehicleRoute(s: GameState, id: string, o: Vec, d: Vec): Route {
    const g = this.roadGrid();
    const key = `${o.x},${o.y}|${d.x},${d.y}|${g.y0.toFixed(1)},${g.y1.toFixed(1)},${g.x0.toFixed(1)}`;
    const hit = this.routeCache.get(id);
    if (hit && hit.key === key) return hit;
    const route = { ...buildRoute(o, d, g), key };
    this.routeCache.set(id, route);
    if (this.routeCache.size > 300) {
      for (const rid of this.routeCache.keys()) if (!s.vehicles[rid]) this.routeCache.delete(rid);
    }
    return route;
  }

  private drawShipments(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const k = Math.min(1, dt * 8);
    const cull = this.visibleWorldRect(s, FACILITY_CULL_MARGIN);
    for (const id in s.vehicles) {
      const v = s.vehicles[id]!;
      if (v.status !== 'enroute') continue;
      // Cull trucks whose live position is offscreen (skips route-line + sprite).
      const lv = v.currentLocation;
      if (lv.x < cull.minX || lv.x > cull.maxX || lv.y < cull.minY || lv.y > cull.maxY) continue;
      const origin = s.facilities[v.originFacilityId]?.location ?? v.currentLocation;
      const straight = Math.max(1e-6, Math.hypot(v.targetLocation.x - origin.x, v.targetLocation.y - origin.y));
      const done = Math.hypot(v.currentLocation.x - origin.x, v.currentLocation.y - origin.y);
      const route = this.vehicleRoute(s, id, origin, v.targetLocation);
      const pose = routePose(route, done / straight);
      const p = this.ease(id, pose.p, k);
      const sp = this.w2s(s, p);
      // remaining route line along the streets
      ctx.strokeStyle = 'rgba(210,168,255,0.30)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y);
      const doneLen = Math.max(0, Math.min(1, done / straight)) * route.total;
      for (let i = 1; i < route.pts.length; i++) {
        if (route.cum[i]! <= doneLen) continue;
        const q = this.w2s(s, route.pts[i]!);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // box truck: shadow, cargo box tinted by product, cab with windshield, wheels
      const ang = Math.atan2(pose.dir.y, pose.dir.x);
      const tk = Math.min(2.2, Math.max(1, this.effScale() / 7));
      ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(ang); ctx.scale(tk, tk);
      ctx.fillStyle = 'rgba(20,30,20,0.3)';
      ctx.beginPath(); ctx.ellipse(0, 3.5, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#20242c';
      for (const wx of [-5, 3]) { ctx.beginPath(); ctx.arc(wx, 4, 1.8, 0, Math.PI * 2); ctx.fill(); }
      const col = this.productColor(v.cargo.productId);
      ctx.fillStyle = '#e8e6df'; this.roundRectPathRaw(ctx, -8, -4.5, 11, 9, 1.5); ctx.fill();
      ctx.fillStyle = col; this.roundRectPathRaw(ctx, -7, -3.5, 9, 7, 1); ctx.fill();
      ctx.fillStyle = '#c8452c'; this.roundRectPathRaw(ctx, 3, -3.5, 6, 7, 1.5); ctx.fill(); // cab
      ctx.fillStyle = '#bfe3f5'; ctx.fillRect(6.5, -2.5, 2, 5); // windshield
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8;
      this.roundRectPathRaw(ctx, -8, -4.5, 17, 9, 1.5); ctx.stroke();
      ctx.restore();
    }
  }

  /** Sidewalk routes for commuters — same street-grid mapping as trucks.
   * Short hops and absurdly circuitous detours stay as straight cut-acrosses
   * (people do cut across the green for the house next door). */
  private citRouteCache = new Map<string, { origin: Vec; key: string; route: Route; walkRoads: boolean }>();

  private citizenPos(s: GameState, id: string, c: { currentLocation: Vec; targetLocation: Vec; movementState: string }): Vec {
    if (c.movementState !== 'moving') { this.citRouteCache.delete(id); return c.currentLocation; }
    const g = this.roadGrid();
    const key = `${c.targetLocation.x},${c.targetLocation.y}|${g.y0.toFixed(1)},${g.y1.toFixed(1)}`;
    let entry = this.citRouteCache.get(id);
    if (!entry || entry.key !== key) {
      const origin = { x: c.currentLocation.x, y: c.currentLocation.y };
      const route = buildRoute(origin, c.targetLocation, g);
      const straight = Math.max(1e-6, Math.hypot(c.targetLocation.x - origin.x, c.targetLocation.y - origin.y));
      const walkRoads = straight >= 6 && route.total / straight <= 2.4;
      entry = { origin, key, route, walkRoads };
      this.citRouteCache.set(id, entry);
      if (this.citRouteCache.size > 400) {
        for (const cid of this.citRouteCache.keys()) if (!s.citizens[cid]) this.citRouteCache.delete(cid);
      }
    }
    if (!entry.walkRoads) return c.currentLocation;
    const straight = Math.max(1e-6, Math.hypot(c.targetLocation.x - entry.origin.x, c.targetLocation.y - entry.origin.y));
    const done = Math.hypot(c.currentLocation.x - entry.origin.x, c.currentLocation.y - entry.origin.y);
    return routePose(entry.route, done / straight).p;
  }

  private drawCitizens(s: GameState, dt: number): void {
    const ctx = this.ctx;
    const selected = this.cb.getSelectedId();
    const k = Math.min(1, dt * 6);
    // LOD floor: below it a citizen sprite is a couple of sub-pixel px, so the
    // whole per-agent pass is skipped (trails still decay below). Positions are
    // not eased while skipped — they resnap when the player zooms back in.
    const drawSprites = !lodEnabled(s) || this.effScale() >= LOD_CITIZEN_SKIP_SCALE;
    if (drawSprites) for (const id in s.citizens) {
      const c = s.citizens[id]!;
      const prev = this.smooth.get(id);
      const p = this.ease(id, this.citizenPos(s, id, c), k);
      const sp = this.w2s(s, p);
      // Screen cull: a citizen sprite spans only a few px, so a small margin
      // around the canvas is an exact cull of the per-agent draw calls.
      if (sp.x < -16 || sp.y < -16 || sp.x > this.cssW + 16 || sp.y > this.cssH + 16) continue;
      // trail when moving
      if (prev && c.movementState === 'moving' && Math.random() < 0.25) {
        this.trails.push({ x: sp.x, y: sp.y, life: 0.5 });
      }
      const sel = id === selected;
      const col = ACTIVITY_COLOR[c.activity] ?? '#8b949e';
      const zk = Math.min(2, Math.max(1, this.effScale() / 8));
      const scale = (sel ? 1.4 : 1) * zk;
      const moving = c.movementState === 'moving';
      // 2-frame walk bob keyed off position so figures animate while walking
      const bob = moving ? Math.sin((sp.x + sp.y + this.smokeT / 90) * 0.9) * 0.8 : 0;
      const bx = sp.x, by = sp.y + bob;
      // little person: shadow, body capsule in activity color, head
      ctx.fillStyle = 'rgba(20,35,20,0.3)';
      ctx.beginPath(); ctx.ellipse(bx, sp.y + 3.4 * scale, 2.6 * scale, 1.1 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      this.roundRectPathRaw(ctx, bx - 1.8 * scale, by - 2.2 * scale, 3.6 * scale, 5.4 * scale, 1.8 * scale);
      ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.4)';
      this.roundRectPathRaw(ctx, bx - 1.8 * scale, by - 2.2 * scale, 3.6 * scale, 5.4 * scale, 1.8 * scale);
      ctx.stroke();
      ctx.fillStyle = '#f0d4b0';
      ctx.beginPath(); ctx.arc(bx, by - 3.4 * scale, 1.7 * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.7; ctx.stroke();
      // Prosperity at a glance: a gold circlet for the affluent, a crisp
      // white collar for the comfortable — workers stay plain.
      if (c.tier === 'affluent') {
        ctx.fillStyle = '#ffd54a';
        ctx.beginPath(); ctx.arc(bx, by - 5.0 * scale, 0.8 * scale, 0, Math.PI * 2); ctx.fill();
      } else if (c.tier === 'comfortable') {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(bx - 1.1 * scale, by - 1.9 * scale, 2.2 * scale, 0.6 * scale);
      }
    }
    // draw + decay trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]!; t.life -= dt;
      if (t.life <= 0) { this.trails.splice(i, 1); continue; }
      ctx.globalAlpha = t.life * 0.4;
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath(); ctx.arc(t.x, t.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.trails.length > 400) this.trails.splice(0, this.trails.length - 400);
  }

  // floaters: detect sales / deliveries / production via stat deltas
  private updateFloaters(s: GameState, dt: number): void {
    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      const prev = this.prevStats.get(id) ?? { revenue: 0, received: 0, produced: 0 };
      const sp = this.w2s(s, this.drawPos(id, f.location));
      // a sale happened -> money rises from the store
      if (f.dailyStats.revenue > prev.revenue) {
        const delta = f.dailyStats.revenue - prev.revenue;
        this.spawnFloater(sp.x, sp.y - 16, `+${formatMoney(delta)}`, '#56d364');
      }
      // a delivery arrived -> goods badge
      if (f.dailyStats.unitsReceived > prev.received) {
        this.spawnFloater(sp.x, sp.y - 16, '+goods', '#d2a8ff');
      }
      // production completed -> small puff (only show occasionally to avoid spam)
      if (f.dailyStats.unitsProduced > prev.produced && Math.random() < 0.6) {
        this.spawnFloater(sp.x + 8, sp.y - 14, '+made', '#e0a458');
      }
      this.prevStats.set(id, {
        revenue: f.dailyStats.revenue,
        received: f.dailyStats.unitsReceived,
        produced: f.dailyStats.unitsProduced,
      });
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i]!;
      fl.life -= dt; fl.y += fl.vy * dt;
      if (fl.life <= 0) this.floaters.splice(i, 1);
    }
    if (this.floaters.length > 80) this.floaters.splice(0, this.floaters.length - 80);
  }

  private spawnFloater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 80) return;
    this.floaters.push({ x, y, vy: -22, life: 1.4, maxLife: 1.4, text, color });
  }

  private drawFloaters(): void {
    const ctx = this.ctx;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const fl of this.floaters) {
      const a = Math.min(1, fl.life / fl.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(fl.text, fl.x + 1, fl.y + 1);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;
  }

  /** 0 at 13:00 (bright day), 1 at 01:00 (deep night). The old formula was
   * inverted (peaked at 1pm) — invisible under the dark theme, glaring in
   * daylight. */
  private nightAmount(hour: number): number {
    return 0.5 - Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5;
  }

  private drawNightTint(hour: number): void {
    const night = this.nightAmount(hour);
    const a = night * 0.58;
    if (a <= 0.01) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(8,14,38,${a})`;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  private drawHud(time: ReturnType<typeof computeTime>): void {
    const ctx = this.ctx;
    const people: { c: string; label: string }[] = [
      { c: ACTIVITY_COLOR.working, label: 'Working' },
      { c: ACTIVITY_COLOR.shopping, label: 'Shopping' },
      { c: ACTIVITY_COLOR['commuting-to-work'], label: 'Commuting' },
      { c: ACTIVITY_COLOR.home, label: 'At home' },
    ];
    const rows = LEGEND_BUILDINGS.length + LEGEND_EXTRAS.length + people.length + 2; // +2 headers
    const panelH = rows * 14 + 14;
    const panelW = 116;
    const px = this.cssW - panelW - 12;
    let y = this.cssH - panelH - 12 + 14;
    ctx.fillStyle = 'rgba(13,17,23,0.78)';
    this.roundRectPath(px - 8, y - 14, panelW, panelH, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    this.roundRectPath(px - 8, y - 14, panelW, panelH, 7); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    ctx.fillStyle = '#6e7681'; ctx.font = '700 9px system-ui';
    ctx.fillText('BUILDINGS', px, y); y += 14;
    for (const item of LEGEND_BUILDINGS) {
      ctx.fillStyle = BUILDING_FILL[item.type];
      this.roundRectPath(px, y - 5, 10, 10, 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, px + 16, y); y += 14;
    }
    for (const item of LEGEND_EXTRAS) {
      ctx.fillStyle = item.color;
      this.roundRectPath(px, y - 5, 10, 10, 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, px + 16, y); y += 14;
    }
    ctx.fillStyle = '#6e7681'; ctx.font = '700 9px system-ui';
    ctx.fillText('PEOPLE', px, y); y += 14;
    for (const item of people) {
      ctx.fillStyle = item.c;
      ctx.beginPath(); ctx.arc(px + 5, y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cdd9e5'; ctx.font = '10px system-ui';
      ctx.fillText(item.label, px + 16, y); y += 14;
    }

    // clock (top-left)
    ctx.fillStyle = 'rgba(13,17,23,0.78)';
    this.roundRectPath(10, 10, 140, 28, 7); ctx.fill();
    ctx.fillStyle = '#e6edf3'; ctx.font = '600 13px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const hh = String(time.hour).padStart(2, '0');
    const icon = time.hour >= 7 && time.hour < 19 ? '☀' : '☾';
    ctx.fillText(`${icon}  Day ${time.day + 1} · ${hh}:00`, 20, 25);
  }

  // --- minimap ----------------------------------------------------------
  private miniHit(m: Vec): boolean {
    const r = this.miniRect;
    return !!r && m.x >= r.x - 5 && m.x <= r.x + r.w + 5 && m.y >= r.y - 5 && m.y <= r.y + r.h + 5;
  }

  /** Center the camera on the world point under a minimap position. */
  private miniNavigate(m: Vec): void {
    const r = this.miniRect;
    if (!r) return;
    const { minX, minY, maxX, maxY } = this.view;
    const fx = Math.max(0, Math.min(1, (m.x - r.x) / r.w));
    const fy = Math.max(0, Math.min(1, (m.y - r.y) / r.h));
    const wx = minX + fx * (maxX - minX);
    const wy = minY + fy * (maxY - minY);
    const sc = this.effScale();
    this.autoFit = false;
    this.camGlide = null;
    this.cb.onFollowBroken();
    this.panX = -(wx - this.view.cx) * sc;
    this.panY = -(wy - this.view.cy) * sc;
  }

  /** Bottom-left town overview with the current viewport framed; click or
   * drag it to fly the camera. Hidden whenever the whole town is already on
   * screen — at the fit view it would just duplicate the map. */
  private drawMinimap(s: GameState): void {
    const tl = this.s2w(s, { x: 0, y: 0 });
    const br = this.s2w(s, { x: this.cssW, y: this.cssH });
    const { minX, minY, maxX, maxY } = this.view;
    if (tl.x <= minX && tl.y <= minY && br.x >= maxX && br.y >= maxY) {
      this.miniRect = null;
      return;
    }
    const w = maxX - minX, h = maxY - minY;
    const k = Math.min(150 / w, 112 / h);
    const mw = w * k, mh = h * k;
    const mx = 14, my = this.cssH - mh - 14;
    this.miniRect = { x: mx, y: my, w: mw, h: mh };
    const toMini = (p: Vec): Vec => ({ x: mx + (p.x - minX) * k, y: my + (p.y - minY) * k });

    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(13,17,23,0.85)';
    this.roundRectPath(mx - 5, my - 5, mw + 10, mh + 10, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    this.roundRectPath(mx - 5, my - 5, mw + 10, mh + 10, 8); ctx.stroke();

    ctx.save();
    this.roundRectPath(mx, my, mw, mh, 4); ctx.clip();

    const [g0] = TownRenderer.GROUND_BY_SEASON[seasonOf(s)]!;
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = g0;
    ctx.fillRect(mx, my, mw, mh);
    ctx.globalAlpha = 1;

    const g = this.roadGrid();
    ctx.strokeStyle = 'rgba(210,210,205,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const y of g.hYs) {
      const a = toMini({ x: g.x0, y }), b = toMini({ x: g.x1, y });
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    for (const x of g.vXs) {
      const a = toMini({ x, y: g.y0 }), b = toMini({ x, y: g.y1 });
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    for (const id in s.facilities) {
      const f = s.facilities[id]!;
      const p = toMini(f.location);
      const player = f.ownerFirmId === s.playerFirmId;
      const d = f.type === 'home' && f.defId !== 'apartment' ? 2.6 : 3.6;
      ctx.fillStyle = f.defId === 'apartment' ? APARTMENT_FILL : BUILDING_FILL[f.type];
      ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      if (player) {
        ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1;
        ctx.strokeRect(p.x - d / 2 - 1, p.y - d / 2 - 1, d + 2, d + 2);
      }
    }

    const va = toMini({ x: Math.max(minX, tl.x), y: Math.max(minY, tl.y) });
    const vb = toMini({ x: Math.min(maxX, br.x), y: Math.min(maxY, br.y) });
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3;
    ctx.strokeRect(va.x, va.y, Math.max(4, vb.x - va.x), Math.max(4, vb.y - va.y));
    ctx.restore();
  }

  private drawHover(s: GameState): void {
    if (!this.mouse) { this.hoverId = null; return; }
    if (this.miniHit(this.mouse)) { this.hoverId = null; return; }
    this.hoverId = this.pick(s, this.mouse);
    if (!this.hoverId || this.cb.getBuildMode()) return;
    const label = this.hoverLabel(s, this.hoverId);
    if (!label) return;
    const ctx = this.ctx;
    ctx.font = '600 11px system-ui';
    const w = ctx.measureText(label).width + 14;
    let x = this.mouse.x + 12;
    let y = this.mouse.y + 12;
    if (x + w > this.cssW) x = this.cssW - w - 4;
    ctx.fillStyle = 'rgba(1,4,9,0.92)';
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1;
    this.roundRectPath(x, y, w, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 7, y + 11);
  }

  private hoverLabel(s: GameState, id: string): string | null {
    const f = s.facilities[id];
    if (f) return f.type === 'home' ? f.name : `${f.name} — ${f.status}`;
    const c = s.citizens[id];
    if (c) return `${c.name} — ${c.activity}`;
    const v = s.vehicles[id];
    if (v) return `Shipment: ${Math.floor(v.cargo.quantity)} ${getProduct(v.cargo.productId).name}`;
    return null;
  }

  // --- helpers ----------------------------------------------------------
  private productColor(pid: string): string {
    switch (pid) {
      case 'grain': return '#d9b25a';
      case 'bread': return '#c98b3a';
      case 'minerals': return '#9aa7b5';
      case 'tools': return '#7fd1e0';
      default: return '#cccccc';
    }
  }
  private statusColor(status: string): string {
    switch (status) {
      case 'active': return '#3fb950';
      case 'closed': return '#f85149';
      case 'idle': return '#6e7681';
      default: return '#d29922';
    }
  }
  private roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    this.roundRectPathRaw(this.ctx, x, y, w, h, r);
  }
  private roundRectPathRaw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  resetView(): void { this.zoom = 1; this.panX = 0; this.panY = 0; this.autoFit = true; this.camGlide = null; this.cb.onFollowBroken(); }
}
