import {useEffect, useRef, useState} from 'react';
import styles from './styles.module.css';

const VISIT_KEY = 'camusdb:pyramid-entrance:v2';
const DURATION = 4400;
const STAGGER = 350;
let hasPlayed = false;

const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => 1 - Math.pow(1 - clamp(value), 3);
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const mix = (from, to, t) => from + (to - from) * t;
const noise = (seed) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

// Subdivide the two visible faces of the actual artwork. Every shard has a
// precise home, so the assembled texture matches the existing pyramid.
function makeShards(image, size, pixelRatio) {
  const apex = [512, 185];
  const ridge = [372, 783];
  const faces = [[apex, [158, 646], ridge], [apex, ridge, [887, 676]]];
  const shards = [];
  const divisions = 5;

  faces.forEach(([a, b, c], face) => {
    const point = (i, j) => [
      (a[0] + (b[0] - a[0]) * i / divisions + (c[0] - a[0]) * j / divisions) / 1024,
      (a[1] + (b[1] - a[1]) * i / divisions + (c[1] - a[1]) * j / divisions) / 1024,
    ];
    const add = (points) => {
      const id = shards.length;
      const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
      const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
      const left = Math.min(...points.map((p) => p[0])) * size - 2;
      const top = Math.min(...points.map((p) => p[1])) * size - 2;
      const width = Math.max(...points.map((p) => p[0])) * size - left + 2;
      const height = Math.max(...points.map((p) => p[1])) * size - top + 2;
      const sprite = document.createElement('canvas');
      sprite.width = Math.ceil(width * pixelRatio);
      sprite.height = Math.ceil(height * pixelRatio);
      const ctx = sprite.getContext('2d');
      if (!ctx) return;
      ctx.scale(pixelRatio, pixelRatio);
      ctx.translate(-left, -top);
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x * size, y * size);
        else ctx.lineTo(x * size, y * size);
      });
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.drawImage(image, 0, 0, size, size);
      const glass = ctx.createLinearGradient(left, top, left + width, top + height);
      glass.addColorStop(0, 'rgba(225, 252, 255, 0.72)');
      glass.addColorStop(0.22, face ? 'rgba(91, 211, 255, 0.2)' : 'rgba(184, 144, 255, 0.3)');
      glass.addColorStop(0.6, 'rgba(91, 157, 255, 0.02)');
      glass.addColorStop(1, 'rgba(156, 222, 255, 0.4)');
      ctx.fillStyle = glass;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(185, 237, 255, 0.8)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
      shards.push({
        sprite, cx, cy, width, height,
        offsetX: left - cx * size,
        offsetY: top - cy * size,
        angle: noise(id + 1) * Math.PI * 2,
        spin: (noise(id + 8) - 0.5) * 5,
        delay: 140 + noise(id + 12) * 600,
        duration: 1750 + noise(id + 21) * 900,
        depth: 0.8 + noise(id + 32) * 1.9,
      });
    };
    for (let i = 0; i < divisions; i += 1) {
      for (let j = 0; j < divisions - i; j += 1) {
        add([point(i, j), point(i + 1, j), point(i, j + 1)]);
        if (i + j < divisions - 1) {
          add([point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
        }
      }
    }
  });
  return shards;
}

export default function PyramidEntrance({targetRefs, networkRef, onActiveChange}) {
  const replayRef = useRef(null);
  const [active, setActive] = useState(false);
  const [canReplay, setCanReplay] = useState(false);

  useEffect(() => {
    const targets = targetRefs.current.filter(Boolean);
    const network = networkRef.current;
    if (targets.length !== 3 || !network) return undefined;
    let frame = 0;
    let canvas = null;
    let observer = null;
    let running = false;
    let disposed = false;
    let prepared = false;
    let resume = null;
    const originalOpacities = targets.map((target) => target.style.opacity);

    const markSeen = () => {
      hasPlayed = true;
      try { window.localStorage.setItem(VISIT_KEY, 'seen'); } catch { /* Storage may be disabled. */ }
    };

    const finish = () => {
      cancelAnimationFrame(frame);
      canvas?.remove();
      canvas = null;
      targets.forEach((target, index) => { target.style.opacity = originalOpacities[index]; });
      running = false;
      resume = null;
      if (!disposed) {
        setActive(false);
        onActiveChange(false);
      }
    };

    const start = () => {
      if (disposed || running || document.hidden || targets.some((target) => !target.naturalWidth)) return;
      const rect = network.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      observer?.disconnect();
      observer = null;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const size = Math.min(460, width * 0.85, height * 0.72);
      // All three pyramids share one set of rasterized fragments.
      const shards = makeShards(targets[0], size, pixelRatio);
      canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx || !shards.length) {
        canvas = null;
        return;
      }
      canvas.className = styles.overlay;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      ctx.scale(pixelRatio, pixelRatio);
      document.body.appendChild(canvas);
      running = true;
      setActive(true);
      onActiveChange(true);
      let lastFrame;
      let elapsed = 0;
      const totalDuration = DURATION + STAGGER * (targets.length - 1);

      const draw = (now) => {
        if (lastFrame !== undefined) elapsed += now - lastFrame;
        lastFrame = now;
        if (elapsed >= totalDuration) {
          markSeen();
          finish();
          return;
        }
        const bounds = network.getBoundingClientRect();
        if (bounds.bottom <= 0 || bounds.top >= height) {
          finish();
          return;
        }
        const atmosphere = smooth(elapsed / 500) * (1 - smooth((elapsed - totalDuration + 1400) / 1200));
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = `rgba(1, 7, 20, ${atmosphere * 0.2})`;
        ctx.fillRect(0, 0, width, height);

        targets.forEach((target, pyramidIndex) => {
          const localElapsed = elapsed - pyramidIndex * STAGGER;
          const destination = target.getBoundingClientRect();
          const assemblySize = Math.min(size, destination.width * 1.25);
          const dock = smooth((localElapsed - 3100) / 1000);
          const reveal = smooth((localElapsed - 3900) / 450);
          const focusX = Math.max(assemblySize / 2, Math.min(width - assemblySize / 2, destination.left + destination.width / 2));
          const focusY = Math.max(assemblySize / 2 + 40, Math.min(height - assemblySize / 2, destination.top + destination.height / 2));
          const centerX = mix(focusX, destination.left + destination.width / 2, dock);
          const centerY = mix(focusY, destination.top + destination.height / 2, dock);
          const currentSize = mix(assemblySize, destination.width, dock);
          const halo = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, currentSize * 0.7);
          halo.addColorStop(0, `rgba(48, 142, 255, ${atmosphere * 0.22})`);
          halo.addColorStop(0.5, `rgba(96, 75, 239, ${atmosphere * 0.09})`);
          halo.addColorStop(1, 'rgba(30, 100, 255, 0)');
          ctx.fillStyle = halo;
          ctx.fillRect(0, 0, width, height);

          shards.forEach((shard, index) => {
            const progress = clamp((localElapsed - shard.delay) / shard.duration);
            const travel = ease(progress);
            const remaining = 1 - travel;
            // Distribute launch points along all four viewport edges.
            const edge = (index + pyramidIndex) % 4;
            const along = noise(index + 57 + pyramidIndex * 83);
            const fromX = edge === 0 ? -100 : edge === 1 ? width + 100 : along * width;
            const fromY = edge === 2 ? -100 : edge === 3 ? height + 100 : along * height;
            const homeX = centerX + (shard.cx - 0.5) * currentSize;
            const homeY = centerY + (shard.cy - 0.5) * currentSize;
            const arc = Math.sin(progress * Math.PI) * remaining * 180;
            const x = mix(fromX, homeX, travel) + Math.cos(shard.angle) * arc;
            const y = mix(fromY, homeY, travel) + Math.sin(shard.angle) * arc;
            const scale = currentSize / size * (1 + remaining * shard.depth);
            ctx.save();
            ctx.globalAlpha = smooth(progress / 0.13) * (1 - reveal);
            ctx.translate(x, y);
            ctx.rotate(shard.spin * remaining);
            // Anisotropic scaling creates a tumbling, glass-like perspective.
            ctx.scale(scale, scale * (1 - Math.sin(progress * Math.PI * 2) * remaining * 0.65));
            ctx.drawImage(shard.sprite, shard.offsetX, shard.offsetY, shard.width, shard.height);
            ctx.restore();
          });

          // A single soft pulse seals the seams as the pyramid slots into place.
          const pulse = Math.sin(clamp((localElapsed - 2800) / 1000) * Math.PI);
          if (pulse > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, currentSize * 0.6);
            glow.addColorStop(0, `rgba(171, 242, 255, ${pulse * 0.28})`);
            glow.addColorStop(0.35, `rgba(74, 180, 255, ${pulse * 0.14})`);
            glow.addColorStop(1, 'rgba(74, 180, 255, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
          }
          target.style.opacity = String(reveal);
        });
        frame = requestAnimationFrame(draw);
      };
      resume = () => {
        lastFrame = undefined;
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    };

    const prepare = () => {
      if (disposed || prepared || targets.some((target) => !target.complete || !target.naturalWidth)) return;
      prepared = true;
      setCanReplay(true);
      let seen = hasPlayed;
      try { seen = seen || window.localStorage.getItem(VISIT_KEY) === 'seen'; } catch { /* Use the in-memory fallback. */ }
      if (seen) return;
      // This entrance intentionally autoplays regardless of the motion
      // preference. The visitor can stop it with the Skip animation control.
      // On narrow screens the artwork sits below the copy: wait until visible.
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) start();
      }, {threshold: 0.5});
      observer.observe(network);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
      } else if (running) {
        resume?.();
      } else if (observer) {
        observer.unobserve(network);
        observer.observe(network);
      }
    };
    replayRef.current = () => {
      if (running) {
        markSeen();
        finish();
      } else start();
    };
    targets.forEach((target) => target.addEventListener('load', prepare, {once: true}));
    prepare();
    window.addEventListener('resize', finish);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      finish();
      observer?.disconnect();
      targets.forEach((target) => target.removeEventListener('load', prepare));
      window.removeEventListener('resize', finish);
      document.removeEventListener('visibilitychange', handleVisibility);
      replayRef.current = null;
    };
  }, [targetRefs, networkRef, onActiveChange]);

  if (!canReplay) return null;
  return (
    <button
      className={styles.replay}
      type="button"
      onClick={() => replayRef.current?.()}
      aria-label={active ? 'Skip pyramid assembly animation' : 'Play glass pyramid entrance animation'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {active ? 'Skip animation' : 'Play animation'}
    </button>
  );
}
