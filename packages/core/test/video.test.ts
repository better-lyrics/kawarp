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

  it("regression: limits the frame rate when the page clock is still small", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    // Pick an interval just over half the page clock: a start slot of 0 used
    // to schedule the next sample in the past, letting the next frame through
    const frameRate = 1000 / (performance.now() / 1.9);
    instance.loadVideo(source.video, { frameRate });
    instance.start();
    source.setPainter(paintSolid(TEAL));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
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

describe.each(CONTEXTS)("temporal smoothing on %s", (_name, contextOptions) => {
  it("smooths color changes over the configured response time", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp(contextOptions);
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

  it("reaches the target color with a short response time", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp(contextOptions);
    instance.loadVideo(source.video, { smoothing: 150 });
    instance.start();
    source.setPainter(paintSolid(TEAL));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await settleVideo(source.video);
    expect(colorDistance(centerPixel(canvas), TEAL)).toBeLessThan(
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

  it("shows an image load as a poster until the video has a frame", async () => {
    const { instance, canvas } = createKawarp({});
    const blob = await new Promise<Blob>((resolve, reject) =>
      createSolidCanvas(BLUE).toBlob((result) =>
        result ? resolve(result) : reject(new Error("toBlob failed")),
      ),
    );
    const pendingImage = instance.loadBlob(blob);
    instance.loadVideo(document.createElement("video"));
    await pendingImage;
    instance.renderFrame(1);
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });

  it("shows an image loaded after loadVideo even if the first frame lands mid-load", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.start();
    const lateVideo = document.createElement("video");
    lateVideo.muted = true;
    instance.loadVideo(lateVideo);

    const imageUrl = createSolidCanvas(BLUE).toDataURL();
    const realFetch = window.fetch;
    // Slow network, so the video's first frame arrives while the image downloads
    window.fetch = (input, init) =>
      new Promise((resolve) => setTimeout(resolve, 600)).then(() =>
        realFetch(input, init),
      );
    try {
      const pendingImage = instance.loadImage(imageUrl);
      lateVideo.srcObject = source.video.srcObject;
      await lateVideo.play();
      await settleVideo(lateVideo);
      expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
        DECODE_TOLERANCE,
      );
      await pendingImage;
    } finally {
      window.fetch = realFetch;
      lateVideo.pause();
    }
    await nextAnimationFrame();
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });

  it("regression: never draws a black frame when the first video frame arrives with a zero transition", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadImageElement(createSolidCanvas(BLUE));
    instance.start();
    const lateVideo = document.createElement("video");
    lateVideo.muted = true;
    instance.loadVideo(lateVideo);
    lateVideo.srcObject = source.video.srcObject;
    await lateVideo.play();

    let darkest = 255;
    for (let frame = 0; frame < 20; frame++) {
      await nextAnimationFrame();
      darkest = Math.min(darkest, Math.max(...centerPixel(canvas)));
    }
    lateVideo.pause();
    expect(darkest).toBeGreaterThan(20);
  });

  it("shows an image as the poster of a newer video after an older video's frame appeared mid-load", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.start();
    const olderVideo = document.createElement("video");
    olderVideo.muted = true;
    instance.loadVideo(olderVideo);

    const imageUrl = createSolidCanvas(BLUE).toDataURL();
    const realFetch = window.fetch;
    window.fetch = (input, init) =>
      new Promise((resolve) => setTimeout(resolve, 600)).then(() =>
        realFetch(input, init),
      );
    try {
      const pendingImage = instance.loadImage(imageUrl);
      olderVideo.srcObject = source.video.srcObject;
      await olderVideo.play();
      await settleVideo(olderVideo);
      instance.loadVideo(document.createElement("video"));
      await pendingImage;
    } finally {
      window.fetch = realFetch;
      olderVideo.pause();
    }
    await nextAnimationFrame();
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });

  it("shows a paused video's first frame on a stopped instance without waiting for a crossfade", async () => {
    const source = await createVideo(paintSolid(CORAL));
    source.video.pause();
    const { instance, canvas } = createKawarp({});
    instance.loadImageElement(createSolidCanvas(BLUE));
    instance.transitionDuration = 5000;
    instance.loadVideo(source.video);
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });

  it("keeps an in-flight image when the video is unloaded before its first frame", async () => {
    const { instance, canvas } = createKawarp({});
    const blob = await new Promise<Blob>((resolve, reject) =>
      createSolidCanvas(BLUE).toBlob((result) =>
        result ? resolve(result) : reject(new Error("toBlob failed")),
      ),
    );
    const pendingImage = instance.loadBlob(blob);
    instance.loadVideo(document.createElement("video"));
    instance.unloadVideo();
    await pendingImage;
    instance.renderFrame(1);
    expect(colorDistance(centerPixel(canvas), BLUE)).toBeLessThan(3);
  });

  it("crossfades from the current image to the first video frame", async () => {
    const { video } = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadImageElement(createSolidCanvas(BLUE));
    instance.transitionDuration = 60000;
    instance.start();
    instance.loadVideo(video);
    await nextAnimationFrame();
    const color = centerPixel(canvas);
    expect(colorDistance(color, BLUE)).toBeLessThan(
      colorDistance(color, CORAL),
    );
  });

  it("stops following the video after dispose", async () => {
    const source = await createVideo(paintSolid(CORAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(source.video);
    instance.start();
    instance.dispose();
    source.setPainter(paintSolid(TEAL));
    await nextVideoFrames(source.video, 4);
    await nextAnimationFrame();
    expect(colorDistance(centerPixel(canvas), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
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

  it.each([
    [1, 1, 1.5],
    [1, 1, 1.25],
    [2, 2, 1.4],
    [128, 1, 1.5],
  ])("terminates staged downsampling for a %ix%i sample with factor %f", async (sampleWidth, sampleHeight, downsampleFactor) => {
    const { video } = await createVideo(paintSolid(TEAL));
    const { instance, canvas } = createKawarp({});
    instance.loadVideo(video, {
      sampleWidth,
      sampleHeight,
      downsampleFactor,
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
