export interface EncoderCapabilities {
  /** Browser supports WebCodecs at all (Chrome/Edge/recent Firefox/Safari). */
  webCodecs: boolean;
  /** A hardware H.264 encoder is available for 1080x1920 - the fast path. */
  hardwareEncoder: boolean;
}

/**
 * Checks whether this device can encode H.264 in hardware. In Chromium,
 * `hardwareAcceleration: 'prefer-hardware'` only reports as supported when an
 * actual hardware encoder exists, so this cleanly separates "GPU encoder,
 * renders in a minute or two" from "CPU-only encoding, noticeably slower".
 */
export async function detectEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return { webCodecs: false, hardwareEncoder: false };
  }
  try {
    const hw = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640028', // H.264 High profile, level 4.0 - covers 1080x1920 @ 30fps
      width: 1080,
      height: 1920,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    });
    return { webCodecs: true, hardwareEncoder: hw.supported === true };
  } catch {
    return { webCodecs: true, hardwareEncoder: false };
  }
}
