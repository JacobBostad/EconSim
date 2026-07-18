/**
 * music.ts — generative ambient soundtrack (WebAudio, no assets).
 *
 * A quiet lo-fi bed under the town: a slow maj7 chord pad (two detuned
 * triangle voices per note through a lowpass) with a sparse pentatonic
 * music-box melody echoing over it. Nothing loops verbatim — chords walk a
 * progression and melody notes are drawn at random, so it never grates.
 *
 * Mood follows the town clock: daytime is brighter (open filter, busier
 * melody), night closes the filter down and lets the pad breathe. The whole
 * bed ducks to silence when the master mute is on, when the music toggle is
 * off, or when the tab is hidden, and swells back in over a few seconds.
 *
 * Browser autoplay policy means the AudioContext can only start after a user
 * gesture; callers should invoke start() from a pointer handler (the
 * MusicDirector arms a one-time listener). Everything is failure-tolerant —
 * no AudioContext, no music, no crash.
 */

import { isMuted } from './sound';

const MUSIC_KEY = 'econsim.music';

export type MusicMood = 'day' | 'night';

let enabled: boolean = (() => {
  try {
    return localStorage.getItem(MUSIC_KEY) !== '0'; // on by default, quietly
  } catch {
    return true;
  }
})();

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let delaySend: GainNode | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let nextChordAt = 0;
let nextMelodyAt = 0;
let chordIndex = 0;
let mood: MusicMood = 'day';

export function isMusicOn(): boolean {
  return enabled;
}

export function setMusicOn(v: boolean): void {
  enabled = v;
  try {
    localStorage.setItem(MUSIC_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function setMusicMood(m: MusicMood): void {
  mood = m;
}

/** Chord progression in Hz (C-major wash: Cmaj7 → Am7 → Fmaj7 → Gadd9). */
const CHORDS: number[][] = [
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 130.81, 164.81, 196.0],
  [87.31, 110.0, 130.81, 164.81],
  [98.0, 123.47, 146.83, 220.0],
];
const CHORD_MS = 9600;
/** C-pentatonic across two octaves for the music-box line. */
const MELODY = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

function graph(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ac) {
      ac = new Ctor();
      master = ac.createGain();
      master.gain.value = 0;
      filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1600;
      filter.Q.value = 0.4;
      filter.connect(master).connect(ac.destination);
      // feedback delay shared by the melody voice — the "music box in a hall"
      const delay = ac.createDelay(1.5);
      delay.delayTime.value = 0.42;
      const fb = ac.createGain();
      fb.gain.value = 0.32;
      delaySend = ac.createGain();
      delaySend.gain.value = 0.25;
      delaySend.connect(delay).connect(fb).connect(delay);
      delay.connect(filter);
    }
    if (ac.state === 'suspended') void ac.resume();
    return ac.state === 'closed' ? null : ac;
  } catch {
    return null;
  }
}

/** One pad note: two triangles detuned a few cents, slow swell in and out. */
function padNote(freq: number, t0: number, durS: number): void {
  if (!ac || !filter) return;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.028, t0 + durS * 0.35);
  g.gain.setValueAtTime(0.028, t0 + durS * 0.7);
  g.gain.linearRampToValueAtTime(0, t0 + durS);
  for (const cents of [-4, 3]) {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * Math.pow(2, cents / 1200), t0);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + durS + 0.1);
  }
  g.connect(filter);
}

/** One melody pluck into the shared delay line. */
function melodyNote(freq: number, t0: number): void {
  if (!ac || !filter || !delaySend) return;
  const durS = 1.4 + Math.random() * 1.1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(mood === 'night' ? 0.02 : 0.03, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t0);
  o.connect(g);
  g.connect(filter);
  g.connect(delaySend);
  o.start(t0);
  o.stop(t0 + durS + 0.1);
}

/** 250ms scheduler tick: keep ~1 chord and ~1 melody draw queued ahead, and
 * ease the master gain toward its target (mute/toggle/hidden-tab ducking). */
function tick(): void {
  if (!ac || !master) return;
  const now = ac.currentTime;
  const audible = enabled && !isMuted() && !(typeof document !== 'undefined' && document.hidden);
  const target = audible ? 1 : 0;
  const cur = master.gain.value;
  if (Math.abs(cur - target) > 0.001) {
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(cur, now);
    master.gain.linearRampToValueAtTime(target, now + (target > cur ? 3.5 : 0.8));
  }
  if (!audible) return; // don't queue notes into silence

  if (filter) {
    const cutoff = mood === 'night' ? 850 : 1600;
    if (Math.abs(filter.frequency.value - cutoff) > 20) {
      filter.frequency.cancelScheduledValues(now);
      filter.frequency.setValueAtTime(filter.frequency.value, now);
      filter.frequency.linearRampToValueAtTime(cutoff, now + 4);
    }
  }

  if (nextChordAt < now + 1) {
    const t0 = Math.max(now, nextChordAt);
    const chord = CHORDS[chordIndex % CHORDS.length]!;
    for (const f of chord) padNote(f, t0, (CHORD_MS / 1000) * 1.15); // slight overlap
    chordIndex += 1;
    nextChordAt = t0 + CHORD_MS / 1000;
  }

  if (nextMelodyAt < now + 1) {
    const t0 = Math.max(now, nextMelodyAt);
    const density = mood === 'night' ? 0.35 : 0.65;
    if (Math.random() < density) {
      melodyNote(MELODY[Math.floor(Math.random() * MELODY.length)]!, t0);
    }
    nextMelodyAt = t0 + 2.4 + Math.random() * 2.4;
  }
}

/** Start (or resume) the bed. Safe to call repeatedly; needs a user gesture
 * to actually produce sound on first call. */
export function startMusic(): void {
  if (!graph()) return;
  if (!tickTimer) tickTimer = setInterval(tick, 250);
  tick();
}

/** Stop scheduling and silence the bed (context is kept for cheap restart). */
export function stopMusic(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (ac && master) {
    const now = ac.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.8);
  }
}
