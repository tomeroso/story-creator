import type { TTSLoadProgress, TTSProvider, TTSResult, TTSVoice } from './types';

// A curated subset of Kokoro's built-in voices (English). Full list is discoverable
// at runtime via tts.list_voices() inside the worker if more are needed later.
const KNOWN_VOICES: TTSVoice[] = [
  { id: 'af_heart', label: 'Heart (US, female)', language: 'en-US' },
  { id: 'af_bella', label: 'Bella (US, female)', language: 'en-US' },
  { id: 'am_michael', label: 'Michael (US, male)', language: 'en-US' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)', language: 'en-US' },
  { id: 'bf_emma', label: 'Emma (UK, female)', language: 'en-GB' },
  { id: 'bm_george', label: 'George (UK, male)', language: 'en-GB' },
];

let requestCounter = 0;

export class KokoroTTSProvider implements TTSProvider {
  readonly id = 'kokoro';
  readonly label = 'Kokoro (local, offline)';
  readonly canExport = true;

  private worker: Worker | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private pending = new Map<string, { resolve: (r: TTSResult) => void; reject: (e: Error) => void }>();

  isReady(): boolean {
    return this.ready;
  }

  async initialize(onProgress?: (p: TTSLoadProgress) => void): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        switch (msg.type) {
          case 'init-progress':
            onProgress?.({ status: msg.status, progress: msg.progress });
            break;
          case 'init-done':
            this.ready = true;
            resolve();
            break;
          case 'init-error':
            reject(new Error(msg.message));
            break;
          case 'generate-done': {
            const p = this.pending.get(msg.requestId);
            if (p) {
              p.resolve({ audioBlob: new Blob([msg.wav], { type: 'audio/wav' }), duration: msg.duration });
              this.pending.delete(msg.requestId);
            }
            break;
          }
          case 'generate-error': {
            const p = this.pending.get(msg.requestId);
            if (p) {
              p.reject(new Error(msg.message));
              this.pending.delete(msg.requestId);
            }
            break;
          }
        }
      };

      this.worker.onerror = (err) => {
        reject(new Error(err.message || 'Kokoro worker failed to load'));
      };

      this.worker.postMessage({ type: 'init' });
    });

    return this.initPromise;
  }

  async listVoices(): Promise<TTSVoice[]> {
    return KNOWN_VOICES;
  }

  async generate(text: string, voiceId: string, speed = 1): Promise<TTSResult> {
    if (!this.worker || !this.ready) {
      throw new Error('Kokoro model is not loaded yet. Call initialize() first.');
    }
    const requestId = `req_${++requestCounter}`;
    return new Promise<TTSResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage({ type: 'generate', requestId, text, voice: voiceId, speed });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.pending.clear();
  }
}
