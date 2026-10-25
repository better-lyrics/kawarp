/**
 * Kawarp - Fluid Animated Background Renderer
 *
 * Creates a fluid, animated background effect similar to Apple Music's album art visualization.
 * Uses WebGL2 with Kawase blur and domain warping techniques.
 *
 * Optimized architecture:
 * - Blur runs on small textures (128x128) only when image changes
 * - Smooth crossfade transitions between images
 * - Instant first frame without black buffer crossfade
 * - High-precision render target tracking and resolution management
 * - Robust CORS and blob/imageBitmap loading
 */

import { BLUE_NOISE_SIZE } from "./blueNoise.js";
import type { Renderer, RendererBackend, Target, Texture } from "./renderer.js";
import { WebGL2Renderer } from "./webgl2.js";
import { WebGPURenderer } from "./webgpu.js";

export type { RendererBackend as KawarpBackend } from "./renderer.js";

export interface KawarpOptions {
  warpIntensity?: number;
  blurPasses?: number;
  animationSpeed?: number;
  transitionDuration?: number;
  saturation?: number;
  tintColor?: [number, number, number];
  tintIntensity?: number;
  dithering?: number;
  scale?: number;
}

export interface KawarpContextOptions {
  /** Keep float32 color history for smoothed video. Creation only. */
  highPrecisionInput?: boolean;
  /** Request a float16 drawing buffer, falling back to RGBA8. Creation only. */
  highPrecisionOutput?: boolean;
}

export interface KawarpCreateOptions {
  /**
   * Graphics API (default "webgl2"). "webgpu" rejects when WebGPU is
   * unavailable; "auto" tries WebGPU and falls back to WebGL2.
   */
  backend?: "auto" | RendererBackend;
}

export interface KawarpVideoOptions {
  /** Width of the sampled color map (default: 128) */
  sampleWidth?: number;
  /** Height of the sampled color map (default: 72) */
  sampleHeight?: number;
  /** Largest reduction per downsampling stage (default: 2) */
  downsampleFactor?: number;
  /** Maximum frames sampled per second, 0 follows the video (default: 0) */
  frameRate?: number;
  /** Temporal color smoothing response in ms, 0 disables it (default: 0) */
  smoothing?: number;
  /** Called when a frame cannot be imported; the video is unloaded first */
  onError?: (error: unknown) => void;
}

// Size for blur operations (small = fast)
const BLUR_SIZE = 128;

const DEFAULT_VIDEO_OPTIONS = {
  sampleWidth: 128,
  sampleHeight: 72,
  downsampleFactor: 2,
  frameRate: 0,
  smoothing: 0,
};

// R2 sequence: per-frame tile shifts that cover the tile evenly over time
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

// A media-time jump larger than this between frames is a seek, not playback.
const VIDEO_SEEK_THRESHOLD_SECONDS = 0.25;
// Time constants after the last video frame before easing snaps and goes idle
const VIDEO_SMOOTHING_SETTLE_RESPONSES = 8;

// Set by Kawarp.create for the synchronous constructor to pick up
let injectedRenderer: Renderer | null = null;

const boundedOption = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export class Kawarp {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private frameIndex = 0;

  // Small targets for blur (BLUR_SIZE x BLUR_SIZE)
  private blurTarget1: Target;
  private blurTarget2: Target;

  // Album targets for crossfade (BLUR_SIZE x BLUR_SIZE)
  private currentAlbumTarget: Target;
  private nextAlbumTarget: Target;

  // Full-res target for warp output
  private warpTarget: Target;

  // Animation state
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  private accumulatedTime: number = 0;
  private isPlaying = false;
  private disposed = false;

  // Transition state
  private isTransitioning = false;
  private transitionStartTime = 0;
  private _transitionDuration: number;

  // Options
  private _warpIntensity: number;
  private _blurPasses: number;
  private _animationSpeed: number;
  private _targetAnimationSpeed: number;
  private _saturation: number;
  private _tintColor: [number, number, number];
  private _tintIntensity: number;
  private _dithering: number;
  private _scale: number;
  private hasImage = false;
  private highPrecisionInputRequested: boolean;

  // Texture the blur reads from: the image source or the latest video frame
  private activeSourceTexture: Texture;
  private videoFrameWidth = 0;
  private videoFrameHeight = 0;

  // Video source state
  private video: HTMLVideoElement | null = null;
  // An in-flight image load is dropped only when a later loadVideo call has
  // since put a video frame on screen
  private videoLoadCount = 0;
  // videoLoadCount of the last video that put a frame on screen
  private shownVideoLoad = 0;
  private videoOptions: Required<Omit<KawarpVideoOptions, "onError">> &
    Pick<KawarpVideoOptions, "onError"> = { ...DEFAULT_VIDEO_OPTIONS };
  private videoCallbackId: number | null = null;
  private videoStages: Target[] = [];
  private videoHistory: Target[] = [];
  private videoHistoryIndex = 0;
  private hasVideoHistory = false;
  // Latest downsampled frame the history is easing toward, null once settled
  private videoSmoothingTarget: Texture | null = null;
  private videoSmoothingTargetAt = 0;
  private videoSmoothedAt = 0;
  // Smallest change the history format can store; 0 for float32
  private videoHistoryStep = 0;
  // Ideal time of the last sample on the frameRate cadence
  private videoSampleSlot = Number.NEGATIVE_INFINITY;
  private videoTargetsStale = true;
  private videoSourceWidth = 0;
  private videoSourceHeight = 0;
  private videoFrameTime = 0;
  private videoMediaTime = 0;
  private videoFrameShown = false;
  private videoFramePending = false;
  private retainedVideoFrame: Target | null = null;
  private sampleTargets: Target[] = [];
  private sampleTargetsLayout: [number, number, number] = [0, 0, 0];
  private pendingSampleSize = 0;
  private pendingSample: Promise<Uint8Array | null> | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options: KawarpOptions & KawarpContextOptions = {},
  ) {
    this.canvas = canvas;
    const renderer = injectedRenderer ?? new WebGL2Renderer(canvas);
    injectedRenderer = null;
    this.renderer = renderer;
    this.highPrecisionInputRequested = !!options.highPrecisionInput;

    this._warpIntensity = options.warpIntensity ?? 1.0;
    this._blurPasses = options.blurPasses ?? 8;
    this._animationSpeed = options.animationSpeed ?? 1.0;
    this._targetAnimationSpeed = this._animationSpeed;
    this._transitionDuration = options.transitionDuration ?? 1000;
    this._saturation = options.saturation ?? 1.5;
    this._tintColor = options.tintColor ?? [0.157, 0.157, 0.235];
    this._tintIntensity = options.tintIntensity ?? 0.15;
    this._dithering = options.dithering ?? 0.008;
    this._scale = options.scale ?? 1.0;

    this.activeSourceTexture = renderer.imageTexture;

    // Blur and crossfade targets are high precision to avoid banding
    this.blurTarget1 = this.createTarget(BLUR_SIZE, BLUR_SIZE);
    this.blurTarget2 = this.createTarget(BLUR_SIZE, BLUR_SIZE);
    this.currentAlbumTarget = this.createTarget(BLUR_SIZE, BLUR_SIZE);
    this.nextAlbumTarget = this.createTarget(BLUR_SIZE, BLUR_SIZE);

    const initW = Math.max(1, canvas.width || 640);
    const initH = Math.max(1, canvas.height || 360);
    this.warpTarget = this.createTarget(initW, initH);

    renderer.configureOutput(!!options.highPrecisionOutput);
  }

  /**
   * Create an instance on a chosen graphics API. WebGPU is opt-in until it is
   * measured to cost less than WebGL2. The constructor always uses WebGL2.
   */
  static async create(
    canvas: HTMLCanvasElement,
    options: KawarpOptions & KawarpContextOptions & KawarpCreateOptions = {},
  ): Promise<Kawarp> {
    const backend = options.backend ?? "webgl2";
    if (backend !== "webgl2") {
      const renderer = await WebGPURenderer.create(canvas).catch(() => null);
      if (renderer) {
        injectedRenderer = renderer;
        try {
          return new Kawarp(canvas, options);
        } finally {
          injectedRenderer = null;
        }
      }
      if (backend === "webgpu") throw new Error("WebGPU not supported");
    }
    return new Kawarp(canvas, options);
  }

  /** Graphics API in use */
  get backend(): "webgl2" | "webgpu" {
    return this.renderer.backend;
  }

  /** Whether the drawing buffer is float16 (requested via highPrecisionOutput) */
  get highPrecisionOutput(): boolean {
    return this.renderer.highPrecisionOutput;
  }

  /** Whether smoothed video keeps float32 color history (requested via highPrecisionInput) */
  get highPrecisionInput(): boolean {
    return this.highPrecisionInputRequested && this.renderer.float32Targets;
  }

  // Getters and setters
  get warpIntensity(): number {
    return this._warpIntensity;
  }
  set warpIntensity(value: number) {
    this._warpIntensity = Math.max(0, Math.min(1, value));
  }

  get blurPasses(): number {
    return this._blurPasses;
  }
  set blurPasses(value: number) {
    const newValue = Math.max(0, Math.min(40, Math.floor(value)));
    if (newValue !== this._blurPasses) {
      this._blurPasses = newValue;
      // Re-blur with new pass count if we have an image
      if (this.hasImage) {
        this.reblurCurrentImage();
      }
    }
  }

  get animationSpeed(): number {
    return this._targetAnimationSpeed;
  }
  set animationSpeed(value: number) {
    this._targetAnimationSpeed = Math.max(0, Math.min(16, value));
  }

  get transitionDuration(): number {
    return this._transitionDuration;
  }
  set transitionDuration(value: number) {
    this._transitionDuration = Math.max(0, Math.min(5000, value));
  }

  get saturation(): number {
    return this._saturation;
  }
  set saturation(value: number) {
    this._saturation = Math.max(0, Math.min(3, value));
  }

  get tintColor(): [number, number, number] {
    return this._tintColor;
  }
  set tintColor(value: [number, number, number]) {
    const newValue = value.map((v) => Math.max(0, Math.min(1, v))) as [
      number,
      number,
      number,
    ];
    const changed = newValue.some((v, i) => v !== this._tintColor[i]);
    if (changed) {
      this._tintColor = newValue;
      if (this.hasImage) {
        this.reblurCurrentImage();
      }
    }
  }

  get tintIntensity(): number {
    return this._tintIntensity;
  }
  set tintIntensity(value: number) {
    const newValue = Math.max(0, Math.min(1, value));
    if (newValue !== this._tintIntensity) {
      this._tintIntensity = newValue;
      if (this.hasImage) {
        this.reblurCurrentImage();
      }
    }
  }

  get dithering(): number {
    return this._dithering;
  }
  set dithering(value: number) {
    this._dithering = Math.max(0, Math.min(0.1, value));
  }

  get scale(): number {
    return this._scale;
  }
  set scale(value: number) {
    this._scale = Math.max(0.01, Math.min(4, value));
  }

  setOptions(options: Partial<KawarpOptions>): void {
    if (options.warpIntensity !== undefined)
      this.warpIntensity = options.warpIntensity;
    if (options.blurPasses !== undefined) this.blurPasses = options.blurPasses;
    if (options.animationSpeed !== undefined)
      this.animationSpeed = options.animationSpeed;
    if (options.transitionDuration !== undefined)
      this.transitionDuration = options.transitionDuration;
    if (options.saturation !== undefined) this.saturation = options.saturation;
    if (options.tintColor !== undefined) this.tintColor = options.tintColor;
    if (options.tintIntensity !== undefined)
      this.tintIntensity = options.tintIntensity;
    if (options.dithering !== undefined) this.dithering = options.dithering;
    if (options.scale !== undefined) this.scale = options.scale;
  }

  getOptions(): Required<KawarpOptions> {
    return {
      warpIntensity: this._warpIntensity,
      blurPasses: this._blurPasses,
      animationSpeed: this._targetAnimationSpeed,
      transitionDuration: this._transitionDuration,
      saturation: this._saturation,
      tintColor: this._tintColor,
      tintIntensity: this._tintIntensity,
      dithering: this._dithering,
      scale: this._scale,
    };
  }

  // Image loading methods
  async loadImage(src: string): Promise<void> {
    if (!src) return;
    const videoLoadsAtStart = this.videoLoadCount;

    let bitmap: ImageBitmap | HTMLImageElement | null = null;
    try {
      const res = await fetch(src, { mode: "cors" });
      if (res.ok) {
        const blob = await res.blob();
        bitmap = await createImageBitmap(blob);
      }
    } catch {
      // ignore fetch failure and proceed to image fallback
    }

    if (!bitmap) {
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
      });
    }

    if (this.disposed || this.shownVideoLoad > videoLoadsAtStart) {
      if ("close" in bitmap) bitmap.close();
      return;
    }
    const posterForVideo =
      !!this.video && this.videoLoadCount !== videoLoadsAtStart;

    this.renderer.uploadImage(bitmap);
    if (
      "close" in bitmap &&
      typeof (bitmap as ImageBitmap).close === "function"
    ) {
      (bitmap as ImageBitmap).close();
    }

    this.processNewImage(this.renderer.imageTexture, posterForVideo);
  }

  loadImageElement(source: TexImageSource): void {
    this.showImageElement(source, false);
  }

  private showImageElement(
    source: TexImageSource,
    posterForVideo: boolean,
  ): void {
    this.renderer.uploadImage(source);
    this.processNewImage(this.renderer.imageTexture, posterForVideo);
  }

  loadImageData(
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    this.renderer.uploadPixels(
      data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer) : data,
      width,
      height,
    );
    this.processNewImage();
  }

  loadFromImageData(imageData: ImageData): void {
    this.loadImageData(imageData.data, imageData.width, imageData.height);
  }

  async loadBlob(blob: Blob): Promise<void> {
    const videoLoadsAtStart = this.videoLoadCount;
    const bitmap = await createImageBitmap(blob);
    if (this.disposed || this.shownVideoLoad > videoLoadsAtStart) {
      bitmap.close();
      return;
    }
    const posterForVideo =
      !!this.video && this.videoLoadCount !== videoLoadsAtStart;
    this.showImageElement(bitmap, posterForVideo);
    bitmap.close();
  }

  loadBase64(base64: string): Promise<void> {
    const src = base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`;
    return this.loadImage(src);
  }

  async loadArrayBuffer(
    buffer: ArrayBuffer,
    mimeType = "image/png",
  ): Promise<void> {
    const blob = new Blob([buffer], { type: mimeType });
    return this.loadBlob(blob);
  }

  loadGradient(colors: string[], angle = 135): void {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const angleRad = (angle * Math.PI) / 180;
    const x1 = size / 2 - Math.cos(angleRad) * size;
    const y1 = size / 2 - Math.sin(angleRad) * size;
    const x2 = size / 2 + Math.cos(angleRad) * size;
    const y2 = size / 2 + Math.sin(angleRad) * size;

    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    colors.forEach((color, i) => {
      gradient.addColorStop(i / (colors.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.loadImageElement(canvas);
  }

  /**
   * Use a playing video as the source. Each decoded frame is imported on the
   * GPU, downsampled in stages, optionally smoothed over time, and blurred in
   * place. The first frame crossfades from the current image (instantly on a
   * stopped instance). Video renders
   * upright; images keep their historical flipped orientation.
   *
   * Calling again with the same element only updates the options. A stopped
   * instance skips frames from a playing video and draws single frames from a
   * paused one, so seeking while paused stays visible.
   */
  loadVideo(video: HTMLVideoElement, options: KawarpVideoOptions = {}): void {
    if (this.disposed) return;
    if (typeof video.requestVideoFrameCallback !== "function") {
      throw new Error("Video sources require requestVideoFrameCallback");
    }
    const isNewVideo = this.video !== video;
    if (isNewVideo) {
      this.videoLoadCount++;
      this.unloadVideo();
      this.video = video;
      this.videoFrameShown = false;
      this.hasVideoHistory = false;
      this.videoSampleSlot = Number.NEGATIVE_INFINITY;
    }

    const nextOptions = {
      sampleWidth: Math.round(
        boundedOption(
          options.sampleWidth,
          DEFAULT_VIDEO_OPTIONS.sampleWidth,
          1,
          1024,
        ),
      ),
      sampleHeight: Math.round(
        boundedOption(
          options.sampleHeight,
          DEFAULT_VIDEO_OPTIONS.sampleHeight,
          1,
          1024,
        ),
      ),
      downsampleFactor: boundedOption(
        options.downsampleFactor,
        DEFAULT_VIDEO_OPTIONS.downsampleFactor,
        1.25,
        4,
      ),
      frameRate: boundedOption(
        options.frameRate,
        DEFAULT_VIDEO_OPTIONS.frameRate,
        0,
        240,
      ),
      smoothing: boundedOption(
        options.smoothing,
        DEFAULT_VIDEO_OPTIONS.smoothing,
        0,
        10000,
      ),
      onError: options.onError,
    };
    const previousOptions = this.videoOptions;
    if (
      isNewVideo ||
      nextOptions.sampleWidth !== previousOptions.sampleWidth ||
      nextOptions.sampleHeight !== previousOptions.sampleHeight ||
      nextOptions.downsampleFactor !== previousOptions.downsampleFactor ||
      nextOptions.smoothing > 0 !== previousOptions.smoothing > 0
    ) {
      this.videoTargetsStale = true;
    }
    this.videoOptions = nextOptions;

    this.requestVideoFrame();
    if (
      video.readyState >= video.HAVE_CURRENT_DATA &&
      (isNewVideo || (video.paused && this.videoTargetsStale))
    ) {
      this.processVideoFrame(performance.now(), video.currentTime);
    }
  }

  /**
   * Stop following the video. The last frame stays on screen until the next
   * image or video is loaded.
   */
  unloadVideo(): void {
    const video = this.video;
    if (!video) return;
    if (this.videoCallbackId !== null) {
      video.cancelVideoFrameCallback(this.videoCallbackId);
      this.videoCallbackId = null;
    }
    video.removeEventListener("pause", this.resumeVideoCallbacks);
    this.video = null;
    this.videoFramePending = false;
    this.releaseVideoTargets();
    this.renderer.releaseVideoFrames();
  }

  /**
   * Read a small RGBA8 thumbnail (size x size, bottom row of the rendered
   * orientation first) of the current source, e.g. to measure brightness.
   * Reads asynchronously through a pixel buffer and fence.
   * Resolves to null when there is no source or the instance is disposed.
   */
  sampleSource(size = 32): Promise<Uint8Array | null> {
    if (this.disposed || !this.hasImage) return Promise.resolve(null);
    const edge = Math.round(boundedOption(size, 32, 1, BLUR_SIZE));
    if (this.pendingSample) {
      return this.pendingSampleSize === edge
        ? this.pendingSample
        : this.pendingSample.then(() => this.sampleSource(edge));
    }

    const [sourceWidth, sourceHeight] =
      this.activeSourceTexture === this.renderer.imageTexture
        ? [this.renderer.imageTexture.width, this.renderer.imageTexture.height]
        : [this.videoFrameWidth, this.videoFrameHeight];
    this.prepareSampleTargets(sourceWidth, sourceHeight, edge);
    let sampledTexture = this.activeSourceTexture;
    for (const stage of this.sampleTargets) {
      this.renderer.downsample(sampledTexture, stage, false);
      sampledTexture = stage.texture;
    }

    const lastTarget = this.sampleTargets[this.sampleTargets.length - 1];
    if (!lastTarget) return Promise.resolve(null);
    const sample = this.renderer
      .readPixels(lastTarget, () => this.disposed)
      .finally(() => {
        this.pendingSample = null;
      });
    this.pendingSample = sample;
    this.pendingSampleSize = edge;
    return sample;
  }

  /**
   * Halving stages from the source down to size x size. A single 4-tap
   * reduction from full-resolution artwork would skip most texels and alias.
   */
  private prepareSampleTargets(
    sourceWidth: number,
    sourceHeight: number,
    edge: number,
  ): void {
    const [cachedWidth, cachedHeight, cachedEdge] = this.sampleTargetsLayout;
    if (
      sourceWidth === cachedWidth &&
      sourceHeight === cachedHeight &&
      edge === cachedEdge
    ) {
      return;
    }
    for (const target of this.sampleTargets) this.renderer.deleteTarget(target);
    this.sampleTargets = [];

    let width = sourceWidth;
    let height = sourceHeight;
    while (width > edge * 2 || height > edge * 2) {
      width = Math.max(edge, Math.ceil(width / 2));
      height = Math.max(edge, Math.ceil(height / 2));
      this.sampleTargets.push(
        this.renderer.createTarget(width, height, "rgba8"),
      );
    }
    this.sampleTargets.push(this.renderer.createTarget(edge, edge, "rgba8"));
    this.sampleTargetsLayout = [sourceWidth, sourceHeight, edge];
  }

  private requestVideoFrame(): void {
    if (!this.video || this.videoCallbackId !== null) return;
    this.videoCallbackId = this.video.requestVideoFrameCallback(
      this.handleVideoFrame,
    );
  }

  private handleVideoFrame = (
    now: DOMHighResTimeStamp,
    metadata: VideoFrameCallbackMetadata,
  ): void => {
    this.videoCallbackId = null;
    const video = this.video;
    if (!video || this.disposed) return;

    // Stay idle until start(), but wake on pause so a paused seek still redraws
    if (!this.isPlaying && !video.paused) {
      this.videoFramePending = true;
      video.addEventListener("pause", this.resumeVideoCallbacks, {
        once: true,
      });
      return;
    }
    this.requestVideoFrame();

    const { frameRate } = this.videoOptions;
    if (frameRate > 0 && !video.paused) {
      const interval = 1000 / frameRate;
      // Slack keeps jittery frame timing from halving the rate
      if (now < this.videoSampleSlot + interval * 0.75) return;
    }
    this.processVideoFrame(now, metadata.mediaTime);
  };

  private resumeVideoCallbacks = (): void => {
    this.requestVideoFrame();
  };

  private processVideoFrame(now: number, mediaTime: number): void {
    const video = this.video;
    if (
      !video ||
      video.readyState < video.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }
    const elapsedMs = now - this.videoFrameTime;

    let videoFrame: Texture;
    try {
      this.prepareVideoTargets(video.videoWidth, video.videoHeight);
      videoFrame = this.renderer.importVideoFrame(video);
    } catch (error) {
      const { onError } = this.videoOptions;
      this.unloadVideo();
      onError?.(error);
      return;
    }

    // The frame is top row first; the first stage flips it upright
    let frameTexture = videoFrame;
    for (const stage of this.videoStages) {
      this.renderer.downsample(
        frameTexture,
        stage,
        frameTexture === videoFrame,
      );
      frameTexture = stage.texture;
    }

    const { smoothing } = this.videoOptions;
    let easedByRenderLoop = false;
    if (smoothing > 0) {
      const expectedMediaAdvance = (elapsedMs / 1000) * video.playbackRate;
      const seeked =
        Math.abs(mediaTime - this.videoMediaTime - expectedMediaAdvance) >
        VIDEO_SEEK_THRESHOLD_SECONDS;
      const snap =
        !this.hasVideoHistory ||
        !this.videoFrameShown ||
        !this.isPlaying ||
        video.paused ||
        seeked;
      if (snap) {
        frameTexture = this.drawSmoothing(frameTexture, 1);
        this.videoSmoothingTarget = null;
      } else {
        if (!this.videoSmoothingTarget) this.videoSmoothedAt = now;
        this.videoSmoothingTarget = frameTexture;
        this.videoSmoothingTargetAt = now;
        easedByRenderLoop = true;
      }
      this.hasVideoHistory = true;
    } else {
      this.hasVideoHistory = false;
    }

    const { frameRate } = this.videoOptions;
    if (frameRate > 0) {
      const interval = 1000 / frameRate;
      // Advance on a fixed cadence; restart it after falling behind
      this.videoSampleSlot =
        now - this.videoSampleSlot > interval * 2
          ? now
          : this.videoSampleSlot + interval;
    }
    this.videoFrameTime = now;
    this.videoMediaTime = mediaTime;
    this.videoFrameWidth = this.videoOptions.sampleWidth;
    this.videoFrameHeight = this.videoOptions.sampleHeight;
    if (!easedByRenderLoop) this.showVideoFrame(frameTexture);
  }

  // Easing per animation frame keeps a low frame rate source from stepping
  private advanceVideoSmoothing(timestamp: number): void {
    const target = this.videoSmoothingTarget;
    if (!target) return;
    const { smoothing } = this.videoOptions;
    const settled =
      timestamp - this.videoSmoothingTargetAt >=
      smoothing * VIDEO_SMOOTHING_SETTLE_RESPONSES;
    const elapsedMs = Math.max(0, timestamp - this.videoSmoothedAt);
    this.videoSmoothedAt = timestamp;
    const response = settled ? 1 : 1 - Math.exp(-elapsedMs / smoothing);
    this.activeSourceTexture = this.drawSmoothing(target, response);
    this.releaseRetainedVideoFrame();
    this.blurSourceInto(this.nextAlbumTarget);
    if (settled) this.videoSmoothingTarget = null;
  }

  private showVideoFrame(texture: Texture): void {
    if (this.videoFrameShown) {
      this.activeSourceTexture = texture;
      this.releaseRetainedVideoFrame();
      this.blurSourceInto(this.nextAlbumTarget);
    } else {
      this.videoFrameShown = true;
      this.shownVideoLoad = this.videoLoadCount;
      this.processNewImage(texture);
      // A stopped instance cannot animate the crossfade, so show the frame outright
      if (!this.isPlaying) this.isTransitioning = false;
    }
    if (!this.isPlaying) this.render(this.accumulatedTime);
  }

  private prepareVideoTargets(videoWidth: number, videoHeight: number): void {
    if (
      !this.videoTargetsStale &&
      videoWidth === this.videoSourceWidth &&
      videoHeight === this.videoSourceHeight
    ) {
      return;
    }
    this.releaseVideoTargets();

    const { sampleWidth, sampleHeight, downsampleFactor, smoothing } =
      this.videoOptions;
    let width = videoWidth;
    let height = videoHeight;
    while (
      width > sampleWidth * downsampleFactor ||
      height > sampleHeight * downsampleFactor
    ) {
      const nextWidth = Math.max(
        sampleWidth,
        Math.ceil(width / downsampleFactor),
      );
      const nextHeight = Math.max(
        sampleHeight,
        Math.ceil(height / downsampleFactor),
      );
      // Rounding up can stop shrinking tiny stages; the final stage covers the rest
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
      this.videoStages.push(this.createTarget(width, height));
    }
    this.videoStages.push(this.createTarget(sampleWidth, sampleHeight));

    if (smoothing > 0) {
      const float32History =
        this.highPrecisionInputRequested && this.renderer.float32Targets;
      for (let i = 0; i < 2; i++) {
        this.videoHistory.push(
          float32History
            ? this.renderer.createTarget(sampleWidth, sampleHeight, "rgba32f")
            : this.createTarget(sampleWidth, sampleHeight),
        );
      }
      this.videoHistoryStep = float32History
        ? this.renderer.float32Targets
          ? 0
          : 1 / 255
        : this.renderer.halfFloatTargets
          ? 1 / 1024
          : 1 / 255;
    }

    this.hasVideoHistory = false;
    this.videoSourceWidth = videoWidth;
    this.videoSourceHeight = videoHeight;
    this.videoTargetsStale = false;
  }

  /**
   * Free video render targets. The one the blur currently reads from is
   * retained so re-blurring keeps working until another source replaces it.
   */
  private releaseVideoTargets(): void {
    for (const target of [...this.videoStages, ...this.videoHistory]) {
      if (target.texture === this.activeSourceTexture) {
        this.releaseRetainedVideoFrame();
        this.retainedVideoFrame = target;
      } else {
        this.renderer.deleteTarget(target);
      }
    }
    this.videoStages = [];
    this.videoHistory = [];
    this.videoSmoothingTarget = null;
    this.videoTargetsStale = true;
  }

  private releaseRetainedVideoFrame(): void {
    if (
      !this.retainedVideoFrame ||
      this.retainedVideoFrame.texture === this.activeSourceTexture
    ) {
      return;
    }
    this.renderer.deleteTarget(this.retainedVideoFrame);
    this.retainedVideoFrame = null;
  }

  private drawSmoothing(source: Texture, response: number): Texture {
    const history = this.videoHistory[this.videoHistoryIndex];
    this.videoHistoryIndex = 1 - this.videoHistoryIndex;
    const target = this.videoHistory[this.videoHistoryIndex];
    if (!history || !target) return source;
    this.renderer.smoothing(
      source,
      history.texture,
      target,
      response,
      this.videoHistoryStep,
    );
    return target.texture;
  }

  /**
   * Process a new image: blur it and start transition
   * This is the key optimization - blur only runs here, not every frame!
   */
  private processNewImage(
    texture: Texture = this.renderer.imageTexture,
    keepVideo = false,
  ): void {
    if (texture === this.renderer.imageTexture && !keepVideo) {
      this.unloadVideo();
    }
    this.activeSourceTexture = texture;
    this.releaseRetainedVideoFrame();

    if (!this.hasImage) {
      this.blurSourceInto(this.nextAlbumTarget);
      this.blurSourceInto(this.currentAlbumTarget);
      this.hasImage = true;
      this.isTransitioning = false;
      return;
    }

    const previousAlbumTarget = this.currentAlbumTarget;
    this.currentAlbumTarget = this.nextAlbumTarget;
    this.nextAlbumTarget = previousAlbumTarget;

    this.blurSourceInto(this.nextAlbumTarget);
    this.isTransitioning = true;
    this.transitionStartTime = performance.now();
  }

  /**
   * Re-blur the current image (used when blurPasses changes)
   * Updates nextAlbumTarget in place without starting a transition
   */
  private reblurCurrentImage(): void {
    this.blurSourceInto(this.nextAlbumTarget);
  }

  /**
   * Blur the source texture into the target (with tint applied before blur)
   */
  private blurSourceInto(target: Target): void {
    this.renderer.tint(
      this.activeSourceTexture,
      this.blurTarget1,
      this._tintColor,
      this._tintIntensity,
    );

    let read = this.blurTarget1;
    let write = this.blurTarget2;
    for (let i = 0; i < this._blurPasses; i++) {
      this.renderer.blur(read.texture, write, i + 0.5);
      const swap = read;
      read = write;
      write = swap;
    }

    // Copy the final blur result to the target
    this.renderer.blur(read.texture, target, 0);
  }

  resize(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    if (this.warpTarget.width !== width || this.warpTarget.height !== height) {
      this.renderer.deleteTarget(this.warpTarget);
      this.warpTarget = this.createTarget(width, height);
    }
  }

  start(): void {
    if (this.disposed || this.isPlaying) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    if (this.video) {
      this.video.removeEventListener("pause", this.resumeVideoCallbacks);
      this.requestVideoFrame();
      if (this.videoFramePending) {
        this.videoFramePending = false;
        this.processVideoFrame(this.lastFrameTime, this.video.currentTime);
      }
    }
    this.animationId = requestAnimationFrame(this.renderLoop);
  }

  stop(): void {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  renderFrame(time?: number): void {
    const now = performance.now();
    if (time !== undefined) {
      this.render(time, now);
    } else {
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this._animationSpeed +=
        (this._targetAnimationSpeed - this._animationSpeed) * 0.05;
      this.accumulatedTime += dt * this._animationSpeed;
      this.render(this.accumulatedTime, now);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.unloadVideo();
    const renderer = this.renderer;

    if (this.retainedVideoFrame) renderer.deleteTarget(this.retainedVideoFrame);
    for (const target of this.sampleTargets) renderer.deleteTarget(target);
    renderer.deleteTarget(this.blurTarget1);
    renderer.deleteTarget(this.blurTarget2);
    renderer.deleteTarget(this.currentAlbumTarget);
    renderer.deleteTarget(this.nextAlbumTarget);
    renderer.deleteTarget(this.warpTarget);
    renderer.dispose();
  }

  private renderLoop = (timestamp: DOMHighResTimeStamp): void => {
    if (!this.isPlaying) return;
    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;
    this._animationSpeed +=
      (this._targetAnimationSpeed - this._animationSpeed) * 0.05;
    this.accumulatedTime += dt * this._animationSpeed;
    this.render(this.accumulatedTime, timestamp);
    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * Main render loop - very efficient!
   * Just: blend album targets → domain warp → output
   */
  private render(time: number, timestamp = performance.now()): void {
    if (this.disposed || !this.hasImage) return;
    this.advanceVideoSmoothing(timestamp);

    const renderer = this.renderer;
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    if (this.warpTarget.width !== width || this.warpTarget.height !== height) {
      renderer.deleteTarget(this.warpTarget);
      this.warpTarget = this.createTarget(width, height);
    }

    // Calculate transition blend factor
    let blendFactor = 1.0;
    if (this.isTransitioning) {
      // A source can arrive after this frame's timestamp (video frame callbacks
      // run before animation frames); a zero duration must not divide into NaN
      const elapsed = Math.max(0, timestamp - this.transitionStartTime);
      blendFactor =
        this._transitionDuration > 0
          ? Math.min(1.0, elapsed / this._transitionDuration)
          : 1.0;
      if (blendFactor >= 1.0) {
        this.isTransitioning = false;
      }
    }

    let currentTexture: Texture;
    if (this.isTransitioning && blendFactor < 1.0) {
      const easedBlend = 0.5 - 0.5 * Math.cos(blendFactor * Math.PI);
      renderer.blend(
        this.currentAlbumTarget.texture,
        this.nextAlbumTarget.texture,
        this.blurTarget1,
        easedBlend,
      );
      currentTexture = this.blurTarget1.texture;
    } else {
      currentTexture = this.nextAlbumTarget.texture;
    }

    // Warp upscales the blended result to full resolution
    renderer.warp(currentTexture, this.warpTarget, time, this._warpIntensity);

    // A fresh noise pattern every drawn frame, whatever the display rate
    const frame = this.frameIndex++;
    renderer.output(this.warpTarget.texture, width, height, {
      saturation: this._saturation,
      dithering: this._dithering,
      scale: this._scale,
      noiseOffset: [
        Math.floor(((frame * R2_X) % 1) * BLUE_NOISE_SIZE),
        Math.floor(((frame * R2_Y) % 1) * BLUE_NOISE_SIZE),
      ],
    });
  }

  /** High precision target, falling back to 8-bit where unsupported */
  private createTarget(width: number, height: number): Target {
    return this.renderer.createTarget(width, height, "rgba16f");
  }
}

export default Kawarp;
