import { afterEach, describe, expect, it } from "vitest";
import { type FrameOptions, frame } from "../src/frame";
import { Kawarp } from "../src/index";
import { createArtworkCanvas, createCanvas, readCanvasPixels } from "./helpers";

const WIDTH = 120;
const HEIGHT = 64;
const CASES: { options: FrameOptions; time: number }[] = [
  { options: { warpIntensity: 0.9, blurPasses: 8, saturation: 1.4 }, time: 12 },
  {
    options: {
      warpIntensity: 0.6,
      blurPasses: 3,
      saturation: 1.2,
      tintColor: [0.3, 0.1, 0.4],
      tintIntensity: 0.4,
      dithering: 0.02,
    },
    time: 4,
  },
];

const artworkPixels = (): ImageData => {
  const art = createArtworkCanvas();
  const context = art.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  return context.getImageData(0, 0, art.width, art.height);
};

const meanChannelDifference = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number => {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    sum += Math.abs(a[i]! - b[i]!);
    count++;
  }
  return sum / count;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("frame", () => {
  it.each(CASES)("matches the WebGL renderer's still frame for %o", ({
    options,
    time,
  }) => {
    const source = artworkPixels();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const instance = new Kawarp(canvas, options);
    instance.loadImageData(source.data, source.width, source.height);
    instance.renderFrame(time);
    const gpu = readCanvasPixels(canvas).data;
    instance.dispose();

    const cpu = frame(source.data, source.width, source.height, WIDTH, HEIGHT, {
      ...options,
      time,
    });
    expect(meanChannelDifference(cpu, gpu)).toBeLessThan(2);
  });

  it("rejects RGB bytes instead of drawing a corrupt frame", () => {
    const rgb = new Uint8Array(16 * 16 * 3);
    expect(() => frame(rgb, 16, 16, 8, 8)).toThrow(RangeError);
  });
});
