/** Bundled display font (Anton, OFL) used for captions, titles and counters. */
export const DISPLAY_FONT_FAMILY = 'StoryCaptionFont';
export const DISPLAY_FONT_STACK = `${DISPLAY_FONT_FAMILY}, Impact, sans-serif`;

let fontLoadPromise: Promise<void> | null = null;

/** Loads the bundled font into document.fonts once so canvas text can use it. */
export function ensureDisplayFont(): Promise<void> {
  if (!fontLoadPromise) {
    fontLoadPromise = (async () => {
      const face = new FontFace(DISPLAY_FONT_FAMILY, 'url(/fonts/Captions-Bold.ttf)');
      await face.load();
      document.fonts.add(face);
    })().catch((err) => {
      fontLoadPromise = null; // allow a retry next time
      throw new Error(`Could not load the caption font: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return fontLoadPromise;
}

/** Wraps text into lines that fit maxWidth with the context's current font. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws centered, outlined display text (white-on-black-outline style), wrapping and shrinking to fit. */
export function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: { centerX: number; y: number; maxWidth: number; fontSize: number; maxLines?: number; color?: string; anchor?: 'top' | 'bottom' | 'middle' }
): { top: number; bottom: number } {
  const { centerX, maxWidth, maxLines = 3, color = '#ffffff', anchor = 'top' } = opts;
  let fontSize = opts.fontSize;
  let lines: string[] = [];
  for (;;) {
    ctx.font = `${fontSize}px ${DISPLAY_FONT_STACK}`;
    lines = wrapText(ctx, text, maxWidth);
    const tooWide = lines.some((l) => ctx.measureText(l).width > maxWidth);
    if ((lines.length <= maxLines && !tooWide) || fontSize <= 24) break;
    fontSize -= 4;
  }
  const lineHeight = fontSize * 1.1;
  const blockHeight = lineHeight * lines.length;
  const top = anchor === 'top' ? opts.y : anchor === 'bottom' ? opts.y - blockHeight : opts.y - blockHeight / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, fontSize * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.fillStyle = color;
  lines.forEach((line, i) => {
    const y = top + lineHeight * (i + 0.5);
    ctx.strokeText(line, centerX, y);
    ctx.fillText(line, centerX, y);
  });
  ctx.textAlign = 'start';
  return { top, bottom: top + blockHeight };
}
