export interface FrameOptions {
  /** Warp strength (default: 1) */
  warpIntensity?: number;
  /** Kawase blur passes (default: 8) */
  blurPasses?: number;
  /** Output saturation (default: 1.5) */
  saturation?: number;
  /** Animation time in seconds, as passed to `renderFrame` (default: 12) */
  time?: number;
}

const BLUR_SIZE = 128;
const TINT: [number, number, number] = [0.157, 0.157, 0.235];
const TINT_INTENSITY = 0.15;
const DITHERING = 0.008;

interface Texture {
  width: number;
  height: number;
  data: Float32Array;
}

function sample(tex: Texture, u: number, v: number, out: Float32Array): void {
  const { width, height, data } = tex;
  const x = Math.min(Math.max(u * width - 0.5, 0), width - 1);
  const y = Math.min(Math.max(v * height - 0.5, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * width + x0) * 3 + c]!;
    const b = data[(y0 * width + x1) * 3 + c]!;
    const d = data[(y1 * width + x0) * 3 + c]!;
    const e = data[(y1 * width + x1) * 3 + c]!;
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
}

function fromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Texture {
  const data = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; j < data.length; i += 4, j += 3) {
    data[j] = rgba[i]! / 255;
    data[j + 1] = rgba[i + 1]! / 255;
    data[j + 2] = rgba[i + 2]! / 255;
  }
  return { width, height, data };
}

function tintedBlurSource(source: Texture): Texture {
  const data = new Float32Array(BLUR_SIZE * BLUR_SIZE * 3);
  const color = new Float32Array(3);
  for (let y = 0; y < BLUR_SIZE; y++) {
    for (let x = 0; x < BLUR_SIZE; x++) {
      sample(source, (x + 0.5) / BLUR_SIZE, (y + 0.5) / BLUR_SIZE, color);
      const luma = color[0]! * 0.299 + color[1]! * 0.587 + color[2]! * 0.114;
      const t = Math.min(Math.max(luma / 0.5, 0), 1);
      const dark = (1 - t * t * (3 - 2 * t)) * TINT_INTENSITY;
      const i = (y * BLUR_SIZE + x) * 3;
      for (let c = 0; c < 3; c++)
        data[i + c] = color[c]! + (TINT[c]! - color[c]!) * dark;
    }
  }
  return { width: BLUR_SIZE, height: BLUR_SIZE, data };
}

function kawase(tex: Texture, offset: number): Texture {
  const { width, height } = tex;
  const data = new Float32Array(tex.data.length);
  const du = offset / width;
  const dv = offset / height;
  const tap = new Float32Array(3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const i = (y * width + x) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [su, sv] of [
        [-du, -dv],
        [du, -dv],
        [-du, dv],
        [du, dv],
      ] as const) {
        sample(tex, u + su, v + sv, tap);
        r += tap[0]!;
        g += tap[1]!;
        b += tap[2]!;
      }
      data[i] = r / 4;
      data[i + 1] = g / 4;
      data[i + 2] = b / 4;
    }
  }
  return { width, height, data };
}

const mod289 = (x: number) => x - Math.floor(x / 289) * 289;
const permute = (x: number) => mod289((x * 34 + 1) * x);
const fract = (x: number) => x - Math.floor(x);

function snoise(vx: number, vy: number): number {
  const C0 = 0.211324865405187;
  const C1 = 0.366025403784439;
  const C2 = -0.577350269189626;
  const C3 = 0.024390243902439;
  const s = (vx + vy) * C1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  const t = (ix + iy) * C0;
  const x0 = vx - ix + t;
  const y0 = vy - iy + t;
  const i1x = x0 > y0 ? 1 : 0;
  const i1y = 1 - i1x;
  const corners: [number, number][] = [
    [x0, y0],
    [x0 + C0 - i1x, y0 + C0 - i1y],
    [x0 + C2, y0 + C2],
  ];
  ix = mod289(ix);
  iy = mod289(iy);
  const p = [
    permute(permute(iy) + ix),
    permute(permute(iy + i1y) + ix + i1x),
    permute(permute(iy + 1) + ix + 1),
  ];
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const [cx, cy] = corners[k]!;
    let m = Math.max(0.5 - (cx * cx + cy * cy), 0);
    m *= m;
    m *= m;
    const gx = 2 * fract(p[k]! * C3) - 1;
    const h = Math.abs(gx) - 0.5;
    const a0 = gx - Math.floor(gx + 0.5);
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    sum += m * (a0 * cx + h * cy);
  }
  return 130 * sum;
}

function hash(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}

/**
 * One still Kawarp frame on the CPU, for places with no WebGL such as servers and build steps.
 * Renders one frame for an RGBA image (alpha is ignored, as the GPU path ignores it) and returns
 * `outWidth` x `outHeight` RGBA pixels, top row first, matching what `renderFrame(time)` draws.
 */
export function frame(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
  options: FrameOptions = {},
): Uint8Array {
  const warpIntensity = options.warpIntensity ?? 1;
  const blurPasses = options.blurPasses ?? 8;
  const saturation = options.saturation ?? 1.5;
  const time = options.time ?? 12;

  let tex = tintedBlurSource(fromRgba(rgba, width, height));
  for (let i = 0; i < blurPasses; i++) tex = kawase(tex, i + 0.5);

  const out = new Uint8Array(outWidth * outHeight * 4);
  const t = time * 0.05;
  const color = new Float32Array(3);
  for (let row = 0; row < outHeight; row++) {
    // The source uploads unflipped and the output draws bottom-up, so the frame is upside down
    const yb = outHeight - 1 - row;
    const v = (yb + 0.5) / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth;
      const cx = u - 0.5;
      const cy = v - 0.5;
      const r = Math.min(Math.hypot(cx, cy) / 0.7, 1);
      const weight = 1 - r * r * (3 - 2 * r);
      const n1 = snoise(u * 0.35 + t, v * 0.35 + t * 0.7);
      const n2 = snoise(u * 0.35 - t * 0.8 + 50, v * 0.35 + t * 0.5 + 50);
      const n3 = snoise(u * 0.9 + t * 1.2 + 100, v * 0.9 - t);
      const n4 = snoise(u * 0.9 - t, v * 0.9 + t * 1.1 + 100);
      const wu = Math.min(
        Math.max(u + (n1 * 0.65 + n3 * 0.35) * weight * warpIntensity, 0),
        1,
      );
      const wv = Math.min(
        Math.max(v + (n2 * 0.65 + n4 * 0.35) * weight * warpIntensity, 0),
        1,
      );
      sample(tex, wu, wv, color);

      const vignette = 1 - (cx * cx + cy * cy) * 0.3;
      const gray =
        (color[0]! * 0.299 + color[1]! * 0.587 + color[2]! * 0.114) * vignette;
      const dither = (hash(x, yb, Math.floor(time * 60)) - 0.5) * DITHERING;
      const i = (row * outWidth + x) * 4;
      for (let c = 0; c < 3; c++) {
        const value =
          gray + (color[c]! * vignette - gray) * saturation + dither;
        out[i + c] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
      }
      out[i + 3] = 255;
    }
  }
  return out;
}
