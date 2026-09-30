import { useEffect, useState } from 'react';
import { listMediaAssets, type MediaAsset } from '../services/storage/mediaStore';

interface Props {
  onPick: (asset: MediaAsset) => void;
  /** Which kind of asset to show; defaults to video. */
  kind?: 'video' | 'audio';
}

/** Grid of saved Media-library assets (video or audio); click one to use it. */
export function MediaPicker({ onPick, kind = 'video' }: Props) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMediaAssets(kind)
      .then(setAssets)
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const a of assets) next[a.id] = URL.createObjectURL(a.blob);
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
  }, [assets]);

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
      {loading && <p className="text-xs text-neutral-500">Loading…</p>}
      {!loading && assets.length === 0 && (
        <p className="text-xs text-neutral-500">
          No {kind === 'audio' ? 'music' : 'videos'} in your media library yet — add some in the Media tab.
        </p>
      )}
      <div className={kind === 'audio' ? 'space-y-1' : 'grid grid-cols-3 sm:grid-cols-4 gap-2'}>
        {assets.map((asset) =>
          kind === 'audio' ? (
            <button
              key={asset.id}
              onClick={() => onPick(asset)}
              className="w-full text-left rounded-md border border-neutral-800 hover:border-cyan-500 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 truncate transition-colors"
              title={`Use ${asset.name}`}
            >
              🎵 {asset.name}
            </button>
          ) : (
            <button
              key={asset.id}
              onClick={() => onPick(asset)}
              className="text-left rounded-md border border-neutral-800 hover:border-cyan-500 bg-neutral-950 overflow-hidden transition-colors"
              title={`Use ${asset.name}`}
            >
              {urls[asset.id] && <video src={urls[asset.id]} className="w-full aspect-video object-cover bg-black" muted />}
              <div className="text-[11px] text-neutral-400 truncate px-1 py-0.5">{asset.name}</div>
            </button>
          )
        )}
      </div>
    </div>
  );
}
