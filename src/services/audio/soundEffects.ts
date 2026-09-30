export type SoundEffectId = 'none' | 'whoosh' | 'ding' | 'pop' | 'click' | 'chime';

export const SOUND_EFFECT_OPTIONS: { id: SoundEffectId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'whoosh', label: 'Whoosh' },
  { id: 'ding', label: 'Bell ding' },
  { id: 'pop', label: 'Pop' },
  { id: 'click', label: 'Click' },
  { id: 'chime', label: 'Chime (rising)' },
];

/** A sound effect selection: either one of the built-in synthesized effects, or a custom uploaded clip. */
export interface SoundChoice {
  id: SoundEffectId | 'custom';
  /** Only set when id === 'custom'. */
  blob?: Blob;
  name?: string;
}

export const NO_SOUND: SoundChoice = { id: 'none' };

function createNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(seconds * ctx.sampleRate)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Schedules one procedurally-synthesized sound effect at time `when` on the
 * given context/destination. Works identically on a live AudioContext (for
 * preview) and an OfflineAudioContext (for rendering into the final video).
 */
export function scheduleSoundEffect(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  effect: SoundEffectId,
  volume = 0.8
) {
  switch (effect) {
    case 'none':
      return;

    case 'whoosh': {
      const dur = 0.45;
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, dur);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(250, when);
      filter.frequency.exponentialRampToValueAtTime(3800, when + dur * 0.55);
      filter.frequency.exponentialRampToValueAtTime(300, when + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(volume, when + dur * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + dur + 0.05);
      break;
    }

    case 'ding': {
      const dur = 1.1;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, when);
      master.gain.exponentialRampToValueAtTime(volume * 0.85, when + 0.008);
      master.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      master.connect(dest);
      const partials: [number, number][] = [
        [1, 1],
        [2.4, 0.35],
        [3.8, 0.15],
      ];
      for (const [mult, amp] of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 1046.5 * mult; // C6-ish fundamental
        const g = ctx.createGain();
        g.gain.value = amp;
        osc.connect(g);
        g.connect(master);
        osc.start(when);
        osc.stop(when + dur + 0.05);
      }
      break;
    }

    case 'pop': {
      const dur = 0.13;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, when);
      osc.frequency.exponentialRampToValueAtTime(110, when + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(when);
      osc.stop(when + dur + 0.02);
      break;
    }

    case 'click': {
      const dur = 0.045;
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, dur);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2500;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + dur + 0.01);
      break;
    }

    case 'chime': {
      const notes = [880, 1108.73, 1318.51]; // quick rising arpeggio
      const step = 0.09;
      notes.forEach((freq, i) => {
        const t0 = when + i * step;
        const dur = 0.35;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(volume * 0.6, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      });
      break;
    }
  }
}

let previewCtx: AudioContext | null = null;

/** Plays one effect immediately through the speakers, for auditioning in the UI. */
/** Plays one effect immediately through the speakers, for auditioning in the UI (built-in or custom). */
export function previewSoundEffect(choice: SoundChoice) {
  if (choice.id === 'none') return;
  if (!previewCtx) previewCtx = new AudioContext();
  void previewCtx.resume();
  const when = previewCtx.currentTime + 0.02;
  if (choice.id === 'custom') {
    if (!choice.blob) return;
    void choice.blob.arrayBuffer().then(async (data) => {
      const buffer = await previewCtx!.decodeAudioData(data);
      const src = previewCtx!.createBufferSource();
      src.buffer = buffer;
      src.connect(previewCtx!.destination);
      src.start(when);
    });
    return;
  }
  scheduleSoundEffect(previewCtx, previewCtx.destination, when, choice.id);
}

/** Mixes the selected effects (built-in or custom) into an existing narration buffer at the given times (seconds). */
export async function overlaySoundEffects(
  narration: AudioBuffer,
  cues: { at: number; choice: SoundChoice }[]
): Promise<AudioBuffer> {
  const active = cues.filter((c) => c.choice.id !== 'none');
  if (active.length === 0) return narration;

  // Custom clips need an async decode first; built-ins don't.
  const decoder = new OfflineAudioContext(1, 1, narration.sampleRate);
  const resolved = await Promise.all(
    active.map(async (c) => {
      if (c.choice.id === 'custom') {
        const buffer = c.choice.blob ? await decoder.decodeAudioData(await c.choice.blob.arrayBuffer()) : null;
        return { at: c.at, builtin: null as SoundEffectId | null, buffer };
      }
      return { at: c.at, builtin: c.choice.id, buffer: null as AudioBuffer | null };
    })
  );

  const ctx = new OfflineAudioContext(narration.numberOfChannels, narration.length, narration.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = narration;
  src.connect(ctx.destination);
  src.start(0);
  for (const r of resolved) {
    const when = Math.max(0, r.at);
    if (r.buffer) {
      const s = ctx.createBufferSource();
      s.buffer = r.buffer;
      s.connect(ctx.destination);
      s.start(when);
    } else if (r.builtin) {
      scheduleSoundEffect(ctx, ctx.destination, when, r.builtin);
    }
  }
  return ctx.startRendering();
}
