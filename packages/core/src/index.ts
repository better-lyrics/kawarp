/**
 * Kawarp - Fluid Animated Background Renderer
 *
 * Creates a fluid, animated background effect similar to Apple Music's album art visualization.
 * Uses WebGL with Kawase blur and domain warping techniques.
 *
 * Optimized architecture:
 * - Blur runs on small textures (128x128) only when image changes
 * - Smooth crossfade transitions between images
 * - Instant first frame without black buffer crossfade
 * - High-precision FBO tracking and resolution management
 * - Robust CORS and blob/imageBitmap loading
 */

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
  /** Use WebGL2 with float32 color history for smoothed video. Creation only. */
  highPrecisionInput?: boolean;
  /** Request a float16 WebGL2 drawing buffer, falling back to RGBA8. Creation only. */
  highPrecisionOutput?: boolean;
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

interface Framebuffer {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
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

// A media-time jump larger than this between frames is a seek, not playback.
const VIDEO_SEEK_THRESHOLD_SECONDS = 0.25;

const boundedOption = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const textureSourceSize = (source: TexImageSource): [number, number] => {
  if ("naturalWidth" in source)
    return [source.naturalWidth, source.naturalHeight];
  if ("videoWidth" in source) return [source.videoWidth, source.videoHeight];
  if ("displayWidth" in source)
    return [source.displayWidth, source.displayHeight];
  return [source.width, source.height];
};

type FloatDrawingBufferContext = WebGL2RenderingContext & {
  drawingBufferStorage?: (
    internalFormat: number,
    width: number,
    height: number,
  ) => void;
  drawingBufferFormat?: number;
};

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const KAWASE_BLUR_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_resolution;
  uniform float u_offset;
  varying vec2 v_texCoord;

  void main() {
    highp vec2 texelSize = 1.0 / u_resolution;
    highp vec4 color = vec4(0.0);

    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, -u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(-u_offset, u_offset) * texelSize);
    color += texture2D(u_texture, v_texCoord + vec2(u_offset, u_offset) * texelSize);

    gl_FragColor = color * 0.25;
  }
`;

// Blend shader for crossfading between two textures
const BLEND_SHADER = `
  precision highp float;
  uniform sampler2D u_texture1;
  uniform sampler2D u_texture2;
  uniform float u_blend;
  varying vec2 v_texCoord;

  void main() {
    vec4 color1 = texture2D(u_texture1, v_texCoord);
    vec4 color2 = texture2D(u_texture2, v_texCoord);
    gl_FragColor = mix(color1, color2, u_blend);
  }
`;

// Tint shader - applies color to dark areas before blur
const TINT_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec3 u_tintColor;
  uniform float u_tintIntensity;
  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));

    // darkMask: 1.0 for black, 0.0 for luma >= 0.5
    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);

    // Blend dark areas toward tint color
    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);

    gl_FragColor = color;
  }
`;

const DOMAIN_WARP_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_texCoord;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = v_texCoord;
    float t = u_time * 0.05;

    vec2 center = uv - 0.5;
    float centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));

    // Large-scale movement (slow, big blobs)
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));

    // Medium-scale detail (adds organic movement)
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));

    // Combine two octaves
    vec2 warp = vec2(
      n1 * 0.65 + n3 * 0.35,
      n2 * 0.65 + n4 * 0.35
    ) * centerWeight;

    vec2 warpedUV = uv + warp * u_intensity;
    warpedUV = clamp(warpedUV, 0.0, 1.0);

    gl_FragColor = texture2D(u_texture, warpedUV);
  }
`;

const OUTPUT_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_saturation;
  uniform float u_dithering;
  uniform float u_time;
  uniform float u_scale;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  highp float hash(highp vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;
    uv = clamp(uv, 0.0, 1.0);

    vec4 color = texture2D(u_texture, uv);

    vec2 center = v_texCoord - 0.5;
    float vignette = 1.0 - dot(center, center) * 0.3;
    color.rgb *= vignette;

    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, u_saturation);

    highp vec2 pixelPos = floor(v_texCoord * u_resolution);
    highp float noise = hash(vec3(pixelPos, floor(u_time * 60.0)));
    color.rgb += (noise - 0.5) * u_dithering;

    gl_FragColor = color;
  }
`;

// Four bilinear taps average a 4x4 source footprint for reductions up to 4x
const DOWNSAMPLE_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  varying vec2 v_texCoord;

  void main() {
    vec2 offset = u_texelSize * 0.25;
    gl_FragColor = 0.25 * (
      texture2D(u_texture, v_texCoord + vec2(-offset.x, -offset.y)) +
      texture2D(u_texture, v_texCoord + vec2(offset.x, -offset.y)) +
      texture2D(u_texture, v_texCoord + vec2(-offset.x, offset.y)) +
      texture2D(u_texture, v_texCoord + vec2(offset.x, offset.y))
    );
  }
`;

// Moves at least one storage step toward the target, so half-float and 8-bit
// history cannot stall short of it when the per-frame response is tiny
const SMOOTHING_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform sampler2D u_history;
  uniform float u_response;
  uniform float u_minStep;
  varying vec2 v_texCoord;

  void main() {
    vec4 history = texture2D(u_history, v_texCoord);
    vec4 current = texture2D(u_texture, v_texCoord);
    vec4 blended = mix(history, current, u_response);
    vec4 remaining = current - history;
    vec4 minimal = history + sign(remaining) * min(abs(remaining), vec4(u_minStep));
    gl_FragColor = mix(
      minimal,
      blended,
      step(abs(minimal - history), abs(blended - history))
    );
  }
`;

interface SamplingPrograms {
  downsample: WebGLProgram;
  smoothing: WebGLProgram;
  downsampleUniforms: {
    texture: WebGLUniformLocation;
    texelSize: WebGLUniformLocation;
  };
  smoothingUniforms: {
    texture: WebGLUniformLocation;
    history: WebGLUniformLocation;
    response: WebGLUniformLocation;
    minStep: WebGLUniformLocation;
  };
}

export class Kawarp {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private halfFloatExt: OES_texture_half_float | null = null;
  private halfFloatLinearExt: OES_texture_half_float_linear | null = null;

  // Shader programs
  private blurProgram: WebGLProgram;
  private blendProgram: WebGLProgram;
  private tintProgram: WebGLProgram;
  private warpProgram: WebGLProgram;
  private outputProgram: WebGLProgram;

  // Buffers
  private positionBuffer: WebGLBuffer;
  private texCoordBuffer: WebGLBuffer;

  // Source texture (original image)
  private sourceTexture: WebGLTexture;

  // Small FBOs for blur (BLUR_SIZE x BLUR_SIZE)
  private blurFBO1: Framebuffer;
  private blurFBO2: Framebuffer;

  // Album FBOs for crossfade (BLUR_SIZE x BLUR_SIZE)
  private currentAlbumFBO: Framebuffer;
  private nextAlbumFBO: Framebuffer;

  // Full-res FBO for warp output
  private warpFBO: Framebuffer;

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

  // WebGL2 high-precision state (null/false on the default WebGL1 path)
  private gl2: WebGL2RenderingContext | null;
  private halfFloatRenderTargets = false;
  private float32RenderTargets = false;
  private floatLinearFiltering = false;
  private _highPrecisionOutput = false;
  private highPrecisionInputRequested: boolean;

  // Texture the blur reads from: the image source or the latest video frame
  private activeSourceTexture: WebGLTexture;
  private imageSourceWidth = 0;
  private imageSourceHeight = 0;
  private videoFrameWidth = 0;
  private videoFrameHeight = 0;

  // Video source state
  private video: HTMLVideoElement | null = null;
  // Let in-flight image loads detect a later loadVideo call, or a video frame
  // that has since taken the screen
  private videoLoadCount = 0;
  private videoFirstFrameCount = 0;
  private videoOptions: Required<Omit<KawarpVideoOptions, "onError">> &
    Pick<KawarpVideoOptions, "onError"> = { ...DEFAULT_VIDEO_OPTIONS };
  private videoCallbackId: number | null = null;
  private videoUploadTexture: WebGLTexture | null = null;
  private videoStages: Framebuffer[] = [];
  private videoHistory: Framebuffer[] = [];
  private videoHistoryIndex = 0;
  private hasVideoHistory = false;
  // Smallest change the history format can store; 0 for float32
  private videoHistoryStep = 0;
  // Ideal time of the last sample on the frameRate cadence
  private videoSampleSlot = 0;
  private videoTargetsStale = true;
  private videoSourceWidth = 0;
  private videoSourceHeight = 0;
  private videoFrameTime = 0;
  private videoMediaTime = 0;
  private videoFrameShown = false;
  private videoFramePending = false;
  private retainedVideoFrame: Framebuffer | null = null;
  private samplingPrograms: SamplingPrograms | null = null;
  private sampleTargets: Framebuffer[] = [];
  private sampleTargetsLayout: [number, number, number] = [0, 0, 0];
  private pendingSampleSize = 0;
  private samplePixelBuffer: WebGLBuffer | null = null;
  private pendingSample: Promise<Uint8Array | null> | null = null;

  // Cached attribute locations
  private attribs!: {
    position: number;
    texCoord: number;
  };

  // Cached uniform locations
  private uniforms!: {
    blur: {
      resolution: WebGLUniformLocation;
      texture: WebGLUniformLocation;
      offset: WebGLUniformLocation;
    };
    blend: {
      texture1: WebGLUniformLocation;
      texture2: WebGLUniformLocation;
      blend: WebGLUniformLocation;
    };
    warp: {
      texture: WebGLUniformLocation;
      time: WebGLUniformLocation;
      intensity: WebGLUniformLocation;
    };
    tint: {
      texture: WebGLUniformLocation;
      tintColor: WebGLUniformLocation;
      tintIntensity: WebGLUniformLocation;
    };
    output: {
      texture: WebGLUniformLocation;
      saturation: WebGLUniformLocation;
      dithering: WebGLUniformLocation;
      time: WebGLUniformLocation;
      scale: WebGLUniformLocation;
      resolution: WebGLUniformLocation;
    };
  };

  constructor(
    canvas: HTMLCanvasElement,
    options: KawarpOptions & KawarpContextOptions = {},
  ) {
    this.canvas = canvas;

    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    };
    const gl2 =
      options.highPrecisionInput || options.highPrecisionOutput
        ? canvas.getContext("webgl2", contextAttributes)
        : null;
    const gl = gl2 ?? canvas.getContext("webgl", contextAttributes);
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl as WebGLRenderingContext;
    this.gl2 = gl2;
    this.highPrecisionInputRequested = !!gl2 && !!options.highPrecisionInput;

    this.halfFloatExt = gl.getExtension("OES_texture_half_float");
    this.halfFloatLinearExt = gl.getExtension("OES_texture_half_float_linear");
    if (gl2) {
      this.float32RenderTargets = !!gl2.getExtension("EXT_color_buffer_float");
      this.halfFloatRenderTargets =
        this.float32RenderTargets ||
        !!gl2.getExtension("EXT_color_buffer_half_float");
      this.floatLinearFiltering = !!gl2.getExtension(
        "OES_texture_float_linear",
      );
    }

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

    // Create shader programs
    this.blurProgram = this.createProgram(VERTEX_SHADER, KAWASE_BLUR_SHADER);
    this.blendProgram = this.createProgram(VERTEX_SHADER, BLEND_SHADER);
    this.tintProgram = this.createProgram(VERTEX_SHADER, TINT_SHADER);
    this.warpProgram = this.createProgram(VERTEX_SHADER, DOMAIN_WARP_SHADER);
    this.outputProgram = this.createProgram(VERTEX_SHADER, OUTPUT_SHADER);

    // Cache attribute locations (same for all programs since they use same vertex shader)
    this.attribs = {
      position: gl.getAttribLocation(this.blurProgram, "a_position"),
      texCoord: gl.getAttribLocation(this.blurProgram, "a_texCoord"),
    };

    // Cache uniform locations
    this.uniforms = {
      blur: {
        resolution: gl.getUniformLocation(this.blurProgram, "u_resolution")!,
        texture: gl.getUniformLocation(this.blurProgram, "u_texture")!,
        offset: gl.getUniformLocation(this.blurProgram, "u_offset")!,
      },
      blend: {
        texture1: gl.getUniformLocation(this.blendProgram, "u_texture1")!,
        texture2: gl.getUniformLocation(this.blendProgram, "u_texture2")!,
        blend: gl.getUniformLocation(this.blendProgram, "u_blend")!,
      },
      warp: {
        texture: gl.getUniformLocation(this.warpProgram, "u_texture")!,
        time: gl.getUniformLocation(this.warpProgram, "u_time")!,
        intensity: gl.getUniformLocation(this.warpProgram, "u_intensity")!,
      },
      tint: {
        texture: gl.getUniformLocation(this.tintProgram, "u_texture")!,
        tintColor: gl.getUniformLocation(this.tintProgram, "u_tintColor")!,
        tintIntensity: gl.getUniformLocation(
          this.tintProgram,
          "u_tintIntensity",
        )!,
      },
      output: {
        texture: gl.getUniformLocation(this.outputProgram, "u_texture")!,
        saturation: gl.getUniformLocation(this.outputProgram, "u_saturation")!,
        dithering: gl.getUniformLocation(this.outputProgram, "u_dithering")!,
        time: gl.getUniformLocation(this.outputProgram, "u_time")!,
        scale: gl.getUniformLocation(this.outputProgram, "u_scale")!,
        resolution: gl.getUniformLocation(this.outputProgram, "u_resolution")!,
      },
    };

    // Create buffers
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    );
    this.texCoordBuffer = this.createBuffer(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    );

    // Create source texture
    this.sourceTexture = this.createTexture();
    this.activeSourceTexture = this.sourceTexture;

    // Create small FBOs for blur operations (high precision to avoid banding)
    this.blurFBO1 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.blurFBO2 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);

    // Create album FBOs for crossfade (high precision to avoid banding)
    this.currentAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.nextAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);

    const initW = Math.max(1, canvas.width || 640);
    const initH = Math.max(1, canvas.height || 360);
    this.warpFBO = this.createFramebuffer(initW, initH, true);

    if (options.highPrecisionOutput) this.applyFloatDrawingBuffer();
  }

  /** Whether the drawing buffer is float16 (requested via highPrecisionOutput) */
  get highPrecisionOutput(): boolean {
    return this._highPrecisionOutput;
  }

  /** Whether smoothed video keeps float32 color history (requested via highPrecisionInput) */
  get highPrecisionInput(): boolean {
    return this.highPrecisionInputRequested && this.float32RenderTargets;
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
    const videoFramesAtStart = this.videoFirstFrameCount;

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

    if (this.disposed || this.videoFirstFrameCount !== videoFramesAtStart) {
      if ("close" in bitmap) bitmap.close();
      return;
    }
    const posterForVideo =
      !!this.video && this.videoLoadCount !== videoLoadsAtStart;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    [this.imageSourceWidth, this.imageSourceHeight] = textureSourceSize(bitmap);
    if (
      "close" in bitmap &&
      typeof (bitmap as ImageBitmap).close === "function"
    ) {
      (bitmap as ImageBitmap).close();
    }

    this.processNewImage(this.sourceTexture, posterForVideo);
  }

  loadImageElement(source: TexImageSource): void {
    this.showImageElement(source, false);
  }

  private showImageElement(
    source: TexImageSource,
    posterForVideo: boolean,
  ): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    [this.imageSourceWidth, this.imageSourceHeight] = textureSourceSize(source);
    this.processNewImage(this.sourceTexture, posterForVideo);
  }

  loadImageData(
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer) : data,
    );
    this.imageSourceWidth = width;
    this.imageSourceHeight = height;
    this.processNewImage();
  }

  loadFromImageData(imageData: ImageData): void {
    this.loadImageData(imageData.data, imageData.width, imageData.height);
  }

  async loadBlob(blob: Blob): Promise<void> {
    const videoLoadsAtStart = this.videoLoadCount;
    const videoFramesAtStart = this.videoFirstFrameCount;
    const bitmap = await createImageBitmap(blob);
    if (this.disposed || this.videoFirstFrameCount !== videoFramesAtStart) {
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
   * place. The first frame crossfades from the current image. Video renders
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
      this.videoSampleSlot = 0;
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
    if (this.videoUploadTexture) {
      this.gl.deleteTexture(this.videoUploadTexture);
      this.videoUploadTexture = null;
    }
  }

  /**
   * Read a small RGBA8 thumbnail (size x size, bottom row of the rendered
   * orientation first) of the current source, e.g. to measure brightness. WebGL2 reads asynchronously
   * through a pixel buffer and fence; WebGL1 reads synchronously.
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

    const gl = this.gl;
    const [sourceWidth, sourceHeight] =
      this.activeSourceTexture === this.sourceTexture
        ? [this.imageSourceWidth, this.imageSourceHeight]
        : [this.videoFrameWidth, this.videoFrameHeight];
    this.prepareSampleTargets(sourceWidth, sourceHeight, edge);
    let sampledTexture = this.activeSourceTexture;
    for (const stage of this.sampleTargets) {
      this.drawDownsample(sampledTexture, stage);
      sampledTexture = stage.texture;
    }

    const pixels = new Uint8Array(edge * edge * 4);
    const gl2 = this.gl2;
    if (!gl2) {
      gl.readPixels(0, 0, edge, edge, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return Promise.resolve(pixels);
    }

    this.samplePixelBuffer ??= gl2.createBuffer();
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.samplePixelBuffer);
    gl2.bufferData(gl2.PIXEL_PACK_BUFFER, pixels.byteLength, gl2.STREAM_READ);
    gl2.readPixels(0, 0, edge, edge, gl2.RGBA, gl2.UNSIGNED_BYTE, 0);
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
    const fence = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return Promise.resolve(null);
    gl2.flush();

    // Timers keep polling in background tabs, where animation frames stop
    const sample = new Promise<Uint8Array | null>((resolve) => {
      const poll = () => {
        if (this.disposed) {
          gl2.deleteSync(fence);
          resolve(null);
          return;
        }
        const status = gl2.clientWaitSync(fence, 0, 0);
        if (status === gl2.TIMEOUT_EXPIRED) {
          setTimeout(poll, 4);
          return;
        }
        gl2.deleteSync(fence);
        if (status === gl2.WAIT_FAILED) {
          resolve(null);
          return;
        }
        gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, this.samplePixelBuffer);
        gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, pixels);
        gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
        resolve(pixels);
      };
      setTimeout(poll, 0);
    }).finally(() => {
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
    for (const target of this.sampleTargets) this.deleteFramebuffer(target);
    this.sampleTargets = [];

    let width = sourceWidth;
    let height = sourceHeight;
    while (width > edge * 2 || height > edge * 2) {
      width = Math.max(edge, Math.ceil(width / 2));
      height = Math.max(edge, Math.ceil(height / 2));
      this.sampleTargets.push(this.createByteFramebuffer(width, height));
    }
    this.sampleTargets.push(this.createByteFramebuffer(edge, edge));
    this.sampleTargetsLayout = [sourceWidth, sourceHeight, edge];
  }

  private createByteFramebuffer(width: number, height: number): Framebuffer {
    return this.gl2
      ? this.createSizedFramebuffer(width, height, this.gl2.RGBA8)
      : this.createFramebuffer(width, height);
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
    const gl = this.gl;
    const elapsedMs = now - this.videoFrameTime;

    try {
      this.prepareVideoTargets(video.videoWidth, video.videoHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.videoUploadTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
    } catch (error) {
      const { onError } = this.videoOptions;
      this.unloadVideo();
      onError?.(error);
      return;
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    let frameTexture = this.videoUploadTexture as WebGLTexture;
    for (const stage of this.videoStages) {
      this.drawDownsample(frameTexture, stage);
      frameTexture = stage.texture;
    }

    const { smoothing } = this.videoOptions;
    if (smoothing > 0) {
      const expectedMediaAdvance = (elapsedMs / 1000) * video.playbackRate;
      const seeked =
        Math.abs(mediaTime - this.videoMediaTime - expectedMediaAdvance) >
        VIDEO_SEEK_THRESHOLD_SECONDS;
      const response =
        !this.hasVideoHistory || video.paused || seeked
          ? 1
          : 1 - Math.exp(-Math.max(0, elapsedMs) / smoothing);
      frameTexture = this.drawSmoothing(frameTexture, response);
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
    this.showVideoFrame(frameTexture);
  }

  private showVideoFrame(texture: WebGLTexture): void {
    if (this.videoFrameShown) {
      this.activeSourceTexture = texture;
      this.releaseRetainedVideoFrame();
      this.blurSourceInto(this.nextAlbumFBO);
    } else {
      this.videoFrameShown = true;
      this.videoFirstFrameCount++;
      this.processNewImage(texture);
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
    this.videoUploadTexture ??= this.createTexture();

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
      this.videoStages.push(this.createFramebuffer(width, height, true));
    }
    this.videoStages.push(
      this.createFramebuffer(sampleWidth, sampleHeight, true),
    );

    if (smoothing > 0) {
      const float32History =
        this.highPrecisionInputRequested && this.float32RenderTargets;
      for (let i = 0; i < 2; i++) {
        this.videoHistory.push(
          this.gl2 && float32History
            ? this.createSizedFramebuffer(
                sampleWidth,
                sampleHeight,
                this.gl2.RGBA32F,
              )
            : this.createFramebuffer(sampleWidth, sampleHeight, true),
        );
      }
      const halfFloatHistory = this.gl2
        ? this.halfFloatRenderTargets
        : !!(this.halfFloatExt && this.halfFloatLinearExt);
      this.videoHistoryStep = float32History
        ? this.float32RenderTargets
          ? 0
          : 1 / 255
        : halfFloatHistory
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
        this.deleteFramebuffer(target);
      }
    }
    this.videoStages = [];
    this.videoHistory = [];
    this.videoTargetsStale = true;
  }

  private releaseRetainedVideoFrame(): void {
    if (
      !this.retainedVideoFrame ||
      this.retainedVideoFrame.texture === this.activeSourceTexture
    ) {
      return;
    }
    this.deleteFramebuffer(this.retainedVideoFrame);
    this.retainedVideoFrame = null;
  }

  private getSamplingPrograms(): SamplingPrograms {
    if (this.samplingPrograms) return this.samplingPrograms;
    const gl = this.gl;
    const downsample = this.createProgram(VERTEX_SHADER, DOWNSAMPLE_SHADER);
    const smoothing = this.createProgram(VERTEX_SHADER, SMOOTHING_SHADER);
    this.samplingPrograms = {
      downsample,
      smoothing,
      downsampleUniforms: {
        texture: gl.getUniformLocation(downsample, "u_texture")!,
        texelSize: gl.getUniformLocation(downsample, "u_texelSize")!,
      },
      smoothingUniforms: {
        texture: gl.getUniformLocation(smoothing, "u_texture")!,
        history: gl.getUniformLocation(smoothing, "u_history")!,
        response: gl.getUniformLocation(smoothing, "u_response")!,
        minStep: gl.getUniformLocation(smoothing, "u_minStep")!,
      },
    };
    return this.samplingPrograms;
  }

  private drawDownsample(source: WebGLTexture, target: Framebuffer): void {
    const gl = this.gl;
    const programs = this.getSamplingPrograms();
    gl.useProgram(programs.downsample);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(programs.downsampleUniforms.texture, 0);
    gl.uniform2f(
      programs.downsampleUniforms.texelSize,
      1 / target.width,
      1 / target.height,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawSmoothing(source: WebGLTexture, response: number): WebGLTexture {
    const gl = this.gl;
    const programs = this.getSamplingPrograms();
    const history = this.videoHistory[this.videoHistoryIndex];
    this.videoHistoryIndex = 1 - this.videoHistoryIndex;
    const target = this.videoHistory[this.videoHistoryIndex];
    if (!history || !target) return source;

    gl.useProgram(programs.smoothing);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, history.texture);
    gl.uniform1i(programs.smoothingUniforms.history, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(programs.smoothingUniforms.texture, 0);
    gl.uniform1f(programs.smoothingUniforms.response, response);
    gl.uniform1f(programs.smoothingUniforms.minStep, this.videoHistoryStep);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return target.texture;
  }

  /**
   * Process a new image: blur it and start transition
   * This is the key optimization - blur only runs here, not every frame!
   */
  private processNewImage(
    texture: WebGLTexture = this.sourceTexture,
    keepVideo = false,
  ): void {
    if (texture === this.sourceTexture && !keepVideo) this.unloadVideo();
    this.activeSourceTexture = texture;
    this.releaseRetainedVideoFrame();

    if (!this.hasImage) {
      this.blurSourceInto(this.nextAlbumFBO);
      this.blurSourceInto(this.currentAlbumFBO);
      this.hasImage = true;
      this.isTransitioning = false;
      return;
    }

    const previousAlbumFBO = this.currentAlbumFBO;
    this.currentAlbumFBO = this.nextAlbumFBO;
    this.nextAlbumFBO = previousAlbumFBO;

    this.blurSourceInto(this.nextAlbumFBO);
    this.isTransitioning = true;
    this.transitionStartTime = performance.now();
  }

  /**
   * Re-blur the current image (used when blurPasses changes)
   * Updates nextAlbumFBO in place without starting a transition
   */
  private reblurCurrentImage(): void {
    this.blurSourceInto(this.nextAlbumFBO);
  }

  /**
   * Blur the source texture into the target FBO (with tint applied before blur)
   */
  private blurSourceInto(targetFBO: Framebuffer): void {
    const gl = this.gl;

    // Step 1: Apply tint to source texture → blurFBO1
    gl.useProgram(this.tintProgram);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
    gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.activeSourceTexture);
    gl.uniform1i(this.uniforms.tint.texture, 0);
    gl.uniform3fv(this.uniforms.tint.tintColor, this._tintColor);
    gl.uniform1f(this.uniforms.tint.tintIntensity, this._tintIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Step 2: Kawase blur passes on the tinted texture
    gl.useProgram(this.blurProgram);
    this.setupAttributes();
    gl.uniform2f(this.uniforms.blur.resolution, BLUR_SIZE, BLUR_SIZE);
    gl.uniform1i(this.uniforms.blur.texture, 0);

    let readFBO = this.blurFBO1;
    let writeFBO = this.blurFBO2;

    for (let i = 0; i < this._blurPasses; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);
      gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
      gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);
      gl.uniform1f(this.uniforms.blur.offset, i + 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const swap = readFBO;
      readFBO = writeFBO;
      writeFBO = swap;
    }

    // Step 3: Copy final blur result to target FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
    gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);
    gl.uniform1f(this.uniforms.blur.offset, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    if (this.warpFBO.width !== width || this.warpFBO.height !== height) {
      if (this.warpFBO) this.deleteFramebuffer(this.warpFBO);
      this.warpFBO = this.createFramebuffer(width, height, true);
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
    const gl = this.gl;

    if (this.retainedVideoFrame)
      this.deleteFramebuffer(this.retainedVideoFrame);
    for (const target of this.sampleTargets) this.deleteFramebuffer(target);
    if (this.samplingPrograms) {
      gl.deleteProgram(this.samplingPrograms.downsample);
      gl.deleteProgram(this.samplingPrograms.smoothing);
    }
    this.gl2?.deleteBuffer(this.samplePixelBuffer);

    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.blendProgram);
    gl.deleteProgram(this.tintProgram);
    gl.deleteProgram(this.warpProgram);
    gl.deleteProgram(this.outputProgram);

    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteTexture(this.sourceTexture);

    this.deleteFramebuffer(this.blurFBO1);
    this.deleteFramebuffer(this.blurFBO2);
    this.deleteFramebuffer(this.currentAlbumFBO);
    this.deleteFramebuffer(this.nextAlbumFBO);
    this.deleteFramebuffer(this.warpFBO);
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
   * Just: blend album FBOs → domain warp → output
   */
  private render(time: number, timestamp = performance.now()): void {
    if (this.disposed || !this.hasImage) return;

    const gl = this.gl;
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    if (this.warpFBO.width !== width || this.warpFBO.height !== height) {
      this.deleteFramebuffer(this.warpFBO);
      this.warpFBO = this.createFramebuffer(width, height, true);
    }

    // Calculate transition blend factor
    let blendFactor = 1.0;
    if (this.isTransitioning) {
      const elapsed = timestamp - this.transitionStartTime;
      blendFactor = Math.min(1.0, elapsed / this._transitionDuration);
      if (blendFactor >= 1.0) {
        this.isTransitioning = false;
      }
    }

    let currentTexture: WebGLTexture;

    if (this.isTransitioning && blendFactor < 1.0) {
      gl.useProgram(this.blendProgram);
      this.setupAttributes();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer);
      gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.currentAlbumFBO.texture);
      gl.uniform1i(this.uniforms.blend.texture1, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
      gl.uniform1i(this.uniforms.blend.texture2, 1);

      const easedBlend = 0.5 - 0.5 * Math.cos(blendFactor * Math.PI);
      gl.uniform1f(this.uniforms.blend.blend, easedBlend);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      currentTexture = this.blurFBO1.texture;
    } else {
      currentTexture = this.nextAlbumFBO.texture;
    }

    // Warp upscales the blended result to full resolution
    gl.useProgram(this.warpProgram);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    gl.uniform1i(this.uniforms.warp.texture, 0);
    gl.uniform1f(this.uniforms.warp.time, time);
    gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Output with saturation and dithering
    gl.useProgram(this.outputProgram);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);
    gl.uniform1i(this.uniforms.output.texture, 0);
    gl.uniform1f(this.uniforms.output.saturation, this._saturation);
    gl.uniform1f(this.uniforms.output.dithering, this._dithering);
    gl.uniform1f(this.uniforms.output.time, time);
    gl.uniform1f(this.uniforms.output.scale, this._scale);
    gl.uniform2f(this.uniforms.output.resolution, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private setupAttributes(): void {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(this.attribs.texCoord);
    gl.vertexAttribPointer(this.attribs.texCoord, 2, gl.FLOAT, false, 0, 0);
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    gl.shaderSource(
      shader,
      this.gl2 && type === gl.FRAGMENT_SHADER
        ? `precision highp sampler2D;\n${source}`
        : source,
    );
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${error}`);
    }
    return shader;
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string,
  ): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(
      gl.FRAGMENT_SHADER,
      fragmentSource,
    );

    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }

  private createBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private createFramebuffer(
    width: number,
    height: number,
    useHighPrecision = false,
  ): Framebuffer {
    if (this.gl2) {
      return this.createSizedFramebuffer(
        width,
        height,
        useHighPrecision && this.halfFloatRenderTargets
          ? this.gl2.RGBA16F
          : this.gl2.RGBA8,
      );
    }

    const gl = this.gl;
    const texture = this.createTexture();

    const canUseHalfFloat =
      useHighPrecision && this.halfFloatExt && this.halfFloatLinearExt;
    const type = canUseHalfFloat
      ? this.halfFloatExt!.HALF_FLOAT_OES
      : gl.UNSIGNED_BYTE;

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      type,
      null,
    );

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Failed to create framebuffer");

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return { framebuffer, texture, width, height };
  }

  /**
   * WebGL2 render target with an explicit internal format. Float formats fall
   * back to RGBA8 when the driver reports them incomplete.
   */
  private createSizedFramebuffer(
    width: number,
    height: number,
    internalFormat: number,
  ): Framebuffer {
    const gl = this.gl2 as WebGL2RenderingContext;
    const texture = this.createTexture();
    const pixelType =
      internalFormat === gl.RGBA32F
        ? gl.FLOAT
        : internalFormat === gl.RGBA16F
          ? gl.HALF_FLOAT
          : gl.UNSIGNED_BYTE;
    if (internalFormat === gl.RGBA32F && !this.floatLinearFiltering) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      pixelType,
      null,
    );

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Failed to create framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    if (
      internalFormat !== gl.RGBA8 &&
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    ) {
      if (internalFormat === gl.RGBA32F) this.float32RenderTargets = false;
      else this.halfFloatRenderTargets = false;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    return { framebuffer, texture, width, height };
  }

  private applyFloatDrawingBuffer(): void {
    const gl = this.gl2 as FloatDrawingBufferContext | null;
    if (!gl?.drawingBufferStorage || !this.halfFloatRenderTargets) return;
    gl.drawingBufferStorage(
      gl.RGBA16F,
      Math.max(1, this.canvas.width),
      Math.max(1, this.canvas.height),
    );
    this._highPrecisionOutput = gl.drawingBufferFormat === gl.RGBA16F;
  }

  private deleteFramebuffer(fbo: Framebuffer): void {
    this.gl.deleteFramebuffer(fbo.framebuffer);
    this.gl.deleteTexture(fbo.texture);
  }
}

export default Kawarp;
