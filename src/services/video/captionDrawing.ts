import type { CaptionStyle } from '../../types/story';

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface TimedCard {
  start: number;
  end: number;
  words: TimedWord[];
}

const CAPTION_FONT_STACK = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const ANIM_SECONDS = 0.15;

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/**
 * Draws one caption card at time `t` (seconds, same clock as card.start/end).
 * Used identically by the real renderer and the live style preview, so
 * what's previewed in the UI is pixel-for-pixel what gets rendered.
 */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  card: TimedCard,
  t: number,
  style: CaptionStyle,
  width: number,
  height: number
) {
  const scale = width / 1080;
  let fontSize = Math.round(style.fontSize * scale);
  const maxWidth = width * 0.86;
  // Original case/punctuation is kept (not forced uppercase) to match the
  // common "bold pill caption" style rather than a shouty all-caps look.
  const text = card.words.map((w) => w.text).join(' ');

  ctx.font = `800 ${fontSize}px ${CAPTION_FONT_STACK}`;
  let textWidth = ctx.measureText(text).width;
  while (textWidth > maxWidth && fontSize > 20) {
    fontSize -= 4;
    ctx.font = `800 ${fontSize}px ${CAPTION_FONT_STACK}`;
    textWidth = ctx.measureText(text).width;
  }

  const y = style.position === 'top' ? height * 0.18 : style.position === 'center' ? height * 0.5 : height * 0.72;
  const padX = fontSize * 0.34;
  const padY = fontSize * 0.22;
  const boxW = textWidth + padX * 2;
  const boxH = fontSize + padY * 2;
  const r = boxH * 0.3;

  // --- Animation: a quick, one-shot entrance as the card starts showing. ---
  const localT = Math.max(0, t - card.start);
  const animP = Math.min(1, localT / ANIM_SECONDS);
  let drawScale = 1;
  let drawAlpha = 1;
  let offsetY = 0;
  if (style.animation === 'pop') {
    drawScale = animP >= 1 ? 1 : Math.max(0, easeOutBack(animP));
  } else if (style.animation === 'fade') {
    drawAlpha = easeOutCubic(animP);
  } else if (style.animation === 'slide') {
    offsetY = (1 - easeOutCubic(animP)) * fontSize * 0.6;
    drawAlpha = easeOutCubic(animP);
  }

  ctx.save();
  ctx.globalAlpha = drawAlpha;
  if (drawScale !== 1) {
    ctx.translate(width / 2, y - offsetY);
    ctx.scale(drawScale, drawScale);
    ctx.translate(-width / 2, -(y - offsetY));
  }

  const boxX = (width - boxW) / 2;
  const boxY = y - offsetY - boxH / 2;

  if (style.backgroundStyle === 'pill') {
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
    ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
    ctx.closePath();
    ctx.fill();
  } else if (style.backgroundStyle === 'none') {
    // No box, but a soft shadow keeps text legible over busy footage.
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = fontSize * 0.15;
  }

  ctx.textBaseline = 'middle';
  const textY = y - offsetY + fontSize * 0.04;

  if (style.backgroundStyle === 'outline') {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, fontSize * 0.16);
    ctx.strokeStyle = style.backgroundColor;
  }

  if (card.words.length === 1) {
    // The normal case (one word per card): no "active word" concept applies
    // when there's only one word on screen, so it just uses the plain caption color.
    ctx.textAlign = 'center';
    if (style.backgroundStyle === 'outline') ctx.strokeText(text, width / 2, textY);
    ctx.fillStyle = style.color;
    ctx.fillText(text, width / 2, textY);
  } else {
    // Kept for multi-word cards: highlights whichever word is currently active.
    ctx.textAlign = 'left';
    let x = boxX + padX;
    const spaceWidth = ctx.measureText(' ').width;
    for (const w of card.words) {
      const active = t >= w.start && t < w.end;
      if (style.backgroundStyle === 'outline') ctx.strokeText(w.text, x, textY);
      ctx.fillStyle = active ? style.highlightColor : style.color;
      ctx.fillText(w.text, x, textY);
      x += ctx.measureText(w.text).width + spaceWidth;
    }
  }

  ctx.shadowBlur = 0;
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
