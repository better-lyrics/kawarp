import { Kawarp as BaselineKawarp } from "@kawarp/core-baseline";
import { afterEach, describe, expect, it } from "vitest";
import { Kawarp, type KawarpOptions } from "../src/index";
import {
  colorDistance,
  countDifferentBytes,
  createArtworkCanvas,
  createCanvas,
  createSolidCanvas,
  createSplitCanvas,
  decodeHalfFloat,
  pixelAt,
  type Rgb,
  readCanvasPixels,
} from "./helpers";

const RENDER_TIME = 1.25;

const OPTION_SETS: KawarpOptions[] = [
  {},
  {
    warpIntensity: 0.6,
    blurPasses: 3,
    saturation: 1.2,
    tintColor: [0.3, 0.1, 0.4],
    tintIntensity: 0.4,
    dithering: 0.02,
    scale: 1.3,
  },
];

const renderImage = (
  Renderer: typeof Kawarp | typeof BaselineKawarp,
  options: ConstructorParameters<typeof Kawarp>[1],
  configure?: (instance: Kawarp | BaselineKawarp) => void,
): ImageData => {
  const canvas = createCanvas(96, 64);
  const instance = new Renderer(canvas, options);
  instance.loadImageElement(createArtworkCanvas());
  configure?.(instance);
  instance.renderFrame(RENDER_TIME);
  const pixels = readCanvasPixels(canvas);
  instance.dispose();
  return pixels;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("default image path matches @kawarp/core 1.2.2", () => {
  it.each(OPTION_SETS)("renders identical pixels for %o", (options) => {
    const current = renderImage(Kawarp, options);
    const baseline = renderImage(BaselineKawarp, options);
    expect(countDifferentBytes(current.data, baseline.data)).toBe(0);
  });

  it("re-blurs identically when blur, tint, and saturation change after load", () => {
    const configure = (instance: Kawarp | BaselineKawarp) => {
      instance.blurPasses = 12;
      instance.tintIntensity = 0.5;
      instance.tintColor = [0.2, 0.5, 0.1];
      instance.saturation = 0.8;
    };
    const current = renderImage(Kawarp, {}, configure);
    const baseline = renderImage(BaselineKawarp, {}, configure);
    expect(countDifferentBytes(current.data, baseline.data)).toBe(0);
  });

  it("renders identically when a second image replaces the first", () => {
    const configure = (instance: Kawarp | BaselineKawarp) => {
      instance.transitionDuration = 0;
      instance.loadImageElement(createSolidCanvas([30, 160, 220]));
    };
    const current = renderImage(Kawarp, {}, configure);
    const baseline = renderImage(BaselineKawarp, {}, configure);
    expect(countDifferentBytes(current.data, baseline.data)).toBe(0);
  });

  it("keeps the getOptions shape", () => {
    const current = new Kawarp(createCanvas());
    const baseline = new BaselineKawarp(createCanvas());
    expect(Object.keys(current.getOptions()).sort()).toEqual(
      Object.keys(baseline.getOptions()).sort(),
    );
    expect(current.getOptions()).toEqual(baseline.getOptions());
  });

  it("uses a WebGL1 context and reports no high-precision paths by default", () => {
    const canvas = createCanvas();
    const instance = new Kawarp(canvas);
    expect(canvas.getContext("webgl")).not.toBeNull();
    expect(instance.highPrecisionInput).toBe(false);
    expect(instance.highPrecisionOutput).toBe(false);
  });
});

describe("high-precision contexts", () => {
  it("renders the image path on WebGL2 within one step of the default path", () => {
    const current = renderImage(Kawarp, { highPrecisionInput: true });
    const baseline = renderImage(BaselineKawarp, {});
    expect(countDifferentBytes(current.data, baseline.data, 1)).toBe(0);
  });

  it("reports float render targets when highPrecisionInput is requested", () => {
    const canvas = createCanvas();
    const instance = new Kawarp(canvas, { highPrecisionInput: true });
    expect(canvas.getContext("webgl2")).not.toBeNull();
    expect(instance.highPrecisionInput).toBe(true);
    expect(instance.highPrecisionOutput).toBe(false);
  });

  it("does not report float32 input when only highPrecisionOutput is requested", () => {
    const instance = new Kawarp(createCanvas(), { highPrecisionOutput: true });
    expect(instance.highPrecisionInput).toBe(false);
  });

  it("allocates a float16 drawing buffer when highPrecisionOutput is requested", () => {
    const canvas = createCanvas();
    const instance = new Kawarp(canvas, { highPrecisionOutput: true });
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext & {
      drawingBufferFormat?: number;
    };
    expect(instance.highPrecisionOutput).toBe(true);
    expect(gl.drawingBufferFormat).toBe(gl.RGBA16F);
  });

  it("keeps rendering after a float16 drawing buffer is resized", () => {
    const canvas = createCanvas(32, 32);
    const instance = new Kawarp(canvas, {
      highPrecisionOutput: true,
      saturation: 1,
      tintIntensity: 0,
      dithering: 0,
      warpIntensity: 0,
    });
    instance.loadImageElement(createSolidCanvas([220, 120, 40]));
    canvas.width = 80;
    canvas.height = 48;
    instance.resize();
    instance.renderFrame(RENDER_TIME);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext & {
      drawingBufferFormat?: number;
    };
    expect(gl.drawingBufferFormat).toBe(gl.RGBA16F);
    // SwiftShader cannot copy a float16 WebGL canvas into a 2D canvas, so read it directly
    const halfFloats = new Uint16Array(4);
    gl.readPixels(40, 24, 1, 1, gl.RGBA, gl.HALF_FLOAT, halfFloats);
    const color = Array.from(halfFloats.subarray(0, 3), (value) =>
      Math.round(decodeHalfFloat(value) * 255),
    ) as Rgb;
    expect(colorDistance(color, [220, 120, 40])).toBeLessThan(4);
  });
});

describe("option ranges", () => {
  it("accepts zero blur passes and bypasses the blur", () => {
    const instance = new Kawarp(createCanvas());
    instance.blurPasses = 0;
    expect(instance.blurPasses).toBe(0);
    instance.blurPasses = -3;
    expect(instance.blurPasses).toBe(0);
  });

  it("keeps hard edges sharper with zero blur passes than with the default", () => {
    const edgeRedness = (blurPasses: number) => {
      const canvas = createCanvas(64, 64);
      const instance = new Kawarp(canvas, {
        blurPasses,
        saturation: 1,
        tintIntensity: 0,
        dithering: 0,
        warpIntensity: 0,
      });
      instance.loadImageElement(
        createSplitCanvas([230, 20, 20], [20, 20, 230]),
      );
      instance.renderFrame(1);
      const [red, , blue] = pixelAt(readCanvasPixels(canvas), 32, 28);
      instance.dispose();
      return Math.abs(red - blue);
    };
    expect(edgeRedness(0)).toBeGreaterThan(edgeRedness(8) + 40);
  });

  it("accepts animation speeds from 0 to 16", () => {
    const instance = new Kawarp(createCanvas());
    instance.animationSpeed = 0;
    expect(instance.animationSpeed).toBe(0);
    instance.animationSpeed = 16;
    expect(instance.animationSpeed).toBe(16);
    instance.animationSpeed = 40;
    expect(instance.animationSpeed).toBe(16);
  });

  it("keeps in-range values unchanged", () => {
    const current = new Kawarp(createCanvas());
    const baseline = new BaselineKawarp(createCanvas());
    for (const value of [1, 7, 40]) {
      current.blurPasses = value;
      baseline.blurPasses = value;
      expect(current.blurPasses).toBe(baseline.blurPasses);
    }
    for (const value of [0.1, 1, 5]) {
      current.animationSpeed = value;
      baseline.animationSpeed = value;
      expect(current.animationSpeed).toBe(baseline.animationSpeed);
    }
  });
});
