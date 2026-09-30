import type { TTSProvider, TTSResult, TTSVoice } from './types';

/**
 * Browser speechSynthesis. Useful for instant playback preview while editing,
 * but it does NOT produce a real audio file - `generate()` here intentionally
 * throws, so the renderer can never accidentally ship a silent/fake export.
 * Use `speak()` for preview playback only.
 */
export class WebSpeechPreviewProvider implements TTSProvider {
  readonly id = 'webspeech';
  readonly label = 'Browser voice (preview only, not exportable)';
  readonly canExport = false;

  private ready = false;

  isReady(): boolean {
    return this.ready;
  }

  async initialize(): Promise<void> {
    this.ready = 'speechSynthesis' in window;
    if (!this.ready) throw new Error('speechSynthesis is not available in this browser');
  }

  async listVoices(): Promise<TTSVoice[]> {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      return voices.map((v) => ({ id: v.name, label: `${v.name} (${v.lang})`, language: v.lang }));
    }
    // Voices can load async on some browsers.
    return new Promise((resolve) => {
      window.speechSynthesis.onvoiceschanged = () => {
        resolve(window.speechSynthesis.getVoices().map((v) => ({ id: v.name, label: `${v.name} (${v.lang})`, language: v.lang })));
      };
    });
  }

  speak(text: string, voiceId?: string): void {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceId) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceId);
      if (voice) utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  }

  stop(): void {
    window.speechSynthesis.cancel();
  }

  async generate(_text?: string, _voiceId?: string, _speed?: number): Promise<TTSResult> {
    throw new Error(
      'Browser voice preview cannot be exported. Use the Kokoro (local, offline) voice to generate narration for rendering.'
    );
  }

  dispose(): void {
    this.stop();
  }
}
