/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js';

// Model id / quantization chosen for a reasonable size/quality tradeoff.
// q8 is ~86MB and downloads once (cached by the browser / transformers.js cache).
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts: KokoroTTS | null = null;

type WorkerRequest =
  | { type: 'init' }
  | { type: 'generate'; requestId: string; text: string; voice: string; speed?: number }
  | { type: 'list-voices'; requestId: string };

type WorkerResponse =
  | { type: 'init-progress'; status: string; progress?: number }
  | { type: 'init-done' }
  | { type: 'init-error'; message: string }
  | { type: 'generate-done'; requestId: string; wav: ArrayBuffer; duration: number }
  | { type: 'generate-error'; requestId: string; message: string }
  | { type: 'voices'; requestId: string; voices: { id: string; label: string }[] };

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  // eslint-disable-next-line no-restricted-globals
  (self as unknown as Worker).postMessage(msg, transfer as any);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    const hasWebGPU = typeof (self as any).navigator !== 'undefined' && 'gpu' in (self as any).navigator;

    const tryLoad = async (device: 'webgpu' | 'wasm') => {
      const dtype = device === 'webgpu' ? 'fp32' : 'q8';
      post({ type: 'init-progress', status: `Loading voice model (${device === 'webgpu' ? 'GPU' : 'CPU'} mode)` });
      return KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') {
            post({ type: 'init-progress', status: 'Downloading voice model', progress: p.progress / 100 });
          } else if (p?.status) {
            post({ type: 'init-progress', status: String(p.status) });
          }
        },
      } as any);
    };

    try {
      tts = await tryLoad(hasWebGPU ? 'webgpu' : 'wasm');
      post({ type: 'init-done' });
    } catch (webgpuErr) {
      // Some browsers report navigator.gpu but fail to get a working adapter -
      // fall back to CPU/WASM rather than leaving the app stuck.
      if (hasWebGPU) {
        try {
          tts = await tryLoad('wasm');
          post({ type: 'init-done' });
          return;
        } catch (wasmErr) {
          post({ type: 'init-error', message: wasmErr instanceof Error ? wasmErr.message : String(wasmErr) });
          return;
        }
      }
      post({ type: 'init-error', message: webgpuErr instanceof Error ? webgpuErr.message : String(webgpuErr) });
    }
    return;
  }

  if (msg.type === 'list-voices') {
    const voices = tts ? Object.keys(tts.voices ?? {}).map((id) => ({ id, label: id })) : [];
    post({ type: 'voices', requestId: msg.requestId, voices });
    return;
  }

  if (msg.type === 'generate') {
    if (!tts) {
      post({ type: 'generate-error', requestId: msg.requestId, message: 'Model not initialized' });
      return;
    }
    try {
      const audio = await tts.generate(msg.text, { voice: msg.voice as any, speed: msg.speed ?? 1 });
      // RawAudio.toWav() is synchronous and returns a real ArrayBuffer directly -
      // no Blob/Promise involved, so no .arrayBuffer() call is needed here.
      const wav = audio.toWav();
      const duration = audio.audio.length / audio.sampling_rate;
      post({ type: 'generate-done', requestId: msg.requestId, wav, duration }, [wav]);
    } catch (err) {
      post({ type: 'generate-error', requestId: msg.requestId, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
