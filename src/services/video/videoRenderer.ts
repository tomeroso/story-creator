import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { Segment } from '../../types/story';
import type { BackgroundClip, CaptionStyle, RedditPostCard } from '../../types/story';
import type { SoundChoice } from '../audio/soundEffects';
import { getVideoDuration } from './clipSelection';

export interface RenderProgress {
  phase: 'loading-engine' | 'preparing-audio' | 'preparing-video' | 'rendering' | 'done';
  ratio?: number; // 0-1 within the current phase, when known
  message?: string;
}

export interface RenderOptions {
  segments: Segment[];
  backgroundVideo: Blob;
  captionStyle: CaptionStyle;
  /** Where to start reading the background video, in seconds (from the chosen clip). */
  backgroundClipStart?: number;
  /** Background video playback speed (1 = normal). */
  backgroundPlaybackRate?: number;
  /** Mirror the background horizontally. */
  backgroundFlip?: boolean;
  /** Fake post card shown at the start, for AskReddit-style compilation videos (WebCodecs renderer only). */
  redditCard?: RedditPostCard;
  backgroundMusic?: Blob;
  backgroundMusicVolume?: number;
  introSound?: SoundChoice;
  titleTransitionSound?: SoundChoice;
  backgroundTransition?: 'cut' | 'fade';
  backgroundTransitionSound?: SoundChoice;
  /** Extra clips for background rotation (WebCodecs renderer only; the FFmpeg fallback ignores these and just uses backgroundVideo). */
  additionalBackgroundClips?: BackgroundClip[];
  backgroundRotationEnabled?: boolean;
  backgroundSwitchSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** x264 encode preset - faster presets trade some compression efficiency for real wall-clock speed. */
  preset?: 'ultrafast' | 'veryfast' | 'medium';
}

const FONT_FILE = 'captions.ttf';

// Bumped whenever the self-hosted FFmpeg core files change (e.g. UMD -> ESM
// build swap, single-thread -> multi-thread). Appending this as a query
// string means a browser or CDN that aggressively cached an old
// ffmpeg-core.js (see netlify.toml's long max-age on that path) will always
// fetch the current file instead of silently reusing a stale, incompatible
// one.
const FFMPEG_ASSET_VERSION = '3';

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Terminates the FFmpeg worker and clears the singleton so the next render
 * spawns a fresh instance. Needed after a hung/timed-out render - the old
 * worker may still be chewing through a huge file in the background, and
 * simply abandoning the promise would leave it running and unreusable.
 */
export function resetFFmpeg(): void {
  try {
    ffmpegSingleton?.terminate();
  } catch {
    // already gone - fine
  }
  ffmpegSingleton = null;
  loadPromise = null;
}

async function getFFmpeg(onProgress?: (p: RenderProgress) => void): Promise<FFmpeg> {
  if (ffmpegSingleton && ffmpegSingleton.loaded) return ffmpegSingleton;

  if (!ffmpegSingleton) ffmpegSingleton = new FFmpeg();
  const ffmpeg = ffmpegSingleton;

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.({ phase: 'rendering', ratio: Math.min(1, Math.max(0, progress)) });
  });

  if (!loadPromise) {
    loadPromise = (async () => {
      onProgress?.({ phase: 'loading-engine', message: 'Loading FFmpeg engine' });
      // Self-hosted, single-thread core. A multi-thread core was tried here
      // but reverted: it spawns its own worker threads that need to load the
      // engine themselves, and that path turned out to be an unreliable
      // source of silent hangs. Simpler and predictable wins for now.
      const base = `${window.location.origin}/ffmpeg`;
      // Same-origin static files, so plain URLs (not blob: URLs) are used -
      // no CORS workaround is needed here, and it keeps the loading path as
      // simple/predictable as possible.
      const coreURL = `${base}/ffmpeg-core.js?v=${FFMPEG_ASSET_VERSION}`;
      const wasmURL = `${base}/ffmpeg-core.wasm?v=${FFMPEG_ASSET_VERSION}`;
      try {
        await ffmpeg.load({ coreURL, wasmURL });
      } catch (err) {
        throw new Error(
          `FFmpeg engine failed to initialize (${
            err instanceof Error ? err.message : String(err)
          }). If this persists after a hard refresh, delete public/ffmpeg/*.js/.wasm and run "npm run sync-ffmpeg" again to regenerate them from node_modules.`
        );
      }
    })();
  }
  try {
    await loadPromise;
  } catch (err) {
    // Let a later call retry from scratch instead of replaying the same
    // cached rejection forever within one page session.
    loadPromise = null;
    throw err;
  }
  return ffmpeg;
}

/**
 * Real end-to-end render: concatenates segment narration into one audio
 * track, loops/crops the background video to match, burns in captions via
 * drawtext (timed per-segment from estimated word timings), and muxes the
 * result into a downloadable MP4.
 */
export async function renderStoryVideo(
  options: RenderOptions,
  onProgress?: (p: RenderProgress) => void
): Promise<Blob> {
  const {
    segments,
    backgroundVideo,
    captionStyle,
    backgroundClipStart = 0,
    width = 1080,
    height = 1920,
    fps = 30,
    preset = 'ultrafast',
  } = options;

  const renderable = segments.filter((s) => s.audioBlob);
  if (renderable.length === 0) {
    throw new Error('No segments have generated narration yet. Generate narration before rendering.');
  }

  const ffmpeg = await getFFmpeg(onProgress);

  onProgress?.({ phase: 'preparing-audio', message: 'Writing narration files' });

  // Write font once.
  if (!(await fileExists(ffmpeg, FONT_FILE))) {
    const fontResp = await fetch('/fonts/Captions-Bold.ttf');
    await ffmpeg.writeFile(FONT_FILE, await fetchFile(await fontResp.blob()));
  }

  // Write each segment's audio and build a concat list + a drawtext filter
  // chain timed against the running clock. IMPORTANT: one drawtext filter
  // per SEGMENT (not per word-group) - chaining a filter per few words
  // across many segments creates a huge filter graph that can make FFmpeg's
  // graph setup itself extremely slow (independent of video file size), and
  // was the actual cause of renders appearing to hang. A future version can
  // switch to real word-level highlighting via an ASS subtitle track if the
  // FFmpeg core build in use supports libass.
  let cursor = 0;
  const concatLines: string[] = [];
  const drawtextFilters: string[] = [];

  for (let i = 0; i < renderable.length; i++) {
    const seg = renderable[i];
    const filename = `seg_${i}.wav`;
    await ffmpeg.writeFile(filename, await fetchFile(seg.audioBlob!));
    concatLines.push(`file '${filename}'`);

    const duration = seg.duration ?? 0;
    const start = cursor.toFixed(2);
    const end = (cursor + duration).toFixed(2);
    const text = escapeDrawtext(wrapCaptionText(seg.text));
    const y = captionYExpression(captionStyle.position, height);
    drawtextFilters.push(
      `drawtext=fontfile=${FONT_FILE}:text='${text}':fontcolor=${hexToFFColor(captionStyle.color)}:` +
        `fontsize=${captionStyle.fontSize}:x=(w-text_w)/2:y=${y}:` +
        `borderw=6:bordercolor=black@0.85:` +
        `enable='between(t,${start},${end})'`
    );

    cursor += duration;
  }

  await ffmpeg.writeFile('concat_list.txt', concatLines.join('\n'));

  onProgress?.({ phase: 'preparing-video', message: 'Preparing background video' });
  await ffmpeg.writeFile('background.mp4', await fetchFile(backgroundVideo));

  // 1) Concatenate narration segments into one track.
  await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', 'narration.wav']);

  const totalDuration = cursor;

  // Only loop the background when the selected clip doesn't actually cover
  // the narration length - if the clip (from its chosen start point) is
  // already long enough, looping/re-seeking would be pure wasted decode
  // work, and matters a lot for large source files. If the clip turns out
  // too short for the current narration (e.g. text was edited after the
  // clip was picked), fall back to looping the whole file from the start
  // rather than producing a short/cut-off video.
  const backgroundDuration = await getVideoDuration(backgroundVideo).catch(() => null);
  const remainingFromClip = backgroundDuration !== null ? backgroundDuration - backgroundClipStart : null;
  const clipCoversNarration = remainingFromClip !== null && remainingFromClip >= totalDuration;
  const needsLoop = !clipCoversNarration;
  const effectiveStart = clipCoversNarration ? backgroundClipStart : 0;

  // The pre-trim pass below adds a second FFmpeg command, which is worth the
  // (small, but real) extra risk only when the source is genuinely large
  // enough that fighting through it during the main encode would actually be
  // slow - for a modest file the plain single-pass approach is simpler and
  // better-tested, so skip straight to it.
  const LARGE_SOURCE_BYTES = 300 * 1024 * 1024; // 300MB
  const LARGE_SOURCE_SECONDS = 15 * 60; // 15 minutes
  const sourceIsLarge =
    backgroundVideo.size > LARGE_SOURCE_BYTES || (backgroundDuration !== null && backgroundDuration > LARGE_SOURCE_SECONDS);

  // When we don't need to loop, pre-trim the background down to just the
  // needed clip with a fast stream-copy pass (no re-encoding - just
  // repackaging, so it's fast even on a huge source) before the expensive
  // scale/crop/caption/encode pass below. This means that expensive pass
  // reads a small file from the start instead of seeking through and
  // fighting a multi-gigabyte source, which is the main thing that makes
  // rendering with a large background video slow. If the copy-trim fails
  // for any reason (unusual codec, etc.), fall back to the original
  // single-pass approach on the full file.
  let compositeInput = 'background.mp4';
  let compositeSeek = effectiveStart;
  if (!needsLoop && sourceIsLarge && effectiveStart >= 0) {
    onProgress?.({ phase: 'preparing-video', message: 'Extracting clip from background video' });
    try {
      await ffmpeg.exec([
        ...(effectiveStart > 0 ? ['-ss', effectiveStart.toFixed(2)] : []),
        '-i',
        'background.mp4',
        '-t',
        totalDuration.toFixed(2),
        '-c',
        'copy',
        'clip.mp4',
      ]);
      compositeInput = 'clip.mp4';
      compositeSeek = 0;
    } catch {
      // Stream-copy trim isn't guaranteed to work for every codec/container -
      // fall back to seeking directly in the original file for the main pass.
      compositeInput = 'background.mp4';
      compositeSeek = effectiveStart;
    }
  }

  onProgress?.({ phase: 'rendering' });

  // 2) Loop (if needed) background video to cover the narration length, crop/scale to target aspect ratio.
  const cropFilter =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},fps=${fps}`;

  const captionChain = drawtextFilters.length > 0 ? ',' + drawtextFilters.join(',') : '';

  await ffmpeg.exec([
    ...(needsLoop ? ['-stream_loop', '-1'] : []),
    ...(compositeSeek > 0 ? ['-ss', compositeSeek.toFixed(2)] : []),
    '-i',
    compositeInput,
    '-i',
    'narration.wav',
    '-t',
    totalDuration.toFixed(2),
    '-vf',
    `${cropFilter}${captionChain}`,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    'output.mp4',
  ]);

  onProgress?.({ phase: 'done' });

  const data = await ffmpeg.readFile('output.mp4');
  const bytes = data as Uint8Array;
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  // Clean up the virtual filesystem so repeated renders don't leak memory.
  for (let i = 0; i < renderable.length; i++) {
    await safeDelete(ffmpeg, `seg_${i}.wav`);
  }
  await safeDelete(ffmpeg, 'concat_list.txt');
  await safeDelete(ffmpeg, 'background.mp4');
  await safeDelete(ffmpeg, 'clip.mp4');
  await safeDelete(ffmpeg, 'narration.wav');
  await safeDelete(ffmpeg, 'output.mp4');

  return new Blob([arrayBuffer], { type: 'video/mp4' });
}

async function fileExists(ffmpeg: FFmpeg, name: string): Promise<boolean> {
  try {
    await ffmpeg.readFile(name);
    return true;
  } catch {
    return false;
  }
}

async function safeDelete(ffmpeg: FFmpeg, name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // already gone / never written - fine
  }
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%')
    .replace(/\n/g, '\\n');
}

/** Wraps a segment's caption text into short lines so one drawtext filter can hold the whole thing legibly. */
function wrapCaptionText(text: string, wordsPerLine = 5): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(' '));
  }
  return lines.join('\n');
}

function hexToFFColor(hex: string): string {
  return hex.startsWith('#') ? `0x${hex.slice(1)}` : hex;
}

function captionYExpression(position: CaptionStyle['position'], height: number): string {
  if (position === 'top') return `${Math.round(height * 0.1)}`;
  if (position === 'center') return '(h-text_h)/2';
  return `h-${Math.round(height * 0.18)}`;
}
