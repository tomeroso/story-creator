/** Reads a video Blob's real duration via a throwaway <video> element. */
export function getVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video metadata'));
    };
    video.src = url;
  });
}

/**
 * Picks a random start point for a clip of `targetSeconds` within a video of
 * `videoDuration` seconds. Returns 0 when the video isn't long enough to
 * offer a choice (the whole thing is needed, and will be looped instead).
 */
export function pickRandomClipStart(videoDuration: number, targetSeconds: number): number {
  const slack = videoDuration - targetSeconds;
  if (!Number.isFinite(slack) || slack <= 0) return 0;
  return Math.random() * slack;
}
