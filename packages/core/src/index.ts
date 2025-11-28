/**
 * Kawarp - Fluid Animated Background Renderer
 *
 * Creates a fluid, animated background effect similar to Apple Music's album art visualization.
 * Uses WebGL with Kawase blur and domain warping techniques.
 *
 * Optimized architecture:
 * - Blur runs on small textures (128x128) only when image changes
 * - Smooth crossfade transitions between images
 * - Per-frame work is minimal: just blend + warp + output
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
}

interface Framebuffer {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

// Size for blur operations (small = fast)
const BLUR_SIZE = 128;

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
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  highp float hash(highp vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);

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
  private hasImage = false;

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
      resolution: WebGLUniformLocation;
    };
  };

  constructor(canvas: HTMLCanvasElement, options: KawarpOptions = {}) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this.halfFloatExt = gl.getExtension("OES_texture_half_float");
    this.halfFloatLinearExt = gl.getExtension("OES_texture_half_float_linear");

    this._warpIntensity = options.warpIntensity ?? 1.0;
    this._blurPasses = options.blurPasses ?? 8;
    this._animationSpeed = options.animationSpeed ?? 1.0;
    this._targetAnimationSpeed = this._animationSpeed;
    this._transitionDuration = options.transitionDuration ?? 1000;
    this._saturation = options.saturation ?? 1.5;
    this._tintColor = options.tintColor ?? [0.157, 0.157, 0.235];
    this._tintIntensity = options.tintIntensity ?? 0.15;
    this._dithering = options.dithering ?? 0.008;

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

    // Create small FBOs for blur operations (high precision to avoid banding)
    this.blurFBO1 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.blurFBO2 = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);

    // Create album FBOs for crossfade (high precision to avoid banding)
    this.currentAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);
    this.nextAlbumFBO = this.createFramebuffer(BLUR_SIZE, BLUR_SIZE, true);

    // Create full-res warp FBO (will be resized)
    this.warpFBO = this.createFramebuffer(1, 1, true);

    this.resize();
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
    const newValue = Math.max(1, Math.min(40, Math.floor(value)));
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
    this._targetAnimationSpeed = Math.max(0.1, Math.min(5, value));
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
    };
  }

  // Image loading methods
  loadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.RGBA,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          img,
        );
        this.processNewImage();
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  loadImageElement(source: TexImageSource): void {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    this.processNewImage();
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
    this.processNewImage();
  }

  loadFromImageData(imageData: ImageData): void {
    this.loadImageData(imageData.data, imageData.width, imageData.height);
  }

  async loadBlob(blob: Blob): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    this.loadImageElement(bitmap);
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
   * Process a new image: blur it and start transition
   * This is the key optimization - blur only runs here, not every frame!
   */
  private processNewImage(): void {
    // Swap album FBOs - current becomes the "from", we'll render "to" into next
    [this.currentAlbumFBO, this.nextAlbumFBO] = [
      this.nextAlbumFBO,
      this.currentAlbumFBO,
    ];

    // Blur into nextAlbumFBO
    this.blurSourceInto(this.nextAlbumFBO);

    // Mark that we have an image
    this.hasImage = true;

    // Start transition
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
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
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
      [readFBO, writeFBO] = [writeFBO, readFBO];
    }

    // Step 3: Copy final blur result to target FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO.framebuffer);
    gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);
    gl.uniform1f(this.uniforms.blur.offset, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  resize(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Only warpFBO needs to be canvas size
    if (this.warpFBO) this.deleteFramebuffer(this.warpFBO);
    this.warpFBO = this.createFramebuffer(width, height, true);
  }

  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.renderLoop);
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
    this.stop();
    const gl = this.gl;

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
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Calculate transition blend factor
    let blendFactor = 1.0;
    if (this.isTransitioning) {
      const elapsed = timestamp - this.transitionStartTime;
      blendFactor = Math.min(1.0, elapsed / this._transitionDuration);
      if (blendFactor >= 1.0) {
        this.isTransitioning = false;
      }
    }

    // Step 1: Blend album FBOs (or use current if not transitioning)
    let blendedTexture: WebGLTexture;

    if (this.isTransitioning && blendFactor < 1.0) {
      // Blend current → next at small resolution (same as album FBOs)
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

      gl.uniform1f(this.uniforms.blend.blend, blendFactor);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      blendedTexture = this.blurFBO1.texture;

      // Warp upscales the blended result to full resolution
      gl.useProgram(this.warpProgram);
      this.setupAttributes();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blendedTexture);
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
      gl.uniform2f(this.uniforms.output.resolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      // No transition - just warp the current album directly
      gl.useProgram(this.warpProgram);
      this.setupAttributes();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture);
      gl.uniform1i(this.uniforms.warp.texture, 0);
      gl.uniform1f(this.uniforms.warp.time, time);
      gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Output with vignette, saturation and dithering
      gl.useProgram(this.outputProgram);
      this.setupAttributes();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture);
      gl.uniform1i(this.uniforms.output.texture, 0);
      gl.uniform1f(this.uniforms.output.saturation, this._saturation);
      gl.uniform1f(this.uniforms.output.dithering, this._dithering);
      gl.uniform1f(this.uniforms.output.time, time);
      gl.uniform2f(this.uniforms.output.resolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
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

    gl.shaderSource(shader, source);
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
    return { framebuffer, texture };
  }

  private deleteFramebuffer(fbo: Framebuffer): void {
    this.gl.deleteFramebuffer(fbo.framebuffer);
    this.gl.deleteTexture(fbo.texture);
  }
}

export default Kawarp;
