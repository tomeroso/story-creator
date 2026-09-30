import { useRef, useState } from 'react';
import type { StoryProject } from '../../types/story';
import { estimateWordTimings } from '../../services/captions/timing';
import { estimateTargetClipSeconds } from './textProcessing';
import { useTTS } from '../../services/tts/useTTS';
import { renderStoryVideo, resetFFmpeg, type RenderProgress } from '../../services/video/videoRenderer';
import { getVideoDuration, pickRandomClipStart } from '../../services/video/clipSelection';
import { saveProject } from '../../services/storage/projectStore';

const RENDER_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      resetFFmpeg();
      reject(new Error(timeoutMessage));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Owns everything that should keep running in the background no matter which
 * tab is visible: the TTS engine (model loading + generation) and video
 * rendering. Call this once at the App level, NOT inside a screen component
 * that can unmount on tab switch - otherwise navigating to Media/Projects
 * and back resets voice-model loading and aborts in-progress generation.
 */
export function useStoryPipeline(project: StoryProject, onProjectChange: (project: StoryProject) => void) {
  const tts = useTTS();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [failedSegmentIds, setFailedSegmentIds] = useState<Set<string>>(new Set());
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Single source of truth for "what's actually saved so far" - kept current
  // during render (not in an effect) so every write builds on the previous
  // one instead of a stale snapshot, regardless of React's render timing.
  const projectRef = useRef(project);
  projectRef.current = project;

  // Bumped on every render attempt and on cancel, so a stale/canceled
  // attempt's late progress events or eventual settle can be told apart
  // from the current one.
  const renderGenerationRef = useRef(0);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [renderEngine, setRenderEngine] = useState<'webcodecs' | 'ffmpeg' | null>(null);

  const update = (patch: Partial<StoryProject>) => {
    const next = { ...projectRef.current, ...patch, updatedAt: Date.now() };
    projectRef.current = next;
    onProjectChange(next);
    void saveProject(next);
  };

  const generateSegment = async (segmentId: string) => {
    const startProjectId = projectRef.current.id;
    const segment = projectRef.current.segments.find((s) => s.id === segmentId);
    if (!segment) return;
    setGeneratingId(segmentId);
    try {
      const result = await tts.generate(segment.text, projectRef.current.voiceId, projectRef.current.voiceSpeed ?? 1);
      const captionWords = estimateWordTimings(segment.text, result.duration);
      // If the user switched to a different project while this was running,
      // don't merge this audio into whatever project happens to be active now.
      if (projectRef.current.id !== startProjectId) return;
      const nextSegments = projectRef.current.segments.map((s) =>
        s.id === segmentId ? { ...s, audioBlob: result.audioBlob, duration: result.duration, captionWords } : s
      );
      update({ segments: nextSegments });
      setFailedSegmentIds((prev) => {
        const next = new Set(prev);
        next.delete(segmentId);
        return next;
      });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
      setFailedSegmentIds((prev) => new Set(prev).add(segmentId));
    } finally {
      setGeneratingId(null);
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    setRenderError(null);
    const startProjectId = projectRef.current.id;
    const idsToGenerate = projectRef.current.segments.map((s) => s.id);
    for (const id of idsToGenerate) {
      if (projectRef.current.id !== startProjectId) break;
      // eslint-disable-next-line no-await-in-loop
      await generateSegment(id);
    }
    setGeneratingAll(false);
    if (projectRef.current.id !== startProjectId) return;
    const stillMissing = projectRef.current.segments.filter((s) => !s.audioBlob);
    if (stillMissing.length > 0) {
      const nums = stillMissing.map((s) => s.order + 1).join(', ');
      setRenderError(
        `Narration failed for segment${stillMissing.length > 1 ? 's' : ''} ${nums} — see that segment for details, or click "Regenerate narration" on it.`
      );
    }
  };

  const handleRender = async () => {
    const current = projectRef.current;
    if (!current.backgroundVideo) {
      setRenderError('Upload a background video first.');
      return;
    }
    const startProjectId = current.id;
    const generation = ++renderGenerationRef.current;
    const abort = new AbortController();
    renderAbortRef.current = abort;
    setRenderError(null);
    setOutputUrl(null);
    setRenderProgress({ phase: 'loading-engine', message: 'Checking browser video support' });
    try {
      const quality = current.renderQuality ?? 'final';
      const size = quality === 'draft' ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
      const renderOptions = {
        segments: current.segments,
        backgroundVideo: current.backgroundVideo,
        captionStyle: current.captionStyle,
        backgroundClipStart: current.backgroundClipStart,
        backgroundPlaybackRate: current.backgroundPlaybackRate ?? 1,
        backgroundFlip: current.backgroundFlip ?? false,
        redditCard: current.redditCard,
        backgroundMusic: current.backgroundMusic,
        backgroundMusicVolume: current.backgroundMusicVolume ?? 0.25,
        backgroundTransition: current.backgroundTransition ?? 'cut',
        backgroundTransitionSound: current.backgroundTransitionSound,
        additionalBackgroundClips: current.additionalBackgroundClips,
        backgroundRotationEnabled: current.backgroundRotationEnabled ?? false,
        backgroundSwitchSeconds: current.backgroundSwitchSeconds ?? 5,
        introSound: current.introSound,
        titleTransitionSound: current.titleTransitionSound,
        ...size,
      };
      const onProgress = (p: RenderProgress) => {
        // A canceled/superseded render's late progress events shouldn't
        // clobber whatever the UI is showing now.
        if (renderGenerationRef.current === generation) setRenderProgress(p);
      };

      // Fast path: the browser's native (usually hardware-accelerated) video
      // codecs. Slow path: FFmpeg.wasm, kept only for browsers without WebCodecs.
      // Loaded on demand so the main app bundle stays small.
      const { checkWebCodecsSupport, renderStoryVideoWebCodecs } = await import('../../services/video/webCodecsRenderer');
      const support = await checkWebCodecsSupport(size.width, size.height);
      if (renderGenerationRef.current !== generation) return;
      setRenderEngine(support.supported ? 'webcodecs' : 'ffmpeg');

      const renderPromise = support.supported
        ? renderStoryVideoWebCodecs({ ...renderOptions, audioCodec: support.audioCodec!, signal: abort.signal }, onProgress)
        : renderStoryVideo(renderOptions, onProgress);

      const blob = await withTimeout(
        renderPromise,
        RENDER_TIMEOUT_MS,
        'Rendering timed out. Try a shorter background clip, or use Chrome/Edge for the fast rendering engine.'
      );
      if (renderGenerationRef.current !== generation) return; // canceled while this was running
      if (projectRef.current.id !== startProjectId) return;
      update({ renderedVideo: blob });
      setOutputUrl(URL.createObjectURL(blob));
    } catch (err) {
      if (renderGenerationRef.current !== generation) return; // already canceled/reset
      setRenderError(err instanceof Error ? err.message : String(err));
      // Without this, a render that fails (or times out) while progress was
      // mid-flight leaves renderProgress.phase stuck at 'rendering' forever,
      // which permanently disables the Render button with no way to retry
      // short of a full page reload.
      setRenderProgress(null);
    }
  };

  /**
   * Lets the user bail out of a stuck/slow render immediately instead of
   * waiting up to RENDER_TIMEOUT_MS. Terminates the FFmpeg worker outright
   * (there's no graceful "stop" mid-exec) and marks any in-flight render
   * generation as stale so its eventual settle (if any) is ignored.
   */
  const cancelRender = () => {
    renderGenerationRef.current++;
    renderAbortRef.current?.abort();
    resetFFmpeg();
    setRenderProgress(null);
    setRenderError('Render canceled.');
  };

  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  /**
   * Sets a new background video and immediately picks a random clip from it
   * matching the current narration length (or an estimate, if narration
   * hasn't been generated yet), rather than always starting at frame 0.
   */
  const setBackgroundVideo = async (file: Blob, name?: string) => {
    setBackgroundError(null);
    let duration: number | undefined;
    try {
      duration = await getVideoDuration(file);
    } catch (err) {
      // Still usable (renderer re-probes and falls back to looping from 0) -
      // just can't offer a curated random clip without knowing the length.
      setBackgroundError(
        `Could not read this video's duration (${err instanceof Error ? err.message : String(err)}) - it can still be used, but will be looped from the start rather than clipped.`
      );
    }
    const target = estimateTargetClipSeconds(projectRef.current);
    const clipStart = duration !== undefined ? pickRandomClipStart(duration, target) : 0;
    update({
      backgroundVideo: file,
      backgroundVideoName: name,
      backgroundVideoDuration: duration,
      backgroundClipStart: clipStart,
    });
  };

  const [generatingTitleNarration, setGeneratingTitleNarration] = useState(false);

  const generateCardTitleNarration = async () => {
    const startProjectId = projectRef.current.id;
    const card = projectRef.current.redditCard;
    if (!card || !card.title.trim()) return;
    setGeneratingTitleNarration(true);
    try {
      const result = await tts.generate(card.title, projectRef.current.voiceId, projectRef.current.voiceSpeed ?? 1);
      if (projectRef.current.id !== startProjectId) return;
      const latestCard = projectRef.current.redditCard ?? card;
      update({
        redditCard: { ...latestCard, titleAudioBlob: result.audioBlob, titleAudioDuration: result.duration },
      });
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingTitleNarration(false);
    }
  };

  /** Picks a different random clip start from the same background video. */
  const rerollBackgroundClip = () => {
    const current = projectRef.current;
    if (!current.backgroundVideo || !current.backgroundVideoDuration) return;
    const target = estimateTargetClipSeconds(current);
    update({ backgroundClipStart: pickRandomClipStart(current.backgroundVideoDuration, target) });
  };

  /** Adds a clip to the background rotation pool (used alongside the primary backgroundVideo). */
  const addRotationClip = (blob: Blob, name: string) => {
    const current = projectRef.current;
    update({ additionalBackgroundClips: [...(current.additionalBackgroundClips ?? []), { blob, name }] });
  };

  const removeRotationClip = (index: number) => {
    const current = projectRef.current;
    const next = (current.additionalBackgroundClips ?? []).filter((_, i) => i !== index);
    update({ additionalBackgroundClips: next });
  };

  return {
    tts,
    generatingId,
    generatingAll,
    failedSegmentIds,
    renderProgress,
    renderError,
    outputUrl,
    renderEngine,
    backgroundError,
    update,
    generateSegment,
    generateAll,
    handleRender,
    cancelRender,
    setBackgroundVideo,
    rerollBackgroundClip,
    addRotationClip,
    removeRotationClip,
    generatingTitleNarration,
    generateCardTitleNarration,
  };
}

export type StoryPipeline = ReturnType<typeof useStoryPipeline>;
