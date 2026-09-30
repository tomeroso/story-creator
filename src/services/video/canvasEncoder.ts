import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type AudioCodec,
} from 'mediabunny';
import type { RenderProgress } from './videoRenderer';

export interface CanvasEncodeOptions {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  /** Complete audio track for the video (optional). */
  audio?: AudioBuffer | null;
  audioCodec: AudioCodec;
  signal?: AbortSignal;
  /** Draw frame `index` (at time `t` seconds) onto `ctx`. */
  drawFrame: (ctx: CanvasRenderingContext2D, index: number, t: number) => void | Promise<void>;
  onProgress?: (p: RenderProgress) => void;
  label?: string;
}

/**
 * Encodes frames drawn on a canvas (plus an optional audio track) into an MP4
 * using the browser's WebCodecs encoder (hardware-accelerated when available).
 * Same approach as the story renderer: draw -> hand canvas to encoder -> await
 * backpressure, so memory stays bounded however long the video is.
 */
export async function encodeCanvasVideo(opts: CanvasEncodeOptions): Promise<Blob> {
  const { width, height, fps, frameCount, audio, audioCodec, signal, drawFrame, onProgress, label = 'Rendering' } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D canvas for rendering.');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  try {
    const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (audio) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }

    const frameDuration = 1 / fps;
    const startedAt = performance.now();
    onProgress?.({ phase: 'rendering', ratio: 0, message: label });

    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new Error('Render canceled.');
      const t = i * frameDuration;
      await drawFrame(ctx, i, t);
      await videoSource.add(t, frameDuration);

      const done = i + 1;
      if (done % 15 === 0 || done === frameCount) {
        const elapsed = (performance.now() - startedAt) / 1000;
        const remaining = Math.max(0, Math.round((elapsed / done) * (frameCount - done)));
        onProgress?.({
          phase: 'rendering',
          ratio: done / frameCount,
          message: `${label}: frame ${done}/${frameCount} — about ${remaining}s left`,
        });
      }
    }

    videoSource.close();
    onProgress?.({ phase: 'rendering', ratio: 1, message: 'Finalizing MP4' });
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Rendering finished but produced no output.');
    onProgress?.({ phase: 'done' });
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw err;
  }
}
