import type { Segment } from '../../types/story';
import { generateFakeUsernames } from './usernameGenerator';

/**
 * Formatting-only cleanup: strips Reddit/markdown clutter and normalizes
 * whitespace, but never rewrites wording or drops sentences. Safe to run
 * even when "preserve original wording" is enabled.
 */
export function cleanStoryText(raw: string): string {
  let text = raw;

  // Strip common Reddit line prefixes like "OP: " / "Edit: " markers left over from copy-paste,
  // and username mentions such as "u/someone" or "/u/someone".
  text = text.replace(/^\s*(OP|Update|Edit)\s*:\s*/gim, '');
  text = text.replace(/\/?u\/[A-Za-z0-9_-]+/g, '');
  text = text.replace(/\/?r\/[A-Za-z0-9_]+/g, '');

  // Strip raw URLs.
  text = text.replace(/https?:\/\/\S+/g, '');

  // Strip basic markdown clutter: **bold**, *italic*, __underline__, `code`, > quotes, # headers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/^\s*>+\s?/gm, '');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Normalize stray/odd unicode whitespace and repeated punctuation.
  text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  text = text.replace(/([!?.]){3,}/g, '$1$1$1');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+\n/g, '\n');

  return text.trim();
}

export interface TextStats {
  words: number;
  characters: number;
  paragraphs: number;
  estimatedSeconds: number;
}

// Average narration pace for estimating duration before any audio exists.
const WORDS_PER_MINUTE = 150;

export function computeStats(text: string): TextStats {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const paragraphs = trimmed.length === 0 ? 0 : trimmed.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
  return {
    words,
    characters: trimmed.length,
    paragraphs,
    estimatedSeconds: (words / WORDS_PER_MINUTE) * 60,
  };
}

/**
 * The clip length a background video should match: the real total of
 * already-generated narration if any exists, otherwise a word-count-based
 * estimate from the story text, with a sane floor for an empty/fresh project.
 */
export function estimateTargetClipSeconds(project: { segments: Segment[]; cleanedText: string; rawText: string }): number {
  const narratedTotal = project.segments.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  if (narratedTotal > 0) return narratedTotal;
  const stats = computeStats(project.cleanedText || project.rawText);
  return stats.estimatedSeconds > 0 ? stats.estimatedSeconds : 60;
}

/**
 * Derives a short title from a story's own text (its first sentence, or first
 * few words if no sentence-ending punctuation shows up early) - used to
 * auto-name exports when the project was never manually renamed.
 */
export function deriveTitleFromText(text: string, maxWords = 9): string {
  const trimmed = text.trim();
  if (!trimmed) return 'story';
  const firstLine = trimmed.split('\n')[0].trim();
  const sentenceMatch = /^.{1,120}?[.!?]/.exec(firstLine);
  const candidate = sentenceMatch ? sentenceMatch[0].slice(0, -1).trim() : firstLine;
  const words = candidate.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ') || 'story';
}

/**
 * Split cleaned text into narration segments by grouping sentences so each
 * segment is a reasonable TTS chunk (avoids hundreds of tiny audio files,
 * avoids overly long single-shot generations).
 */
export function splitIntoSegments(text: string, targetWordsPerSegment = 40): Segment[] {
  const sentences = splitIntoSentences(text);
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let order = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({
      id: crypto.randomUUID(),
      text: buffer.join(' ').trim(),
      order: order++,
    });
    buffer = [];
    bufferWords = 0;
  };

  for (const sentence of sentences) {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;
    if (bufferWords > 0 && bufferWords + wordCount > targetWordsPerSegment) {
      flush();
    }
    buffer.push(sentence);
    bufferWords += wordCount;
  }
  flush();

  return segments;
}

/**
 * Splits text into "answers" by blank-line-separated paragraphs, each
 * getting its own fake commenter name - for AskReddit-style compilation
 * videos. A long answer is further split into normal-sized narration chunks
 * (via splitIntoSegments) that all share the same commenter name, so a long
 * answer doesn't look like several different people replying.
 */
export function splitIntoAnswers(text: string, targetWordsPerSegment = 40): Segment[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const names = generateFakeUsernames(paragraphs.length);
  const segments: Segment[] = [];
  let order = 0;
  paragraphs.forEach((paragraph, i) => {
    const chunks = splitIntoSegments(paragraph, targetWordsPerSegment);
    for (const chunk of chunks) {
      segments.push({ ...chunk, order: order++, commenterName: names[i] });
    }
  });
  return segments;
}

function splitIntoSentences(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sentences: string[] = [];
  for (const paragraph of paragraphs) {
    // Split on sentence-ending punctuation followed by whitespace + capital/quote,
    // while keeping the punctuation attached to the sentence.
    const parts = paragraph
      .replace(/\n+/g, ' ')
      .match(/[^.!?]+[.!?]+(?:['")\]]*)|[^.!?]+$/g);
    if (parts) {
      sentences.push(...parts.map((s) => s.trim()).filter(Boolean));
    }
  }
  return sentences;
}

export function reorderSegments(segments: Segment[], fromIndex: number, toIndex: number): Segment[] {
  const next = [...segments];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((s, i) => ({ ...s, order: i }));
}

export function mergeSegments(segments: Segment[], idA: string, idB: string): Segment[] {
  const a = segments.find((s) => s.id === idA);
  const b = segments.find((s) => s.id === idB);
  if (!a || !b) return segments;
  const merged: Segment = { id: a.id, text: `${a.text} ${b.text}`.trim(), order: a.order };
  return segments
    .filter((s) => s.id !== idA && s.id !== idB)
    .concat(merged)
    .sort((x, y) => x.order - y.order)
    .map((s, i) => ({ ...s, order: i }));
}

export function splitSegment(segments: Segment[], id: string, splitAtCharIndex: number): Segment[] {
  const target = segments.find((s) => s.id === id);
  if (!target) return segments;
  const first = target.text.slice(0, splitAtCharIndex).trim();
  const second = target.text.slice(splitAtCharIndex).trim();
  if (!first || !second) return segments;

  const before = segments.filter((s) => s.order < target.order);
  const after = segments.filter((s) => s.order > target.order);
  const newSegments: Segment[] = [
    { id: target.id, text: first, order: 0 },
    { id: crypto.randomUUID(), text: second, order: 0 },
  ];
  return [...before, ...newSegments, ...after].map((s, i) => ({ ...s, order: i }));
}
