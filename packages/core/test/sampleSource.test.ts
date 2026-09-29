import { afterEach, describe, expect, it } from "vitest";
import { Kawarp, type KawarpContextOptions } from "../src/index";
import {
  colorDistance,
  createCanvas,
  createSolidCanvas,
  createVideoSource,
  paintSolid,
  type Rgb,
  type TestVideoSource,
} from "./helpers";

const AMBER: Rgb = [230, 150, 40];
const VIOLET: Rgb = [120, 50, 200];

const CONTEXTS: [string, KawarpContextOptions][] = [
  ["WebGL1", {}],
  ["WebGL2 high precision", { highPrecisionInput: true }],
];

const instances: Kawarp[] = [];
const sources: TestVideoSource[] = [];

const createKawarp = (options: KawarpContextOptions) => {
  const instance = new Kawarp(createCanvas(), options);
  instances.push(instance);
  return instance;
};

const everyPixelNear = (pixels: Uint8Array, color: Rgb, tolerance: number) => {
  for (let i = 0; i < pixels.length; i += 4) {
    const pixel: Rgb = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    if (colorDistance(pixel, color) > tolerance) return false;
  }
  return true;
};

afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
  for (const source of sources.splice(0)) source.dispose();
  document.body.replaceChildren();
});

describe.each(CONTEXTS)("sampleSource on %s", (_name, contextOptions) => {
  it("resolves null before any source is loaded", async () => {
    const instance = createKawarp(contextOptions);
    await expect(instance.sampleSource()).resolves.toBeNull();
  });

  it("returns a size x size RGBA thumbnail of the image", async () => {
    const instance = createKawarp(contextOptions);
    instance.loadImageElement(createSolidCanvas(AMBER, 200));
    const pixels = await instance.sampleSource(8);
    expect(pixels).toHaveLength(8 * 8 * 4);
    expect(everyPixelNear(pixels as Uint8Array, AMBER, 1)).toBe(true);
  });

  it("samples the current video frame", async () => {
    const source = await createVideoSource(320, 180, paintSolid(VIOLET));
    sources.push(source);
    const instance = createKawarp(contextOptions);
    instance.loadVideo(source.video);
    const pixels = await instance.sampleSource(16);
    expect(pixels).toHaveLength(16 * 16 * 4);
    expect(everyPixelNear(pixels as Uint8Array, VIOLET, 10)).toBe(true);
  });

  it("clamps the size to the blur resolution", async () => {
    const instance = createKawarp(contextOptions);
    instance.loadImageElement(createSolidCanvas(AMBER));
    await expect(instance.sampleSource(4096)).resolves.toHaveLength(
      128 * 128 * 4,
    );
    await expect(instance.sampleSource(0)).resolves.toHaveLength(4);
  });

  it("does not disturb rendering", async () => {
    const canvas = createCanvas();
    const instance = new Kawarp(canvas, {
      ...contextOptions,
      saturation: 1,
      tintIntensity: 0,
      dithering: 0,
      warpIntensity: 0,
    });
    instances.push(instance);
    instance.loadImageElement(createSolidCanvas(AMBER));
    await instance.sampleSource(8);
    instance.renderFrame(1);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    context.canvas.width = canvas.width;
    context.canvas.height = canvas.height;
    context.drawImage(canvas, 0, 0);
    const [red, green, blue] = context.getImageData(32, 32, 1, 1).data;
    expect(
      colorDistance([red ?? 0, green ?? 0, blue ?? 0], AMBER),
    ).toBeLessThan(3);
  });
});

describe("sampleSource concurrency and lifetime", () => {
  it("shares one pending read between concurrent calls on WebGL2", async () => {
    const instance = createKawarp({ highPrecisionInput: true });
    instance.loadImageElement(createSolidCanvas(AMBER));
    const first = instance.sampleSource(8);
    const second = instance.sampleSource(8);
    expect(second).toBe(first);
    await first;
  });

  it("resolves null when disposed while a read is pending", async () => {
    const instance = new Kawarp(createCanvas(), { highPrecisionInput: true });
    instance.loadImageElement(createSolidCanvas(AMBER));
    const pending = instance.sampleSource(8);
    instance.dispose();
    await expect(pending).resolves.toBeNull();
    await expect(instance.sampleSource(8)).resolves.toBeNull();
  });
});
