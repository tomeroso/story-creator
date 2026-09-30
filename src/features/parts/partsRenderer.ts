import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type AudioCodec } from 'mediabunny';
import { encodeCanvasVideo } from '../../services/video/canvasEncoder';
import { ensureDisplayFont } from '../../services/video/fonts';
import type { RenderProgress } from '../../services/video/videoRenderer';
import { drawPartsFrame, type PartRange, type PartsStyle } from './partsLayout';

const AUDIO_SAMPLE_RATE = 48000;

export interface RenderPartOptions {
  source: Blob;
  part: PartRange;
  totalParts: number;
  style: PartsStyle;
  width: number;
  height: number;
  fps: number;
  audioCodec: AudioCodec;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
}

export async function renderPart(opts: RenderPartOptions): Promise<Blob> {
  const { source, part, totalParts, style, width, height, fps, audioCodec, signal, onProgress } = opts;
  await ensureDisplayFont();

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('This file has no video track.');
    if (!(await videoTrack.canDecode())) {
      throw new Error('This video format/codec is not supported by your browser. Try converting it to MP4/H.264 and import it again.');
    }
    // Times in the UI are relative to the start of the video; decoded
    // timestamps can start slightly above zero, so offset everything by the
    // video's first timestamp. Using the same base for audio keeps A/V sync
    // identical to the original file.
    const base = await videoTrack.getFirstTimestamp();
    const start = base + part.start;
    const end = base + part.end;
    const duration = part.end - part.start;

    // --- Audio: the original soundtrack for exactly this time range. ---
    onProgress?.({ phase: 'preparing-audio', message: `Part ${part.index + 1}: cutting audio` });
    let audio: AudioBuffer | null = null;
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && (await audioTrack.canDecode())) {
      const mixer = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * AUDIO_SAMPLE_RATE)), AUDIO_SAMPLE_RATE);
      const sink = new AudioBufferSink(audioTrack);
      for await (const chunk of sink.buffers(start, end)) {
        if (signal?.aborted) throw new Error('Render canceled.');
        const offset = chunk.timestamp - start;
        const node = mixer.createBufferSource();
        node.buffer = chunk.buffer;
        node.connect(mixer.destination);
        // Chunks that begin before the part start are trimmed from the front.
        node.start(Math.max(0, offset), Math.max(0, -offset));
      }
      audio = await mixer.startRendering();
    }

    // --- Video: one decoded source frame per output frame. ---
    const frameCount = Math.max(1, Math.round(duration * fps));
    const lastUsable = end - 1 / fps / 2;
    const timestamps = function* () {
      for (let i = 0; i < frameCount; i++) yield Math.min(start + i / fps, lastUsable);
    };
    const frames = new VideoSampleSink(videoTrack).samplesAtTimestamps(timestamps())[Symbol.asyncIterator]();

    try {
      return await encodeCanvasVideo({
        width,
        height,
        fps,
        frameCount,
        audio,
        audioCodec,
        signal,
        onProgress,
        label: `Part ${part.index + 1}/${totalParts}`,
        drawFrame: async (ctx) => {
          const { value: sample } = await frames.next();
          // null = no frame at that exact time; leave the previous frame on screen.
          if (!sample) return;
          drawPartsFrame(
            ctx,
            (c, dx, dy, dw, dh) => sample.draw(c, dx, dy, dw, dh),
            sample.displayWidth,
            sample.displayHeight,
            style,
            part.index + 1,
            totalParts,
            width,
            height
          );
          sample.close();
        },
      });
    } finally {
      await frames.return?.(undefined);
    }
  } finally {
    input.dispose();
  }
}
