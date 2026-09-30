import { useEffect, useState } from 'react';
import { deleteMediaAsset, listMediaAssets, saveMediaAsset, type MediaAsset } from '../../services/storage/mediaStore';
import { previewSoundEffect } from '../../services/audio/soundEffects';

interface Props {
  onUseAsBackground: (asset: MediaAsset) => void;
  onUseAsMusic?: (asset: MediaAsset) => void;
}

export function MediaScreen({ onUseAsBackground, onUseAsMusic }: Props) {
  const [videos, setVideos] = useState<MediaAsset[]>([]);
  const [music, setMusic] = useState<MediaAsset[]>([]);
  const [sfx, setSfx] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [uploadingSfx, setUploadingSfx] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    const [v, m, s] = await Promise.all([listMediaAssets('video'), listMediaAssets('audio'), listMediaAssets('sfx')]);
    setVideos(v);
    setMusic(m);
    setSfx(s);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Build/revoke object URLs whenever any list changes.
  useEffect(() => {
    const nextUrls: Record<string, string> = {};
    for (const asset of [...videos, ...music, ...sfx]) {
      nextUrls[asset.id] = URL.createObjectURL(asset.blob);
    }
    setUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [videos, music, sfx]);

  const handleUploadVideos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingVideo(true);
    try {
      for (const file of Array.from(files)) {
        // eslint-disable-next-line no-await-in-loop
        await saveMediaAsset(file);
      }
      await refresh();
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleUploadMusic = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingMusic(true);
    try {
      for (const file of Array.from(files)) {
        // eslint-disable-next-line no-await-in-loop
        await saveMediaAsset(file);
      }
      await refresh();
    } finally {
      setUploadingMusic(false);
    }
  };

  const handleUploadSfx = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingSfx(true);
    try {
      for (const file of Array.from(files)) {
        // eslint-disable-next-line no-await-in-loop
        await saveMediaAsset(file, 'sfx');
      }
      await refresh();
    } finally {
      setUploadingSfx(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteMediaAsset(id);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-8">
      {/* VIDEOS */}
      <section className="space-y-4">
        <h2 className="section-title">Media library</h2>
        <p className="text-xs text-neutral-500">
          Upload gameplay/background videos once and reuse them across projects — stored locally in your browser
          (IndexedDB), never uploaded anywhere.
        </p>

        <label className="btn-primary inline-block cursor-pointer text-sm">
          {uploadingVideo ? 'Uploading…' : '+ Upload video'}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            multiple
            onChange={(e) => void handleUploadVideos(e.target.files)}
            disabled={uploadingVideo}
            className="hidden"
          />
        </label>

        {loading && <p className="text-sm text-neutral-500">Loading…</p>}
        {!loading && videos.length === 0 && (
          <p className="text-sm text-neutral-500">No videos yet — upload a gameplay/background video above.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {videos.map((asset) => (
            <div key={asset.id} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
              {urls[asset.id] && (
                <video
                  src={urls[asset.id]}
                  className="w-full rounded aspect-[9/16] object-cover bg-black"
                  muted
                  controls
                />
              )}
              <div className="text-xs text-neutral-300 truncate" title={asset.name}>
                {asset.name}
              </div>
              <div className="flex gap-2">
                <button onClick={() => onUseAsBackground(asset)} className="btn-primary text-xs flex-1">
                  Use as background
                </button>
                <button onClick={() => handleDelete(asset.id)} className="btn-ghost text-xs text-red-400">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MUSIC */}
      <section className="space-y-4 border-t border-neutral-800 pt-6">
        <h2 className="section-title">Music</h2>
        <p className="text-xs text-neutral-500">
          Upload background music tracks once and reuse them across projects — same local-only storage as videos above.
          Only use music you have the rights to use.
        </p>

        <label className="btn-primary inline-block cursor-pointer text-sm">
          {uploadingMusic ? 'Uploading…' : '+ Upload music'}
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={(e) => void handleUploadMusic(e.target.files)}
            disabled={uploadingMusic}
            className="hidden"
          />
        </label>

        {!loading && music.length === 0 && (
          <p className="text-sm text-neutral-500">No music yet — upload a track above.</p>
        )}

        <div className="space-y-2">
          {music.map((asset) => (
            <div key={asset.id} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
              <div className="text-xs text-neutral-300 truncate" title={asset.name}>
                🎵 {asset.name}
              </div>
              {urls[asset.id] && <audio src={urls[asset.id]} controls className="w-full h-9" />}
              <div className="flex gap-2">
                {onUseAsMusic && (
                  <button onClick={() => onUseAsMusic(asset)} className="btn-primary text-xs flex-1">
                    Use as background music
                  </button>
                )}
                <button onClick={() => handleDelete(asset.id)} className="btn-ghost text-xs text-red-400">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SOUND EFFECTS */}
      <section className="space-y-4 border-t border-neutral-800 pt-6">
        <h2 className="section-title">Sound effects</h2>
        <p className="text-xs text-neutral-500">
          Upload short one-shot sound clips (a stinger, a custom whoosh, whatever you like) to use anywhere the Story
          tab lets you pick a sound effect, alongside the 5 built-in synthesized ones.
        </p>

        <label className="btn-primary inline-block cursor-pointer text-sm">
          {uploadingSfx ? 'Uploading…' : '+ Upload sound effect'}
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={(e) => void handleUploadSfx(e.target.files)}
            disabled={uploadingSfx}
            className="hidden"
          />
        </label>

        {!loading && sfx.length === 0 && (
          <p className="text-sm text-neutral-500">No custom sound effects yet — upload a short clip above.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {sfx.map((asset) => (
            <div key={asset.id} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
              <div className="text-xs text-neutral-300 truncate" title={asset.name}>
                🔊 {asset.name}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => previewSoundEffect({ id: 'custom', blob: asset.blob, name: asset.name })}
                  className="btn-secondary text-xs flex-1"
                >
                  ▶ Preview
                </button>
                <button onClick={() => handleDelete(asset.id)} className="btn-ghost text-xs text-red-400">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
