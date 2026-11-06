import { BLUR_SIZE, DEFAULTS, LIMITS } from "./defaults.js";
import type { KawarpOptions } from "./index.js";

export type FrameOptions = Pick<
  KawarpOptions,
  | "warpIntensity"
  | "blurPasses"
  | "saturation"
  | "tintColor"
  | "tintIntensity"
  | "dithering"
> & {
  /** Animation time in seconds, as passed to `renderFrame` (default: 12) */
  time?: number;
};

interface Texture {
  width: number;
  height: number;
  data: Float32Array;
}

function sample(
  data: ArrayLike<number>,
  width: number,
  height: number,
  stride: number,
  u: number,
  v: number,
  out: Float32Array,
): void {
  const x = Math.min(Math.max(u * width - 0.5, 0), width - 1);
  const y = Math.min(Math.max(v * height - 0.5, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = data[(y0 * width + x0) * stride + c]!;
    const b = data[(y0 * width + x1) * stride + c]!;
    const d = data[(y1 * width + x0) * stride + c]!;
    const e = data[(y1 * width + x1) * stride + c]!;
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
}

const sampleTexture = (tex: Texture, u: number, v: number, out: Float32Array) =>
  sample(tex.data, tex.width, tex.height, 3, u, v, out);

function tintedBlurSource(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  tint: readonly [number, number, number],
  intensity: number,
): Texture {
  const data = new Float32Array(BLUR_SIZE * BLUR_SIZE * 3);
  const color = new Float32Array(3);
  for (let y = 0; y < BLUR_SIZE; y++) {
    for (let x = 0; x < BLUR_SIZE; x++) {
      sample(
        rgba,
        width,
        height,
        4,
        (x + 0.5) / BLUR_SIZE,
        (y + 0.5) / BLUR_SIZE,
        color,
      );
      const r = color[0]! / 255;
      const g = color[1]! / 255;
      const b = color[2]! / 255;
      const luma = r * 0.299 + g * 0.587 + b * 0.114;
      const t = Math.min(Math.max(luma / 0.5, 0), 1);
      const dark = (1 - t * t * (3 - 2 * t)) * intensity;
      const i = (y * BLUR_SIZE + x) * 3;
      data[i] = r + (tint[0] - r) * dark;
      data[i + 1] = g + (tint[1] - g) * dark;
      data[i + 2] = b + (tint[2] - b) * dark;
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
  const offsets = [-du, -dv, du, -dv, -du, dv, du, dv];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 8; k += 2) {
        sampleTexture(tex, u + offsets[k]!, v + offsets[k + 1]!, tap);
        r += tap[0]!;
        g += tap[1]!;
        b += tap[2]!;
      }
      const i = (y * width + x) * 3;
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

const C0 = 0.211324865405187;
const C1 = 0.366025403784439;
const C2 = -0.577350269189626;
const C3 = 0.024390243902439;

function corner(cx: number, cy: number, p: number): number {
  let m = Math.max(0.5 - (cx * cx + cy * cy), 0);
  m *= m;
  m *= m;
  const gx = 2 * fract(p * C3) - 1;
  const h = Math.abs(gx) - 0.5;
  const a0 = gx - Math.floor(gx + 0.5);
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  return m * (a0 * cx + h * cy);
}

function snoise(vx: number, vy: number): number {
  const s = (vx + vy) * C1;
  const fx = Math.floor(vx + s);
  const fy = Math.floor(vy + s);
  const t = (fx + fy) * C0;
  const x0 = vx - fx + t;
  const y0 = vy - fy + t;
  const i1x = x0 > y0 ? 1 : 0;
  const i1y = 1 - i1x;
  const ix = mod289(fx);
  const iy = mod289(fy);
  return (
    130 *
    (corner(x0, y0, permute(permute(iy) + ix)) +
      corner(
        x0 + C0 - i1x,
        y0 + C0 - i1y,
        permute(permute(iy + i1y) + ix + i1x),
      ) +
      corner(x0 + C2, y0 + C2, permute(permute(iy + 1) + ix + 1)))
  );
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
 * Takes opaque RGBA pixels (alpha is dropped, so flatten a transparent image onto a background
 * first) and returns opaque `outWidth` x `outHeight` RGBA pixels, top row first. Like
 * `renderFrame(time)` on a still image, the picture comes out vertically flipped.
 */
export function frame(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
  options: FrameOptions = {},
): Uint8Array {
  for (const size of [width, height, outWidth, outHeight]) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(
        `frame sizes must be positive integers, got ${size}`,
      );
    }
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(
      `frame expects ${width * height * 4} RGBA bytes for ${width}x${height}, got ${rgba.length}`,
    );
  }
  const warpIntensity = LIMITS.warpIntensity(
    options.warpIntensity ?? DEFAULTS.warpIntensity,
  );
  const blurPasses = LIMITS.blurPasses(
    options.blurPasses ?? DEFAULTS.blurPasses,
  );
  const saturation = LIMITS.saturation(
    options.saturation ?? DEFAULTS.saturation,
  );
  const dithering = LIMITS.dithering(options.dithering ?? DEFAULTS.dithering);
  const tint = LIMITS.tintColor(options.tintColor ?? DEFAULTS.tintColor);
  const tintIntensity = LIMITS.tintIntensity(
    options.tintIntensity ?? DEFAULTS.tintIntensity,
  );
  const time = options.time ?? 12;

  let tex = tintedBlurSource(rgba, width, height, tint, tintIntensity);
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
      sampleTexture(tex, wu, wv, color);

      const vignette = 1 - (cx * cx + cy * cy) * 0.3;
      const gray =
        (color[0]! * 0.299 + color[1]! * 0.587 + color[2]! * 0.114) * vignette;
      const dither = (hash(x, yb, Math.floor(time * 60)) - 0.5) * dithering;
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
