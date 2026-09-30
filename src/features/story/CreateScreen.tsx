import { useEffect, useMemo, useState } from 'react';
import type { CaptionStyle, RedditPostCard, StoryProject } from '../../types/story';
import { DEFAULT_REDDIT_CARD } from '../../types/story';
import {
  cleanStoryText,
  computeStats,
  deriveTitleFromText,
  estimateTargetClipSeconds,
  mergeSegments,
  reorderSegments,
  splitIntoAnswers,
  splitIntoSegments,
  splitSegment,
} from './textProcessing';
import type { StoryPipeline } from './useStoryPipeline';
import { SegmentCard } from './SegmentCard';
import { CaptionPreview } from './CaptionPreview';
import { MediaPicker } from '../../components/MediaPicker';
import { listMediaAssets, pickRandomMediaAsset, type MediaAsset } from '../../services/storage/mediaStore';
import { DEFAULT_PROJECT_NAME } from '../../services/storage/projectStore';
import { detectEncoderCapabilities, type EncoderCapabilities } from '../../services/video/encoderCapabilities';
import { safeFileName } from '../../utils/format';
import { NO_SOUND } from '../../services/audio/soundEffects';
import { SoundEffectPicker } from './SoundEffectPicker';

interface Props {
  project: StoryProject;
  pipeline: StoryPipeline;
}

const VOICES = [
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' },
  { id: 'bm_george', label: 'George (UK, male)' },
];

export function CreateScreen({ project, pipeline }: Props) {
  const {
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
  } = pipeline;

  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showRotationPicker, setShowRotationPicker] = useState(false);
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | null>(null);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [mediaAssetUrls, setMediaAssetUrls] = useState<Record<string, string>>({});
  const [mediaLoading, setMediaLoading] = useState(false);
  const [encoderCaps, setEncoderCaps] = useState<EncoderCapabilities | null>(null);

  useEffect(() => {
    void detectEncoderCapabilities().then(setEncoderCaps);
  }, []);

  useEffect(() => {
    if (project.backgroundVideo) {
      const url = URL.createObjectURL(project.backgroundVideo);
      setBackgroundUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setBackgroundUrl(null);
  }, [project.backgroundVideo]);

  useEffect(() => {
    if (project.backgroundMusic) {
      const url = URL.createObjectURL(project.backgroundMusic);
      setMusicPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setMusicPreviewUrl(null);
  }, [project.backgroundMusic]);

  // Load the media library list only when the picker is actually opened -
  // no need to touch IndexedDB on every Create screen visit.
  useEffect(() => {
    if (!showMediaPicker) return;
    setMediaLoading(true);
    listMediaAssets()
      .then(setMediaAssets)
      .finally(() => setMediaLoading(false));
  }, [showMediaPicker]);

  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const asset of mediaAssets) {
      urls[asset.id] = URL.createObjectURL(asset.blob);
    }
    setMediaAssetUrls(urls);
    return () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [mediaAssets]);

  const stats = useMemo(() => computeStats(project.cleanedText || project.rawText), [project.cleanedText, project.rawText]);
  const targetClipSeconds = useMemo(() => estimateTargetClipSeconds(project), [project]);

  const exportFileName = useMemo(() => {
    const hasCustomName = project.name.trim() && project.name.trim() !== DEFAULT_PROJECT_NAME;
    const title = hasCustomName ? project.name : deriveTitleFromText(project.cleanedText || project.rawText);
    return safeFileName(title);
  }, [project.name, project.cleanedText, project.rawText]);

  const LONG_VIDEO_SECONDS = 20 * 60; // 20 minutes
  const LARGE_FILE_BYTES = 500 * 1024 * 1024; // 500MB
  const backgroundTooLarge =
    (project.backgroundVideoDuration !== undefined && project.backgroundVideoDuration > LONG_VIDEO_SECONDS) ||
    (project.backgroundVideo?.size ?? 0) > LARGE_FILE_BYTES;

  // A reroll only makes sense when the source is long enough to offer a
  // different random start point - if the video is shorter than (or close
  // to) the narration length, the whole thing gets used/looped regardless.
  const pickRandomBackground = async () => {
    const asset = await pickRandomMediaAsset();
    if (asset) void setBackgroundVideo(asset.blob, asset.name);
  };

  const canReroll =
    project.backgroundVideo !== undefined &&
    project.backgroundVideoDuration !== undefined &&
    project.backgroundVideoDuration > targetClipSeconds;

  const handleCleanText = () => {
    update({ cleanedText: cleanStoryText(project.rawText) });
  };

  const handleSplitIntoScenes = () => {
    const source = project.cleanedText || cleanStoryText(project.rawText);
    const segments = splitIntoSegments(source);
    update({ cleanedText: source, segments });
  };

  const redditCard = project.redditCard ?? DEFAULT_REDDIT_CARD;
  const updateCaptionStyle = (patch: Partial<CaptionStyle>) => update({ captionStyle: { ...project.captionStyle, ...patch } });
  const updateRedditCard = (patch: Partial<RedditPostCard>) => update({ redditCard: { ...redditCard, ...patch } });

  const handleSplitIntoAnswers = () => {
    const source = project.cleanedText || cleanStoryText(project.rawText);
    const segments = splitIntoAnswers(source);
    update({ cleanedText: source, segments });
  };

  const allSegmentsNarrated = project.segments.length > 0 && project.segments.every((s) => s.audioBlob);
  const narratedCount = project.segments.filter((s) => s.audioBlob).length;
  const missingSegments = project.segments.filter((s) => !s.audioBlob).map((s) => s.order + 1);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <div>
        <input
          value={project.name}
          onChange={(e) => update({ name: e.target.value })}
          className="text-xl font-semibold bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-cyan-500 focus:outline-none"
        />
      </div>

      {/* SOURCE */}
      <section className="space-y-2">
        <h2 className="section-title">Source</h2>
        <textarea
          value={project.rawText}
          onChange={(e) => update({ rawText: e.target.value })}
          placeholder="Paste your Reddit story or script here…"
          rows={8}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={project.preserveOriginalWording}
            onChange={(e) => update({ preserveOriginalWording: e.target.checked })}
          />
          Preserve original wording (formatting cleanup only)
        </label>
      </section>

      {/* STORY EDITOR */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Story editor</h2>
          <div className="text-xs text-neutral-500 flex gap-3">
            <span>{stats.words} words</span>
            <span>{stats.characters} chars</span>
            <span>{stats.paragraphs} paragraphs</span>
            <span>~{Math.round(stats.estimatedSeconds)}s</span>
          </div>
        </div>
        <textarea
          value={project.cleanedText}
          onChange={(e) => update({ cleanedText: e.target.value })}
          rows={8}
          className="w-full rounded-md bg-neutral-950 border border-neutral-800 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
          placeholder="Cleaned narration text appears here — edit freely."
        />
        <div className="flex gap-2">
          <button onClick={handleCleanText} className="btn-secondary">
            Clean text
          </button>
          <button onClick={handleSplitIntoScenes} className="btn-secondary">
            Split into scenes
          </button>
          <button onClick={handleSplitIntoAnswers} className="btn-secondary">
            Split into answers
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          "Split into answers" treats each blank-line-separated paragraph as one commenter's answer (for AskReddit-style
          compilation videos) — pair it with the Reddit post card below.
        </p>
      </section>

      {/* CAPTIONS */}
      <section className="space-y-3">
        <h2 className="section-title">Captions</h2>
        <div className="flex gap-4 flex-wrap items-start">
          <CaptionPreview style={project.captionStyle} />
          <div className="flex-1 min-w-[240px] grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-neutral-400 space-y-1">
              <span className="flex justify-between">
                <span>Font size</span>
                <span className="text-neutral-300">{project.captionStyle.fontSize}px</span>
              </span>
              <input
                type="range"
                min={32}
                max={100}
                value={project.captionStyle.fontSize}
                onChange={(e) => updateCaptionStyle({ fontSize: Number(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span className="block">Location</span>
              <select
                value={project.captionStyle.position}
                onChange={(e) => updateCaptionStyle({ position: e.target.value as CaptionStyle['position'] })}
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="top">Top</option>
                <option value="center">Center</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span className="block">Text color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.captionStyle.color}
                  onChange={(e) => updateCaptionStyle({ color: e.target.value })}
                  className="h-8 w-14 rounded bg-neutral-950 border border-neutral-800"
                />
                <span className="text-neutral-500">{project.captionStyle.color}</span>
              </div>
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span className="block">Background style</span>
              <select
                value={project.captionStyle.backgroundStyle}
                onChange={(e) => updateCaptionStyle({ backgroundStyle: e.target.value as CaptionStyle['backgroundStyle'] })}
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="pill">Solid pill background</option>
                <option value="outline">Outlined text</option>
                <option value="none">No background</option>
              </select>
            </label>
            {project.captionStyle.backgroundStyle !== 'none' && (
              <label className="text-xs text-neutral-400 space-y-1">
                <span className="block">{project.captionStyle.backgroundStyle === 'pill' ? 'Pill color' : 'Outline color'}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={project.captionStyle.backgroundColor}
                    onChange={(e) => updateCaptionStyle({ backgroundColor: e.target.value })}
                    className="h-8 w-14 rounded bg-neutral-950 border border-neutral-800"
                  />
                  <span className="text-neutral-500">{project.captionStyle.backgroundColor}</span>
                </div>
              </label>
            )}
            <label className="text-xs text-neutral-400 space-y-1">
              <span className="block">Animation</span>
              <select
                value={project.captionStyle.animation}
                onChange={(e) => updateCaptionStyle({ animation: e.target.value as CaptionStyle['animation'] })}
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="pop">Pop (bounce in)</option>
                <option value="fade">Fade in</option>
                <option value="slide">Slide up</option>
                <option value="none">None (instant)</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* REDDIT POST CARD */}
      <section className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={redditCard.enabled}
            onChange={(e) => updateRedditCard({ enabled: e.target.checked })}
          />
          <h2 className="section-title !mb-0">Show as a Reddit post (AskReddit-style intro)</h2>
        </label>
        {redditCard.enabled && (
          <div className="grid sm:grid-cols-2 gap-3 pl-6">
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Subreddit</span>
              <input
                value={redditCard.subreddit}
                onChange={(e) => updateRedditCard({ subreddit: e.target.value })}
                placeholder="AskReddit"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Post author</span>
              <input
                value={redditCard.author}
                onChange={(e) => updateRedditCard({ author: e.target.value })}
                placeholder="u/anonymous"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1 sm:col-span-2">
              <span>Post title (the question)</span>
              <input
                value={redditCard.title}
                onChange={(e) => updateRedditCard({ title: e.target.value, titleAudioBlob: undefined, titleAudioDuration: undefined })}
                placeholder="What's the fastest way you have seen someone ruin their life?"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => void generateCardTitleNarration()}
                  disabled={tts.status !== 'ready' || generatingTitleNarration || !redditCard.title.trim()}
                  className="btn-secondary text-xs"
                  type="button"
                >
                  {generatingTitleNarration
                    ? 'Generating…'
                    : redditCard.titleAudioBlob
                      ? 'Regenerate title narration'
                      : 'Generate title narration'}
                </button>
                {redditCard.titleAudioBlob && (
                  <span className="text-emerald-400">Read aloud ({redditCard.titleAudioDuration?.toFixed(1)}s)</span>
                )}
                {!redditCard.titleAudioBlob && (
                  <span className="text-amber-400">Not read aloud yet — card will show silently for ~4s</span>
                )}
              </div>
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Upvotes shown</span>
              <input
                value={redditCard.upvotes}
                onChange={(e) => updateRedditCard({ upvotes: e.target.value })}
                placeholder="1.2K"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Time shown</span>
              <input
                value={redditCard.timeAgo}
                onChange={(e) => updateRedditCard({ timeAgo: e.target.value })}
                placeholder="2d ago"
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
          </div>
        )}
        <p className="text-xs text-neutral-500 pl-6">
          When the title has been read aloud, the card stays up for exactly as long as that takes, then cuts to the
          background footage for the answers. Without generated narration it falls back to a silent ~4 seconds. This is
          a generic card design, not a copy of any real app's logo — fill in whatever fictional post you'd like.
        </p>
      </section>

      {/* SOUND EFFECTS */}
      <section className="space-y-3">
        <h2 className="section-title">Sound effects</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <SoundEffectPicker
            label="At the very start of the video"
            value={project.introSound ?? NO_SOUND}
            onChange={(choice) => update({ introSound: choice })}
          />
          <SoundEffectPicker
            label="Right after the title (cutting to the answers)"
            value={project.titleTransitionSound ?? NO_SOUND}
            onChange={(choice) => update({ titleTransitionSound: choice })}
          />
        </div>
        <p className="text-xs text-neutral-500">
          Pick a built-in synthesized sound (no files needed), or one of your own uploads from the Sound Effects
          section of the Media tab. The second one only plays if "Show as a Reddit post" is on and the title has been
          read aloud above.
        </p>
      </section>

      {/* BACKGROUND MUSIC */}
      <section className="space-y-2">
        <h2 className="section-title">Background music</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) update({ backgroundMusic: file, backgroundMusicName: file.name });
            }}
            className="text-sm"
          />
          <button onClick={() => setShowMusicPicker((v) => !v)} className="btn-secondary text-xs">
            {showMusicPicker ? 'Hide media library' : 'Choose from Media library'}
          </button>
          {project.backgroundMusic && (
            <button
              onClick={() => update({ backgroundMusic: undefined, backgroundMusicName: undefined })}
              className="btn-ghost text-xs text-red-400"
            >
              Remove
            </button>
          )}
        </div>
        {showMusicPicker && (
          <MediaPicker
            kind="audio"
            onPick={(a) => {
              update({ backgroundMusic: a.blob, backgroundMusicName: a.name });
              setShowMusicPicker(false);
            }}
          />
        )}
        {project.backgroundMusic && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-400">🎵 {project.backgroundMusicName ?? 'Selected track'}</p>
            {musicPreviewUrl && <audio src={musicPreviewUrl} controls className="w-full h-9" />}
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <span className="w-16">Volume {Math.round((project.backgroundMusicVolume ?? 0.25) * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={project.backgroundMusicVolume ?? 0.25}
                onChange={(e) => update({ backgroundMusicVolume: Number(e.target.value) })}
                className="w-48 accent-cyan-500"
              />
            </label>
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Loops automatically to match the video's length and mixes in under the narration. Only use music you have the
          rights to use.
        </p>
      </section>

      {/* VOICE */}
      <section className="space-y-2">
        <h2 className="section-title">Narration voice</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={project.voiceId}
            onChange={(e) => update({ voiceId: e.target.value })}
            className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>

          {tts.status !== 'ready' && (
            <button onClick={tts.loadVoiceModel} disabled={tts.status === 'loading'} className="btn-secondary text-xs">
              {tts.status === 'loading' ? 'Loading voice model…' : 'Load voice model'}
            </button>
          )}
          {tts.status === 'ready' && <span className="text-xs text-emerald-400">Voice model ready (offline)</span>}
          {tts.progress?.status && tts.status === 'loading' && (
            <span className="text-xs text-neutral-500">
              {tts.progress.status}
              {typeof tts.progress.progress === 'number' ? ` — ${Math.round(tts.progress.progress * 100)}%` : ''}
            </span>
          )}
          {tts.error && <span className="text-xs text-red-400">{tts.error}</span>}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="w-24">Speed {(project.voiceSpeed ?? 1).toFixed(2)}×</span>
          <input
            type="range"
            min={0.7}
            max={2}
            step={0.05}
            value={project.voiceSpeed ?? 1}
            onChange={(e) => update({ voiceSpeed: Number(e.target.value) })}
            className="w-40 accent-cyan-500"
          />
          <span className="text-neutral-600">(regenerate narration to apply)</span>
        </label>
        {(project.voiceSpeed ?? 1) > 1.5 && (
          <p className="text-xs text-amber-400 pl-24">
            Above ~1.5× the voice can start sounding unnatural/glitchy — that's a limitation of the TTS model itself,
            not something rendering settings can fix.
          </p>
        )}
        <p className="text-xs text-neutral-500">
          First load downloads the model (~80–300MB depending on quality) once; it's cached for offline reuse after
          that. Loading and generation keep running even if you switch to another tab.
        </p>
      </section>

      {/* SEGMENTS */}
      {project.segments.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="section-title">
              Segments ({narratedCount}/{project.segments.length} narrated)
            </h2>
            <button onClick={generateAll} disabled={tts.status !== 'ready' || generatingAll} className="btn-primary text-xs">
              {generatingAll ? 'Generating all…' : 'Generate all narration'}
            </button>
          </div>
          <div className="space-y-2">
            {project.segments
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((segment, i) => (
                <SegmentCard
                  key={segment.id}
                  segment={segment}
                  index={i}
                  total={project.segments.length}
                  isGenerating={generatingId === segment.id}
                  canGenerate={tts.status === 'ready'}
                  failed={failedSegmentIds.has(segment.id)}
                  showCommenterName={redditCard.enabled}
                  onChangeText={(text) =>
                    update({ segments: project.segments.map((s) => (s.id === segment.id ? { ...s, text } : s)) })
                  }
                  onChangeCommenterName={(name) =>
                    update({ segments: project.segments.map((s) => (s.id === segment.id ? { ...s, commenterName: name } : s)) })
                  }
                  onGenerate={() => generateSegment(segment.id)}
                  onDelete={() => update({ segments: project.segments.filter((s) => s.id !== segment.id) })}
                  onMoveUp={() => update({ segments: reorderSegments(project.segments, i, i - 1) })}
                  onMoveDown={() => update({ segments: reorderSegments(project.segments, i, i + 1) })}
                  onMergeWithNext={() => {
                    const sorted = project.segments.slice().sort((a, b) => a.order - b.order);
                    const next = sorted[i + 1];
                    if (next) update({ segments: mergeSegments(project.segments, segment.id, next.id) });
                  }}
                  onSplit={(charIndex) => update({ segments: splitSegment(project.segments, segment.id, charIndex) })}
                />
              ))}
          </div>
        </section>
      )}

      {/* BACKGROUND */}
      <section className="space-y-2">
        <h2 className="section-title">Background video</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void setBackgroundVideo(file, file.name);
            }}
            className="text-sm"
          />
          <button onClick={() => setShowMediaPicker((v) => !v)} className="btn-secondary text-xs">
            {showMediaPicker ? 'Hide media library' : 'Choose from Media library'}
          </button>
          <button onClick={() => void pickRandomBackground()} className="btn-secondary text-xs">
            🎲 Random from Media
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          A random clip matching your narration length (~{Math.round(targetClipSeconds)}s) is picked automatically.
        </p>

        {showMediaPicker && (
          <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
            {mediaLoading && <p className="text-xs text-neutral-500">Loading…</p>}
            {!mediaLoading && mediaAssets.length === 0 && (
              <p className="text-xs text-neutral-500">
                No videos in your media library yet — upload one above, or go to the Media tab.
              </p>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {mediaAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    void setBackgroundVideo(asset.blob, asset.name);
                    setShowMediaPicker(false);
                  }}
                  className="text-left rounded-md border border-neutral-800 hover:border-cyan-500 bg-neutral-950 overflow-hidden transition-colors"
                  title={`Use ${asset.name}`}
                >
                  {mediaAssetUrls[asset.id] && (
                    <video src={mediaAssetUrls[asset.id]} className="w-full aspect-[9/16] object-cover bg-black" muted />
                  )}
                  <div className="text-[11px] text-neutral-400 truncate px-1 py-0.5">{asset.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {backgroundError && <p className="text-xs text-amber-400">{backgroundError}</p>}
        {backgroundTooLarge && (
          <p className="text-xs text-neutral-500">
            Large source video ({project.backgroundVideoDuration ? `${Math.round(project.backgroundVideoDuration / 60)} min` : 'big file'}) —
            fine in Chrome/Edge, which only read the part they need. Browsers without the fast engine have to load the
            whole file, so trimming it first helps there.
          </p>
        )}
        {project.backgroundVideo && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              {canReroll && project.backgroundClipStart !== undefined && (
                <span className="text-xs text-neutral-400">
                  Using clip {formatTime(project.backgroundClipStart)}–
                  {formatTime(project.backgroundClipStart + targetClipSeconds)} of{' '}
                  {formatTime(project.backgroundVideoDuration ?? 0)}
                </span>
              )}
              {!canReroll && project.backgroundVideoDuration !== undefined && (
                <span className="text-xs text-neutral-400">
                  Video is shorter than the narration — it will be looped to fill the video.
                </span>
              )}
              {canReroll && (
                <button onClick={rerollBackgroundClip} className="btn-secondary text-xs">
                  🎲 Reroll clip
                </button>
              )}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="w-28">Playback speed {(project.backgroundPlaybackRate ?? 1).toFixed(2)}×</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={project.backgroundPlaybackRate ?? 1}
                  onChange={(e) => update({ backgroundPlaybackRate: Number(e.target.value) })}
                  className="w-40 accent-cyan-500"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={project.backgroundFlip ?? false}
                  onChange={(e) => update({ backgroundFlip: e.target.checked })}
                />
                Mirror horizontally
              </label>
            </div>

            {/* ROTATION */}
            <div className="space-y-2 border-t border-neutral-800 pt-3">
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input
                  type="checkbox"
                  checked={project.backgroundRotationEnabled ?? false}
                  onChange={(e) => update({ backgroundRotationEnabled: e.target.checked })}
                />
                Rotate through multiple clips instead of one
              </label>
              {project.backgroundRotationEnabled && (
                <div className="pl-6 space-y-2">
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <span>Switch clips every</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={project.backgroundSwitchSeconds ?? 5}
                      onChange={(e) => update({ backgroundSwitchSeconds: Math.max(1, Number(e.target.value) || 5) })}
                      className="w-16 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                    />
                    <span>seconds</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    <span>Transition between clips</span>
                    <select
                      value={project.backgroundTransition ?? 'cut'}
                      onChange={(e) => update({ backgroundTransition: e.target.value as 'cut' | 'fade' })}
                      className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100"
                    >
                      <option value="cut">Hard cut</option>
                      <option value="fade">Fade to black</option>
                    </select>
                  </label>

                  <SoundEffectPicker
                    label="Sound at each clip switch"
                    value={project.backgroundTransitionSound ?? NO_SOUND}
                    onChange={(choice) => update({ backgroundTransitionSound: choice })}
                  />

                  <div className="flex flex-wrap gap-2">
                    <div className="w-20 h-14 rounded-md border border-cyan-700 bg-neutral-900 flex items-center justify-center text-[10px] text-neutral-400 text-center px-1">
                      Main clip
                    </div>
                    {(project.additionalBackgroundClips ?? []).map((clip, i) => (
                      <div key={i} className="relative w-20 h-14 rounded-md border border-neutral-800 bg-neutral-900 overflow-hidden">
                        <div className="text-[10px] text-neutral-400 truncate px-1 pt-1">{clip.name}</div>
                        <button
                          onClick={() => removeRotationClip(i)}
                          className="absolute top-0 right-0 bg-black/70 text-red-400 text-xs px-1 rounded-bl"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {(project.additionalBackgroundClips?.length ?? 0) === 0 && (
                    <p className="text-xs text-amber-400">
                      Add at least one more clip below for rotation to actually kick in - with just the main clip, it
                      behaves the same as having rotation off.
                    </p>
                  )}

                  <button onClick={() => setShowRotationPicker((v) => !v)} className="btn-secondary text-xs">
                    {showRotationPicker ? 'Hide media library' : '+ Add clip from Media library'}
                  </button>
                  {showRotationPicker && (
                    <MediaPicker
                      onPick={(a) => {
                        addRotationClip(a.blob, a.name);
                        setShowRotationPicker(false);
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
        {backgroundUrl && (
          <video src={backgroundUrl} controls className="w-48 rounded-md border border-neutral-800" muted />
        )}
      </section>

      {/* RENDER */}
      <section className="space-y-2 pb-10">
        <h2 className="section-title">Render</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-400">Quality:</span>
          <button
            onClick={() => update({ renderQuality: 'draft' })}
            className={project.renderQuality === 'draft' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
          >
            Draft (720p, fast)
          </button>
          <button
            onClick={() => update({ renderQuality: 'final' })}
            className={(project.renderQuality ?? 'final') === 'final' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
          >
            Final (1080p)
          </button>
        </div>
        {encoderCaps && !encoderCaps.webCodecs && (
          <p className="text-xs text-amber-400">
            This browser doesn't have the fast video engine (WebCodecs), so renders will be very slow here. Open the app
            in Chrome or Edge instead.
          </p>
        )}
        {encoderCaps?.webCodecs && encoderCaps.hardwareEncoder && (
          <p className="text-xs text-emerald-400">
            Hardware video encoder detected — Final (1080p) should render in a few minutes at most.
          </p>
        )}
        {encoderCaps?.webCodecs && !encoderCaps.hardwareEncoder && (
          <p className="text-xs text-amber-400">
            No hardware video encoder detected, so encoding runs on your CPU. Draft (720p) renders about 2–3× faster than
            Final — use Draft if Final's time estimate is too long.
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRender}
            disabled={!allSegmentsNarrated || !project.backgroundVideo || (!!renderProgress && renderProgress.phase !== 'done')}
            className="btn-primary"
          >
            Render MP4
          </button>
          {renderProgress && renderProgress.phase !== 'done' && (
            <button onClick={cancelRender} className="btn-secondary text-xs">
              Cancel
            </button>
          )}
        </div>
        {project.segments.length === 0 && (
          <p className="text-xs text-neutral-500">
            No narration segments yet — paste your story above and click "Split into scenes" to create them.
          </p>
        )}
        {!allSegmentsNarrated && project.segments.length > 0 && (
          <p className="text-xs text-neutral-500">
            {narratedCount}/{project.segments.length} segments narrated — missing narration for segment
            {missingSegments.length > 1 ? 's' : ''} {missingSegments.join(', ')}.
          </p>
        )}
        {allSegmentsNarrated && !project.backgroundVideo && (
          <p className="text-xs text-neutral-500">Upload or pick a background video before rendering.</p>
        )}

        {renderProgress && renderProgress.phase !== 'done' && (
          <div className="text-xs text-neutral-400">
            {renderProgress.message ?? renderProgress.phase}
            {typeof renderProgress.ratio === 'number' ? ` — ${Math.round(renderProgress.ratio * 100)}%` : ''}
            {renderEngine === 'ffmpeg' && (
              <span className="block text-amber-400 mt-1">
                This browser doesn't support the fast engine (WebCodecs), so the slow fallback is being used - open the
                app in Chrome or Edge for much faster renders.
              </span>
            )}
          </div>
        )}
        {renderError && <p className="text-xs text-red-400">{renderError}</p>}

        {outputUrl && (
          <div className="space-y-2">
            <video src={outputUrl} controls className="w-64 rounded-md border border-neutral-800" />
            <a href={outputUrl} download={`${exportFileName}.mp4`} className="btn-secondary inline-block">
              Download MP4
            </a>
          </div>
        )}
      </section>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
