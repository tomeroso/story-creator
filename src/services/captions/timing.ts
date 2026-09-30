import type { CaptionWord } from '../../types/story';

/**
 * Kokoro doesn't return word-level timestamps, so timing is estimated by
 * distributing the segment's real audio duration across words, weighted by
 * word length (longer words get slightly more time). This is "reasonably
 * synchronized" as called for in the spec - a local forced-aligner can
 * replace this later behind the same return shape if tighter sync is needed.
 */
export function estimateWordTimings(text: string, durationSeconds: number): CaptionWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSeconds <= 0) return [];

  const weights = words.map((w) => Math.max(1, w.replace(/[^\w]/g, '').length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  const result: CaptionWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const share = weights[i] / totalWeight;
    const wordDuration = share * durationSeconds;
    result.push({ text: words[i], start: cursor, end: cursor + wordDuration });
    cursor += wordDuration;
  }
  return result;
}

/** Groups words into caption "cards" of up to maxWords for on-screen display. */
export function groupCaptionCards(words: CaptionWord[], maxWords = 4): { text: string; start: number; end: number }[] {
  const cards: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords);
    if (chunk.length === 0) continue;
    cards.push({
      text: chunk.map((w) => w.text).join(' '),
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
    });
  }
  return cards;
}
