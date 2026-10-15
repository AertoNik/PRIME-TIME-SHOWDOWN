import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three';

const cache = new Map<string, CanvasTexture>();

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function cached(key: string, build: () => HTMLCanvasElement): CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = canvasTexture(build());
    cache.set(key, t);
  }
  return t;
}

/** Soft radial glow (white, alpha falloff). */
export function glowTexture(): Texture {
  return cached('glow', () => {
    const { c, g } = makeCanvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

/** Four-point star flare for muzzle flashes and impacts. */
export function flareTexture(): Texture {
  return cached('flare', () => {
    const { c, g } = makeCanvas(128, 128);
    g.translate(64, 64);
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 40);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, 40, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      const grd = g.createLinearGradient(0, 0, 62, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(62, 0);
      g.lineTo(0, 7);
      g.closePath();
      g.fill();
      g.restore();
    }
    return c;
  });
}

/** Soft cloudy puff for smoke / dust. */
export function puffTexture(): Texture {
  return cached('puff', () => {
    const { c, g } = makeCanvas(128, 128);
    for (let i = 0; i < 9; i++) {
      const x = 64 + Math.cos(i * 2.1) * 18 * (i % 3) * 0.6;
      const y = 64 + Math.sin(i * 1.7) * 18 * (i % 3) * 0.6;
      const r = 34 + (i % 4) * 6;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.5)');
      grd.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  });
}

/** Thin bright ring for shockwaves. */
export function ringTexture(): Texture {
  return cached('ring', () => {
    const { c, g } = makeCanvas(256, 256);
    const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.72, 'rgba(255,255,255,0.0)');
    grd.addColorStop(0.86, 'rgba(255,255,255,1)');
    grd.addColorStop(0.93, 'rgba(255,255,255,0.4)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    return c;
  });
}

/** Ground team ring with dashed segments. */
export function teamRingTexture(): Texture {
  return cached('teamring', () => {
    const { c, g } = makeCanvas(256, 256);
    g.translate(128, 128);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, 104, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.arc(0, 0, 120, a, a + 0.12);
      g.stroke();
    }
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 104);
    grd.addColorStop(0, 'rgba(255,255,255,0.0)');
    grd.addColorStop(0.75, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, 104, 0, Math.PI * 2);
    g.fill();
    return c;
  });
}

/** Dark blob shadow. */
export function shadowTexture(): Texture {
  return cached('shadow', () => {
    const { c, g } = makeCanvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

/** Telegraph lane: arrow chevrons on a soft strip (white, tinted by material). */
export function laneTexture(): Texture {
  return cached('lane', () => {
    const { c, g } = makeCanvas(128, 512);
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.35)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    grd.addColorStop(0.82, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 512);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let y = 30; y < 512; y += 64) {
      g.beginPath();
      g.moveTo(24, y + 26);
      g.lineTo(64, y);
      g.lineTo(104, y + 26);
      g.lineTo(104, y + 40);
      g.lineTo(64, y + 14);
      g.lineTo(24, y + 40);
      g.closePath();
      g.fill();
    }
    return c;
  });
}

/** Electric/hex pattern used by the shield bubble. */
export function hexTexture(): Texture {
  return cached('hex', () => {
    const { c, g } = makeCanvas(256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    const r = 18;
    const h = Math.sqrt(3) * r;
    for (let row = -1; row < 10; row++) {
      for (let col = -1; col < 10; col++) {
        const x = col * r * 3 + (row % 2 ? r * 1.5 : 0);
        const y = row * (h / 2);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = x + r * Math.cos(a);
          const py = y + r * Math.sin(a);
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
    return c;
  });
}

/** Tracer streak: bright head fading into a soft tail (head at v=1). */
export function streakTexture(): Texture {
  return cached('streak', () => {
    const { c, g } = makeCanvas(64, 256);
    const along = g.createLinearGradient(0, 256, 0, 0);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    along.addColorStop(0.92, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0.6)');
    g.fillStyle = along;
    g.fillRect(0, 0, 64, 256);
    // soft edges across the width
    g.globalCompositeOperation = 'destination-in';
    const across = g.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 64, 256);
    return c;
  });
}

/** Radial light rays for big moments (combos, KO). */
export function raysTexture(): Texture {
  return cached('rays', () => {
    const { c, g } = makeCanvas(256, 256);
    g.translate(128, 128);
    for (let i = 0; i < 18; i++) {
      g.save();
      g.rotate((i / 18) * Math.PI * 2 + (i % 2) * 0.08);
      const len = i % 2 ? 110 : 128;
      const grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(len, -9);
      g.lineTo(len, 9);
      g.closePath();
      g.fill();
      g.restore();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 40);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0, 40, 0, Math.PI * 2);
    g.fill();
    return c;
  });
}

/** Five-point cartoon star (dizzy stun). */
export function starTexture(): Texture {
  return cached('star', () => {
    const { c, g } = makeCanvas(64, 64);
    g.translate(32, 32);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 27;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    return c;
  });
}

/** Burn mark with a hot rim, for heavy impacts on the floor. */
export function scorchTexture(): Texture {
  return cached('scorch', () => {
    const { c, g } = makeCanvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(10,6,20,0.85)');
    grd.addColorStop(0.45, 'rgba(14,8,24,0.6)');
    grd.addColorStop(0.7, 'rgba(255,140,60,0.35)');
    grd.addColorStop(0.8, 'rgba(255,120,40,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

/** Little glowing jack-o'-lantern sprite (PUMPKIN VICTORY). */
export function pumpkinSpriteTexture(): Texture {
  return cached('pumpkin', () => {
    const { c, g } = makeCanvas(96, 96);
    g.translate(48, 52);
    const body = g.createRadialGradient(-8, -10, 4, 0, 0, 40);
    body.addColorStop(0, '#ffc86a');
    body.addColorStop(0.55, '#ff8a1f');
    body.addColorStop(1, '#b8420a');
    g.fillStyle = body;
    for (const [dx, w] of [[-14, 20], [14, 20], [0, 22]] as [number, number][]) {
      g.beginPath();
      g.ellipse(dx, 0, w, 32, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#4a7a2a';
    g.fillRect(-4, -42, 8, 14);
    g.fillStyle = '#ffe9a0';
    g.shadowColor = '#ffd04a';
    g.shadowBlur = 8;
    for (const dx of [-11, 11]) {
      g.beginPath();
      g.moveTo(dx - 7, -2);
      g.lineTo(dx + 7, -2);
      g.lineTo(dx, -14);
      g.fill();
    }
    g.beginPath();
    g.moveTo(-18, 8);
    g.lineTo(-10, 14);
    g.lineTo(-4, 9);
    g.lineTo(2, 15);
    g.lineTo(8, 9);
    g.lineTo(14, 14);
    g.lineTo(18, 8);
    g.quadraticCurveTo(0, 28, -18, 8);
    g.fill();
    return c;
  });
}
