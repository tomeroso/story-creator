import type { AudioCodec } from 'mediabunny';
import { encodeCanvasVideo } from '../../services/video/canvasEncoder';
import { ensureDisplayFont } from '../../services/video/fonts';
import type { RenderProgress } from '../../services/video/videoRenderer';
import { drawPhysicsFrame, type PhysicsLook } from './drawPhysics';
import { PhysicsSim, simulateHeadless, type PhysicsSettings } from './simulation';
import { renderSoundtrack, type SoundSettings } from './sound';

export interface RenderPhysicsOptions {
  settings: PhysicsSettings;
  sound: SoundSettings;
  look: PhysicsLook;
  width: number;
  height: number;
  fps: number;
  audioCodec: AudioCodec;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
}

/**
 * Two passes over the same deterministic simulation: first headless (to learn
 * the video length and every collision time for the soundtrack), then again
 * frame by frame while drawing and encoding.
 */
export async function renderPhysicsVideo(opts: RenderPhysicsOptions): Promise<Blob> {
  const { settings, sound, look, width, height, fps, audioCodec, signal, onProgress } = opts;
  await ensureDisplayFont();

  onProgress?.({ phase: 'preparing-audio', message: 'Simulating' });
  const { duration, events } = simulateHeadless(settings);
  if (signal?.aborted) throw new Error('Render canceled.');

  onProgress?.({ phase: 'preparing-audio', message: 'Synthesizing sounds' });
  const audio = await renderSoundtrack(events, duration, sound, settings.seed);
  if (signal?.aborted) throw new Error('Render canceled.');

  const sim = new PhysicsSim(settings);
  return encodeCanvasVideo({
    width,
    height,
    fps,
    frameCount: Math.max(1, Math.round(duration * fps)),
    audio,
    audioCodec,
    signal,
    onProgress,
    label: 'Rendering',
    drawFrame: (ctx, _i, t) => {
      sim.stepTo(t);
      drawPhysicsFrame(ctx, sim, look, width, height);
    },
  });
}
