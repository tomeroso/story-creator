import { makeRng, type SimEvent } from './simulation';

export type ScaleId = 'pentatonic' | 'major' | 'minor' | 'random' | 'custom';
export type Instrument = 'pluck' | 'chip' | 'bell';
export type SoundOn = 'both' | 'bounces' | 'escapes';

export interface SoundSettings {
  scale: ScaleId;
  /** Space/comma separated notes like "C4 E4 G4 C5" - used when scale === 'custom'. */
  customNotes: string;
  instrument: Instrument;
  soundOn: SoundOn;
  volume: number; // 0..1
}

export const DEFAULT_SOUND: SoundSettings = {
  scale: 'pentatonic',
  customNotes: 'C4 D4 E4 G4 A4 C5 A4 G4 E4 D4',
  instrument: 'pluck',
  soundOn: 'both',
  volume: 0.8,
};

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" / "Eb3" / "a5" -> frequency in Hz, or null if it isn't a note. */
export function noteToFrequency(note: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return null;
  const semis = NOTE_OFFSETS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = 12 * (Number(m[3]) + 1) + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Parses a custom note list; returns the valid frequencies and any tokens that weren't notes. */
export function parseNoteList(text: string): { freqs: number[]; invalid: string[] } {
  const freqs: number[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const f = noteToFrequency(token);
    if (f) freqs.push(f);
    else invalid.push(token);
  }
  return { freqs, invalid };
}

function scaleNotes(names: string[]): number[] {
  return names.map((n) => noteToFrequency(n)!);
}

/** Up-then-down so long runs sound like a phrase instead of jumping back to the bottom. */
function pingPong(freqs: number[]): number[] {
  return [...freqs, ...freqs.slice(1, -1).reverse()];
}

const SCALES: Record<Exclude<ScaleId, 'custom' | 'random'>, number[]> = {
  pentatonic: pingPong(scaleNotes(['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6'])),
  major: pingPong(scaleNotes(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'])),
  minor: pingPong(scaleNotes(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'A5'])),
};
const RANDOM_POOL = scaleNotes(['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5']);

/**
 * Turns simulation events into a stable note sequence. Each bounce plays the
 * next note, so a custom note list plays through one bounce at a time.
 */
export class NoteSequencer {
  private index = 0;
  private lastSoundAt = -Infinity;
  private readonly seq: number[];
  private readonly rng: () => number;
  private readonly sound: SoundSettings;

  constructor(sound: SoundSettings, seed: number) {
    this.sound = sound;
    const custom = sound.scale === 'custom' ? parseNoteList(sound.customNotes).freqs : [];
    this.seq = sound.scale === 'custom' ? (custom.length ? custom : SCALES.pentatonic) : sound.scale === 'random' ? RANDOM_POOL : SCALES[sound.scale];
    this.rng = makeRng(seed * 7919 + 13);
  }

  /** Returns the notes to play for an event (empty = silent), rate-limited so dense collisions don't turn to noise. */
  notesFor(event: SimEvent): { freqs: number[]; strength: number } | null {
    const { soundOn } = this.sound;
    if (event.kind === 'bounce' && soundOn === 'escapes') return null;
    if (event.kind === 'escape' && soundOn === 'bounces') return null;
    const minGap = event.kind === 'bounce' ? 0.045 : 0.02;
    if (event.t - this.lastSoundAt < minGap) return null;
    this.lastSoundAt = event.t;

    if (event.kind === 'finish') {
      const root = this.seq[0];
      return { freqs: [root, root * 1.25, root * 1.5, root * 2], strength: 1 };
    }
    const base = this.next();
    if (event.kind === 'escape') return { freqs: [base * 2, base * 3], strength: 0.9 };
    return { freqs: [base], strength: 0.75 };
  }

  private next(): number {
    if (this.sound.scale === 'random') return this.seq[Math.floor(this.rng() * this.seq.length)];
    const f = this.seq[this.index % this.seq.length];
    this.index++;
    return f;
  }
}

/** Schedules one synthesized note. Works for both live (AudioContext) and offline (OfflineAudioContext) audio. */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, when: number, freq: number, instrument: Instrument, level: number) {
  const env = ctx.createGain();
  env.connect(dest);
  const decay = instrument === 'bell' ? 1.4 : instrument === 'chip' ? 0.22 : 0.55;
  const peak = level * (instrument === 'chip' ? 0.18 : 0.35);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(peak, when + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, when + decay);

  const voices: [OscillatorType, number, number][] =
    instrument === 'bell'
      ? [['sine', 1, 1], ['sine', 2.76, 0.35], ['sine', 5.4, 0.12]]
      : instrument === 'chip'
        ? [['square', 1, 1]]
        : [['triangle', 1, 1], ['sine', 2, 0.35]];

  for (const [type, ratio, gain] of voices) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * ratio, when);
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g);
    g.connect(env);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  }
}

/** Master chain with a compressor so many overlapping notes never clip. Notes go into `input`; `gain` sets the volume. */
export function createMasterChain(ctx: BaseAudioContext, volume: number): { input: AudioNode; gain: GainNode } {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  comp.connect(gain);
  gain.connect(ctx.destination);
  return { input: comp, gain };
}

/** Renders the whole soundtrack for a finished simulation into an AudioBuffer. */
export async function renderSoundtrack(events: SimEvent[], duration: number, sound: SoundSettings, seed: number): Promise<AudioBuffer> {
  const sampleRate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const master = createMasterChain(ctx, sound.volume).input;
  const sequencer = new NoteSequencer(sound, seed);
  let scheduled = 0;
  for (const e of events) {
    const notes = sequencer.notesFor(e);
    if (!notes) continue;
    notes.freqs.forEach((f, i) => playNote(ctx, master, e.t + i * (e.kind === 'finish' ? 0.07 : 0.03), f, sound.instrument, notes.strength));
    if (++scheduled > 6000) break; // safety cap for extremely dense runs
  }
  return ctx.startRendering();
}
