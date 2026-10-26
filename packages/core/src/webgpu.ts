import {
  BLUE_NOISE_CHANNEL_OFFSETS,
  BLUE_NOISE_SIZE,
  decodeBlueNoise,
} from "./blueNoise.js";
import {
  type OutputParams,
  type Renderer,
  type Target,
  type TargetFormat,
  type Texture,
  textureSourceSize,
} from "./renderer.js";

// Offscreen passes keep row r of the target at texture y = (r + 0.5) / height,
// matching WebGL, where framebuffers start at the bottom. Only the screen pass
// flips, so the canvas shows row 0 at the bottom as the WebGL backend does.
export const VERTEX = /* wgsl */ `
  struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
  };

  fn corner(index: u32) -> vec2f {
    var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return corners[index];
  }

  @vertex fn vs_target(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = corner(index);
    var out: VertexOutput;
    out.position = vec4f(p, 0.0, 1.0);
    out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
  }

  @vertex fn vs_screen(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = corner(index);
    var out: VertexOutput;
    out.position = vec4f(p, 0.0, 1.0);
    out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 + p.y * 0.5);
    return out;
  }
`;

const KAWASE_BLUR = /* wgsl */ `
  struct Uniforms { resolution: vec2f, offset: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var source: texture_2d<f32>;

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let texelSize = 1.0 / u.resolution;
    var color = vec4f(0.0);
    color += textureSample(source, linearSampler, in.uv + vec2f(-u.offset, -u.offset) * texelSize);
    color += textureSample(source, linearSampler, in.uv + vec2f(u.offset, -u.offset) * texelSize);
    color += textureSample(source, linearSampler, in.uv + vec2f(-u.offset, u.offset) * texelSize);
    color += textureSample(source, linearSampler, in.uv + vec2f(u.offset, u.offset) * texelSize);
    return color * 0.25;
  }
`;

const BLEND = /* wgsl */ `
  struct Uniforms { amount: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var current: texture_2d<f32>;
  @group(0) @binding(3) var next: texture_2d<f32>;

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    return mix(
      textureSample(current, linearSampler, in.uv),
      textureSample(next, linearSampler, in.uv),
      u.amount,
    );
  }
`;

// Applies color to dark areas before blur
const TINT = /* wgsl */ `
  struct Uniforms { color: vec3f, intensity: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var source: texture_2d<f32>;

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    var color = textureSample(source, linearSampler, in.uv);
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    // darkMask: 1.0 for black, 0.0 for luma >= 0.5
    let darkMask = 1.0 - smoothstep(0.0, 0.5, luma);
    color = vec4f(mix(color.rgb, u.color, darkMask * u.intensity), color.a);
    return color;
  }
`;

const DOMAIN_WARP = /* wgsl */ `
  struct Uniforms { time: f32, intensity: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var source: texture_2d<f32>;

  fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  fn mod289v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  fn permute(x: vec3f) -> vec3f { return mod289v3(((x * 34.0) + 1.0) * x); }

  fn snoise(v: vec2f) -> f32 {
    let C = vec4f(0.211324865405187, 0.366025403784439,
                  -0.577350269189626, 0.024390243902439);
    var i = floor(v + dot(v, C.yy));
    let x0 = v - i + dot(i, C.xx);
    let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
    var x12 = x0.xyxy + C.xxzz;
    x12 = vec4f(x12.xy - i1, x12.zw);
    i = mod289v2(i);
    let p = permute(permute(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
    var m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
    m = m * m;
    m = m * m;
    let x = 2.0 * fract(p * C.www) - 1.0;
    let h = abs(x) - 0.5;
    let ox = floor(x + 0.5);
    let a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
    return 130.0 * dot(m, g);
  }

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.time * 0.05;

    let center = uv - 0.5;
    let centerWeight = 1.0 - smoothstep(0.0, 0.7, length(center));

    // Large-scale movement (slow, big blobs)
    let n1 = snoise(uv * 0.35 + vec2f(t, t * 0.7));
    let n2 = snoise(uv * 0.35 + vec2f(-t * 0.8, t * 0.5) + vec2f(50.0, 50.0));

    // Medium-scale detail (adds organic movement)
    let n3 = snoise(uv * 0.9 + vec2f(t * 1.2, -t) + vec2f(100.0, 0.0));
    let n4 = snoise(uv * 0.9 + vec2f(-t, t * 1.1) + vec2f(0.0, 100.0));

    // Combine two octaves
    let warp = vec2f(n1 * 0.65 + n3 * 0.35, n2 * 0.65 + n4 * 0.35) * centerWeight;
    let warpedUV = clamp(uv + warp * u.intensity, vec2f(0.0), vec2f(1.0));
    return textureSample(source, linearSampler, warpedUV);
  }
`;

// Dithers each channel with its own blue noise, reshaped to a triangular
// distribution so the noise level does not vary with the signal
const OUTPUT = /* wgsl */ `
  struct Uniforms {
    // saturation, dithering, scale
    params: vec4f,
    // xy: per-frame tile shift
    noiseOffset: vec4f,
    // red xy, green zw; blue xy
    channelOffsets: array<vec4f, 2>,
  };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var source: texture_2d<f32>;
  @group(0) @binding(3) var blueNoiseTile: texture_2d<f32>;

  fn blueNoise(position: vec2f, offset: vec2f) -> f32 {
    let texel = vec2i(floor(position + u.noiseOffset.xy + offset)) % ${BLUE_NOISE_SIZE};
    return (textureLoad(blueNoiseTile, texel, 0).r * 255.0 + 0.5) / 256.0;
  }

  // Uniform (0, 1) to triangular (-1, 1)
  fn triangular(value: f32) -> f32 {
    let v = value * 2.0 - 1.0;
    return sign(v) * (1.0 - sqrt(1.0 - abs(v)));
  }

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let saturation = u.params.x;
    let dithering = u.params.y;
    let scale = u.params.z;
    let uv = clamp((in.uv - 0.5) / scale + 0.5, vec2f(0.0), vec2f(1.0));

    var color = textureSample(source, linearSampler, uv);

    let center = in.uv - 0.5;
    let vignette = 1.0 - dot(center, center) * 0.3;
    var rgb = color.rgb * vignette;

    let gray = dot(rgb, vec3f(0.299, 0.587, 0.114));
    rgb = mix(vec3f(gray), rgb, saturation);

    let noise = vec3f(
      triangular(blueNoise(in.position.xy, u.channelOffsets[0].xy)),
      triangular(blueNoise(in.position.xy, u.channelOffsets[0].zw)),
      triangular(blueNoise(in.position.xy, u.channelOffsets[1].xy)),
    );
    rgb += noise * (dithering * 0.5);
    return vec4f(rgb, color.a);
  }
`;

// Four bilinear taps average a 4x4 source footprint for reductions up to 4x
const downsampleShader = (external: boolean) => /* wgsl */ `
  struct Uniforms { texelSize: vec2f, flipY: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var source: ${external ? "texture_external" : "texture_2d<f32>"};

  fn tap(uv: vec2f) -> vec4f {
    return ${
      external
        ? "textureSampleBaseClampToEdge(source, linearSampler, uv)"
        : "textureSample(source, linearSampler, uv)"
    };
  }

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let uv = vec2f(in.uv.x, mix(in.uv.y, 1.0 - in.uv.y, u.flipY));
    let offset = u.texelSize * 0.25;
    return 0.25 * (
      tap(uv + vec2f(-offset.x, -offset.y)) +
      tap(uv + vec2f(offset.x, -offset.y)) +
      tap(uv + vec2f(-offset.x, offset.y)) +
      tap(uv + vec2f(offset.x, offset.y))
    );
  }
`;

// Moves at least one storage step toward the target, so half-float and 8-bit
// history cannot stall short of it when the per-frame response is tiny
const SMOOTHING = /* wgsl */ `
  struct Uniforms { response: f32, minStep: f32 };
  @group(0) @binding(0) var<uniform> u: Uniforms;
  @group(0) @binding(1) var linearSampler: sampler;
  @group(0) @binding(2) var current: texture_2d<f32>;
  @group(0) @binding(3) var history: texture_2d<f32>;

  @fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let previous = textureSample(history, linearSampler, in.uv);
    let next = textureSample(current, linearSampler, in.uv);
    let blended = mix(previous, next, u.response);
    let remaining = next - previous;
    let minimal = previous + sign(remaining) * min(abs(remaining), vec4f(u.minStep));
    return mix(minimal, blended, step(abs(minimal - previous), abs(blended - previous)));
  }
`;

type ShaderName =
  | "blur"
  | "blend"
  | "tint"
  | "warp"
  | "output"
  | "downsample"
  | "downsampleExternal"
  | "smoothing";

export const SHADERS: Record<ShaderName, string> = {
  blur: KAWASE_BLUR,
  blend: BLEND,
  tint: TINT,
  warp: DOMAIN_WARP,
  output: OUTPUT,
  downsample: downsampleShader(false),
  downsampleExternal: downsampleShader(true),
  smoothing: SMOOTHING,
};

const GPU_FORMATS: Record<TargetFormat, GPUTextureFormat> = {
  rgba8: "rgba8unorm",
  rgba16f: "rgba16float",
  rgba32f: "rgba32float",
};

// Largest uniform block any pass writes
const UNIFORM_BYTES = 64;

interface GPUTextureRef extends Texture {
  /** Changes whenever the GPU texture is replaced; keys cached bind groups */
  id: number;
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
}

interface ExternalTextureRef extends Texture {
  external: GPUExternalTexture;
}

interface GPUTargetRef extends Target {
  readonly texture: GPUTextureRef;
}

const isExternal = (texture: Texture): texture is ExternalTextureRef =>
  "external" in texture;

export class WebGPURenderer implements Renderer {
  readonly backend = "webgpu";
  readonly halfFloatTargets = true;
  readonly float32Targets: boolean;
  readonly imageTexture: GPUTextureRef;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvasFormat: GPUTextureFormat;
  private _highPrecisionOutput = false;
  private sampler: GPUSampler;
  private blueNoise: GPUTextureRef;
  private modules = new Map<ShaderName, GPUShaderModule>();
  private pipelines = new Map<string, GPURenderPipeline>();
  // Bind groups for passes without video frames. Steady-state frames reuse
  // the same targets and uniform slots, so these are created once.
  private bindGroups = new Map<string, GPUBindGroup>();
  private nextTextureId = 1;
  private encoder: GPUCommandEncoder | null = null;
  // One small uniform buffer per pass. writeBuffer lands before the next
  // submit, so passes in one submit must not share a buffer.
  private uniformBuffers: GPUBuffer[] = [];
  private uniformsUsed = 0;
  // Textures deleted while commands that use them are still unsubmitted
  private pendingDestroy: GPUTexture[] = [];
  private disposed = false;

  /**
   * Resolves to null when WebGPU or a suitable adapter is unavailable. The
   * canvas is only claimed once a device exists, so WebGL2 can still use it.
   */
  static async create(
    canvas: HTMLCanvasElement,
    powerPreference: GPUPowerPreference = "low-power",
  ): Promise<WebGPURenderer | null> {
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : undefined;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference });
    if (!adapter) return null;
    const float32Filterable = adapter.features.has("float32-filterable");
    const device = await adapter.requestDevice({
      requiredFeatures: float32Filterable ? ["float32-filterable"] : [],
    });
    const context = canvas.getContext("webgpu");
    if (!context) {
      device.destroy();
      return null;
    }
    return new WebGPURenderer(device, context, float32Filterable);
  }

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    float32Filterable: boolean,
  ) {
    this.device = device;
    this.context = context;
    this.float32Targets = float32Filterable;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.imageTexture = this.createTexture(1, 1, "rgba8unorm");
    this.blueNoise = this.createTexture(
      BLUE_NOISE_SIZE,
      BLUE_NOISE_SIZE,
      "r8unorm",
    );
    device.queue.writeTexture(
      { texture: this.blueNoise.texture },
      decodeBlueNoise() as Uint8Array<ArrayBuffer>,
      { bytesPerRow: BLUE_NOISE_SIZE },
      [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE],
    );
  }

  get highPrecisionOutput(): boolean {
    return this._highPrecisionOutput;
  }

  configureOutput(highPrecision: boolean): void {
    if (highPrecision) this.canvasFormat = "rgba16float";
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });
    this._highPrecisionOutput =
      (this.context.getConfiguration?.()?.format ?? this.canvasFormat) ===
      "rgba16float";
  }

  createTarget(width: number, height: number, format: TargetFormat): Target {
    // Without float32 filtering, rgba32f would fail every sampling pass
    if (format === "rgba32f" && !this.float32Targets) format = "rgba8";
    const texture = this.createTexture(width, height, GPU_FORMATS[format]);
    const target: GPUTargetRef = { texture, width, height, format };
    return target;
  }

  deleteTarget(target: Target): void {
    this.destroyTexture((target as GPUTargetRef).texture.texture);
  }

  uploadImage(source: TexImageSource): void {
    const [width, height] = textureSourceSize(source);
    this.resizeImageTexture(width, height);
    this.device.queue.copyExternalImageToTexture(
      { source: source as GPUCopyExternalImageSource },
      { texture: this.imageTexture.texture },
      [this.imageTexture.width, this.imageTexture.height],
    );
  }

  uploadPixels(data: Uint8Array, width: number, height: number): void {
    this.resizeImageTexture(width, height);
    this.device.queue.writeTexture(
      { texture: this.imageTexture.texture },
      data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * 4 },
      [width, height],
    );
  }

  importVideoFrame(video: HTMLVideoElement): Texture {
    const frame: ExternalTextureRef = {
      external: this.device.importExternalTexture({ source: video }),
      width: video.videoWidth,
      height: video.videoHeight,
    };
    // External textures expire when the task ends; the passes using this one
    // are submitted by the microtask flush queued with the encoder
    this.getEncoder();
    return frame;
  }

  releaseVideoFrames(): void {
    // External textures hold no memory of their own
  }

  tint(
    source: Texture,
    target: Target,
    color: [number, number, number],
    intensity: number,
  ): void {
    this.pass("tint", target, [...color, intensity], [source]);
  }

  blur(source: Texture, target: Target, offset: number): void {
    this.pass("blur", target, [target.width, target.height, offset], [source]);
  }

  blend(from: Texture, to: Texture, target: Target, amount: number): void {
    this.pass("blend", target, [amount], [from, to]);
  }

  warp(source: Texture, target: Target, time: number, intensity: number): void {
    this.pass("warp", target, [time, intensity], [source]);
  }

  downsample(source: Texture, target: Target, flipY: boolean): void {
    this.pass(
      isExternal(source) ? "downsampleExternal" : "downsample",
      target,
      [1 / target.width, 1 / target.height, flipY ? 1 : 0],
      [source],
    );
  }

  smoothing(
    source: Texture,
    history: Texture,
    target: Target,
    response: number,
    minStep: number,
  ): void {
    this.pass("smoothing", target, [response, minStep], [source, history]);
  }

  output(
    source: Texture,
    width: number,
    height: number,
    params: OutputParams,
  ): void {
    const surface = this.context.getCurrentTexture();
    this.encodePass(
      "output",
      this.canvasFormat,
      surface.createView(),
      [
        ...[params.saturation, params.dithering, params.scale, 0],
        ...[...params.noiseOffset, 0, 0],
        // Red, green, and blue texel shifts, then padding
        ...BLUE_NOISE_CHANNEL_OFFSETS,
        0,
        0,
      ],
      [source, this.blueNoise],
      [width, height],
    );
    // Submit now so the canvas shows this frame within the current task
    this.flush();
  }

  async readPixels(
    target: Target,
    isDisposed: () => boolean,
  ): Promise<Uint8Array | null> {
    const { width, height } = target;
    const rowBytes = width * 4;
    // Buffer copies need rows padded to 256 bytes
    const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
    const buffer = this.device.createBuffer({
      size: paddedRowBytes * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.getEncoder().copyTextureToBuffer(
      { texture: (target as GPUTargetRef).texture.texture },
      { buffer, bytesPerRow: paddedRowBytes },
      [width, height],
    );
    this.flush();
    try {
      await buffer.mapAsync(GPUMapMode.READ);
    } catch {
      buffer.destroy();
      return null;
    }
    if (isDisposed()) {
      buffer.destroy();
      return null;
    }
    const padded = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8Array(rowBytes * height);
    for (let row = 0; row < height; row++) {
      pixels.set(
        padded.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes),
        row * rowBytes,
      );
    }
    buffer.unmap();
    buffer.destroy();
    return pixels;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flush();
    this.imageTexture.texture.destroy();
    this.blueNoise.texture.destroy();
    for (const buffer of this.uniformBuffers) buffer.destroy();
    // Leave the context configured so the last frame stays on screen, as it
    // does with WebGL. A frame drawn in this task is presented at the next
    // rendering update, and destroying the device first would blank it.
    const device = this.device;
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      device.destroy();
    };
    requestAnimationFrame(() => setTimeout(destroy, 0));
    // Background tabs skip animation frames
    setTimeout(destroy, 1000);
  }

  private pass(
    shader: ShaderName,
    target: Target,
    uniforms: number[],
    textures: Texture[],
  ): void {
    const texture = (target as GPUTargetRef).texture;
    this.encodePass(
      shader,
      texture.texture.format,
      texture.view,
      uniforms,
      textures,
      [target.width, target.height],
    );
  }

  private encodePass(
    shader: ShaderName,
    format: GPUTextureFormat,
    view: GPUTextureView,
    uniforms: number[],
    textures: Texture[],
    [width, height]: [number, number],
  ): void {
    const device = this.device;
    const pipeline = this.getPipeline(shader, format);
    const uniformSlot = this.uniformsUsed;
    const uniformBuffer = this.nextUniformBuffer();
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniforms));

    const cacheable = !textures.some(isExternal);
    const key = cacheable
      ? `${shader}:${format}:${uniformSlot}:${textures
          .map((texture) => (texture as GPUTextureRef).id)
          .join(",")}`
      : "";
    let bindGroup = cacheable ? this.bindGroups.get(key) : undefined;
    if (!bindGroup) {
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: this.sampler },
          ...textures.map((texture, i) => ({
            binding: 2 + i,
            resource: isExternal(texture)
              ? texture.external
              : (texture as GPUTextureRef).view,
          })),
        ],
      });
      if (cacheable) this.bindGroups.set(key, bindGroup);
    }
    const pass = this.getEncoder().beginRenderPass({
      colorAttachments: [
        { view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
      ],
    });
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private getPipeline(
    shader: ShaderName,
    format: GPUTextureFormat,
  ): GPURenderPipeline {
    const key = `${shader}:${format}`;
    let pipeline = this.pipelines.get(key);
    if (pipeline) return pipeline;
    let module = this.modules.get(shader);
    if (!module) {
      module = this.device.createShaderModule({
        code: VERTEX + SHADERS[shader],
      });
      this.modules.set(shader, module);
    }
    pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: shader === "output" ? "vs_screen" : "vs_target",
      },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  private getEncoder(): GPUCommandEncoder {
    if (!this.encoder) {
      this.encoder = this.device.createCommandEncoder();
      queueMicrotask(() => this.flush());
    }
    return this.encoder;
  }

  private flush(): void {
    if (this.encoder) {
      this.device.queue.submit([this.encoder.finish()]);
      this.encoder = null;
    }
    this.uniformsUsed = 0;
    for (const texture of this.pendingDestroy) texture.destroy();
    this.pendingDestroy = [];
  }

  private nextUniformBuffer(): GPUBuffer {
    let buffer = this.uniformBuffers[this.uniformsUsed];
    if (!buffer) {
      buffer = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniformBuffers.push(buffer);
    }
    this.uniformsUsed++;
    return buffer;
  }

  private createTexture(
    width: number,
    height: number,
    format: GPUTextureFormat,
  ): GPUTextureRef {
    const texture = this.device.createTexture({
      size: [Math.max(1, width), Math.max(1, height)],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    return {
      id: this.nextTextureId++,
      texture,
      view: texture.createView(),
      width,
      height,
    };
  }

  private resizeImageTexture(width: number, height: number): void {
    const image = this.imageTexture;
    if (image.width === width && image.height === height) return;
    this.destroyTexture(image.texture);
    const next = this.createTexture(width, height, "rgba8unorm");
    image.id = next.id;
    image.texture = next.texture;
    image.view = next.view;
    image.width = width;
    image.height = height;
  }

  private destroyTexture(texture: GPUTexture): void {
    // Rare (resizes, new video layouts), so dropping every cached group is fine
    this.bindGroups.clear();
    if (this.encoder) this.pendingDestroy.push(texture);
    else texture.destroy();
  }
}
