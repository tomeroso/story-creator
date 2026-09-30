import { useCallback, useEffect, useRef, useState } from 'react';
import { detectEncoderCapabilities, type EncoderCapabilities } from '../../services/video/encoderCapabilities';
import { ensureDisplayFont } from '../../services/video/fonts';
import type { RenderProgress } from '../../services/video/videoRenderer';
import { downloadBlobUrl, safeFileName } from '../../utils/format';
import { saveMediaAsset } from '../../services/storage/mediaStore';
import { drawPhysicsFrame } from './drawPhysics';
import { PRESET_DEFAULTS, PhysicsSim, simulateHeadless, type PhysicsPreset, type PhysicsSettings } from './simulation';
import {
  DEFAULT_SOUND,
  NoteSequencer,
  createMasterChain,
  parseNoteList,
  playNote,
  type Instrument,
  type ScaleId,
  type SoundOn,
  type SoundSettings,
} from './sound';

interface Props {
  active: boolean;
}

const PRESET_INFO: Record<PhysicsPreset, { label: string; title: string; ends: string }> = {
  grow: { label: 'Growing ball', title: 'Every bounce makes it bigger', ends: 'ends when the ball fills the circle' },
  rings: { label: 'Escape the rings', title: 'Can the ball escape?', ends: 'ends when the ball escapes every ring' },
  multiply: { label: 'Multiplying balls', title: 'Every escape = 2 more balls', ends: 'runs for the max length' },
};

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs text-neutral-400 space-y-1">
      <span className="flex justify-between">
        <span>{props.label}</span>
        <span className="text-neutral-300">
          {props.value}
          {props.unit ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-cyan-500"
      />
    </label>
  );
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

export function PhysicsScreen({ active }: Props) {
  const [settings, setSettings] = useState<PhysicsSettings>({ ...PRESET_DEFAULTS.rings, seed: randomSeed() });
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [title, setTitle] = useState(PRESET_INFO.rings.title);
  const [showCounter, setShowCounter] = useState(true);
  const [quality, setQuality] = useState<'final' | 'draft'>('final');
  const [fps, setFps] = useState<30 | 60>(30);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [stats, setStats] = useState<{ duration: number; finished: boolean } | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const [caps, setCaps] = useState<EncoderCapabilities | null>(null);

  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [savedToMedia, setSavedToMedia] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<PhysicsSim | null>(null);
  const seqRef = useRef<NoteSequencer | null>(null);
  const previewTimeRef = useRef(0);
  const audioRef = useRef<{ ctx: AudioContext; input: AudioNode; gain: GainNode } | null>(null);

  const look = { title, showCounter };
  const lookRef = useRef(look);
  lookRef.current = look;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    void detectEncoderCapabilities().then(setCaps);
    void ensureDisplayFont().then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext('2d');
    if (ctx) drawPhysicsFrame(ctx, sim, lookRef.current, canvas.width, canvas.height);
  }, []);

  // Any physics/sound change restarts the preview from t=0 with the same seed.
  useEffect(() => {
    simRef.current = new PhysicsSim(settings);
    seqRef.current = new NoteSequencer(sound, settings.seed);
    previewTimeRef.current = 0;
    draw();
  }, [settings, sound, draw]);

  useEffect(() => {
    draw();
  }, [title, showCounter, fontReady, draw]);

  // Video length / outcome, computed with a short debounce (it's a full simulation).
  useEffect(() => {
    setStats(null);
    const id = setTimeout(() => {
      const r = simulateHeadless(settings);
      setStats({ duration: r.duration, finished: r.finished });
    }, 250);
    return () => clearTimeout(id);
  }, [settings]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.gain.gain.value = sound.volume;
  }, [sound.volume]);

  // Preview loop.
  useEffect(() => {
    if (!playing || !active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const sim = simRef.current;
      if (!sim) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      previewTimeRef.current += dt;
      const events = sim.stepTo(previewTimeRef.current);
      const audio = audioRef.current;
      if (audio && !mutedRef.current && seqRef.current) {
        for (const e of events) {
          const notes = seqRef.current.notesFor(e);
          if (!notes) continue;
          notes.freqs.forEach((f, i) =>
            playNote(audio.ctx, audio.input, audio.ctx.currentTime + 0.01 + i * (e.kind === 'finish' ? 0.07 : 0.03), f, soundRef.current.instrument, notes.strength)
          );
        }
      } else if (seqRef.current) {
        for (const e of events) seqRef.current.notesFor(e); // keep the melody position in step while muted
      }
      draw();
      if (sim.t >= sim.endTime) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, draw]);

  const play = () => {
    if (!audioRef.current) {
      const ctx = new AudioContext();
      audioRef.current = { ctx, ...createMasterChain(ctx, sound.volume) };
    }
    void audioRef.current.ctx.resume();
    const sim = simRef.current;
    if (sim && sim.t >= sim.endTime) restart();
    setPlaying(true);
  };

  const restart = () => {
    simRef.current = new PhysicsSim(settings);
    seqRef.current = new NoteSequencer(sound, settings.seed);
    previewTimeRef.current = 0;
    draw();
  };

  const update = (patch: Partial<PhysicsSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const choosePreset = (preset: PhysicsPreset) => {
    setSettings({ ...PRESET_DEFAULTS[preset], seed: settings.seed });
    setTitle(PRESET_INFO[preset].title);
    setPlaying(false);
  };

  const render = async () => {
    const size = quality === 'draft' ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
    setError(null);
    setOutputUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRendering(true);
    setPlaying(false);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const { checkWebCodecsSupport } = await import('../../services/video/webCodecsRenderer');
      const support = await checkWebCodecsSupport(size.width, size.height);
      if (!support.supported) throw new Error(`${support.reason ?? 'Fast video engine unavailable.'} Use Chrome or Edge.`);
      const { renderPhysicsVideo } = await import('./physicsRenderer');
      const blob = await renderPhysicsVideo({
        settings,
        sound,
        look,
        ...size,
        fps,
        audioCodec: support.audioCodec!,
        signal: abort.signal,
        onProgress: setProgress,
      });
      setOutputUrl(URL.createObjectURL(blob));
      setOutputBlob(blob);
      setSavedToMedia(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      setRendering(false);
      abortRef.current = null;
    }
  };

  const saveToMedia = async () => {
    if (!outputBlob) return;
    const name = `${safeFileName(title || PRESET_INFO[settings.preset].label)}.mp4`;
    await saveMediaAsset(new File([outputBlob], name, { type: 'video/mp4' }));
    setSavedToMedia(true);
  };

  const customCheck = sound.scale === 'custom' ? parseNoteList(sound.customNotes) : null;
  const s = settings;
  const locked = rendering;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Physics</h1>
        <p className="text-xs text-neutral-500 mt-1">
          Satisfying bouncing-ball videos with a note on every bounce. Same seed = same run, so what you preview is exactly
          what renders.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="section-title">Format</h2>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(PRESET_INFO) as PhysicsPreset[]).map((p) => (
            <button
              key={p}
              disabled={locked}
              onClick={() => choosePreset(p)}
              className={s.preset === p ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
            >
              {PRESET_INFO[p].label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex gap-6 flex-wrap items-start">
        {/* PREVIEW */}
        <section className="space-y-2">
          <canvas
            ref={canvasRef}
            width={540}
            height={960}
            className="w-[270px] h-[480px] rounded-md border border-neutral-800 bg-black"
          />
          <div className="flex gap-2 flex-wrap">
            {playing ? (
              <button onClick={() => setPlaying(false)} className="btn-secondary text-xs">
                ⏸ Pause
              </button>
            ) : (
              <button onClick={play} disabled={locked} className="btn-primary text-xs">
                ▶ Play
              </button>
            )}
            <button onClick={restart} disabled={locked} className="btn-secondary text-xs">
              ⟲ Restart
            </button>
            <button onClick={() => update({ seed: randomSeed() })} disabled={locked} className="btn-secondary text-xs">
              🎲 New run
            </button>
            <button onClick={() => setMuted((m) => !m)} className="btn-ghost text-xs">
              {muted ? '🔇 Muted' : '🔊 Sound'}
            </button>
          </div>
          <p className="text-xs text-neutral-500 w-[270px]">
            {stats
              ? `Video length: ${stats.duration.toFixed(1)}s — ${
                  stats.finished ? PRESET_INFO[s.preset].ends : 'hits the max length before finishing'
                }`
              : 'Working out video length…'}
          </p>
          <p className="text-[11px] text-neutral-600">Seed #{s.seed}</p>
        </section>

        {/* CONTROLS */}
        <section className="flex-1 min-w-[260px] space-y-4">
          <label className="block text-xs text-neutral-400 space-y-1">
            <span>Title</span>
            <input
              value={title}
              disabled={locked}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={showCounter} disabled={locked} onChange={(e) => setShowCounter(e.target.checked)} />
            Show counter under the circle
          </label>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {s.preset === 'grow' && (
              <Slider label="Growth per bounce" value={s.growth} min={1} max={20} unit="px" disabled={locked} onChange={(v) => update({ growth: v })} />
            )}
            {s.preset === 'rings' && (
              <Slider label="Rings" value={s.ringCount} min={3} max={30} disabled={locked} onChange={(v) => update({ ringCount: v })} />
            )}
            {s.preset !== 'grow' && (
              <>
                <Slider label="Gap size" value={s.gapDegrees} min={15} max={100} unit="°" disabled={locked} onChange={(v) => update({ gapDegrees: v })} />
                <Slider label="Spin speed" value={s.rotationSpeed} min={0} max={200} unit="°/s" disabled={locked} onChange={(v) => update({ rotationSpeed: v })} />
              </>
            )}
            {s.preset === 'multiply' && (
              <>
                <Slider label="New balls per escape" value={s.spawnPerEscape} min={1} max={4} disabled={locked} onChange={(v) => update({ spawnPerEscape: v })} />
                <Slider label="Max balls" value={s.maxBalls} min={10} max={500} step={10} disabled={locked} onChange={(v) => update({ maxBalls: v })} />
              </>
            )}
            <Slider label="Gravity" value={s.gravity} min={0} max={2000} step={50} disabled={locked} onChange={(v) => update({ gravity: v })} />
            <Slider label="Launch speed" value={s.speed} min={300} max={2000} step={50} disabled={locked} onChange={(v) => update({ speed: v })} />
            <Slider label="Ball size" value={s.ballRadius} min={6} max={60} disabled={locked} onChange={(v) => update({ ballRadius: v })} />
            <Slider label="Bounce energy" value={s.bounceBoost} min={0.95} max={1.1} step={0.01} unit="×" disabled={locked} onChange={(v) => update({ bounceBoost: v })} />
            <Slider label="Max length" value={s.maxDuration} min={10} max={120} step={5} unit="s" disabled={locked} onChange={(v) => update({ maxDuration: v })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={s.trails} disabled={locked} onChange={(e) => update({ trails: e.target.checked })} />
            Trails
          </label>

          <div className="space-y-2 border-t border-neutral-800 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Sound</h3>
            <div className="flex flex-wrap gap-3 text-xs text-neutral-400">
              <label className="space-y-1">
                <span className="block">Notes</span>
                <select
                  value={sound.scale}
                  disabled={locked}
                  onChange={(e) => setSound({ ...sound, scale: e.target.value as ScaleId })}
                  className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                >
                  <option value="pentatonic">Pentatonic up & down</option>
                  <option value="major">Major scale up & down</option>
                  <option value="minor">Minor scale up & down</option>
                  <option value="random">Random pleasant notes</option>
                  <option value="custom">My own notes…</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block">Instrument</span>
                <select
                  value={sound.instrument}
                  disabled={locked}
                  onChange={(e) => setSound({ ...sound, instrument: e.target.value as Instrument })}
                  className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                >
                  <option value="pluck">Pluck</option>
                  <option value="bell">Bell</option>
                  <option value="chip">8-bit</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block">Play on</span>
                <select
                  value={sound.soundOn}
                  disabled={locked}
                  onChange={(e) => setSound({ ...sound, soundOn: e.target.value as SoundOn })}
                  className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                >
                  <option value="both">Bounces + escapes</option>
                  <option value="bounces">Bounces only</option>
                  <option value="escapes">Escapes only</option>
                </select>
              </label>
            </div>
            {sound.scale === 'custom' && (
              <label className="block text-xs text-neutral-400 space-y-1">
                <span>Notes, one per bounce (e.g. C4 E4 G4 C5 — use # or b for sharps/flats)</span>
                <input
                  value={sound.customNotes}
                  disabled={locked}
                  onChange={(e) => setSound({ ...sound, customNotes: e.target.value })}
                  className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 font-mono"
                />
                {customCheck && customCheck.invalid.length > 0 && (
                  <span className="block text-amber-400">Not recognized as notes: {customCheck.invalid.slice(0, 6).join(', ')}</span>
                )}
                {customCheck && customCheck.freqs.length === 0 && (
                  <span className="block text-amber-400">No valid notes yet — the pentatonic scale is used until you add some.</span>
                )}
              </label>
            )}
            <Slider label="Volume" value={Math.round(sound.volume * 100)} min={0} max={100} unit="%" disabled={locked} onChange={(v) => setSound({ ...sound, volume: v / 100 })} />
          </div>
        </section>
      </div>

      {/* RENDER */}
      <section className="space-y-3 pb-10">
        <h2 className="section-title">Render</h2>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-neutral-400">Quality:</span>
          <button onClick={() => setQuality('draft')} disabled={locked} className={quality === 'draft' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>
            Draft (720p)
          </button>
          <button onClick={() => setQuality('final')} disabled={locked} className={quality === 'final' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>
            Final (1080p)
          </button>
          <span className="text-neutral-400 ml-3">Frame rate:</span>
          <button onClick={() => setFps(30)} disabled={locked} className={fps === 30 ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>
            30 fps
          </button>
          <button onClick={() => setFps(60)} disabled={locked} className={fps === 60 ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>
            60 fps (smoother, 2× render time)
          </button>
        </div>
        {caps && !caps.webCodecs && <p className="text-xs text-amber-400">This tab needs the fast video engine — open the app in Chrome or Edge.</p>}
        {caps?.webCodecs && !caps.hardwareEncoder && (
          <p className="text-xs text-amber-400">No hardware video encoder detected — Draft and 30 fps render fastest on your CPU.</p>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => void render()} disabled={locked} className="btn-primary">
            Render MP4
          </button>
          {rendering && (
            <button onClick={() => abortRef.current?.abort()} className="btn-secondary text-xs">
              Cancel
            </button>
          )}
        </div>
        {progress && progress.phase !== 'done' && (
          <p className="text-xs text-neutral-400">
            {progress.message ?? progress.phase}
            {typeof progress.ratio === 'number' ? ` — ${Math.round(progress.ratio * 100)}%` : ''}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {outputUrl && (
          <div className="space-y-2">
            <video src={outputUrl} controls className="w-64 rounded-md border border-neutral-800" />
            <div className="flex gap-2">
              <button
                onClick={() => downloadBlobUrl(outputUrl, `${safeFileName(title || PRESET_INFO[s.preset].label)}.mp4`)}
                className="btn-secondary"
              >
                Download MP4
              </button>
              <button onClick={() => void saveToMedia()} disabled={savedToMedia} className="btn-secondary">
                {savedToMedia ? 'Saved to Media ✓' : 'Save to Media library'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
