import { drawOutlinedText } from '../../services/video/fonts';
import { ARENA, type PhysicsSim } from './simulation';

export interface PhysicsLook {
  title: string;
  showCounter: boolean;
}

const TAU = Math.PI * 2;

/** Draws the current simulation state. Everything is laid out in a 1080x1920 logical space and scaled to the output. */
export function drawPhysicsFrame(ctx: CanvasRenderingContext2D, sim: PhysicsSim, look: PhysicsLook, width: number, height: number) {
  const s = width / 1080;
  ctx.setTransform(s, 0, 0, height / 1920, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 1080, 1920);

  // Ring shatter particles.
  for (const p of sim.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = `hsl(${p.hue}, 90%, 62%)`;
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
  }
  ctx.globalAlpha = 1;

  // Rings (drawn as an arc that skips the gap).
  ctx.lineCap = 'round';
  const ringWidth = sim.settings.preset === 'rings' ? Math.max(5, Math.min(12, 180 / Math.max(1, sim.rings.length))) : 12;
  for (const ring of sim.rings) {
    if (!ring.alive) continue;
    ctx.strokeStyle = `hsl(${ring.hue}, 90%, 60%)`;
    ctx.lineWidth = ringWidth;
    ctx.beginPath();
    if (ring.gap > 0) ctx.arc(ARENA.cx, ARENA.cy, ring.radius, ring.angle + ring.gap / 2, ring.angle - ring.gap / 2 + TAU);
    else ctx.arc(ARENA.cx, ARENA.cy, ring.radius, 0, TAU);
    ctx.stroke();
  }

  // Trails.
  if (sim.settings.trails) {
    for (const b of sim.balls) {
      const n = b.trail.length;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.globalAlpha = k * 0.45;
        ctx.strokeStyle = `hsl(${b.hue}, 90%, 60%)`;
        ctx.lineWidth = Math.max(2, b.r * 1.6 * k);
        ctx.beginPath();
        ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
        ctx.lineTo(b.trail[i].x, b.trail[i].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Balls.
  for (const b of sim.balls) {
    ctx.fillStyle = `hsl(${b.hue}, 90%, 58%)`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.min(8, b.r * 0.14));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  if (look.title.trim()) {
    drawOutlinedText(ctx, look.title.trim(), { centerX: 540, y: 330, anchor: 'middle', maxWidth: 960, fontSize: 84, maxLines: 3 });
  }

  if (look.showCounter) {
    const preset = sim.settings.preset;
    const text =
      preset === 'grow'
        ? `SIZE ${Math.round(((sim.balls[0]?.r ?? 0) / ARENA.r) * 100)}%`
        : preset === 'rings'
          ? sim.ringsLeft === 0
            ? 'ESCAPED!'
            : `RINGS LEFT: ${sim.ringsLeft}`
          : `BALLS: ${sim.activeBalls}`;
    drawOutlinedText(ctx, text, { centerX: 540, y: ARENA.cy + ARENA.r + 150, anchor: 'middle', maxWidth: 960, fontSize: 76, maxLines: 1, color: '#facc15' });
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
