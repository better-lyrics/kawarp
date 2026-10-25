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

// Dithers each channel with its own blue noise, reshaped to a triangular
// distribution so the noise level does not vary with the signal
const OUTPUT_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform sampler2D u_blueNoise;
  uniform float u_saturation;
  uniform float u_dithering;
  uniform float u_scale;
  uniform vec2 u_noiseOffset;
  uniform vec2 u_channelOffsets[3];
  varying vec2 v_texCoord;

  float blueNoise(vec2 offset) {
    vec2 texel = gl_FragCoord.xy + u_noiseOffset + offset;
    return (texture2D(u_blueNoise, texel / ${BLUE_NOISE_SIZE}.0).r * 255.0 + 0.5) / 256.0;
  }

  // Uniform (0, 1) to triangular (-1, 1)
  float triangular(float u) {
    float v = u * 2.0 - 1.0;
    return sign(v) * (1.0 - sqrt(1.0 - abs(v)));
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

    vec3 noise = vec3(
      triangular(blueNoise(u_channelOffsets[0])),
      triangular(blueNoise(u_channelOffsets[1])),
      triangular(blueNoise(u_channelOffsets[2]))
    );
    color.rgb += noise * (u_dithering * 0.5);

    gl_FragColor = color;
  }
`;

// Four bilinear taps average a 4x4 source footprint for reductions up to 4x.
// u_flipY turns top-down video uploads upright without UNPACK_FLIP_Y_WEBGL,
// which can force browsers off their zero-copy video upload path.
const DOWNSAMPLE_SHADER = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform float u_flipY;
  varying vec2 v_texCoord;

  void main() {
    vec2 uv = vec2(v_texCoord.x, mix(v_texCoord.y, 1.0 - v_texCoord.y, u_flipY));
    vec2 offset = u_texelSize * 0.25;
    gl_FragColor = 0.25 * (
      texture2D(u_texture, uv + vec2(-offset.x, -offset.y)) +
      texture2D(u_texture, uv + vec2(offset.x, -offset.y)) +
      texture2D(u_texture, uv + vec2(-offset.x, offset.y)) +
      texture2D(u_texture, uv + vec2(offset.x, offset.y))
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

interface GLTexture extends Texture {
  readonly handle: WebGLTexture;
  width: number;
  height: number;
}

interface GLTarget extends Target {
  readonly texture: GLTexture;
  readonly framebuffer: WebGLFramebuffer;
}

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
};

export class WebGL2Renderer implements Renderer {
  readonly backend = "webgl2";
  readonly imageTexture: GLTexture;

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private _halfFloatTargets: boolean;
  private _float32Targets: boolean;
  private floatLinearFiltering: boolean;
  private _highPrecisionOutput = false;

  private blurProgram: Program;
  private blendProgram: Program;
  private tintProgram: Program;
  private warpProgram: Program;
  private outputProgram: Program;
  // Only video and sampleSource need these
  private downsampleProgram: Program | null = null;
  private smoothingProgram: Program | null = null;

  private positionBuffer: WebGLBuffer;
  private texCoordBuffer: WebGLBuffer;
  private attribs: { position: number; texCoord: number };
  private blueNoiseTexture: WebGLTexture;
  private videoTexture: GLTexture | null = null;
  private pixelBuffer: WebGLBuffer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    this._float32Targets = !!gl.getExtension("EXT_color_buffer_float");
    this._halfFloatTargets =
      this._float32Targets || !!gl.getExtension("EXT_color_buffer_half_float");
    this.floatLinearFiltering = !!gl.getExtension("OES_texture_float_linear");

    this.blurProgram = this.createProgram(KAWASE_BLUR_SHADER, [
      "u_resolution",
      "u_texture",
      "u_offset",
    ]);
    this.blendProgram = this.createProgram(BLEND_SHADER, [
      "u_texture1",
      "u_texture2",
      "u_blend",
    ]);
    this.tintProgram = this.createProgram(TINT_SHADER, [
      "u_texture",
      "u_tintColor",
      "u_tintIntensity",
    ]);
    this.warpProgram = this.createProgram(DOMAIN_WARP_SHADER, [
      "u_texture",
      "u_time",
      "u_intensity",
    ]);
    this.outputProgram = this.createProgram(OUTPUT_SHADER, [
      "u_texture",
      "u_blueNoise",
      "u_saturation",
      "u_dithering",
      "u_scale",
      "u_noiseOffset",
      "u_channelOffsets",
    ]);

    // Same vertex shader everywhere, so one set of attribute locations
    this.attribs = {
      position: gl.getAttribLocation(this.blurProgram.program, "a_position"),
      texCoord: gl.getAttribLocation(this.blurProgram.program, "a_texCoord"),
    };
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    );
    this.texCoordBuffer = this.createBuffer(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    );

    this.imageTexture = this.createTexture(0, 0);
    this.blueNoiseTexture = this.createBlueNoiseTexture();
  }

  get halfFloatTargets(): boolean {
    return this._halfFloatTargets;
  }

  get float32Targets(): boolean {
    return this._float32Targets;
  }

  get highPrecisionOutput(): boolean {
    return this._highPrecisionOutput;
  }

  configureOutput(highPrecision: boolean): void {
    if (!highPrecision) return;
    const gl = this.gl as FloatDrawingBufferContext;
    if (!gl.drawingBufferStorage || !this._halfFloatTargets) return;
    gl.drawingBufferStorage(
      gl.RGBA16F,
      Math.max(1, this.canvas.width),
      Math.max(1, this.canvas.height),
    );
    this._highPrecisionOutput = gl.drawingBufferFormat === gl.RGBA16F;
  }

  createTarget(width: number, height: number, format: TargetFormat): GLTarget {
    const gl = this.gl;
    if (format === "rgba16f" && !this._halfFloatTargets) format = "rgba8";
    const internalFormat =
      format === "rgba32f"
        ? gl.RGBA32F
        : format === "rgba16f"
          ? gl.RGBA16F
          : gl.RGBA8;
    const pixelType =
      format === "rgba32f"
        ? gl.FLOAT
        : format === "rgba16f"
          ? gl.HALF_FLOAT
          : gl.UNSIGNED_BYTE;
    const texture = this.createTexture(width, height);
    if (format === "rgba32f" && !this.floatLinearFiltering) {
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
      texture.handle,
      0,
    );

    // Float formats fall back to RGBA8 when the driver reports them incomplete
    if (
      format !== "rgba8" &&
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    ) {
      if (format === "rgba32f") this._float32Targets = false;
      else this._halfFloatTargets = false;
      format = "rgba8";
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
    return { texture, framebuffer, width, height, format };
  }

  deleteTarget(target: Target): void {
    const glTarget = target as GLTarget;
    this.gl.deleteFramebuffer(glTarget.framebuffer);
    this.gl.deleteTexture(glTarget.texture.handle);
  }

  uploadImage(source: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture.handle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    [this.imageTexture.width, this.imageTexture.height] =
      textureSourceSize(source);
  }

  uploadPixels(data: Uint8Array, width: number, height: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture.handle);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    this.imageTexture.width = width;
    this.imageTexture.height = height;
  }

  importVideoFrame(video: HTMLVideoElement): Texture {
    const gl = this.gl;
    this.videoTexture ??= this.createTexture(0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture.handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.videoTexture.width = video.videoWidth;
    this.videoTexture.height = video.videoHeight;
    return this.videoTexture;
  }

  releaseVideoFrames(): void {
    if (!this.videoTexture) return;
    this.gl.deleteTexture(this.videoTexture.handle);
    this.videoTexture = null;
  }

  tint(
    source: Texture,
    target: Target,
    color: [number, number, number],
    intensity: number,
  ): void {
    const gl = this.gl;
    const { uniforms } = this.beginPass(this.tintProgram, target);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform3fv(uniforms.u_tintColor ?? null, color);
    gl.uniform1f(uniforms.u_tintIntensity ?? null, intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  blur(source: Texture, target: Target, offset: number): void {
    const gl = this.gl;
    const { uniforms } = this.beginPass(this.blurProgram, target);
    gl.uniform2f(uniforms.u_resolution ?? null, target.width, target.height);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform1f(uniforms.u_offset ?? null, offset);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  blend(from: Texture, to: Texture, target: Target, amount: number): void {
    const gl = this.gl;
    const { uniforms } = this.beginPass(this.blendProgram, target);
    this.bindTexture(0, from, uniforms.u_texture1);
    this.bindTexture(1, to, uniforms.u_texture2);
    gl.uniform1f(uniforms.u_blend ?? null, amount);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  warp(source: Texture, target: Target, time: number, intensity: number): void {
    const gl = this.gl;
    const { uniforms } = this.beginPass(this.warpProgram, target);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform1f(uniforms.u_time ?? null, time);
    gl.uniform1f(uniforms.u_intensity ?? null, intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  downsample(source: Texture, target: Target, flipY: boolean): void {
    const gl = this.gl;
    this.downsampleProgram ??= this.createProgram(DOWNSAMPLE_SHADER, [
      "u_texture",
      "u_texelSize",
      "u_flipY",
    ]);
    const { uniforms } = this.beginPass(this.downsampleProgram, target);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform2f(
      uniforms.u_texelSize ?? null,
      1 / target.width,
      1 / target.height,
    );
    gl.uniform1f(uniforms.u_flipY ?? null, flipY ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  smoothing(
    source: Texture,
    history: Texture,
    target: Target,
    response: number,
    minStep: number,
  ): void {
    const gl = this.gl;
    this.smoothingProgram ??= this.createProgram(SMOOTHING_SHADER, [
      "u_texture",
      "u_history",
      "u_response",
      "u_minStep",
    ]);
    const { uniforms } = this.beginPass(this.smoothingProgram, target);
    this.bindTexture(1, history, uniforms.u_history);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform1f(uniforms.u_response ?? null, response);
    gl.uniform1f(uniforms.u_minStep ?? null, minStep);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  output(
    source: Texture,
    width: number,
    height: number,
    params: OutputParams,
  ): void {
    const gl = this.gl;
    const { uniforms } = this.outputProgram;
    gl.useProgram(this.outputProgram.program);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blueNoiseTexture);
    gl.uniform1i(uniforms.u_blueNoise ?? null, 1);
    this.bindTexture(0, source, uniforms.u_texture);
    gl.uniform1f(uniforms.u_saturation ?? null, params.saturation);
    gl.uniform1f(uniforms.u_dithering ?? null, params.dithering);
    gl.uniform1f(uniforms.u_scale ?? null, params.scale);
    gl.uniform2f(uniforms.u_noiseOffset ?? null, ...params.noiseOffset);
    gl.uniform2fv(
      uniforms.u_channelOffsets ?? null,
      BLUE_NOISE_CHANNEL_OFFSETS,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  readPixels(
    target: Target,
    isDisposed: () => boolean,
  ): Promise<Uint8Array | null> {
    const gl = this.gl;
    const pixels = new Uint8Array(target.width * target.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, (target as GLTarget).framebuffer);
    this.pixelBuffer ??= gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, pixels.byteLength, gl.STREAM_READ);
    gl.readPixels(
      0,
      0,
      target.width,
      target.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      0,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return Promise.resolve(null);
    gl.flush();

    // Timers keep polling in background tabs, where animation frames stop
    return new Promise<Uint8Array | null>((resolve) => {
      const poll = () => {
        if (isDisposed()) {
          gl.deleteSync(fence);
          resolve(null);
          return;
        }
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) {
          setTimeout(poll, 4);
          return;
        }
        gl.deleteSync(fence);
        if (status === gl.WAIT_FAILED) {
          resolve(null);
          return;
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        resolve(pixels);
      };
      setTimeout(poll, 0);
    });
  }

  dispose(): void {
    const gl = this.gl;
    this.releaseVideoFrames();
    for (const program of [
      this.blurProgram,
      this.blendProgram,
      this.tintProgram,
      this.warpProgram,
      this.outputProgram,
      this.downsampleProgram,
      this.smoothingProgram,
    ]) {
      if (program) gl.deleteProgram(program.program);
    }
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texCoordBuffer);
    gl.deleteBuffer(this.pixelBuffer);
    gl.deleteTexture(this.imageTexture.handle);
    gl.deleteTexture(this.blueNoiseTexture);
  }

  private beginPass(program: Program, target: Target): Program {
    const gl = this.gl;
    gl.useProgram(program.program);
    this.setupAttributes();
    gl.bindFramebuffer(gl.FRAMEBUFFER, (target as GLTarget).framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    return program;
  }

  private bindTexture(
    unit: number,
    texture: Texture,
    location: WebGLUniformLocation | null | undefined,
  ): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, (texture as GLTexture).handle);
    gl.uniform1i(location ?? null, unit);
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
      type === gl.FRAGMENT_SHADER
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
    fragmentSource: string,
    uniformNames: string[],
  ): Program {
    const gl = this.gl;
    const vertexShader = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER);
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
    const uniforms: Program["uniforms"] = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }

  private createBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  private createTexture(width: number, height: number): GLTexture {
    const gl = this.gl;
    const handle = gl.createTexture();
    if (!handle) throw new Error("Failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { handle, width, height };
  }

  private createBlueNoiseTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      BLUE_NOISE_SIZE,
      BLUE_NOISE_SIZE,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      decodeBlueNoise(),
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return texture;
  }
}
