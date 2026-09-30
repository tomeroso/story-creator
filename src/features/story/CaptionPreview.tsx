import { useEffect, useRef } from 'react';
import type { CaptionStyle } from '../../types/story';
import { drawCaption, type TimedCard } from '../../services/video/captionDrawing';

interface Props {
  style: CaptionStyle;
}

const SAMPLE_WORDS = ['This', 'is', 'how', 'your', 'captions', 'will', 'look.'];
const WORD_SECONDS = 0.55;

export function CaptionPreview({ style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const start = performance.now();

    const loop = () => {
      const elapsed = (performance.now() - start) / 1000;
      const cycleLength = SAMPLE_WORDS.length * WORD_SECONDS;
      const t = elapsed % cycleLength;
      const index = Math.floor(t / WORD_SECONDS);
      const card: TimedCard = {
        start: index * WORD_SECONDS,
        end: (index + 1) * WORD_SECONDS,
        words: [{ text: SAMPLE_WORDS[index], start: index * WORD_SECONDS, end: (index + 1) * WORD_SECONDS }],
      };

      ctx.fillStyle = '#111318';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Simple gradient stand-in for background footage, so contrast is visible.
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(1, '#334155');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawCaption(ctx, card, t, styleRef.current, canvas.width, canvas.height);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={360}
      height={640}
      className="w-[135px] h-[240px] rounded-md border border-neutral-800 bg-black"
    />
  );
}
