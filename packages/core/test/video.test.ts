import { afterEach, describe, expect, it } from "vitest";
import {
  Kawarp,
  type KawarpContextOptions,
  type KawarpOptions,
} from "../src/index";
import {
  centerPixel,
  colorDistance,
  createCanvas,
  createSolidCanvas,
  createVideoSource,
  nextAnimationFrame,
  nextVideoFrames,
  paintSolid,
  paintSplit,
  pixelAt,
  type Rgb,
  readCanvasPixels,
  settleVideo,
  type TestVideoSource,
} from "./helpers";

// Neutral settings so the rendered center pixel equals the source color
const COLOR_FAITHFUL: KawarpOptions = {
  saturation: 1,
  tintIntensity: 0,
  dithering: 0,
  warpIntensity: 0,
  transitionDuration: 0,
};

// Video decoding goes through YUV, so exact byte equality is not expected
const DECODE_TOLERANCE = 10;

const CORAL: Rgb = [220, 70, 60];
const TEAL: Rgb = [30, 170, 160];
const BLUE: Rgb = [40, 60, 210];

const CONTEXTS: [string, KawarpContextOptions][] = [
  ["WebGL1", {}],
  ["WebGL2 high precision", { highPrecisionInput: true }],
];

const sources: TestVideoSource[] = [];
const instances: Kawarp[] = [];

const createVideo = async (
  painter: Parameters<typeof createVideoSource>[2],
  width = 640,
  height = 360,
) => {
  const source = await createVideoSource(width, height, painter);
  sources.push(source);
  return source;
};

const createKawarp = (
  options: KawarpOptions & KawarpContextOptions,
  canvas = createCanvas(),
) => {
  const instance = new Kawarp(canvas, { ...COLOR_FAITHFUL, ...options });
  instances.push(instance);
  return { instance, canvas };
};

afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
  for (const source of sources.splice(0)) source.dispose();
  document.body.replaceChildren();
});

describe.each(CONTEXTS)("video source on %s", (_name, contextOptions) => {
  it("renders the current frame as soon as the video is loaded", async () => {
    const { video } = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp(contextOptions);
    instance.loadVideo(video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("follows new frames while playing", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp(contextOptions);
    instance.loadVideo(source.video);
    instance.start();
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("keeps the video upright", async () => {
    const { video } = await createVideo(paintSplit(CORAL, BLUE));
    const { instance, canvas } = createKawarp({
      ...contextOptions,
      blurPasses: 0,
    });
    instance.loadVideo(video);
    const pixels = readCanvasPixels(canvas);
    const top = pixelAt(pixels, canvas.width / 2, 4);
    const bottom = pixelAt(pixels, canvas.width / 2, canvas.height - 5);
    expect(top[0]).toBeGreaterThan(top[2]);
    expect(bottom[2]).toBeGreaterThan(bottom[0]);
  });

  it("samples small videos without intermediate stages", async () => {
    const { video } = await createVideo(paintSolid(TEAL), 96, 54);
    const { instance, canvas } = createKawarp(contextOptions);
    instance.loadVideo(video);
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });
});

describe("video playback control", () => {
  it("ignores frames from a playing video while stopped, then catches up on start", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video);
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );

    instance.start();
    await nextAnimationFrame();
    await nextAnimationFrame();
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("limits sampling to the configured frame rate", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video, { frameRate: 0.5 });
    instance.start();
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("smooths color changes over the configured response time", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({ highPrecisionInput: true });
    instance.loadVideo(source.video, { smoothing: 5000 });
    instance.start();
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    const color = centerPixel(canvas);
    expect(colorDistance(color, CORAL)).toBeLessThan(
      colorDistance(color, TEAL),
    );
    expect(colorDistance(color, CORAL)).toBeGreaterThan(0);
  });

  it("updates options in place when called again with the same video", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video, { frameRate: 0.5 });
    instance.start();
    instance.loadVideo(source.video, { frameRate: 0 });
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("switches to a second video", async () => {
    const first = await createVideo(paintSolid(CORAL));
    const second = await createVideo(paintSolid(BLUE));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(first.video);
    instance.loadVideo(second.video);
    first.setPainter(paintSolid(TEAL));
    instance.start();
    await settleVideo(second.video);
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });
});

describe("unloading and replacing video", () => {
  it("keeps the last frame after unloadVideo", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video);
    instance.unloadVideo();
    source.setPainter(paintSolid(TEAL));
    instance.start();
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("re-blurs the retained frame after unloadVideo", async () => {
    const { video } = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(video);
    instance.unloadVideo();
    instance.blurPasses = 2;
    instance.renderFrame(1);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("replaces the video when an image loads", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video);
    instance.start();
    instance.loadImageElement(createSolidCanvas(BLUE));
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });

  it("drops an image load that finishes after a later loadVideo", async () => {
    const { video } = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    const blob = await new Promise<Blob>((resolve, reject) =>
      createSolidCanvas(BLUE).toBlob((result) =>
        result ? resolve(result) : reject(new Error("toBlob failed")),
      ),
    );
    const pendingImage = instance.loadBlob(blob);
    instance.loadVideo(video);
    await pendingImage;
    instance.renderFrame(1);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("crossfades from the current image to the first video frame", async () => {
    const { video } = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadImageElement(createSolidCanvas(BLUE));
    instance.transitionDuration = 60000;
    instance.loadVideo(video);
    const color = centerPixel(canvas);
    expect(colorDistance(color, BLUE)).toBeLessThan(
      colorDistance(color, CORAL),
    );
  });

  it("stops following the video after dispose", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance } = createKawarp({});
    instance.loadVideo(source.video);
    instance.start();
    instance.dispose();
    source.setPainter(paintSolid(TEAL));
    await nextVideoFrames(source.video, 4);
  });
});

describe("video option validation", () => {
  it("falls back to defaults for non-finite options", async () => {
    const { video } = await createVideo(paintSolid(TEAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(video, {
      sampleWidth: Number.NaN,
      sampleHeight: Number.POSITIVE_INFINITY,
      downsampleFactor: Number.NaN,
      frameRate: Number.NaN,
      smoothing: Number.NaN,
    });
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("clamps out-of-range sample sizes", async () => {
    const { video } = await createVideo(paintSolid(TEAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(video, {
      sampleWidth: -20,
      sampleHeight: 1e9,
      downsampleFactor: 100,
    });
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("throws when requestVideoFrameCallback is unavailable", () => {
    const { instance } = createKawarp({});
    const video = document.createElement("video");
    Object.defineProperty(video, "requestVideoFrameCallback", {
      value: undefined,
    });
    expect(() => instance.loadVideo(video)).toThrow(
      "requestVideoFrameCallback",
    );
  });

  it("does nothing for a video without decoded data", async () => {
    const { instance, canvas } = createKawarp({});
    instance.loadImageElement(createSolidCanvas(BLUE));
    instance.loadVideo(document.createElement("video"));
    instance.renderFrame(1);
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });
});
