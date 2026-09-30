import { useRef, useState } from 'react';
import type { Segment } from '../../types/story';

interface Props {
  segment: Segment;
  index: number;
  total: number;
  isGenerating: boolean;
  canGenerate: boolean;
  failed?: boolean;
  showCommenterName?: boolean;
  onChangeText: (text: string) => void;
  onChangeCommenterName?: (name: string) => void;
  onGenerate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMergeWithNext: () => void;
  onSplit: (charIndex: number) => void;
}

export function SegmentCard({
  segment,
  index,
  total,
  isGenerating,
  canGenerate,
  failed,
  showCommenterName,
  onChangeText,
  onChangeCommenterName,
  onGenerate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMergeWithNext,
  onSplit,
}: Props) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handlePlay = () => {
    if (!segment.audioBlob) return;
    const url = URL.createObjectURL(segment.audioBlob);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const handleSplitClick = () => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    if (caret <= 0 || caret >= segment.text.length) return;
    onSplit(caret);
  };

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        failed ? 'border-red-500/60 bg-red-950/20' : 'border-neutral-800 bg-neutral-900/60'
      }`}
    >
      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span className="flex items-center gap-2">
          Segment {index + 1}
          {failed && <span className="text-red-400 font-medium">Narration failed</span>}
          {!failed && !segment.audioBlob && !isGenerating && (
            <span className="text-amber-400">No narration yet</span>
          )}
        </span>
        <div className="flex gap-1">
          <button onClick={onMoveUp} disabled={index === 0} className="btn-ghost">
            ↑
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="btn-ghost">
            ↓
          </button>
          <button onClick={handleSplitClick} title="Split at cursor position" className="btn-ghost">
            Split
          </button>
          <button onClick={onMergeWithNext} disabled={index === total - 1} className="btn-ghost">
            Merge ↓
          </button>
          <button onClick={onDelete} className="btn-ghost text-red-400">
            Delete
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={segment.text}
        onChange={(e) => onChangeText(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-md bg-neutral-950 border border-neutral-800 p-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
      />

      {showCommenterName && (
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span>Commenter:</span>
          <input
            value={segment.commenterName ?? ''}
            onChange={(e) => onChangeCommenterName?.(e.target.value)}
            placeholder="u/username"
            className="rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating || segment.text.trim().length === 0}
          className="btn-primary text-xs"
        >
          {isGenerating ? 'Generating…' : segment.audioBlob ? 'Regenerate narration' : 'Generate narration'}
        </button>

        {segment.audioBlob && (
          <>
            <button onClick={handlePlay} className="btn-ghost text-xs">
              ▶ Play
            </button>
            <span className="text-xs text-neutral-500">{segment.duration?.toFixed(1)}s</span>
          </>
        )}
      </div>

      {audioUrl && <audio src={audioUrl} controls autoPlay className="w-full h-8" />}
    </div>
  );
}
