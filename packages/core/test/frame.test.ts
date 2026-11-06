import { afterEach, describe, expect, it } from "vitest";
import { frame } from "../src/frame";
import { Kawarp } from "../src/index";
import { createArtworkCanvas, createCanvas, readCanvasPixels } from "./helpers";

const WIDTH = 120;
const HEIGHT = 64;
const OPTIONS = { warpIntensity: 0.9, blurPasses: 8, saturation: 1.4 };
const TIME = 12;

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
  it("matches the WebGL renderer's still frame", () => {
    const art = createArtworkCanvas();
    const context = art.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    const source = context.getImageData(0, 0, art.width, art.height);

    const canvas = createCanvas(WIDTH, HEIGHT);
    const instance = new Kawarp(canvas, OPTIONS);
    instance.loadImageData(source.data, source.width, source.height);
    instance.renderFrame(TIME);
    const gpu = readCanvasPixels(canvas).data;
    instance.dispose();

    const cpu = frame(source.data, source.width, source.height, WIDTH, HEIGHT, {
      ...OPTIONS,
      time: TIME,
    });
    expect(meanChannelDifference(cpu, gpu)).toBeLessThan(2);
  });
});
