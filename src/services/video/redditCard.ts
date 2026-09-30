import type { RedditPostCard } from '../../types/story';
import { wrapText } from './fonts';

const UI_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Draws a generic dark-mode "post card" panel - avatar, subreddit/time,
 * username, bold title, and upvote/comment/share pills - as a floating
 * overlay meant to sit on top of whatever's already been drawn (the
 * background footage), not a full-screen takeover. Deliberately generic
 * rather than a pixel copy of any real platform's UI or logo.
 */
export function drawRedditCardFrame(ctx: CanvasRenderingContext2D, card: RedditPostCard, width: number, height: number) {
  const s = width / 1080;

  // Subtle full-frame dim so the panel and its text stay readable over busy
  // footage, without hiding the video the way a solid fill would.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(0, 0, width, height);

  const pad = 44 * s;
  const panelX = pad;
  const panelW = width - pad * 2;
  const panelPad = 36 * s;

  // Lay out the text first (on a throwaway pass) so the panel can be sized
  // to fit it, then draw the panel, then draw the text on top for real.
  const avatarR = 30 * s;
  const titleFontSize = Math.round(46 * s);
  ctx.font = `700 ${titleFontSize}px ${UI_FONT_STACK}`;
  const titleMaxWidth = panelW - panelPad * 2;
  const titleLines = wrapText(ctx, card.title.trim() || 'Untitled post', titleMaxWidth).slice(0, 5);
  const titleLineHeight = 56 * s;
  const pillH = 50 * s;

  const headerH = avatarR * 2 + 10 * s;
  const titleBlockH = titleLines.length * titleLineHeight;
  const panelH = panelPad + headerH + 22 * s + titleBlockH + 20 * s + pillH + panelPad;
  const panelY = height * 0.1;
  const r = 24 * s;

  // Panel background: solid enough to guarantee legibility, sitting on top
  // of the dimmed video rather than replacing it.
  ctx.fillStyle = 'rgba(11,13,16,0.94)';
  ctx.beginPath();
  ctx.moveTo(panelX + r, panelY);
  ctx.arcTo(panelX + panelW, panelY, panelX + panelW, panelY + panelH, r);
  ctx.arcTo(panelX + panelW, panelY + panelH, panelX, panelY + panelH, r);
  ctx.arcTo(panelX, panelY + panelH, panelX, panelY, r);
  ctx.arcTo(panelX, panelY, panelX + panelW, panelY, r);
  ctx.closePath();
  ctx.fill();

  let y = panelY + panelPad + avatarR;
  const avatarX = panelX + panelPad + avatarR;

  // Avatar: plain circle with a simple mark - not any real platform's logo.
  ctx.fillStyle = '#2a2f36';
  ctx.beginPath();
  ctx.arc(avatarX, y, avatarR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b94a3';
  ctx.beginPath();
  ctx.arc(avatarX, y - avatarR * 0.15, avatarR * 0.4, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avatarX, y + avatarR * 0.75, avatarR * 0.65, Math.PI, 0); // shoulders
  ctx.fill();

  // "r/subreddit • time"
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(27 * s)}px ${UI_FONT_STACK}`;
  ctx.fillStyle = '#d4d4d8';
  const subLine = `r/${card.subreddit.replace(/^r\//i, '') || 'AskReddit'}  •  ${card.timeAgo || 'now'}`;
  ctx.fillText(subLine, avatarX + avatarR + 18 * s, y - 6 * s);

  // Username, below the subreddit line.
  ctx.font = `${Math.round(23 * s)}px ${UI_FONT_STACK}`;
  ctx.fillStyle = '#9aa1ad';
  ctx.fillText(card.author || 'anonymous', avatarX + avatarR + 18 * s, y + 22 * s);

  // Title, bold and wrapped.
  y = panelY + panelPad + headerH + 22 * s;
  ctx.font = `700 ${titleFontSize}px ${UI_FONT_STACK}`;
  ctx.fillStyle = '#f4f4f5';
  for (const line of titleLines) {
    y += titleLineHeight;
    ctx.fillText(line, panelX + panelPad, y);
  }

  // Pills: upvote, comments, share.
  y += 20 * s;
  let x = panelX + panelPad;
  x = drawPill(ctx, x, y, pillH, `▲ ${card.upvotes || '1'} ▼`, s);
  x += 14 * s;
  x = drawPill(ctx, x, y, pillH, `💬 answers`, s);
  x += 14 * s;
  drawPill(ctx, x, y, pillH, `↗ Share`, s);
}

function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, text: string, s: number): number {
  ctx.font = `${Math.round(25 * s)}px ${UI_FONT_STACK}`;
  const textWidth = ctx.measureText(text).width;
  const padX = 22 * s;
  const w = textWidth + padX * 2;
  const r = h / 2;
  ctx.fillStyle = '#23272d';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e4e4e7';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1 * s);
  ctx.textBaseline = 'alphabetic';
  return x + w;
}
