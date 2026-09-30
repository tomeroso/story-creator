/**
 * Deterministic 2D ball physics for "satisfying" bounce videos.
 *
 * Fixed 240 Hz time step + seeded RNG: the same settings and seed always
 * produce exactly the same run, so the live preview matches the rendered
 * video frame-for-frame. All coordinates are in a logical 1080x1920 space.
 */

export type PhysicsPreset = 'grow' | 'rings' | 'multiply';

export interface PhysicsSettings {
  preset: PhysicsPreset;
  seed: number;
  /** px/s² downward. */
  gravity: number;
  /** Launch speed, px/s. */
  speed: number;
  ballRadius: number;
  /** Speed multiplier applied on each wall bounce (1 = perfectly elastic). */
  bounceBoost: number;
  /** grow: radius added per bounce (px). */
  growth: number;
  /** rings: number of rings to escape. */
  ringCount: number;
  /** rings/multiply: gap size in degrees. */
  gapDegrees: number;
  /** rings/multiply: gap rotation speed, degrees per second. */
  rotationSpeed: number;
  /** multiply: new balls spawned per escaped ball. */
  spawnPerEscape: number;
  /** multiply: cap on balls in play. */
  maxBalls: number;
  /** Hard cap on video length (seconds). */
  maxDuration: number;
  trails: boolean;
}

export const PRESET_DEFAULTS: Record<PhysicsPreset, PhysicsSettings> = {
  grow: {
    preset: 'grow', seed: 1, gravity: 900, speed: 900, ballRadius: 26, bounceBoost: 1.0, growth: 5,
    ringCount: 1, gapDegrees: 0, rotationSpeed: 0, spawnPerEscape: 0, maxBalls: 1, maxDuration: 75, trails: true,
  },
  rings: {
    preset: 'rings', seed: 1, gravity: 700, speed: 1050, ballRadius: 22, bounceBoost: 1.0, growth: 0,
    ringCount: 10, gapDegrees: 48, rotationSpeed: 80, spawnPerEscape: 0, maxBalls: 1, maxDuration: 90, trails: true,
  },
  multiply: {
    preset: 'multiply', seed: 1, gravity: 300, speed: 900, ballRadius: 14, bounceBoost: 1.0, growth: 0,
    ringCount: 1, gapDegrees: 46, rotationSpeed: 60, spawnPerEscape: 2, maxBalls: 250, maxDuration: 45, trails: false,
  },
};

export const ARENA = { cx: 540, cy: 1010, r: 450 };
export const SIM_DT = 1 / 240;
const OUTRO_SECONDS = 2.5;
const MIN_SPEED = 450;
const MAX_SPEED = 2800;
const TRAIL_POINTS = 14;

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  escaped: boolean;
  trail: { x: number; y: number }[];
}

export interface Ring {
  radius: number;
  /** Gap center angle (radians); rotates over time. */
  angle: number;
  /** Full gap width (radians); 0 = closed circle. */
  gap: number;
  /** Radians per second. */
  spin: number;
  hue: number;
  alive: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  hue: number;
}

export type SimEventKind = 'bounce' | 'escape' | 'finish';
export interface SimEvent {
  t: number;
  kind: SimEventKind;
}

/** mulberry32 - tiny, fast, deterministic PRNG. */
export function makeRng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
function wrapAngle(a: number) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

export class PhysicsSim {
  readonly settings: PhysicsSettings;
  t = 0;
  balls: Ball[] = [];
  rings: Ring[] = [];
  particles: Particle[] = [];
  bounces = 0;
  escapes = 0;
  /** Time the end condition was reached (null = not yet). */
  finishedAt: number | null = null;
  private rng: () => number;
  private nextBallId = 0;
  private lastTrailSample = -1;

  constructor(settings: PhysicsSettings) {
    this.settings = settings;
    this.rng = makeRng(settings.seed);
    const s = settings;

    if (s.preset === 'rings') {
      const count = Math.max(1, Math.round(s.ringCount));
      const inner = Math.max(s.ballRadius * 3.2, 110);
      for (let i = 0; i < count; i++) {
        const radius = count === 1 ? ARENA.r : inner + ((ARENA.r - inner) * i) / (count - 1);
        this.rings.push({
          radius,
          angle: this.rng() * TAU,
          gap: (s.gapDegrees * Math.PI) / 180,
          // Alternate directions and speed up slightly outward for a nicer look.
          spin: ((s.rotationSpeed * Math.PI) / 180) * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.04),
          hue: (i * 360) / count,
          alive: true,
        });
      }
    } else {
      this.rings.push({
        radius: ARENA.r,
        angle: -Math.PI / 2 + this.rng() * TAU,
        gap: s.preset === 'multiply' ? (s.gapDegrees * Math.PI) / 180 : 0,
        spin: s.preset === 'multiply' ? (s.rotationSpeed * Math.PI) / 180 : 0,
        hue: 200,
        alive: true,
      });
    }
    this.spawnBall(ARENA.cx, ARENA.cy - (s.preset === 'grow' ? 150 : 0));
  }

  private spawnBall(x: number, y: number) {
    const dir = this.rng() * TAU;
    this.balls.push({
      id: this.nextBallId++,
      x,
      y,
      vx: Math.cos(dir) * this.settings.speed,
      vy: Math.sin(dir) * this.settings.speed,
      r: this.settings.ballRadius,
      hue: this.rng() * 360,
      escaped: false,
      trail: [],
    });
  }

  /** When the video should end (end condition + short outro, capped by maxDuration). */
  get endTime(): number {
    const cap = this.settings.maxDuration;
    return this.finishedAt === null ? cap : Math.min(cap, this.finishedAt + OUTRO_SECONDS);
  }

  get activeBalls(): number {
    return this.balls.reduce((n, b) => n + (b.escaped ? 0 : 1), 0);
  }

  get ringsLeft(): number {
    return this.rings.reduce((n, r) => n + (r.alive ? 1 : 0), 0);
  }

  /** Advance the simulation to `time`, returning sound/visual events that happened. */
  stepTo(time: number): SimEvent[] {
    const events: SimEvent[] = [];
    while (this.t + SIM_DT <= time + 1e-9) this.step(events);
    return events;
  }

  private step(events: SimEvent[]) {
    const s = this.settings;
    const dt = SIM_DT;
    this.t += dt;
    const t = this.t;

    for (const ring of this.rings) ring.angle = wrapAngle(ring.angle + ring.spin * dt);

    const spawnQueue: number = this.stepBalls(events, dt, t);
    for (let i = 0; i < spawnQueue; i++) {
      if (this.activeBalls >= s.maxBalls) break;
      this.spawnBall(ARENA.cx, ARENA.cy);
    }

    // Particles (visual only, but deterministic too).
    for (const p of this.particles) {
      p.vy += s.gravity * 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    if (this.particles.length && this.particles[0].life <= 0) this.particles = this.particles.filter((p) => p.life > 0);

    // Drop escaped balls once they have left the screen.
    if (this.balls.some((b) => b.escaped && (b.y - b.r > 2000 || b.x + b.r < -100 || b.x - b.r > 1180))) {
      this.balls = this.balls.filter((b) => !(b.escaped && (b.y - b.r > 2000 || b.x + b.r < -100 || b.x - b.r > 1180)));
    }

    // Trails are sampled at 60 Hz of sim time so they look identical at any output fps.
    if (s.trails) {
      const sample = Math.floor(t * 60);
      if (sample !== this.lastTrailSample) {
        this.lastTrailSample = sample;
        for (const b of this.balls) {
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > TRAIL_POINTS) b.trail.shift();
        }
      }
    }

    if (this.finishedAt === null) {
      const done =
        (s.preset === 'grow' && this.balls[0] && this.balls[0].r >= ARENA.r - 2) ||
        (s.preset === 'rings' && this.ringsLeft === 0);
      if (done) {
        this.finishedAt = t;
        events.push({ t, kind: 'finish' });
      }
    }
  }

  /** Moves balls and resolves ring collisions. Returns how many balls to spawn (multiply). */
  private stepBalls(events: SimEvent[], dt: number, t: number): number {
    const s = this.settings;
    let toSpawn = 0;

    for (const b of this.balls) {
      b.vy += s.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.escaped) continue;

      // The ball is bounded by the innermost ring that's still alive.
      let ring: Ring | null = null;
      for (const r of this.rings) if (r.alive && (!ring || r.radius < ring.radius)) ring = r;
      if (!ring) {
        b.escaped = true; // every ring is gone - it's free
        continue;
      }

      const dx = b.x - ARENA.cx;
      const dy = b.y - ARENA.cy;
      const dist = Math.hypot(dx, dy) || 1e-6;

      // Fully outside the ring: it escaped through the gap.
      if (dist - b.r > ring.radius) {
        this.escapes++;
        events.push({ t, kind: 'escape' });
        if (s.preset === 'multiply') {
          b.escaped = true;
          toSpawn += Math.max(0, Math.round(s.spawnPerEscape));
        } else {
          ring.alive = false;
          this.burst(ring);
          if (this.ringsLeft === 0) b.escaped = true;
        }
        continue;
      }

      if (dist + b.r <= ring.radius) continue; // not touching the ring

      // Touching the ring: pass through if lined up with the gap (or already
      // committed past the ring line), otherwise bounce.
      if (ring.gap > 0) {
        const rel = Math.abs(wrapAngle(Math.atan2(dy, dx) - ring.angle));
        const ballAngular = Math.asin(Math.min(1, b.r / ring.radius));
        if (dist > ring.radius || rel + ballAngular * 0.85 < ring.gap / 2) continue;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      b.x = ARENA.cx + nx * (ring.radius - b.r);
      b.y = ARENA.cy + ny * (ring.radius - b.r);
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= 2 * vn * nx;
        b.vy -= 2 * vn * ny;
        // Keep the motion lively: optional boost, clamped to a sane range.
        let speed = Math.hypot(b.vx, b.vy) * s.bounceBoost;
        speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
        // Tiny deterministic nudge (+/-4 deg) so the ball can't lock into a
        // repeating loop that never lines up with a gap.
        const jitter = (this.rng() - 0.5) * ((8 * Math.PI) / 180);
        const dir = Math.atan2(b.vy, b.vx) + jitter;
        b.vx = Math.cos(dir) * speed;
        b.vy = Math.sin(dir) * speed;
        // The nudge must never point the ball back into the wall.
        if (b.vx * nx + b.vy * ny > 0) {
          const back = b.vx * nx + b.vy * ny;
          b.vx -= 2 * back * nx;
          b.vy -= 2 * back * ny;
        }
        b.hue = (b.hue + 23) % 360;
        this.bounces++;
        events.push({ t, kind: 'bounce' });
        if (s.preset === 'grow') b.r = Math.min(ARENA.r - 1, b.r + s.growth);
      }
    }
    return toSpawn;
  }

  private burst(ring: Ring) {
    const count = 48;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + this.rng() * 0.1;
      const speed = 150 + this.rng() * 350;
      const life = 0.7 + this.rng() * 0.6;
      this.particles.push({
        x: ARENA.cx + Math.cos(a) * ring.radius,
        y: ARENA.cy + Math.sin(a) * ring.radius,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life,
        maxLife: life,
        hue: ring.hue,
      });
    }
  }
}

/** Runs a whole simulation without drawing - used to know the video length and all sound events up front. */
export function simulateHeadless(settings: PhysicsSettings): { duration: number; events: SimEvent[]; finished: boolean } {
  const sim = new PhysicsSim(settings);
  const events: SimEvent[] = [];
  const cap = settings.maxDuration;
  // Step in 1-second chunks so we can stop right after the outro.
  for (let second = 1; second <= Math.ceil(cap); second++) {
    events.push(...sim.stepTo(Math.min(second, cap)));
    if (sim.finishedAt !== null && sim.t >= sim.endTime) break;
  }
  const duration = sim.endTime;
  return { duration, events: events.filter((e) => e.t <= duration), finished: sim.finishedAt !== null };
}
