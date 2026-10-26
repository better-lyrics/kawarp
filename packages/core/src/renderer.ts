/**
 * The GPU work Kawarp needs, independent of the graphics API. Kawarp owns
 * the pipeline order, timing, and source state; a renderer only runs passes.
 *
 * Every pass draws a full-screen quad that preserves texture rows: row r of
 * the target is computed from texture coordinate y = (r + 0.5) / height, so
 * row order is the same on every backend. Only `output` maps rows onto the
 * screen, putting row 0 at the bottom as WebGL always has.
 */

export type RendererBackend = "webgl2" | "webgpu";

export const textureSourceSize = (source: TexImageSource): [number, number] => {
  if ("naturalWidth" in source)
    return [source.naturalWidth, source.naturalHeight];
  if ("videoWidth" in source) return [source.videoWidth, source.videoHeight];
  if ("displayWidth" in source)
    return [source.displayWidth, source.displayHeight];
  return [source.width, source.height];
};

/** Requested storage for a render target */
export type TargetFormat = "rgba8" | "rgba16f" | "rgba32f";

/** A texture a pass can read, owned by the renderer */
export interface Texture {
  readonly width: number;
  readonly height: number;
}

/** A texture a pass can write */
export interface Target {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
  /** Storage actually allocated; float formats fall back when unsupported */
  readonly format: TargetFormat;
}

export interface OutputParams {
  saturation: number;
  dithering: number;
  scale: number;
  /** Per-frame shift of the blue noise tile, in texels */
  noiseOffset: [number, number];
}

export interface Renderer {
  readonly backend: RendererBackend;
  /** Half-float targets render and filter; rgba16f falls back to rgba8 otherwise */
  readonly halfFloatTargets: boolean;
  /** Float32 targets render; rgba32f falls back to rgba8 otherwise */
  readonly float32Targets: boolean;
  /** The canvas presents a float16 buffer */
  readonly highPrecisionOutput: boolean;
  /** Holds the latest still image */
  readonly imageTexture: Texture;

  /** Request a float16 canvas buffer. Call once, after the initial targets exist. */
  configureOutput(highPrecision: boolean): void;

  createTarget(width: number, height: number, format: TargetFormat): Target;
  deleteTarget(target: Target): void;

  uploadImage(source: TexImageSource): void;
  uploadPixels(data: Uint8Array, width: number, height: number): void;
  /**
   * The video's current frame, top row first like an uploaded image. Valid
   * only until the current task ends; throws when the frame can't be read.
   */
  importVideoFrame(video: HTMLVideoElement): Texture;
  /** Free resources kept for video frames */
  releaseVideoFrames(): void;

  tint(
    source: Texture,
    target: Target,
    color: [number, number, number],
    intensity: number,
  ): void;
  blur(source: Texture, target: Target, offset: number): void;
  blend(from: Texture, to: Texture, target: Target, amount: number): void;
  warp(source: Texture, target: Target, time: number, intensity: number): void;
  downsample(source: Texture, target: Target, flipY: boolean): void;
  smoothing(
    source: Texture,
    history: Texture,
    target: Target,
    response: number,
    minStep: number,
  ): void;
  /** Draw to the canvas at width x height */
  output(
    source: Texture,
    width: number,
    height: number,
    params: OutputParams,
  ): void;

  /** Read an rgba8 target, row 0 first, without waiting on the GPU */
  readPixels(
    target: Target,
    isDisposed: () => boolean,
  ): Promise<Uint8Array | null>;

  dispose(): void;
}
