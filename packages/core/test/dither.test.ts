import { afterEach, describe, expect, it } from "vitest";
import { BLUE_NOISE_SIZE, decodeBlueNoise } from "../src/blueNoise";
import { Kawarp, type KawarpOptions } from "../src/index";
import { createCanvas, createSolidCanvas, readCanvasPixels } from "./helpers";

// Flat mid-grey output, so any difference between renders is the dither
const FLAT: KawarpOptions = {
  saturation: 1,
  tintIntensity: 0,
  warpIntensity: 0,
  transitionDuration: 0,
};
const DITHERING = 0.02;

const instances: Kawarp[] = [];

const createFlat = (dithering: number) => {
  const canvas = createCanvas(128, 128);
  const instance = new Kawarp(canvas, { ...FLAT, dithering });
  instances.push(instance);
  instance.loadImageElement(createSolidCanvas([128, 128, 128]));
  return { instance, canvas };
};

const renderPixels = (instance: Kawarp, canvas: HTMLCanvasElement) => {
  instance.renderFrame(1);
  return readCanvasPixels(canvas).data;
};

// Per-pixel, per-channel offsets of a dithered frame from the undithered one
const ditherOffsets = (frames = 1): Int16Array[] => {
  const reference = createFlat(0);
  const expected = renderPixels(reference.instance, reference.canvas);
  const dithered = createFlat(DITHERING);
  return Array.from({ length: frames }, () => {
    const pixels = renderPixels(dithered.instance, dithered.canvas);
    return Int16Array.from(pixels, (value, i) => value - (expected[i] ?? 0));
  });
};

afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

describe("blue noise tile", () => {
  it("uses every threshold equally often", () => {
    const noise = decodeBlueNoise();
    expect(noise).toHaveLength(BLUE_NOISE_SIZE * BLUE_NOISE_SIZE);
    const counts = new Array(256).fill(0);
    for (const value of noise) counts[value]++;
    expect(new Set(counts)).toEqual(new Set([noise.length / 256]));
  });
});

describe("output dithering", () => {
  it("is off at zero dithering", () => {
    const { instance, canvas } = createFlat(0);
    const first = renderPixels(instance, canvas);
    const second = renderPixels(instance, canvas);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("changes the pattern on every frame at a fixed time", () => {
    const [first, second] = ditherOffsets(2) as [Int16Array, Int16Array];
    let changed = 0;
    for (let i = 0; i < first.length; i++) {
      if (i % 4 !== 3 && first[i] !== second[i]) changed++;
    }
    expect(changed / ((first.length * 3) / 4)).toBeGreaterThan(0.3);
  });

  it("stays within half the dithering width and averages out", () => {
    const [offsets] = ditherOffsets() as [Int16Array];
    const limit = Math.ceil((DITHERING / 2) * 255);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (i % 4 === 3) continue;
      const offset = offsets[i] ?? 0;
      expect(Math.abs(offset)).toBeLessThanOrEqual(limit);
      sum += offset;
      count++;
    }
    expect(Math.abs(sum / count)).toBeLessThan(0.1);
  });

  it("dithers each color channel independently", () => {
    // Differences between two frames cancel the rounding bias the channels
    // share at each pixel, leaving only the noise
    const [first, second] = ditherOffsets(2) as [Int16Array, Int16Array];
    let red = 0;
    let green = 0;
    let blue = 0;
    let redGreen = 0;
    let greenBlue = 0;
    let pixels = 0;
    for (let i = 0; i < first.length; i += 4) {
      const r = (first[i] ?? 0) - (second[i] ?? 0);
      const g = (first[i + 1] ?? 0) - (second[i + 1] ?? 0);
      const b = (first[i + 2] ?? 0) - (second[i + 2] ?? 0);
      red += r * r;
      green += g * g;
      blue += b * b;
      redGreen += r * g;
      greenBlue += g * b;
      pixels++;
    }
    expect(red / pixels).toBeGreaterThan(0.5);
    expect(Math.abs(redGreen) / Math.sqrt(red * green)).toBeLessThan(0.05);
    expect(Math.abs(greenBlue) / Math.sqrt(green * blue)).toBeLessThan(0.05);
  });
});
