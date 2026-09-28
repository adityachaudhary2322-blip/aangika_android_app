import { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';

/**
 * The animated layer behind the app for seasonal palettes: cherry blossom
 * petals, autumn leaves, snow, or fireflies.
 *
 * One canvas, fixed behind everything (negative z-index, no pointer events),
 * so it can never cover text or steal a tap. Particles drift away from the
 * pointer or finger, which is the only interaction. It stops entirely when
 * the tab is hidden and does not run at all under prefers-reduced-motion.
 */

const KINDS = {
  sakura: {
    colors: { light: ['#F9A8D4', '#FBCFE8', '#F472B6', '#FCE7F3'], dark: ['#F9A8D4', '#F472B6', '#FBCFE8', '#DB2777'] },
    size: [5, 10], fall: [0.35, 0.8], alpha: [0.55, 0.9], density: 26000, max: 42,
  },
  autumn: {
    colors: { light: ['#D97706', '#B45309', '#DC2626', '#F59E0B', '#92400E'], dark: ['#F59E0B', '#EA580C', '#DC2626', '#FBBF24', '#B45309'] },
    size: [8, 14], fall: [0.45, 1.0], alpha: [0.6, 0.9], density: 34000, max: 32,
  },
  winter: {
    colors: { light: ['#BAE6FD', '#93C5FD', '#E0F2FE'], dark: ['#FFFFFF', '#E0F2FE', '#BAE6FD'] },
    size: [1.2, 3.4], fall: [0.3, 0.9], alpha: [0.5, 0.95], density: 12000, max: 90,
  },
  fireflies: {
    colors: { light: ['#A3E635', '#EAB308', '#84CC16'], dark: ['#FDE047', '#BEF264', '#FACC15'] },
    size: [1.6, 3], fall: [0, 0], alpha: [0.3, 1], density: 30000, max: 34,
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function spawn(kind, cfg, w, h, isDark, anywhere) {
  return {
    x: rand(0, w),
    y: anywhere || kind === 'fireflies' ? rand(0, h) : rand(-h * 0.2, -10),
    r: rand(...cfg.size),
    vy: rand(...cfg.fall),
    vx: kind === 'fireflies' ? rand(-0.3, 0.3) : rand(-0.2, 0.2),
    rot: rand(0, Math.PI * 2),
    vr: rand(-0.02, 0.02),
    phase: rand(0, Math.PI * 2),
    color: pick(cfg.colors[isDark ? 'dark' : 'light']),
    alpha: rand(...cfg.alpha),
  };
}

function drawPetal(ctx, p, t) {
  // A petal with a notch at the tip; the flip term fakes it tumbling in 3-D.
  const flip = Math.cos(t * 0.002 + p.phase);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(flip, 1);
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  const r = p.r;
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.bezierCurveTo(r * 1.1, r * 0.4, r * 0.9, -r * 0.9, r * 0.2, -r);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(-r * 0.2, -r);
  ctx.bezierCurveTo(-r * 0.9, -r * 0.9, -r * 1.1, r * 0.4, 0, r);
  ctx.fill();
  ctx.restore();
}

function drawLeaf(ctx, p, t) {
  const flip = Math.cos(t * 0.0015 + p.phase);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(flip, 1);
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  const r = p.r;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.9, -r * 0.3, 0, r);
  ctx.quadraticCurveTo(-r * 0.9, -r * 0.3, 0, -r);
  ctx.fill();
  // Midrib and stem.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.8);
  ctx.lineTo(0, r * 1.25);
  ctx.stroke();
  ctx.restore();
}

function drawSnow(ctx, p) {
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fill();
}

function drawFirefly(ctx, p, t) {
  const glow = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.0018 + p.phase));
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
  g.addColorStop(0, p.color);
  g.addColorStop(1, 'transparent');
  ctx.globalAlpha = glow * p.alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = glow;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

const DRAW = { sakura: drawPetal, autumn: drawLeaf, winter: drawSnow, fireflies: drawFirefly };

export default function Ambient() {
  const { ambient, isDark } = useTheme();
  const canvasRef = useRef(null);

  useEffect(() => {
    const cfg = KINDS[ambient];
    const canvas = canvasRef.current;
    if (!cfg || !canvas) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let particles = [];
    let raf = 0;
    const pointer = { x: -9999, y: -9999 };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(cfg.max, Math.round((w * h) / cfg.density));
      particles = Array.from({ length: n }, () => spawn(ambient, cfg, w, h, isDark, true));
    };

    const step = (t) => {
      raf = requestAnimationFrame(step);
      ctx.clearRect(0, 0, w, h);
      const draw = DRAW[ambient];
      for (const p of particles) {
        // Gentle breeze plus a push away from the pointer.
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 110 * 110) {
          const f = (1 - Math.sqrt(d2) / 110) * 0.6;
          p.vx += (dx / (Math.sqrt(d2) + 0.01)) * f;
          p.vy += (dy / (Math.sqrt(d2) + 0.01)) * f * (ambient === 'fireflies' ? 1 : 0.4);
        }
        if (ambient === 'fireflies') {
          p.vx += rand(-0.03, 0.03);
          p.vy += rand(-0.03, 0.03);
          p.vx *= 0.97;
          p.vy *= 0.97;
        } else {
          p.vx = p.vx * 0.96 + Math.sin(t * 0.0006 + p.phase) * 0.02;
          p.vy = p.vy * 0.96 + rand(...cfg.fall) * 0.04;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;

        if (ambient === 'fireflies') {
          if (p.x < -20) p.x = w + 20;
          if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20;
          if (p.y > h + 20) p.y = -20;
        } else if (p.y > h + 20 || p.x < -40 || p.x > w + 40) {
          Object.assign(p, spawn(ambient, cfg, w, h, isDark, false));
        }
        draw(ctx, p, t);
      }
      ctx.globalAlpha = 1;
    };

    const onMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; };
    const onLeave = () => { pointer.x = -9999; pointer.y = -9999; };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(step);
    };

    resize();
    raf = requestAnimationFrame(step);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, w, h);
    };
  }, [ambient, isDark]);

  if (!ambient) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
