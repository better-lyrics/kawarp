import { afterEach, describe, expect, it } from "vitest";
import { Kawarp, type KawarpOptions } from "../src/index";
import { SHADERS, VERTEX } from "../src/webgpu";
import {
  BACKEND,
  colorDistance,
  countDifferentBytes,
  createArtworkCanvas,
  createCanvas,
  createSolidCanvas,
  displayedCenterPixel,
  readCanvasPixels,
} from "./helpers";

const RENDER_TIME = 1.25;

const instances: Kawarp[] = [];

const renderOn = async (
  backend: "webgl2" | "webgpu",
  options: KawarpOptions = {},
  configure?: (instance: Kawarp) => void,
) => {
  const canvas = createCanvas(96, 64);
  const instance = await Kawarp.create(canvas, {
    dithering: 0,
    ...options,
    backend,
  });
  instances.push(instance);
  instance.loadImageElement(createArtworkCanvas());
  configure?.(instance);
  instance.renderFrame(RENDER_TIME);
  return { instance, pixels: readCanvasPixels(canvas) };
};

// Hide navigator.gpu, as in browsers without WebGPU
const withoutWebGPU = async <T>(run: () => Promise<T>): Promise<T> => {
  Object.defineProperty(navigator, "gpu", {
    value: undefined,
    configurable: true,
  });
  try {
    return await run();
  } finally {
    delete (navigator as { gpu?: unknown }).gpu;
  }
};

afterEach(() => {
  for (const instance of instances.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

describe.skipIf(BACKEND !== "webgpu")("WebGPU backend", () => {
  it("compiles every shader without errors", async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    try {
      for (const [name, code] of Object.entries(SHADERS)) {
        const module = device.createShaderModule({ code: VERTEX + code });
        const { messages } = await module.getCompilationInfo();
        expect(
          messages
            .filter((message) => message.type === "error")
            .map((message) => message.message),
          name,
        ).toEqual([]);
      }
    } finally {
      device.destroy();
    }
  });

  it("defaults to WebGL2", async () => {
    const instance = await Kawarp.create(createCanvas());
    instances.push(instance);
    expect(instance.backend).toBe("webgl2");
  });

  it("picks WebGPU for auto when available", async () => {
    const instance = await Kawarp.create(createCanvas(), { backend: "auto" });
    instances.push(instance);
    expect(instance.backend).toBe("webgpu");
  });

  it("falls back to WebGL2 for auto without WebGPU", async () => {
    const instance = await withoutWebGPU(() =>
      Kawarp.create(createCanvas(), { backend: "auto" }),
    );
    instances.push(instance);
    expect(instance.backend).toBe("webgl2");
  });

  it("rejects an explicit WebGPU request without WebGPU", async () => {
    await expect(
      withoutWebGPU(() => Kawarp.create(createCanvas(), { backend: "webgpu" })),
    ).rejects.toThrow("WebGPU not supported");
  });

  it("keeps the constructor on WebGL2", () => {
    const instance = new Kawarp(createCanvas());
    instances.push(instance);
    expect(instance.backend).toBe("webgl2");
  });

  it("presents a float16 canvas when highPrecisionOutput is requested", async () => {
    const canvas = createCanvas(32, 32);
    const instance = await Kawarp.create(canvas, {
      backend: "webgpu",
      highPrecisionOutput: true,
      saturation: 1,
      tintIntensity: 0,
      dithering: 0,
      warpIntensity: 0,
    });
    instances.push(instance);
    expect(instance.highPrecisionOutput).toBe(true);
    instance.loadImageElement(createSolidCanvas([220, 120, 40]));
    instance.renderFrame(1);
    expect(
      colorDistance(await displayedCenterPixel(canvas), [220, 120, 40]),
    ).toBeLessThan(4);
  });

  it("matches WebGL2 output", async () => {
    const webgl = await renderOn("webgl2");
    const webgpu = await renderOn("webgpu");
    expect(webgl.instance.backend).toBe("webgl2");
    expect(webgpu.instance.backend).toBe("webgpu");
    expect(countDifferentBytes(webgpu.pixels.data, webgl.pixels.data, 1)).toBe(
      0,
    );
  });
});
