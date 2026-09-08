import { useEffect, useRef } from 'react';
import { HAND_BONES, POSE_BONES } from '../services/landmarker.js';
import { cn } from '../lib/utils.js';

/**
 * Draws the skeleton over the preview.
 *
 * Takes a ref holding the latest frame rather than a prop, so 30 fps of
 * landmark data never triggers a React render. The canvas paints from its own
 * rAF loop; React only mounts it once.
 *
 * `mirrored` flips x to match the CSS-mirrored preview. The landmarks
 * themselves are in un-mirrored image space, which is what the model needs, so
 * the flip has to happen here at draw time rather than in the data.
 */
export default function LandmarkCanvas({ frameRef, mirrored = true, className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      // The overlay is thin lines and dots over live video, so a device-pixel
      // backing store buys nothing visible and costs a full clear plus redraw
      // of ~4x the pixels every frame on a 2x phone. Cap the backing store at
      // the camera's own resolution instead of the display's.
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = Math.min(Math.round(rect.width * dpr), 640);
      const h = Math.min(Math.round(rect.height * dpr), 640);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const data = frameRef.current;
      if (!data) return;

      const px = (i) => {
        const x = data[i * 3];
        const y = data[i * 3 + 1];
        // Exact zero means "not tracked" -- never draw it.
        if (x === 0 && y === 0) return null;
        return [(mirrored ? 1 - x : x) * canvas.width, y * canvas.height];
      };

      const skeleton = (base, bones, count, colour, dot) => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        for (const [a, b] of bones) {
          const pa = px(base + a);
          const pb = px(base + b);
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pb[0], pb[1]);
          ctx.stroke();
        }
        ctx.fillStyle = colour;
        for (let i = 0; i < count; i++) {
          const p = px(base + i);
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p[0], p[1], dot * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      skeleton(0, POSE_BONES, 33, 'rgba(76,215,246,0.85)', 3);
      skeleton(33, HAND_BONES, 21, 'rgba(78,222,163,0.95)', 4);
      skeleton(54, HAND_BONES, 21, 'rgba(78,222,163,0.95)', 4);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, mirrored]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    />
  );
}
