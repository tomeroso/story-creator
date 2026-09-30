import { DISPLAY_FONT_STACK, drawOutlinedText } from '../../services/video/fonts';

export type PartsFit = 'fit' | 'zoom' | 'fill';
export type PartsBackground = 'blur' | 'black';

export interface PartsStyle {
  title: string;
  /** Optional attribution line, shown smaller under the title (e.g. "Credit: @channel"). */
  credit: string;
  fit: PartsFit;
  background: PartsBackground;
  /** "Part 2/7" instead of "Part 2". */
  showTotal: boolean;
  accentColor: string;
}

export interface PartRange {
  index: number; // 0-based
  start: number; // seconds in source
  end: number;
}

/**
 * Splits [rangeStart, rangeEnd] into parts of `partLength` seconds. A short
 * leftover at the end (under 35% of a part) is merged into the previous part
 * instead of becoming a tiny final part.
 */
export function computeParts(rangeStart: number, rangeEnd: number, partLength: number): PartRange[] {
  const length = Math.max(0, rangeEnd - rangeStart);
  const size = Math.max(5, partLength);
  if (length <= 0.5) return [];
  const parts: PartRange[] = [];
  for (let start = rangeStart; start < rangeEnd - 0.05; start += size) {
    parts.push({ index: parts.length, start, end: Math.min(rangeEnd, start + size) });
  }
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.end - last.start < size * 0.35) {
    parts.pop();
    parts[parts.length - 1].end = last.end;
  }
  return parts;
}

type DrawSource = (ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) => void;

let blurCanvas: HTMLCanvasElement | null = null;

/**
 * Draws one composed frame: background, the fitted source video, the title
 * above it and the part label below it. Used identically by the live preview
 * (drawing from a <video>) and the renderer (drawing decoded frames).
 */
export function drawPartsFrame(
  ctx: CanvasRenderingContext2D,
  drawSource: DrawSource,
  srcWidth: number,
  srcHeight: number,
  style: PartsStyle,
  partNumber: number,
  totalParts: number,
  width: number,
  height: number
) {
  const s = width / 1080;
  const contain = Math.min(width / srcWidth, height / srcHeight);
  const cover = Math.max(width / srcWidth, height / srcHeight);
  const scale = style.fit === 'fill' ? cover : style.fit === 'zoom' ? Math.min(contain * 1.35, cover) : contain;
  const dw = srcWidth * scale;
  const dh = srcHeight * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  const coversScreen = dw >= width - 1 && dh >= height - 1;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  if (style.background === 'blur' && !coversScreen) {
    // Cheap, good-looking blur: draw the frame into a tiny canvas, then scale
    // it back up with smoothing. Much faster than a real blur filter.
    if (!blurCanvas) {
      blurCanvas = document.createElement('canvas');
      blurCanvas.width = 36;
      blurCanvas.height = 64;
    }
    const bctx = blurCanvas.getContext('2d')!;
    const bw = blurCanvas.width;
    const bh = blurCanvas.height;
    const bscale = Math.max(bw / srcWidth, bh / srcHeight);
    drawSource(bctx, (bw - srcWidth * bscale) / 2, (bh - srcHeight * bscale) / 2, srcWidth * bscale, srcHeight * bscale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blurCanvas, 0, 0, width, height);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, width, height);
  }

  drawSource(ctx, dx, dy, dw, dh);

  const visibleTop = Math.max(0, dy);
  const visibleBottom = Math.min(height, dy + dh);
  const maxWidth = width * 0.9;

  if (style.title.trim()) {
    const roomAbove = visibleTop > height * 0.16;
    const { bottom: titleBottom } = drawOutlinedText(ctx, style.title.trim(), {
      centerX: width / 2,
      y: roomAbove ? visibleTop - 40 * s : height * 0.1,
      anchor: roomAbove ? 'bottom' : 'top',
      maxWidth,
      fontSize: Math.round(84 * s),
      maxLines: 3,
    });
    if (style.credit.trim()) {
      drawOutlinedText(ctx, style.credit.trim(), {
        centerX: width / 2,
        y: titleBottom + 8 * s,
        anchor: 'top',
        maxWidth,
        fontSize: Math.round(38 * s),
        maxLines: 1,
        color: '#d4d4d8',
      });
    }
  }

  const label = style.showTotal ? `Part ${partNumber}/${totalParts}` : `Part ${partNumber}`;
  const roomBelow = visibleBottom < height * 0.84;
  const fontSize = Math.round(92 * s);
  ctx.font = `${fontSize}px ${DISPLAY_FONT_STACK}`;
  drawOutlinedText(ctx, label, {
    centerX: width / 2,
    y: roomBelow ? visibleBottom + 40 * s : height * 0.86,
    anchor: 'top',
    maxWidth,
    fontSize,
    maxLines: 1,
    color: style.accentColor,
  });
}
