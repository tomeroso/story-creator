import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
  type AudioCodec,
  type VideoSample,
} from 'mediabunny';
import type { BackgroundClip, Segment } from '../../types/story';
import { estimateWordTimings } from '../captions/timing';
import type { RenderOptions, RenderProgress } from './videoRenderer';
import { ensureDisplayFont } from './fonts';
import { drawRedditCardFrame } from './redditCard';
import { pickRandomClipStart } from './clipSelection';
import { drawCaption, type TimedCard } from './captionDrawing';
import { overlaySoundEffects, type SoundChoice } from '../audio/soundEffects';

/**
 * Fast renderer built on the browser's WebCodecs API (via mediabunny for
 * MP4 demux/mux). Decoding and encoding go through the browser's native
 * codecs - hardware-accelerated on most machines - instead of FFmpeg
 * compiled to single-threaded WebAssembly, which is typically an order of
 * magnitude faster. Still 100% local: nothing is uploaded anywhere.
 *
 * Pipeline per output frame: decode the matching background frame -> draw it
 * straight onto the output canvas cover-cropped to 9:16 -> draw the current
 * caption card with the active word highlighted -> hand the canvas to the
 * H.264 encoder. Profiling showed decode + crop + captions together run at
 * 150-220 fps even on a single slow CPU core; the encoder is the only real
 * cost, which is why having a hardware encoder matters so much.
 */

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;
export interface WebCodecsSupport {
  supported: boolean;
  audioCodec: AudioCodec | null;
  reason?: string;
}

export async function checkWebCodecsSupport(width: number, height: number): Promise<WebCodecsSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return { supported: false, audioCodec: null, reason: 'This browser does not support WebCodecs.' };
  }
  try {
    const videoOk = await canEncodeVideo('avc', { width, height });
    if (!videoOk) return { supported: false, audioCodec: null, reason: 'H.264 encoding is not available in this browser.' };
    // AAC is the most compatible choice for social platforms; some browser
    // builds (e.g. Chromium on Linux) can't encode AAC, so fall back to Opus.
    const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: AUDIO_CHANNELS,
      sampleRate: AUDIO_SAMPLE_RATE,
    });
    if (!audioCodec) return { supported: false, audioCodec: null, reason: 'No usable audio encoder in this browser.' };
    return { supported: true, audioCodec };
  } catch (err) {
    return { supported: false, audioCodec: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

const ensureCaptionFont = ensureDisplayFont;

/** Decodes each segment's WAV, then mixes them back-to-back into one 48kHz stereo AudioBuffer. */
async function buildNarrationTrack(segments: Segment[]): Promise<{ buffer: AudioBuffer; offsets: number[]; durations: number[] }> {
  const decoder = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
  const decoded: AudioBuffer[] = [];
  for (const seg of segments) {
    // eslint-disable-next-line no-await-in-loop
    const data = await seg.audioBlob!.arrayBuffer();
    // eslint-disable-next-line no-await-in-loop
    decoded.push(await decoder.decodeAudioData(data));
  }
  const offsets: number[] = [];
  const durations: number[] = [];
  let cursor = 0;
  for (const buf of decoded) {
    offsets.push(cursor);
    durations.push(buf.duration);
    cursor += buf.duration;
  }
  const totalFrames = Math.max(1, Math.ceil(cursor * AUDIO_SAMPLE_RATE));
  const mixer = new OfflineAudioContext(AUDIO_CHANNELS, totalFrames, AUDIO_SAMPLE_RATE);
  decoded.forEach((buf, i) => {
    const node = mixer.createBufferSource();
    node.buffer = buf;
    node.connect(mixer.destination);
    node.start(offsets[i]);
  });
  const buffer = await mixer.startRendering();
  return { buffer, offsets, durations };
}

function buildCaptionCards(segments: Segment[], offsets: number[], durations: number[]): TimedCard[] {
  const cards: TimedCard[] = [];
  segments.forEach((seg, i) => {
    // Re-derive timings against the real decoded duration so captions can't drift from the audio.
    const words = estimateWordTimings(seg.text, durations[i]);
    const offset = offsets[i];
    const perCard = 1;
    for (let w = 0; w < words.length; w += perCard) {
      const chunk = words.slice(w, w + perCard).map((word) => ({
        text: word.text,
        start: word.start + offset,
        end: word.end + offset,
      }));
      if (chunk.length === 0) continue;
      cards.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, words: chunk });
    }
  });
  return cards;
}

function drawCommenterLabel(ctx: CanvasRenderingContext2D, name: string, width: number, height: number) {
  const s = width / 1080;
  const text = name.startsWith('u/') ? name : `u/${name}`;
  ctx.font = `${Math.round(34 * s)}px system-ui, sans-serif`;
  const padX = 20 * s;
  const boxH = 34 * s + 24 * s;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padX * 2;
  const x = (width - boxW) / 2;
  const y = height * 0.1;
  const r = boxH / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
  ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
  ctx.arcTo(x, y + boxH, x, y, r);
  ctx.arcTo(x, y, x + boxW, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7dd3fc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + boxH / 2 + 1 * s);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** Prepends silence to an AudioBuffer so it starts at `leadSeconds` in a longer timeline (used to hold narration silent during an intro card). */
async function padAudioWithSilence(buffer: AudioBuffer, leadSeconds: number): Promise<AudioBuffer> {
  const totalFrames = Math.max(1, Math.ceil((leadSeconds + buffer.duration) * buffer.sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, totalFrames, buffer.sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  node.start(leadSeconds);
  return ctx.startRendering();
}

/** Concatenates two AudioBuffers back-to-back (first, then second) into one buffer at `second`'s sample rate/channel count. */
async function concatAudio(first: AudioBuffer, second: AudioBuffer): Promise<AudioBuffer> {
  const totalFrames = Math.max(1, Math.ceil((first.duration + second.duration) * second.sampleRate));
  const ctx = new OfflineAudioContext(second.numberOfChannels, totalFrames, second.sampleRate);
  const a = ctx.createBufferSource();
  a.buffer = first;
  a.connect(ctx.destination);
  a.start(0);
  const b = ctx.createBufferSource();
  b.buffer = second;
  b.connect(ctx.destination);
  b.start(first.duration);
  return ctx.startRendering();
}

interface OpenClip {
  input: Input;
  sink: VideoSampleSink;
  firstTimestamp: number;
  sourceLength: number;
}

async function openClip(blob: Blob): Promise<OpenClip> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error('One of the background clips has no video track.');
  }
  if (!(await track.canDecode())) {
    input.dispose();
    throw new Error(
      "One of the background clips uses a format/codec this browser can't decode. Try converting it to MP4/H.264."
    );
  }
  const firstTimestamp = await track.getFirstTimestamp();
  const endTimestamp = await track.computeDuration();
  const sourceLength = Math.max(0.1, endTimestamp - firstTimestamp);
  return { input, sink: new VideoSampleSink(track), firstTimestamp, sourceLength };
}

/** Picks a random pool index different from `avoid` (or 0 if the pool has only one clip). */
function pickNextClipIndex(poolSize: number, avoid: number): number {
  if (poolSize <= 1) return 0;
  let idx = Math.floor(Math.random() * poolSize);
  while (idx === avoid) idx = Math.floor(Math.random() * poolSize);
  return idx;
}

/** Mixes a looped/volume-scaled music track under an existing narration+SFX buffer. The result is exactly as long as `narration`. */
async function mixInBackgroundMusic(narration: AudioBuffer, music: AudioBuffer, volume: number): Promise<AudioBuffer> {
  const targetSeconds = narration.duration;
  const totalFrames = Math.max(1, Math.ceil(targetSeconds * narration.sampleRate));
  const ctx = new OfflineAudioContext(narration.numberOfChannels, totalFrames, narration.sampleRate);

  const narrationSrc = ctx.createBufferSource();
  narrationSrc.buffer = narration;
  narrationSrc.connect(ctx.destination);
  narrationSrc.start(0);

  const musicGain = ctx.createGain();
  musicGain.gain.value = volume;
  musicGain.connect(ctx.destination);
  const loopLength = Math.max(0.05, music.duration);
  for (let t = 0; t < targetSeconds; t += loopLength) {
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.connect(musicGain);
    src.start(t);
  }
  return ctx.startRendering();
}

export async function renderStoryVideoWebCodecs(
  options: RenderOptions & { audioCodec: AudioCodec; signal?: AbortSignal },
  onProgress?: (p: RenderProgress) => void
): Promise<Blob> {
  const {
    segments,
    backgroundVideo,
    captionStyle,
    backgroundClipStart = 0,
    backgroundPlaybackRate = 1,
    backgroundFlip = false,
    redditCard,
    additionalBackgroundClips,
    backgroundRotationEnabled = false,
    backgroundSwitchSeconds = 5,
    introSound,
    backgroundTransition = 'cut',
    backgroundTransitionSound,
    titleTransitionSound,
    backgroundMusic,
    backgroundMusicVolume = 0.25,
    width = 1080,
    height = 1920,
    fps = 30,
    audioCodec,
    signal,
  } = options;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error('Render canceled.');
  };

  const renderable = segments.filter((s) => s.audioBlob).sort((a, b) => a.order - b.order);
  if (renderable.length === 0) {
    throw new Error('No segments have generated narration yet. Generate narration before rendering.');
  }

  const showCard = redditCard?.enabled === true;
  const FALLBACK_INTRO_SECONDS = 4;

  onProgress?.({ phase: 'preparing-audio', message: 'Mixing narration' });
  await ensureCaptionFont();
  const { buffer: rawNarration, offsets, durations } = await buildNarrationTrack(renderable);
  const answerDuration = rawNarration.duration;

  let introDuration = 0;
  let narration = rawNarration;
  if (showCard) {
    if (redditCard?.titleAudioBlob) {
      // Real spoken title: the intro lasts exactly as long as the narration
      // takes, not a guessed fixed length.
      const decoder = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
      const titleBuffer = await decoder.decodeAudioData(await redditCard.titleAudioBlob.arrayBuffer());
      introDuration = titleBuffer.duration;
      narration = await concatAudio(titleBuffer, rawNarration);
    } else {
      // No title narration generated yet - fall back to a silent card so
      // rendering still works, just without a spoken title.
      introDuration = FALLBACK_INTRO_SECONDS;
      narration = await padAudioWithSilence(rawNarration, introDuration);
    }
  }

  // Background clip pool - computed here (not just decoded later) because
  // the sound-effect pass below needs to know the clip-switch timing.
  const pool: Blob[] = [backgroundVideo, ...(additionalBackgroundClips ?? []).map((c: BackgroundClip) => c.blob)];
  const useRotation = backgroundRotationEnabled && pool.length >= 2;
  const switchFrames = Math.max(1, Math.round(backgroundSwitchSeconds * fps));
  const answerFrameCount = Math.max(1, Math.round(answerDuration * fps));

  // Sound effects: one at the very start, one right as the title card ends
  // (only meaningful when there actually was a spoken title phase), and one
  // at each background-clip switch when rotation is on.
  const soundCues: { at: number; choice: SoundChoice }[] = [];
  if (introSound && introSound.id !== 'none') soundCues.push({ at: 0, choice: introSound });
  if (titleTransitionSound && titleTransitionSound.id !== 'none' && showCard && introDuration > 0) {
    soundCues.push({ at: introDuration, choice: titleTransitionSound });
  }
  if (useRotation && backgroundTransitionSound && backgroundTransitionSound.id !== 'none') {
    let offset = 0;
    let isFirstChunk = true;
    while (offset < answerFrameCount) {
      const chunkFrames = Math.min(switchFrames, answerFrameCount - offset);
      if (!isFirstChunk) soundCues.push({ at: introDuration + offset / fps, choice: backgroundTransitionSound });
      isFirstChunk = false;
      offset += chunkFrames;
    }
  }
  if (soundCues.length > 0) narration = await overlaySoundEffects(narration, soundCues);

  if (backgroundMusic) {
    const musicDecoder = new OfflineAudioContext(1, 1, AUDIO_SAMPLE_RATE);
    const musicBuffer = await musicDecoder.decodeAudioData(await backgroundMusic.arrayBuffer());
    narration = await mixInBackgroundMusic(narration, musicBuffer, backgroundMusicVolume);
  }

  const cards = buildCaptionCards(renderable, offsets, durations);
  throwIfAborted();

  onProgress?.({ phase: 'preparing-video', message: 'Opening background video' });
  // BlobSource reads the file lazily - the whole background video is never
  // loaded into memory, which is what made huge files so painful with FFmpeg.wasm.
  const activeClips = useRotation ? pool : [pool[0]];
  const clips = await Promise.all(activeClips.map(openClip));
  let output: Output | null = null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // Opaque canvas: measurably faster to hand to the encoder than an RGBA one.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create a 2D canvas for rendering.');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 2,
    });
    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
    output.addVideoTrack(videoSource, { frameRate: fps });
    output.addAudioTrack(audioSource);
    await output.start();

    await audioSource.add(narration);
    audioSource.close();

    const frameDuration = 1 / fps;
    const introFrameCount = Math.round(introDuration * fps);
    const frameCount = introFrameCount + answerFrameCount;

    onProgress?.({ phase: 'rendering', ratio: 0, message: 'Rendering' });
    const startedAt = performance.now();
    let frameIndex = 0;

    const reportProgress = () => {
      if (frameIndex % 15 !== 0 && frameIndex !== frameCount) return;
      const elapsed = (performance.now() - startedAt) / 1000;
      const perFrame = elapsed / frameIndex;
      const remaining = Math.max(0, Math.round(perFrame * (frameCount - frameIndex)));
      onProgress?.({
        phase: 'rendering',
        ratio: frameIndex / frameCount,
        message: `Rendering frame ${frameIndex}/${frameCount} — about ${remaining}s left`,
      });
    };

    // Phase 2: the answers, driven by the background footage as before.
    let cardIndex = 0;
    let segIndex = 0;
    const segEndTimes = renderable.map((_, i) => offsets[i] + durations[i]);

    const renderAnswerFrame = (t: number) => {
      while (cardIndex < cards.length - 1 && t >= cards[cardIndex].end) cardIndex++;
      const card = cards[cardIndex];
      if (card && t >= card.start && t < card.end) {
        drawCaption(ctx, card, t, captionStyle, width, height);
      }
      while (segIndex < segEndTimes.length - 1 && t >= segEndTimes[segIndex]) segIndex++;
      const commenter = renderable[segIndex]?.commenterName;
      if (showCard && commenter) {
        drawCommenterLabel(ctx, commenter, width, height);
      }
    };

    const drawSample = (sample: VideoSample, alpha = 1) => {
      // cover-fit = scale up + center-crop the (usually 16:9) footage to 9:16,
      // respecting any rotation metadata.
      if (backgroundFlip) {
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        sample.drawWithFit(ctx, { fit: 'cover' });
        ctx.restore();
      } else {
        sample.drawWithFit(ctx, { fit: 'cover' });
      }
      sample.close();
      if (alpha < 1) {
        // Fade-to-black transition: darken this frame by (1 - alpha).
        ctx.fillStyle = `rgba(0,0,0,${1 - alpha})`;
        ctx.fillRect(0, 0, width, height);
      }
    };

    // Phase 1: background footage plays normally from the very start, with
    // the fake post card overlaid on top while the title is being read -
    // not a separate blacked-out title scene. Always uses clips[0] (the
    // primary clip), even in rotation mode.
    const introClip = clips[0];
    if (introFrameCount > 0) {
      function* introTimestamps() {
        for (let i = 0; i < introFrameCount; i++) {
          const offsetInSource = (backgroundClipStart + i * frameDuration * backgroundPlaybackRate) % introClip.sourceLength;
          yield introClip.firstTimestamp + Math.min(offsetInSource, introClip.sourceLength - frameDuration);
        }
      }
      let introFramesDrawn = 0;
      for await (const sample of introClip.sink.samplesAtTimestamps(introTimestamps())) {
        throwIfAborted();
        if (sample) drawSample(sample);
        drawRedditCardFrame(ctx, redditCard!, width, height);
        await videoSource.add(frameIndex * frameDuration, frameDuration);
        frameIndex++;
        introFramesDrawn++;
        reportProgress();
        if (introFramesDrawn >= introFrameCount) break;
      }
    }
    // How far into the source the intro already played, in source-seconds -
    // so Phase 2's single-clip path can continue seamlessly instead of
    // jumping back to the start the moment the card disappears.
    const introSourceSeconds = introFrameCount * frameDuration * backgroundPlaybackRate;

    if (!useRotation) {
      // Single background clip: one continuous timestamp generator, picking
      // up exactly where the intro left off (or from backgroundClipStart
      // directly when there was no intro) - no behavior change for existing
      // single-clip projects without a title card.
      const clip = clips[0];
      function* sourceTimestamps() {
        for (let i = 0; i < answerFrameCount; i++) {
          const offsetInSource =
            (backgroundClipStart + introSourceSeconds + i * frameDuration * backgroundPlaybackRate) % clip.sourceLength;
          yield clip.firstTimestamp + Math.min(offsetInSource, clip.sourceLength - frameDuration);
        }
      }
      for await (const sample of clip.sink.samplesAtTimestamps(sourceTimestamps())) {
        if (signal?.aborted) {
          sample?.close();
          throw new Error('Render canceled.');
        }
        const t = (frameIndex - introFrameCount) * frameDuration;
        if (sample) drawSample(sample);
        renderAnswerFrame(t);
        await videoSource.add(frameIndex * frameDuration, frameDuration);
        frameIndex++;
        reportProgress();
        if (frameIndex >= frameCount) break;
      }
    } else {
      // Multiple background clips: switch to a different (never
      // back-to-back-repeated) random clip every `backgroundSwitchSeconds`,
      // each time starting from a fresh random point within that clip. When
      // the transition style is "fade", each chunk fades in from black at
      // its start and fades to black at its end (skipping the very first
      // fade-in and very last fade-out, since there's no adjacent clip there).
      const FADE_SECONDS = 0.25;
      const fadeFrames = Math.max(1, Math.min(Math.round(FADE_SECONDS * fps), Math.floor(switchFrames / 2)));
      let answerFrameOffset = 0; // frames rendered so far within the answers phase
      let lastClipIndex = introFrameCount > 0 ? 0 : -1; // avoid repeating clips[0] right after it was shown during the intro
      let chunkIndex = 0;

      while (answerFrameOffset < answerFrameCount) {
        throwIfAborted();
        const clipIndex = pickNextClipIndex(clips.length, lastClipIndex);
        lastClipIndex = clipIndex;
        const clip = clips[clipIndex];
        const chunkFrames = Math.min(switchFrames, answerFrameCount - answerFrameOffset);
        const chunkStart = pickRandomClipStart(clip.sourceLength, chunkFrames / fps);
        const isFirstChunk = chunkIndex === 0;
        const isLastChunk = answerFrameOffset + chunkFrames >= answerFrameCount;

        function* chunkTimestamps() {
          for (let i = 0; i < chunkFrames; i++) {
            const offsetInSource = (chunkStart + i * frameDuration * backgroundPlaybackRate) % clip.sourceLength;
            yield clip.firstTimestamp + Math.min(offsetInSource, clip.sourceLength - frameDuration);
          }
        }

        let localIndex = 0;
        for await (const sample of clip.sink.samplesAtTimestamps(chunkTimestamps())) {
          if (signal?.aborted) {
            sample?.close();
            throw new Error('Render canceled.');
          }
          const t = (frameIndex - introFrameCount) * frameDuration;
          let alpha = 1;
          if (backgroundTransition === 'fade') {
            const fadeIn = isFirstChunk ? 1 : Math.min(1, localIndex / fadeFrames);
            const fadeOut = isLastChunk ? 1 : Math.min(1, (chunkFrames - 1 - localIndex) / fadeFrames);
            alpha = Math.min(fadeIn, fadeOut);
          }
          if (sample) drawSample(sample, alpha);
          renderAnswerFrame(t);
          await videoSource.add(frameIndex * frameDuration, frameDuration);
          frameIndex++;
          answerFrameOffset++;
          localIndex++;
          reportProgress();
          if (frameIndex >= frameCount) break;
        }
        chunkIndex++;
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
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    throw err;
  } finally {
    for (const clip of clips) clip.input.dispose();
  }
}
