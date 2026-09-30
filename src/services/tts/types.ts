export interface TTSVoice {
  id: string;
  label: string;
  language?: string;
}

export interface TTSResult {
  /** Real audio file the renderer can hand to FFmpeg. */
  audioBlob: Blob;
  /** Duration in seconds. */
  duration: number;
}

export interface TTSLoadProgress {
  status: string;
  progress?: number; // 0-1 when known
}

/**
 * Adapter boundary for narration engines. Swap in a cloud provider later
 * without touching the rest of the app - only an implementation of this
 * interface is needed.
 */
export interface TTSProvider {
  readonly id: string;
  readonly label: string;
  /** Whether generate() returns a real, exportable audio file (vs. playback-only). */
  readonly canExport: boolean;

  initialize(onProgress?: (p: TTSLoadProgress) => void): Promise<void>;
  isReady(): boolean;
  listVoices(): Promise<TTSVoice[]>;
  generate(text: string, voiceId: string, speed?: number): Promise<TTSResult>;
  dispose(): void;
}
