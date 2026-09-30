import { useEffect, useState } from 'react';
import { listMediaAssets, type MediaAsset } from '../../services/storage/mediaStore';
import { previewSoundEffect, SOUND_EFFECT_OPTIONS, type SoundChoice, type SoundEffectId } from '../../services/audio/soundEffects';

interface Props {
  label: string;
  value: SoundChoice;
  onChange: (choice: SoundChoice) => void;
  disabled?: boolean;
}

const CUSTOM_PREFIX = 'custom:';

export function SoundEffectPicker({ label, value, onChange, disabled }: Props) {
  const [customOptions, setCustomOptions] = useState<MediaAsset[]>([]);

  useEffect(() => {
    listMediaAssets('sfx').then(setCustomOptions);
  }, []);

  const selectValue =
    value.id === 'custom'
      ? `${CUSTOM_PREFIX}${customOptions.find((a) => a.blob === value.blob)?.id ?? ''}`
      : value.id;

  const handleChange = (raw: string) => {
    if (raw.startsWith(CUSTOM_PREFIX)) {
      const asset = customOptions.find((a) => a.id === raw.slice(CUSTOM_PREFIX.length));
      if (asset) onChange({ id: 'custom', blob: asset.blob, name: asset.name });
      return;
    }
    onChange({ id: raw as SoundEffectId });
  };

  return (
    <div className="text-xs text-neutral-400 space-y-1">
      <span className="block">{label}</span>
      <div className="flex items-center gap-2">
        <select
          value={selectValue}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
        >
          {SOUND_EFFECT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          {customOptions.length > 0 && (
            <optgroup label="Your uploaded sound effects">
              {customOptions.map((a) => (
                <option key={a.id} value={`${CUSTOM_PREFIX}${a.id}`}>
                  🎵 {a.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          onClick={() => previewSoundEffect(value)}
          disabled={value.id === 'none'}
          className="btn-ghost text-xs"
          title="Preview"
          type="button"
        >
          ▶
        </button>
      </div>
    </div>
  );
}
