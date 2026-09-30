import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MediaPicker } from '../../components/MediaPicker';
import { detectEncoderCapabilities, type EncoderCapabilities } from '../../services/video/encoderCapabilities';
import { ensureDisplayFont } from '../../services/video/fonts';
import { pickRandomMediaAsset } from '../../services/storage/mediaStore';
import type { RenderProgress } from '../../services/video/videoRenderer';
import { downloadBlobUrl, formatTime, parseTime, safeFileName } from '../../utils/format';
import { computeParts, drawPartsFrame, type PartsFit, type PartsStyle } from './partsLayout';

interface Props {
  active: boolean;
}

type PartStatus = 'queued' | 'rendering' | 'done' | 'error';

const PART_LENGTH_PRESETS = [30, 60, 90, 120, 180];

export function PartsScreen({ active }: Props) {
  const [source, setSource] = useState<Blob | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [style, setStyle] = useState<PartsStyle>({
    title: '',
    credit: '',
    fit: 'fit',
    background: 'blur',
    showTotal: false,
    accentColor: '#facc15',
  });
  const [partLength, setPartLength] = useState(60);
  const [rangeStartText, setRangeStartText] = useState('0:00');
  const [rangeEndText, setRangeEndText] = useState('');
  const [quality, setQuality] = useState<'final' | 'draft'>('final');

  const [statuses, setStatuses] = useState<Record<number, PartStatus>>({});
  const [results, setResults] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [caps, setCaps] = useState<EncoderCapabilities | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    void detectEncoderCapabilities().then(setCaps);
    void ensureDisplayFont().then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  useEffect(() => {
    if (!source) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(source);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  const rangeStart = Math.min(parseTime(rangeStartText) ?? 0, duration ?? 0);
  const rangeEnd = Math.min(parseTime(rangeEndText) ?? duration ?? 0, duration ?? 0);
  const parts = useMemo(
    () => (duration ? computeParts(rangeStart, Math.max(rangeStart, rangeEnd), partLength) : []),
    [duration, rangeStart, rangeEnd, partLength]
  );

  // Any settings change makes already-rendered parts stale, so drop them.
  const settingsKey = JSON.stringify({ sourceName, style, partLength, rangeStart, rangeEnd, quality, n: parts.length });
  const clearResults = useCallback(() => {
    setResults((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
    setStatuses({});
  }, []);
  useEffect(() => {
    if (!rendering) clearResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const pickSource = (blob: Blob, name: string) => {
    if (rendering) return;
    setSource(blob);
    setSourceName(name);
    setDuration(null);
    setRangeStartText('0:00');
    setRangeEndText('');
    setError(null);
    setShowPicker(false);
    if (!style.title) setStyle((s) => ({ ...s, title: name.replace(/\.[^.]+$/, '') }));
  };

  // --- Live preview (same drawing code as the renderer) ---
  const drawPreview = useCallback(() => {
    const canvas = previewRef.current;
    const video = videoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!video || !video.videoWidth) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const current = parts.find((p) => video.currentTime >= p.start && video.currentTime < p.end) ?? parts[0];
    drawPartsFrame(
      ctx,
      (c, dx, dy, dw, dh) => c.drawImage(video, dx, dy, dw, dh),
      video.videoWidth,
      video.videoHeight,
      style,
      (current?.index ?? 0) + 1,
      Math.max(1, parts.length),
      canvas.width,
      canvas.height
    );
  }, [parts, style]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview, fontReady, sourceUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    const loop = () => {
      drawPreview();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', drawPreview);
    video.addEventListener('loadeddata', drawPreview);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeked', drawPreview);
      video.removeEventListener('loadeddata', drawPreview);
    };
  }, [drawPreview, sourceUrl]);

  // --- Rendering ---
  const renderQueue = async (indices: number[]) => {
    if (!source || indices.length === 0) return;
    const size = quality === 'draft' ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
    setError(null);
    setRendering(true);
    const abort = new AbortController();
    abortRef.current = abort;
    setStatuses((prev) => {
      const next = { ...prev };
      indices.forEach((i) => (next[i] = 'queued'));
      return next;
    });
    try {
      const { checkWebCodecsSupport } = await import('../../services/video/webCodecsRenderer');
      const support = await checkWebCodecsSupport(size.width, size.height);
      if (!support.supported) {
        throw new Error(`${support.reason ?? 'Fast video engine unavailable.'} The Parts tab needs Chrome or Edge.`);
      }
      const { renderPart } = await import('./partsRenderer');
      for (const index of indices) {
        if (abort.signal.aborted) break;
        const part = parts[index];
        setStatuses((prev) => ({ ...prev, [index]: 'rendering' }));
        try {
          const blob = await renderPart({
            source,
            part,
            totalParts: parts.length,
            style,
            ...size,
            fps: 30,
            audioCodec: support.audioCodec!,
            signal: abort.signal,
            onProgress: setProgress,
          });
          const url = URL.createObjectURL(blob);
          setResults((prev) => {
            if (prev[index]) URL.revokeObjectURL(prev[index]);
            return { ...prev, [index]: url };
          });
          setStatuses((prev) => ({ ...prev, [index]: 'done' }));
        } catch (err) {
          setStatuses((prev) => ({ ...prev, [index]: 'error' }));
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) if (v === 'queued' || v === 'rendering') delete next[Number(k)];
        return next;
      });
      setProgress(null);
      setRendering(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const baseName = safeFileName(style.title || sourceName.replace(/\.[^.]+$/, '') || 'video');
  const doneIndices = parts.filter((p) => results[p.index]).map((p) => p.index);
  const downloadAll = async () => {
    for (const i of doneIndices) {
      downloadBlobUrl(results[i], `${baseName} - Part ${i + 1}.mp4`);
      await new Promise((r) => setTimeout(r, 400)); // browsers throttle rapid multi-downloads
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Parts</h1>
        <p className="text-xs text-neutral-500 mt-1">
          Split a long video into vertical parts with a title on top and "Part 1, Part 2…" labels.
        </p>
      </div>

      {/* SOURCE */}
      <section className="space-y-2">
        <h2 className="section-title">Source video</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            disabled={rendering}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickSource(file, file.name);
            }}
            className="text-sm"
          />
          <button onClick={() => setShowPicker((v) => !v)} disabled={rendering} className="btn-secondary text-xs">
            {showPicker ? 'Hide media library' : 'Choose from Media library'}
          </button>
          <button
            onClick={async () => {
              const asset = await pickRandomMediaAsset();
              if (asset) pickSource(asset.blob, asset.name);
            }}
            disabled={rendering}
            className="btn-secondary text-xs"
          >
            🎲 Random from Media
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Upload an MP4 — YouTube links can't be imported directly in a browser app.
        </p>
        {showPicker && <MediaPicker onPick={(a) => pickSource(a.blob, a.name)} />}
      </section>

      {sourceUrl && (
        <>
          {/* PREVIEW */}
          <section className="space-y-2">
            <h2 className="section-title">Preview</h2>
            <div className="flex gap-4 flex-wrap items-start">
              <div className="space-y-1">
                <video
                  ref={videoRef}
                  src={sourceUrl}
                  controls
                  className="w-80 rounded-md border border-neutral-800 bg-black"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                />
                <p className="text-xs text-neutral-500">
                  {sourceName} {duration ? `· ${formatTime(duration)}` : ''} — scrub here to preview any moment.
                </p>
              </div>
              <canvas
                ref={previewRef}
                width={540}
                height={960}
                className="w-[180px] h-[320px] rounded-md border border-neutral-800 bg-black"
              />
            </div>
          </section>

          {/* SETTINGS */}
          <section className="space-y-3">
            <h2 className="section-title">Layout</h2>
            <label className="block text-xs text-neutral-400 space-y-1">
              <span>Title (shown on every part)</span>
              <input
                value={style.title}
                disabled={rendering}
                onChange={(e) => setStyle({ ...style, title: e.target.value })}
                placeholder="e.g. The best scene ever"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="block text-xs text-neutral-400 space-y-1">
              <span>Credit (optional, shown smaller under the title)</span>
              <input
                value={style.credit}
                disabled={rendering}
                onChange={(e) => setStyle({ ...style, credit: e.target.value })}
                placeholder="e.g. Credit: @channel"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
              <label className="space-y-1">
                <span className="block">Video size</span>
                <select
                  value={style.fit}
                  disabled={rendering}
                  onChange={(e) => setStyle({ ...style, fit: e.target.value as PartsFit })}
                  className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                >
                  <option value="fit">Fit (whole frame)</option>
                  <option value="zoom">Zoomed (crop sides a bit)</option>
                  <option value="fill">Fill screen (crop to 9:16)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block">Background</span>
                <select
                  value={style.background}
                  disabled={rendering}
                  onChange={(e) => setStyle({ ...style, background: e.target.value as 'blur' | 'black' })}
                  className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                >
                  <option value="blur">Blurred video</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block">Part label color</span>
                <input
                  type="color"
                  value={style.accentColor}
                  disabled={rendering}
                  onChange={(e) => setStyle({ ...style, accentColor: e.target.value })}
                  className="h-8 w-14 rounded bg-neutral-950 border border-neutral-800"
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-1">
                <input
                  type="checkbox"
                  checked={style.showTotal}
                  disabled={rendering}
                  onChange={(e) => setStyle({ ...style, showTotal: e.target.checked })}
                />
                Show total ("Part 2/7")
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Split</h2>
            <div className="flex flex-wrap items-end gap-4 text-xs text-neutral-400">
              <div className="space-y-1">
                <span className="block">Part length</span>
                <div className="flex gap-1 items-center">
                  {PART_LENGTH_PRESETS.map((p) => (
                    <button
                      key={p}
                      disabled={rendering}
                      onClick={() => setPartLength(p)}
                      className={partLength === p ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                    >
                      {p < 60 ? `${p}s` : `${p / 60}m`}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={5}
                    value={partLength}
                    disabled={rendering}
                    onChange={(e) => setPartLength(Math.max(5, Number(e.target.value) || 5))}
                    className="w-20 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                  />
                  <span>sec</span>
                </div>
              </div>
              <label className="space-y-1">
                <span className="block">Start at</span>
                <input
                  value={rangeStartText}
                  disabled={rendering}
                  onChange={(e) => setRangeStartText(e.target.value)}
                  placeholder="0:00"
                  className="w-24 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                />
              </label>
              <label className="space-y-1">
                <span className="block">End at</span>
                <input
                  value={rangeEndText}
                  disabled={rendering}
                  onChange={(e) => setRangeEndText(e.target.value)}
                  placeholder={duration ? formatTime(duration) : 'end'}
                  className="w-24 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                />
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              Use Start/End to skip intros or credits. A very short leftover at the end is merged into the last part.
            </p>
          </section>

          {/* RENDER */}
          <section className="space-y-3 pb-10">
            <h2 className="section-title">Parts ({parts.length})</h2>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-neutral-400">Quality:</span>
              <button
                onClick={() => setQuality('draft')}
                disabled={rendering}
                className={quality === 'draft' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
              >
                Draft (720p, fast)
              </button>
              <button
                onClick={() => setQuality('final')}
                disabled={rendering}
                className={quality === 'final' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
              >
                Final (1080p)
              </button>
            </div>
            {caps && !caps.webCodecs && (
              <p className="text-xs text-amber-400">This tab needs the fast video engine — open the app in Chrome or Edge.</p>
            )}
            {caps?.webCodecs && !caps.hardwareEncoder && (
              <p className="text-xs text-amber-400">
                No hardware video encoder detected — encoding runs on your CPU, so Draft is noticeably faster.
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void renderQueue(parts.filter((p) => !results[p.index]).map((p) => p.index))}
                disabled={rendering || parts.length === 0 || doneIndices.length === parts.length}
                className="btn-primary"
              >
                {doneIndices.length > 0 && doneIndices.length < parts.length ? 'Render remaining parts' : 'Render all parts'}
              </button>
              {rendering && (
                <button onClick={cancel} className="btn-secondary text-xs">
                  Cancel
                </button>
              )}
              {doneIndices.length > 1 && !rendering && (
                <button onClick={() => void downloadAll()} className="btn-secondary text-xs">
                  Download all ({doneIndices.length})
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

            <div className="grid gap-2">
              {parts.map((p) => {
                const status = statuses[p.index];
                const url = results[p.index];
                return (
                  <div
                    key={p.index}
                    className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 flex-wrap"
                  >
                    <div className="text-sm font-medium w-16">Part {p.index + 1}</div>
                    <div className="text-xs text-neutral-400 w-36">
                      {formatTime(p.start)}–{formatTime(p.end)} ({Math.round(p.end - p.start)}s)
                    </div>
                    <div className="text-xs w-20">
                      {status === 'queued' && <span className="text-neutral-500">Queued</span>}
                      {status === 'rendering' && <span className="text-cyan-400">Rendering…</span>}
                      {status === 'done' && <span className="text-emerald-400">Done</span>}
                      {status === 'error' && <span className="text-red-400">Failed</span>}
                    </div>
                    <div className="flex gap-2 ml-auto">
                      {!url && (
                        <button
                          onClick={() => void renderQueue([p.index])}
                          disabled={rendering}
                          className="btn-secondary text-xs"
                        >
                          Render this part
                        </button>
                      )}
                      {url && (
                        <>
                          <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                            ▶ Watch
                          </a>
                          <button
                            onClick={() => downloadBlobUrl(url, `${baseName} - Part ${p.index + 1}.mp4`)}
                            className="btn-primary text-xs"
                          >
                            Download
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
