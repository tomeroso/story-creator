import { useCallback, useMemo, useRef, useState } from 'react';
import { KokoroTTSProvider } from './kokoroProvider';
import { WebSpeechPreviewProvider } from './webSpeechProvider';
import type { TTSResult } from './types';

export function useTTS() {
  const kokoro = useMemo(() => new KokoroTTSProvider(), []);
  const preview = useMemo(() => new WebSpeechPreviewProvider(), []);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState<{ status: string; progress?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadStarted = useRef(false);

  const loadVoiceModel = useCallback(async () => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setStatus('loading');
    setError(null);
    try {
      await kokoro.initialize((p) => setProgress(p));
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      loadStarted.current = false;
    }
  }, [kokoro]);

  const generate = useCallback(
    async (text: string, voiceId: string, speed?: number): Promise<TTSResult> => {
      if (!kokoro.isReady()) {
        throw new Error('Voice model is not loaded yet.');
      }
      return kokoro.generate(text, voiceId, speed);
    },
    [kokoro]
  );

  return { kokoro, preview, status, progress, error, loadVoiceModel, generate };
}
